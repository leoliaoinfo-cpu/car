import { useState, useEffect, useRef } from 'react';
import html2canvas from 'html2canvas';
import { db } from '../../db';
import { generateId, formatMoney, calcMonthlyPayment, QUOTE_ADDON_CATS, DEFAULT_LOAN_TERMS } from '../../utils/crm';
import { useApp } from '../../context';
import dayjs from 'dayjs';
import { Field } from '../ui';
import ProductCatalog from '../catalog/ProductCatalog';
import {
  buildPricingRecord, calculateQuoteTotals, normalizeDiscount, normalizeQuoteItems,
  pricingSafetyStatus,
} from '../../utils/pricing';

/** 依類別分組配備，照 QUOTE_ADDON_CATS 順序排列（未知類別歸「其他」放最後）；
 *  每組內金額由高到低排序 */
function groupAddonsByCat(addons) {
  const map = new Map();
  for (const a of addons) {
    const cat = a.cat || '其他';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(a);
  }
  for (const list of map.values()) list.sort((x, y) => (Number(y.price) || 0) - (Number(x.price) || 0));
  const ordered = [];
  for (const cat of QUOTE_ADDON_CATS) if (map.has(cat)) { ordered.push([cat, map.get(cat)]); map.delete(cat); }
  for (const [cat, list] of map) ordered.push([cat, list]); // 剩下未列在順序中的
  return ordered;
}

// 類別顏色（視覺區分，莫蘭迪色）
const CAT_COLORS_Q = ['#bf8a5e', '#7d9b76', '#7291a8', '#9382a5', '#6f9a9c', '#b58a96', '#9a9a6f', '#8f7a68', '#a99760', '#b26b6b'];
function catColor(cat) {
  let h = 0;
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) >>> 0;
  return CAT_COLORS_Q[h % CAT_COLORS_Q.length];
}

/** 由字串推導 4 碼英數（報價單編號用，同輸入固定輸出） */
function shortHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h.toString(36).toUpperCase().padStart(4, '0').slice(-4);
}

/**
 * 報價單產生器：填車型與項目價格 → 產生美觀的報價單（固定淺色，方便截圖給客人）。
 * 新增模式（quote=null）會把總額寫入客戶時間軸；傳入既有 quote 則為編輯模式。
 */
export default function QuoteModal({ client, quote, onSaveQuote, onClose }) {
  const { quotePresets, costCatalog, pricingRecords } = useApp();
  const isEdit = !!quote;
  const [quoteId] = useState(() => quote?.id || generateId('quote'));
  const normalizedInitial = normalizeQuoteItems(quote?.items || []);
  const [model, setModel] = useState(quote?.model || '');
  const [modelId, setModelId] = useState(() => quote?.modelId
    || quotePresets.models?.find((row) => row.name === quote?.model)?.id
    || null);
  const [items, setItems] = useState(() =>
    normalizedInitial.items.length
      ? normalizedInitial.items.map((it) => ({
        ...it,
        price: String(it.price),
        discounts: (it.discounts || []).map((row) => ({ ...row, amount: String(row.amount) })),
      }))
      : [{ id: generateId('qi'), name: '車輛售價', price: '', kind: 'vehicle', catalogId: null, discounts: [] }]
  );
  const [generalDiscounts, setGeneralDiscounts] = useState(() => [
    ...(Array.isArray(quote?.generalDiscounts) ? quote.generalDiscounts : []),
    ...normalizedInitial.legacyDiscounts,
  ].map((row) => {
    const normalized = normalizeDiscount(row);
    return { ...normalized, amount: String(normalized.amount) };
  }));
  const [note, setNote] = useState(quote?.note || '');
  const [profile, setProfile] = useState({ name: '', phone: '' });
  const [watermark, setWatermark] = useState('報價僅供參考'); // 浮水印文字（設定可改，留空不顯示）
  const [showDesc, setShowDesc] = useState(false); // 配備介紹展開
  const [capturing, setCapturing] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false); // 產品型錄覆蓋層
  const previewRef = useRef(null);
  // 貸款試算：頭期（可用 % 或自訂金額）＋選期數；年利率由設定帶入、報價單不顯示
  const [loan, setLoan] = useState({
    down: quote?.loan?.down != null ? String(quote.loan.down) : '',
    downPct: null, // 選了百分比時依總價自動算頭期；自訂金額時為 null
    months: quote?.loan?.months != null ? String(quote.loan.months) : '',
  });
  // 期數/年利率表（設定帶入）
  const [loanTerms, setLoanTerms] = useState(DEFAULT_LOAN_TERMS);

  // 業務署名、浮水印、貸款月利率記在設定，下次自動帶入
  useEffect(() => {
    db.get('settings', 'quoteProfile')
      .then((row) => { if (row) setProfile({ name: row.name || '', phone: row.phone || '' }); })
      .catch(() => {});
    db.get('settings', 'quoteWatermark')
      .then((row) => { if (row) setWatermark(row.text || ''); })
      .catch(() => {});
    db.get('settings', 'quoteLoan')
      .then((row) => { if (Array.isArray(row?.terms) && row.terms.length) setLoanTerms(row.terms); })
      .catch(() => {});
  }, [quote]);

  function saveProfile(next) {
    setProfile(next);
    db.put('settings', { key: 'quoteProfile', ...next }).catch(() => {});
  }

  const validItems = items.filter((it) => it.name.trim() && Number(it.price) > 0);
  const validGeneralDiscounts = generalDiscounts
    .filter((row) => row.name.trim() && Number(row.amount) > 0);
  const totals = calculateQuoteTotals(validItems, validGeneralDiscounts);
  const total = totals.total;

  // 報價單編號：由日期＋此單 id 推導（同一張單編號固定，看起來更正式）
  const quoteNo = `Q${dayjs(quote?.date || undefined).format('YYMMDD')}-${shortHash(quote?.id || client?.id || 'new')}`;

  // 頭期：選了 % 依總價自動算，否則用自訂金額
  const effectiveDown = loan.downPct != null ? Math.round(total * loan.downPct / 100) : (Number(loan.down) || 0);
  const loanPrincipal = Math.max(0, total - effectiveDown);
  const selMonths = Number(loan.months) || 0;
  // 選到的期數對應年利率（設定帶入）；找不到就 0（單純除法）
  const selTerm = loanTerms.find((t) => Number(t.months) === selMonths);
  const annualRate = selTerm ? Number(selTerm.rate) || 0 : 0;
  const monthlyPay = calcMonthlyPayment(loanPrincipal, annualRate, selMonths);

  // 選車型：帶入車型名稱，並把「車輛售價」項目設為該車型售價
  function pickModel(m) {
    setModel(m.name);
    setModelId(m.id);
    setItems((list) => {
      const idx = list.findIndex((it) => it.kind === 'vehicle' || it.name.trim() === '車輛售價');
      if (idx !== -1) return list.map((it, i) => (i === idx ? {
        ...it, name: '車輛售價', price: String(m.price), kind: 'vehicle', catalogId: m.id,
      } : it));
      return [{
        id: generateId('qi'), name: '車輛售價', price: String(m.price),
        kind: 'vehicle', catalogId: m.id, discounts: [],
      }, ...list];
    });
  }

  // 此配備/折抵是否已在報價項目中（用於顯示已選狀態）
  const isPicked = (name) => items.some((it) => it.name.trim() === name);

  /** 切換一筆項目：已選→移除；未選→加入。有 group 者為擇一，加入時先移除同組其他項 */
  function toggleLine({ id: catalogId, name, price, group }) {
    setItems((list) => {
      const picked = list.some((it) => it.catalogId === catalogId || it.name.trim() === name);
      if (picked) {
        const next = list.filter((it) => it.catalogId !== catalogId && it.name.trim() !== name);
        return next.length ? next : [{ id: generateId('qi'), name: '', price: '', kind: 'other', catalogId: null, discounts: [] }];
      }
      let base = list;
      if (group) {
        const siblings = quotePresets.addons.filter((x) => x.group === group).map((x) => x.name);
        base = list.filter((it) => !siblings.includes(it.name.trim()));
      }
      const emptyIdx = base.findIndex((it) => !it.name.trim() && !Number(it.price));
      const value = { name, price: String(price), kind: 'addon', catalogId, discounts: [] };
      if (emptyIdx !== -1) return base.map((it, i) => (i === emptyIdx ? { ...it, ...value } : it));
      return [...base, { id: generateId('qi'), ...value }];
    });
  }

  function setItem(id, patch) {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((list) => [...list, {
      id: generateId('qi'), name: '', price: '', kind: 'other', catalogId: null, discounts: [],
    }]);
  }

  function removeItem(id) {
    setItems((list) => (list.length > 1 ? list.filter((it) => it.id !== id) : list));
  }

  function addItemDiscount(itemId) {
    setItems((list) => list.map((item) => (item.id === itemId ? {
      ...item,
      discounts: [...(item.discounts || []), { id: generateId('discount'), name: '專案優惠', amount: '' }],
    } : item)));
  }

  function setItemDiscount(itemId, discountId, patch) {
    setItems((list) => list.map((item) => {
      if (item.id !== itemId) return item;
      let nextPatch = patch;
      if (Object.prototype.hasOwnProperty.call(patch, 'amount')) {
        const other = (item.discounts || []).filter((row) => row.id !== discountId)
          .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
        const max = Math.max(0, (Number(item.price) || 0) - other);
        nextPatch = { ...patch, amount: String(Math.min(max, Math.max(0, Number(patch.amount) || 0))) };
      }
      return {
        ...item,
        discounts: (item.discounts || []).map((row) => (row.id === discountId ? { ...row, ...nextPatch } : row)),
      };
    }));
  }

  function removeItemDiscount(itemId, discountId) {
    setItems((list) => list.map((item) => (item.id === itemId
      ? { ...item, discounts: (item.discounts || []).filter((row) => row.id !== discountId) }
      : item)));
  }

  function addGeneralDiscount(row = null) {
    const value = row ? normalizeDiscount(row) : { name: '整單優惠', amount: 0 };
    setGeneralDiscounts((list) => [...list, {
      id: generateId('discount'), name: value.name, amount: value.amount ? String(value.amount) : '',
    }]);
  }

  function setGeneralDiscount(id, patch) {
    setGeneralDiscounts((list) => list.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeGeneralDiscount(id) {
    setGeneralDiscounts((list) => list.filter((row) => row.id !== id));
  }

  function makeQuotePayload() {
    return {
      id: quoteId,
      clientId: client?.id || null,
      date: quote?.date || dayjs().format('YYYY-MM-DD'),
      model: model.trim(),
      modelId,
      items: validItems.map((it) => ({
        id: it.id,
        catalogId: it.catalogId || null,
        kind: it.kind || 'other',
        name: it.name.trim(),
        price: Number(it.price) || 0,
        discounts: (it.discounts || [])
          .filter((row) => row.name.trim() && Number(row.amount) > 0)
          .map((row) => ({ id: row.id, name: row.name.trim(), amount: Number(row.amount) || 0 })),
      })),
      generalDiscounts: validGeneralDiscounts.map((row) => ({
        id: row.id, name: row.name.trim(), amount: Number(row.amount) || 0,
      })),
      originalTotal: totals.originalTotal,
      itemDiscountTotal: totals.itemDiscountTotal,
      generalDiscountTotal: totals.generalDiscountTotal,
      discountTotal: totals.discountTotal,
      total,
      note: note.trim(),
      loan: { down: effectiveDown, months: selMonths, rate: annualRate },
      text: `報價單：${model.trim() || '未填車型'}｜${validItems.map((i) => i.name.trim()).join('、')}`,
    };
  }

  function pricingForCurrentQuote() {
    const draft = makeQuotePayload();
    const existing = pricingRecords.find((row) => row.id === `quote:${quoteId}`) || null;
    return buildPricingRecord({ quote: draft, costCatalog, existing });
  }

  function confirmPricingSafety() {
    const pricing = pricingForCurrentQuote();
    const status = pricingSafetyStatus(pricing);
    if (status === 'incomplete') {
      return window.confirm('內部提醒：部分項目的成本尚未設定，現在無法完整確認是否低於成本。仍要繼續嗎？');
    }
    if (status === 'belowCost') {
      return window.confirm('內部警告：這張報價已低於設定成本。請再次確認，仍要繼續嗎？');
    }
    return true;
  }

  // 把整張報價單（不論多長）輸出成一張 PNG；手機優先叫系統分享（可存相簿/傳 LINE）
  async function downloadImage() {
    const src = previewRef.current;
    if (!src || capturing) return;
    if (!confirmPricingSafety()) return;
    setCapturing(true);
    // 複製一份到畫面外、完整展開（脫離捲動容器），避免 html2canvas 裁掉底部
    const clone = src.cloneNode(true);
    clone.style.position = 'fixed';
    clone.style.top = '0';
    clone.style.left = '-10000px';
    clone.style.margin = '0';
    clone.style.width = `${src.offsetWidth}px`; // 保持與畫面上相同的斷行
    document.body.appendChild(clone);
    try {
      const canvas = await html2canvas(clone, {
        scale: Math.min(2, window.devicePixelRatio || 1) * 1.5,
        backgroundColor: '#ffffff', useCORS: true, logging: false,
        width: clone.offsetWidth, height: clone.offsetHeight,
        windowWidth: clone.offsetWidth, windowHeight: clone.offsetHeight,
      });
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('capture failed');
      const fileName = `報價單-${(client?.name || '客戶').replace(/[\\/:*?"<>|]/g, '')}-${dayjs().format('YYYYMMDD')}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });
      // 行動裝置：系統分享（iPhone 可存到照片或直接傳 LINE）
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); }
        catch { /* 使用者取消分享 */ }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      alert('圖片產生失敗，請改用截圖。');
    } finally {
      if (clone.parentNode) clone.parentNode.removeChild(clone);
      setCapturing(false);
    }
  }

  async function handleRecord() {
    if (!confirmPricingSafety()) return;
    const payload = makeQuotePayload();
    await onSaveQuote({ ...payload, _pricingRecord: pricingForCurrentQuote() });
  }

  const previewGroups = [
    { key: 'vehicle', label: '車輛', rows: validItems.filter((item) => item.kind === 'vehicle') },
    { key: 'addon', label: '專屬改裝', rows: validItems.filter((item) => item.kind === 'addon') },
    { key: 'other', label: '其他費用', rows: validItems.filter((item) => item.kind !== 'vehicle' && item.kind !== 'addon') },
  ].filter((group) => group.rows.length > 0);

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="fixed inset-0 z-50 overflow-y-auto p-4 flex items-start justify-center">
        <div className="bg-s1 rounded-2xl shadow-panel border border-bdr w-full max-w-md md:max-w-2xl p-4 md:p-5 anim-scale-in my-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-lg text-ink">🧾 {isEdit ? '編輯報價單' : '報價單產生器'}</h3>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setShowCatalog(true)}
                className="btn-outline text-xs gap-1 py-1">📖 看型錄</button>
              <button onClick={onClose} className="btn-ghost text-xl leading-none px-2 py-1">✕</button>
            </div>
          </div>

          {/* 輸入區 */}
          <div className="space-y-2 mb-4">
            <Field label="車型">
              <div className="flex gap-2">
                <input value={model} onChange={(e) => { setModel(e.target.value); setModelId(null); }}
                  placeholder="例：單廂三人座 手排六速" className="flex-1 min-w-0 text-sm" />
                {quotePresets.models?.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => { const m = quotePresets.models.find((x) => x.id === e.target.value); if (m) pickModel(m); }}
                    className="text-xs shrink-0 w-28"
                  >
                    <option value="">選車型帶入</option>
                    {quotePresets.models.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}（{formatMoney(m.price)}）</option>
                    ))}
                  </select>
                )}
              </div>
            </Field>

            {/* 選購配備（依類別分組、組內金額由高到低；可展開看產品介紹） */}
            {quotePresets.addons.length > 0 && (
              <div className="bg-s2 rounded-xl p-2.5 md:p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink-2">🚚 選購配備</span>
                  <button type="button" onClick={() => setShowDesc((v) => !v)}
                    className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${
                      showDesc ? 'bg-accent text-on-accent' : 'text-accent hover:bg-accent/10'}`}>
                    {showDesc ? '✓ 顯示介紹中' : '📖 看產品介紹'}
                  </button>
                </div>
                <p className="text-[10px] text-ink-3 -mt-1">點選即加入、再點取消；已選會反白。車身改色 / 防刮尾門 / 後照鏡為擇一，換新的自動取代。</p>
                {groupAddonsByCat(quotePresets.addons).map(([cat, list]) => {
                  const color = catColor(cat);
                  // 整個類別同屬一個擇一群組時才標「擇一」（例如車身改色底色、防刮尾門尺寸）
                  const groupSet = new Set(list.map((a) => a.group || ''));
                  const allOneGroup = list.length > 1 && groupSet.size === 1 && !groupSet.has('');
                  return (
                    <div key={cat}>
                      {/* 類別標題 */}
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="w-1 h-3.5 rounded-full shrink-0" style={{ background: color }} />
                        <span className="text-[11px] font-semibold" style={{ color }}>{cat}</span>
                        <span className="text-[10px] text-ink-3">{list.length}</span>
                        {allOneGroup && <span className="text-[9px] px-1 rounded bg-s3 text-ink-3">擇一</span>}
                      </div>
                      {showDesc ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {list.map((a) => {
                            const picked = isPicked(a.name);
                            return (
                              <div key={a.id}
                                className={`flex flex-col rounded-lg px-2.5 py-2 border transition-colors ${picked ? '' : 'bg-s1 border-bdr/50'}`}
                                style={picked ? { background: color + '18', borderColor: color } : undefined}>
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-xs text-ink font-medium leading-snug">
                                    {picked && <span style={{ color }}>✓ </span>}{a.name}
                                  </p>
                                  <span className="text-xs font-bold shrink-0" style={{ color }}>{formatMoney(a.price)}</span>
                                </div>
                                {a.desc && <p className="text-[10px] text-ink-3 mt-1 leading-relaxed">{a.desc}</p>}
                                <button type="button" onClick={() => toggleLine(a)}
                                  className="text-[10px] px-2 py-0.5 mt-1.5 self-end rounded-md border transition-colors"
                                  style={picked ? { background: color, borderColor: color, color: '#fff' } : { borderColor: color + '66', color }}>
                                  {picked ? '✓ 已加入' : '＋ 加入報價'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex gap-1.5 flex-wrap">
                          {list.map((a) => {
                            const picked = isPicked(a.name);
                            return (
                              <button key={a.id} type="button" title={a.desc || ''}
                                onClick={() => toggleLine(a)}
                                className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] transition-colors"
                                style={picked
                                  ? { background: color, borderColor: color, color: '#fff' }
                                  : { borderColor: color + '55' }}>
                                {picked && <span>✓</span>}
                                <span style={picked ? { color: '#fff' } : undefined} className={picked ? '' : 'text-ink-2'}>{a.name}</span>
                                <span className="font-semibold" style={{ color: picked ? '#fff' : color }}>{formatMoney(a.price)}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {/* 整單優惠範本：加入後才出現可編輯欄位 */}
            {quotePresets.subsidies.length > 0 && (
              <div className="flex gap-1.5 flex-wrap items-center">
                <span className="text-[11px] text-ink-3 shrink-0">🏷 優惠範本：</span>
                {quotePresets.subsidies.map((s) => (
                  <button key={s.id} type="button" onClick={() => addGeneralDiscount(s)}
                    className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border text-ok border-ok/40 hover:bg-ok/10">
                    ＋ {s.name} -{formatMoney(Math.abs(s.amount))}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2 text-[11px] font-medium text-ink-3">
              <span className="flex-1">項目名稱</span>
              <span className="w-28">金額（元）</span>
              <span className="w-4" />
            </div>
            {items.map((it) => {
              const selected = it.name.trim() && Number(it.price) > 0;
              const discountSum = (it.discounts || []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
              return (
                <div key={it.id} className="rounded-xl border border-bdr bg-s1 p-2.5 space-y-2">
                  <div className="flex gap-2">
                    <input value={it.name} onChange={(e) => setItem(it.id, { name: e.target.value })}
                      placeholder="配備 / 保險 / 領牌…" className="flex-1 text-sm min-w-0" />
                    <input type="number" min="0" value={it.price}
                      onChange={(e) => setItem(it.id, { price: e.target.value })}
                      className="w-28 text-sm" />
                    <button onClick={() => removeItem(it.id)}
                      className="text-danger/50 hover:text-danger shrink-0 px-1">✕</button>
                  </div>
                  {selected && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-ink-3">
                        {(it.discounts || []).length > 0
                          ? `已優惠 ${formatMoney(discountSum)}・折後 ${formatMoney(Math.max(0, Number(it.price) - discountSum))}`
                          : '此項目目前沒有優惠'}
                      </span>
                      <button type="button" onClick={() => addItemDiscount(it.id)}
                        className="text-[11px] text-accent hover:bg-accent/10 rounded-lg px-2 py-1 shrink-0">
                        ＋ 新增優惠折扣
                      </button>
                    </div>
                  )}
                  {(it.discounts || []).length > 0 && (
                    <div className="space-y-1.5 border-l-2 border-ok/40 pl-2">
                      {it.discounts.map((discount) => (
                        <div key={discount.id} className="flex gap-2 items-center">
                          <input value={discount.name}
                            onChange={(e) => setItemDiscount(it.id, discount.id, { name: e.target.value })}
                            placeholder="優惠名稱" className="flex-1 text-xs min-w-0" />
                          <input type="number" min="0" value={discount.amount}
                            onChange={(e) => setItemDiscount(it.id, discount.id, { amount: e.target.value })}
                            placeholder="折扣金額" className="w-28 text-xs" />
                          <button type="button" onClick={() => removeItemDiscount(it.id, discount.id)}
                            className="text-danger/50 hover:text-danger px-1">✕</button>
                        </div>
                      ))}
                      <p className="text-[10px] text-ink-3">單項優惠合計不會超過此項目售價；更多折扣請放到下方整單優惠。</p>
                    </div>
                  )}
                </div>
              );
            })}
            <button onClick={addItem} className="btn-outline text-xs">＋ 新增項目</button>

            <div className="bg-ok/5 border border-ok/25 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-ink-2">🏷 總優惠折扣區</p>
                  <p className="text-[10px] text-ink-3">放不屬於單一項目的活動、補助或整單折抵。</p>
                </div>
                <button type="button" onClick={() => addGeneralDiscount()}
                  className="btn-outline text-[11px] shrink-0">＋ 新增整單優惠</button>
              </div>
              {generalDiscounts.map((discount) => (
                <div key={discount.id} className="flex gap-2 items-center">
                  <input value={discount.name}
                    onChange={(e) => setGeneralDiscount(discount.id, { name: e.target.value })}
                    placeholder="優惠名稱" className="flex-1 text-xs min-w-0" />
                  <input type="number" min="0" value={discount.amount}
                    onChange={(e) => setGeneralDiscount(discount.id, { amount: e.target.value })}
                    placeholder="折扣金額" className="w-28 text-xs" />
                  <button type="button" onClick={() => removeGeneralDiscount(discount.id)}
                    className="text-danger/50 hover:text-danger px-1">✕</button>
                </div>
              ))}
              {generalDiscounts.length === 0 && <p className="text-[11px] text-ink-3">尚未加入整單優惠。</p>}
            </div>

            {/* 貸款試算：頭期＋選期數（年利率在設定，報價單不顯示利率） */}
            <div className="bg-s2 rounded-lg p-2.5 space-y-2">
              <p className="text-[11px] font-medium text-ink-2">🏦 貸款試算（選填）</p>
              <div>
                <p className="text-[11px] text-ink-3 mb-1">頭期款</p>
                <div className="flex gap-1.5 flex-wrap items-center">
                  {[0, 10, 20, 30].map((p) => {
                    const sel = loan.downPct === p;
                    return (
                      <button key={p} type="button"
                        onClick={() => setLoan((v) => ({ ...v, downPct: sel ? null : p, down: '' }))}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                          sel ? 'bg-accent text-on-accent border-accent' : 'border-bdr text-ink-2 hover:bg-s3'}`}>
                        {p === 0 ? '免頭款' : `${p}%`}
                      </button>
                    );
                  })}
                  <input type="number" min="0" placeholder="自訂金額"
                    value={loan.downPct != null ? '' : loan.down}
                    onChange={(e) => setLoan((v) => ({ ...v, down: e.target.value, downPct: null }))}
                    className="text-xs w-24" />
                </div>
                {effectiveDown > 0 && (
                  <p className="text-[10px] text-ink-3 mt-1">頭期 NT$ {formatMoney(effectiveDown)}</p>
                )}
              </div>
              <div>
                <p className="text-[11px] text-ink-3 mb-1">選擇期數（點一下算月付）</p>
                <div className="flex gap-1.5 flex-wrap">
                  {loanTerms.map((t) => {
                    const sel = selMonths === Number(t.months);
                    return (
                      <button key={t.months} type="button"
                        onClick={() => setLoan((v) => ({ ...v, months: sel ? '' : String(t.months) }))}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                          sel ? 'bg-accent text-on-accent border-accent' : 'border-bdr text-ink-2 hover:bg-s3'}`}>
                        {t.months} 期
                      </button>
                    );
                  })}
                </div>
              </div>
              {monthlyPay > 0 && (
                <div className="flex items-baseline justify-between bg-s1 rounded-lg px-3 py-2">
                  <span className="text-[11px] text-ink-3">分 {selMonths} 期</span>
                  <span className="text-sm text-ink">每月只要 <strong className="text-accent text-base">NT$ {formatMoney(monthlyPay)}</strong></span>
                </div>
              )}
              {selMonths > 0 && monthlyPay === 0 && (
                <p className="text-[10px] text-ink-3">此期數尚未在「設定 → 報價選單」設定年利率</p>
              )}
            </div>

            <Field label="備註">
              <input value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="有效期限、交車條件…" className="w-full text-sm" />
            </Field>
            <div className="flex gap-2">
              <Field label="業務姓名" className="flex-1">
                <input value={profile.name} onChange={(e) => saveProfile({ ...profile, name: e.target.value })}
                  className="w-full text-sm min-w-0" />
              </Field>
              <Field label="聯絡電話" className="flex-1">
                <input value={profile.phone} onChange={(e) => saveProfile({ ...profile, phone: e.target.value })}
                  className="w-full text-sm min-w-0" />
              </Field>
            </div>
          </div>

          {/* 報價單預覽 — 固定淺色、專業排版，可下載成整張 PNG */}
          <div ref={previewRef} className="mx-auto" style={{
            position: 'relative', maxWidth: 380, background: '#ffffff', borderRadius: 14, overflow: 'hidden',
            boxShadow: '0 8px 30px rgba(45,58,66,0.18)', border: '1px solid #eceef1',
            fontFamily: '"PingFang TC","Microsoft JhengHei","Noto Sans TC",sans-serif',
          }}>
            {/* 浮水印：設定可自訂文字（留空不顯示）；截圖轉傳時品牌隨行、也防止竄改 */}
            {watermark && (
              <div aria-hidden style={{
                position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none',
                display: 'flex', flexWrap: 'wrap', alignContent: 'center', justifyContent: 'center',
                transform: 'rotate(-24deg) scale(1.5)', opacity: 0.05,
              }}>
                {Array.from({ length: 30 }).map((_, i) => (
                  <span key={i} style={{ color: '#2e3a42', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', margin: '9px 14px' }}>
                    {watermark}
                  </span>
                ))}
              </div>
            )}
            {/* 信頭 */}
            <div style={{ position: 'relative', zIndex: 1, background: 'linear-gradient(135deg,#3f4d5a 0%,#2b343d 100%)', padding: '22px 24px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <p style={{ color: '#fff', fontSize: 24, fontWeight: 800, letterSpacing: 8, lineHeight: 1 }}>報價單</p>
                  <p style={{ color: '#9db3c4', fontSize: 10, letterSpacing: 3, marginTop: 5 }}>QUOTATION</p>
                </div>
                <div style={{ textAlign: 'right', paddingTop: 3 }}>
                  <p style={{ color: '#c9d6e0', fontSize: 10.5, fontFamily: 'monospace' }}>No. {quoteNo}</p>
                  <p style={{ color: '#c9d6e0', fontSize: 10.5, marginTop: 3 }}>
                    {dayjs(quote?.date || undefined).format('YYYY.MM.DD')}
                  </p>
                </div>
              </div>
            </div>

            <div style={{ position: 'relative', zIndex: 1, padding: '18px 24px 22px' }}>
              {/* 客戶 / 業務 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ color: '#9aa7b0', fontSize: 9.5, letterSpacing: 1, marginBottom: 3 }}>客戶</p>
                  <p style={{ color: '#2e3a42', fontSize: 16, fontWeight: 700 }}>{client?.name || '貴賓'}</p>
                  {client?.phone && <p style={{ color: '#8b98a1', fontSize: 11, marginTop: 1 }}>{client.phone}</p>}
                </div>
                {(profile.name || profile.phone) && (
                  <div style={{ textAlign: 'right', minWidth: 0 }}>
                    <p style={{ color: '#9aa7b0', fontSize: 9.5, letterSpacing: 1, marginBottom: 3 }}>業務專員</p>
                    <p style={{ color: '#2e3a42', fontSize: 14, fontWeight: 600 }}>{profile.name || '—'}</p>
                    {profile.phone && <p style={{ color: '#8b98a1', fontSize: 11, marginTop: 1 }}>{profile.phone}</p>}
                  </div>
                )}
              </div>

              {/* 車型 */}
              {model.trim() && (
                <div style={{
                  borderLeft: '3px solid #bf8a5e', background: '#faf6f1',
                  borderRadius: '0 8px 8px 0', padding: '9px 14px', marginBottom: 16,
                }}>
                  <p style={{ color: '#9aa7b0', fontSize: 9.5, letterSpacing: 1, marginBottom: 2 }}>車型</p>
                  <p style={{ color: '#5a4632', fontSize: 14, fontWeight: 700 }}>{model}</p>
                </div>
              )}

              {/* 客戶版項目：有優惠才顯示刪除線、折後價與優惠標籤 */}
              <div>
                {previewGroups.map((group) => (
                  <div key={group.key} style={{ marginBottom: 13 }}>
                    <p style={{
                      color: group.key === 'addon' ? '#9a6d3e' : '#8b98a1', fontSize: 9.5,
                      fontWeight: 700, letterSpacing: 1.5, paddingBottom: 5,
                      borderBottom: '1.5px solid #e8ecef',
                    }}>{group.label}</p>
                    {group.rows.map((item) => {
                      const itemTotal = totals.itemTotals[item.id] || { original: 0, discount: 0, net: 0 };
                      const hasDiscount = itemTotal.discount > 0;
                      return (
                        <div key={item.id} style={{ padding: '9px 0', borderBottom: '1px solid #f0f3f5' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                            <span style={{ color: '#4a5862', fontSize: 12.5, lineHeight: 1.45 }}>{item.name}</span>
                            <span style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                              {hasDiscount && (
                                <span style={{ color: '#aab4bc', fontSize: 10.5, textDecoration: 'line-through', marginRight: 6 }}>
                                  {formatMoney(itemTotal.original)}
                                </span>
                              )}
                              <span style={{ color: hasDiscount ? '#3f7652' : '#2e3a42', fontSize: hasDiscount ? 15 : 13.5, fontWeight: 800 }}>
                                {formatMoney(itemTotal.net)}
                              </span>
                            </span>
                          </div>
                          {hasDiscount && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
                              {(item.discounts || []).filter((row) => Number(row.amount) > 0).map((discount) => (
                                <span key={discount.id} style={{
                                  color: '#5f8669', background: '#edf5ef', border: '1px solid #d8e9dc',
                                  borderRadius: 999, padding: '2px 6px', fontSize: 9,
                                }}>
                                  {discount.name || '專案優惠'} −{formatMoney(discount.amount)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
                {validItems.length === 0 && (
                  <p style={{ color: '#b3bdc4', fontSize: 12, padding: '14px 0', textAlign: 'center' }}>（尚未輸入項目）</p>
                )}
              </div>

              {validGeneralDiscounts.length > 0 && (
                <div style={{ background: '#f4f8f5', borderRadius: 9, padding: '9px 12px', marginTop: 8 }}>
                  <p style={{ color: '#6f957a', fontSize: 9.5, fontWeight: 700, letterSpacing: 1.5, marginBottom: 5 }}>整單優惠</p>
                  {validGeneralDiscounts.map((discount) => (
                    <div key={discount.id} style={{ display: 'flex', justifyContent: 'space-between', color: '#5f7f67', fontSize: 11.5, padding: '2px 0' }}>
                      <span>{discount.name}</span><strong>−{formatMoney(discount.amount)}</strong>
                    </div>
                  ))}
                </div>
              )}

              {/* 優惠摘要＋最終專案價 */}
              <div style={{ borderTop: '1px solid #e8ecef', marginTop: 14, paddingTop: 10 }}>
                {[
                  ['原價合計', totals.originalTotal],
                  ['單項優惠', -totals.itemDiscountTotal],
                  ['整單優惠', -totals.generalDiscountTotal],
                  ['優惠總額', -totals.discountTotal],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', color: value < 0 ? '#6f957a' : '#8b98a1', fontSize: 10.5, padding: '2px 2px' }}>
                    <span>{label}</span><span>{value < 0 ? '−' : ''}{formatMoney(Math.abs(value))}</span>
                  </div>
                ))}
              </div>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'linear-gradient(135deg,#3f4d5a,#2b343d)', borderRadius: 10,
                padding: '13px 18px', marginTop: 10,
              }}>
                <span style={{ color: '#c9d6e0', fontSize: 12, fontWeight: 600, letterSpacing: 2 }}>最終專案價</span>
                <span style={{ color: '#fff', fontSize: 23, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#bf8a5e', marginRight: 4 }}>NT$</span>
                  {formatMoney(total)}
                </span>
              </div>

              {/* 分期試算：主打「每月只要」 */}
              {monthlyPay > 0 && (
                <div style={{ border: '1px solid #ecdfce', background: '#fdfaf6', borderRadius: 10, padding: '12px 16px', marginTop: 12 }}>
                  <p style={{ color: '#b08650', fontSize: 10, fontWeight: 700, letterSpacing: 2, marginBottom: 8 }}>輕鬆分期</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ color: '#8b7355', fontSize: 12, fontWeight: 600 }}>
                      分 {loan.months} 期
                    </span>
                    <span style={{ color: '#2e3a42', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, marginRight: 3 }}>每月只要</span>
                      <span style={{ fontSize: 19 }}>{formatMoney(monthlyPay)}</span>
                    </span>
                  </div>
                </div>
              )}

              {/* 備註 */}
              {note.trim() && (
                <p style={{ color: '#9aa7b0', fontSize: 10.5, marginTop: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>備註　{note}</p>
              )}

              {/* 頁尾：感謝＋嚴謹免責聲明 */}
              <div style={{ borderTop: '1px solid #eceef1', marginTop: 16, paddingTop: 12, textAlign: 'center' }}>
                <p style={{ color: '#8b98a1', fontSize: 10, fontWeight: 600, letterSpacing: 1 }}>感謝您的信賴</p>
                <p style={{ color: '#aab4bc', fontSize: 9, lineHeight: 1.6, marginTop: 4 }}>
                  本內容所有分期款項僅供參考，實際申貸條件、額度及利率，均以金融機構最終審核及正式合約為準。
                </p>
              </div>
            </div>
          </div>

          {/* 下載整張報價單圖片（不論多長都是一張完整 PNG） */}
          <button onClick={downloadImage} disabled={total <= 0 || capturing}
            className="btn-primary w-full mt-3 disabled:opacity-40">
            {capturing ? '產生圖片中…' : '📥 下載報價單圖片（一張完整）'}
          </button>
          <p className="text-center text-[11px] text-ink-3 mt-1.5">
            手機會跳出分享，可存到相簿或直接傳 LINE 給客人
          </p>
          <div className="flex gap-2 mt-3">
            <button onClick={onClose} className="btn-outline flex-1">關閉</button>
            <button onClick={handleRecord} disabled={total <= 0}
              className="btn-outline flex-1 disabled:opacity-40">
              💲 {isEdit ? '儲存修改' : '記錄報價'}
            </button>
          </div>
        </div>
      </div>
      {showCatalog && <ProductCatalog onClose={() => setShowCatalog(false)} />}
    </>
  );
}
