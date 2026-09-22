import { useState, useEffect, useRef } from 'react';
import html2canvas from 'html2canvas';
import { db } from '../../db';
import { generateId, formatMoney, calcMonthlyPayment, QUOTE_ADDON_CATS, DEFAULT_LOAN_TERMS, resolveLoanTerms } from '../../utils/crm';
import { useApp } from '../../context';
import dayjs from 'dayjs';
import { Field } from '../ui';
import ProductCatalog from '../catalog/ProductCatalog';
import {
  buildPricingRecord, calculateQuoteTotals, normalizeDiscount, normalizeQuoteItems,
} from '../../utils/pricing';

/** 依類別分組配備，照 QUOTE_ADDON_CATS 順序排列（未知類別歸「其他」放最後）；
 *  每組內金額由高到低排序 */
function groupAddonsByCat(addons, categoryOrder = QUOTE_ADDON_CATS) {
  const map = new Map();
  for (const a of addons) {
    const cat = a.cat || '其他';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(a);
  }
  for (const list of map.values()) list.sort((x, y) => (Number(y.price) || 0) - (Number(x.price) || 0));
  const ordered = [];
  for (const cat of categoryOrder) if (map.has(cat)) { ordered.push([cat, map.get(cat)]); map.delete(cat); }
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

const PAINT_COLOR_CATALOG_IDS = new Set(['qa-paint1', 'qa-paint2', 'qa-paint3']);

/** 由字串推導 4 碼英數（報價單編號用，同輸入固定輸出） */
function shortHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h.toString(36).toUpperCase().padStart(4, '0').slice(-4);
}

/**
 * 報價單產生器：填需求、車型、項目與優惠 → 產生固定淺色的客戶報價圖片。
 * 可由客戶頁寫入時間軸，也可由主導覽的獨立報價工作區儲存草稿。
 */
export default function QuoteModal({ client, clients = [], quote, onSaveQuote, onClose }) {
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
        pending: !!it.pending,
        discounts: (it.discounts || []).map((row) => ({ ...row, amount: String(row.amount) })),
      }))
      : [{ id: generateId('qi'), name: '車輛售價', price: '', pending: false, kind: 'vehicle', catalogId: null, discounts: [] }]
  );
  const [generalDiscounts, setGeneralDiscounts] = useState(() => [
    ...(Array.isArray(quote?.generalDiscounts) ? quote.generalDiscounts : []),
    ...normalizedInitial.legacyDiscounts,
  ].map((row) => {
    const normalized = normalizeDiscount(row);
    return { ...normalized, amount: String(normalized.amount) };
  }));
  const [note, setNote] = useState(quote?.note || '');
  const [requirements, setRequirements] = useState(quote?.requirements || '');
  const [linkedClientId, setLinkedClientId] = useState(quote?.clientId || client?.id || '');
  const [customerName, setCustomerName] = useState(quote?.customerName || client?.name || '');
  const [customerPhone, setCustomerPhone] = useState(quote?.customerPhone || client?.phone || '');
  const [extraAddon, setExtraAddon] = useState({ name: '', price: '', pending: false });
  const [profile, setProfile] = useState({ name: '', phone: '' });
  const [watermark, setWatermark] = useState('報價僅供參考'); // 浮水印文字（設定可改，留空不顯示）
  const [showDesc, setShowDesc] = useState(false); // 配備介紹展開
  const [expandedAddonCategories, setExpandedAddonCategories] = useState({});
  const [noOptionCategories, setNoOptionCategories] = useState(() =>
    Array.isArray(quote?.noOptionCategories) ? quote.noOptionCategories : []);
  const [capturing, setCapturing] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false); // 產品型錄覆蓋層
  const previewRef = useRef(null);
  // 貸款試算：頭期（可用 % 或自訂金額）＋選期數；年利率由設定帶入。
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
      .then((row) => setLoanTerms(resolveLoanTerms(row?.terms)))
      .catch(() => {});
  }, [quote]);

  function saveProfile(next) {
    setProfile(next);
    db.put('settings', { key: 'quoteProfile', ...next }).catch(() => {});
  }

  const selectedItems = items.filter((it) => it.name.trim() && (it.pending || Number(it.price) > 0));
  const pricedItems = selectedItems.filter((it) => !it.pending && Number(it.price) > 0);
  const pendingItems = selectedItems.filter((it) => it.pending);
  const validGeneralDiscounts = generalDiscounts
    .filter((row) => row.name.trim() && Number(row.amount) > 0);
  const totals = calculateQuoteTotals(pricedItems, validGeneralDiscounts);
  const total = totals.total;

  // 報價單編號：由日期＋此單 id 推導（同一張單編號固定，看起來更正式）
  const quoteNo = `Q${dayjs(quote?.date || undefined).format('YYMMDD')}-${shortHash(quote?.id || client?.id || quoteId)}`;

  // 頭期：選了 % 依總價自動算，否則用自訂金額
  const effectiveDown = loan.downPct != null ? Math.round(total * loan.downPct / 100) : (Number(loan.down) || 0);
  const loanPrincipal = Math.max(0, total - effectiveDown);
  const selMonths = Math.min(84, Number(loan.months) || 0);
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
        ...it, name: '車輛售價', price: String(m.price), pending: false, kind: 'vehicle', catalogId: m.id,
      } : it));
      return [{
        id: generateId('qi'), name: '車輛售價', price: String(m.price),
        pending: false, kind: 'vehicle', catalogId: m.id, discounts: [],
      }, ...list];
    });
  }

  function pickClient(clientId) {
    setLinkedClientId(clientId);
    const picked = clients.find((row) => row.id === clientId);
    if (picked) {
      setCustomerName(picked.name || '');
      setCustomerPhone(picked.phone || '');
    }
  }

  // 此配備/折抵是否已在報價項目中（用於顯示已選狀態）
  const isCatalogPicked = (catalogId) => items.some((it) => it.catalogId === catalogId);
  const isPicked = (addon) => items.some((it) => it.catalogId === addon.id || it.name.trim() === addon.name);
  const visibleAddons = quotePresets.addons.filter((addon) => !addon.parentId || isCatalogPicked(addon.parentId));
  const addonGroups = groupAddonsByCat(visibleAddons, quotePresets.addonCategories);
  const reviewedAddonCount = addonGroups.filter(([cat, list]) => noOptionCategories.includes(cat)
    || list.some((addon) => isPicked(addon))).length;

  /** 切換一筆項目：已選→移除；未選→加入。有 group 者為擇一，加入時先移除同組其他項 */
  function toggleLine({ id: catalogId, name, price, group, cat, pendingPrice = false }) {
    if (!isPicked({ id: catalogId, name }) && cat) {
      setNoOptionCategories((list) => list.filter((category) => category !== cat));
    }
    setItems((list) => {
      const picked = list.some((it) => it.catalogId === catalogId || it.name.trim() === name);
      if (picked) {
        const dependentIds = new Set(quotePresets.addons
          .filter((addon) => addon.parentId === catalogId)
          .map((addon) => addon.id));
        const next = list.filter((it) => it.catalogId !== catalogId
          && it.name.trim() !== name
          && !dependentIds.has(it.catalogId));
        return next.length ? next : [{ id: generateId('qi'), name: '', price: '', pending: false, kind: 'other', catalogId: null, discounts: [] }];
      }
      let base = list;
      if (group) {
        const siblings = quotePresets.addons.filter((x) => x.group === group).map((x) => x.name);
        base = list.filter((it) => !siblings.includes(it.name.trim()));
      }
      const emptyIdx = base.findIndex((it) => !it.name.trim() && !Number(it.price));
      const value = {
        name,
        price: pendingPrice ? '' : String(price),
        pending: !!pendingPrice,
        kind: 'addon',
        catalogId,
        note: '',
        discounts: [],
      };
      if (emptyIdx !== -1) return base.map((it, i) => (i === emptyIdx ? { ...it, ...value } : it));
      return [...base, { id: generateId('qi'), ...value }];
    });
  }

  function setItem(id, patch) {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((list) => [...list, {
      id: generateId('qi'), name: '', price: '', pending: false, kind: 'other', catalogId: null, discounts: [],
    }]);
  }

  function addExtraAddon() {
    const name = extraAddon.name.trim();
    if (!name || (!extraAddon.pending && !(Number(extraAddon.price) > 0))) return;
    const value = {
      id: generateId('qi'),
      name,
      price: extraAddon.pending ? '' : String(Math.max(0, Number(extraAddon.price) || 0)),
      pending: !!extraAddon.pending,
      kind: 'addon',
      catalogId: null,
      discounts: [],
    };
    setItems((list) => {
      const emptyIdx = list.findIndex((item) => !item.name.trim() && !Number(item.price));
      if (emptyIdx === -1) return [...list, value];
      return list.map((item, index) => (index === emptyIdx ? { ...item, ...value, id: item.id } : item));
    });
    setExtraAddon({ name: '', price: '', pending: false });
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
      clientId: client?.id || linkedClientId || null,
      date: quote?.date || dayjs().format('YYYY-MM-DD'),
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      model: model.trim(),
      modelId,
      noOptionCategories,
      items: selectedItems.map((it) => ({
        id: it.id,
        catalogId: it.catalogId || null,
        kind: it.kind || 'other',
        name: it.name.trim(),
        price: it.pending ? 0 : (Number(it.price) || 0),
        pending: !!it.pending,
        note: String(it.note || '').trim(),
        discounts: it.pending ? [] : (it.discounts || [])
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
      requirements: requirements.trim(),
      note: note.trim(),
      loan: { down: effectiveDown, months: selMonths, rate: annualRate },
      text: `報價單：${model.trim() || '未填車型'}｜${selectedItems.map((i) => i.name.trim()).join('、')}`,
    };
  }

  function pricingForCurrentQuote() {
    const draft = makeQuotePayload();
    const existing = pricingRecords.find((row) => row.id === `quote:${quoteId}`) || null;
    return buildPricingRecord({ quote: draft, costCatalog, existing });
  }

  function confirmAddonReview() {
    const unreviewed = addonGroups
      .filter(([cat, list]) => !noOptionCategories.includes(cat) && !list.some((addon) => isPicked(addon)));
    return unreviewed.length === 0 || window.confirm(
      `還有 ${unreviewed.length} 個配備分類未確認（例如：${unreviewed.slice(0, 3).map(([cat]) => cat).join('、')}）。請先問客戶並選配，或勾選「沒有選配」。確定仍要繼續嗎？`,
    );
  }

  // 把整張報價單（不論多長）輸出成一張 PNG；手機優先叫系統分享（可存相簿/傳 LINE）
  async function downloadImage() {
    const src = previewRef.current;
    if (!src || capturing) return;
    if (!confirmAddonReview()) return;
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
      const fileName = `報價單-${(customerName || client?.name || '客戶').replace(/[\\/:*?"<>|]/g, '')}-${dayjs().format('YYYYMMDD')}.png`;
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
    if (!confirmAddonReview()) return;
    const payload = makeQuotePayload();
    await onSaveQuote({ ...payload, _pricingRecord: pricingForCurrentQuote() });
  }

  const previewGroups = [
    { key: 'vehicle', label: '車輛', rows: selectedItems.filter((item) => item.kind === 'vehicle') },
    { key: 'addon', label: '專屬改裝', rows: selectedItems.filter((item) => item.kind === 'addon') },
    { key: 'other', label: '其他費用', rows: selectedItems.filter((item) => item.kind !== 'vehicle' && item.kind !== 'addon') },
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
            {!client?.id && (
              <div className="bg-s2 rounded-xl p-3 space-y-2">
                <p className="text-xs font-semibold text-ink-2">👤 客戶資料</p>
                {clients.length > 0 && (
                  <select value={linkedClientId} onChange={(e) => pickClient(e.target.value)} className="w-full text-sm">
                    <option value="">不連結客戶檔，直接輸入</option>
                    {clients.map((row) => <option key={row.id} value={row.id}>{row.name || '未命名客戶'}{row.phone ? `・${row.phone}` : ''}</option>)}
                  </select>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input value={customerName} onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="客戶姓名／公司" className="w-full text-sm" />
                  <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="聯絡電話（選填）" className="w-full text-sm" />
                </div>
              </div>
            )}
            <Field label="客戶需求／用途">
              <textarea value={requirements} onChange={(e) => setRequirements(e.target.value)} rows={3}
                placeholder="例：市場載貨、需要防滑底板、尾門載重與平台尺寸待確認…"
                className="w-full text-sm resize-y" />
            </Field>
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
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink-2">🚚 選購配備</span>
                  <span className="text-[10px] text-ink-3">已處理 {reviewedAddonCount}/{addonGroups.length} 類</span>
                  <button type="button" onClick={() => setShowDesc((v) => !v)}
                    className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${
                      showDesc ? 'bg-accent text-on-accent' : 'text-accent hover:bg-accent/10'}`}>
                    {showDesc ? '✓ 顯示介紹中' : '📖 看產品介紹'}
                  </button>
                </div>
                <p className="text-[10px] text-ink-3 -mt-1">逐類打開，選配件或勾「沒有選配」才算已處理；未確認的分類會保留提醒。</p>
                {addonGroups.map(([cat, list]) => {
                  const color = catColor(cat);
                  const pickedCount = list.filter((addon) => isPicked(addon)).length;
                  const noOption = pickedCount === 0 && noOptionCategories.includes(cat);
                  const expanded = !!expandedAddonCategories[cat];
                  // 整個類別同屬一個擇一群組時才標「擇一」（例如車身改色底色、防刮尾門尺寸）
                  const groupSet = new Set(list.map((a) => a.group || ''));
                  const allOneGroup = list.length > 1 && groupSet.size === 1 && !groupSet.has('');
                  return (
                    <div key={cat} className="rounded-lg border border-bdr/60 bg-s1/70 overflow-hidden">
                      {/* 類別標題 */}
                      <button type="button" onClick={() => setExpandedAddonCategories((current) => ({ ...current, [cat]: !expanded }))}
                        aria-expanded={expanded} className="w-full flex items-center gap-1.5 px-2.5 py-2 text-left">
                        <span className="w-1 h-3.5 rounded-full shrink-0" style={{ background: color }} />
                        <span className="text-[11px] font-semibold flex-1" style={{ color }}>{cat}</span>
                        <span className="text-[10px] text-ink-3">{list.length} 項</span>
                        {allOneGroup && <span className="text-[9px] px-1 rounded bg-s3 text-ink-3">擇一</span>}
                        <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${pickedCount || noOption ? 'text-ok bg-ok/10' : 'text-warn bg-warn/10'}`}>
                          {pickedCount ? `已選 ${pickedCount}・已處理` : noOption ? '沒有選配・已處理' : '未確認'}
                        </span>
                        <span className="text-xs text-ink-3">{expanded ? '▲' : '▼'}</span>
                      </button>
                      {expanded && (
                        <div className="px-2.5 pb-2.5 space-y-2">
                          <label className={`inline-flex items-center gap-1.5 text-[11px] ${pickedCount ? 'text-ink-3' : 'text-ink-2 cursor-pointer'}`}>
                            <input type="checkbox" checked={noOption} disabled={pickedCount > 0}
                              onChange={(event) => setNoOptionCategories((current) => event.target.checked
                                ? [...new Set([...current, cat])]
                                : current.filter((category) => category !== cat))} />
                            沒有選配（已向客戶確認）
                          </label>
                          {pickedCount > 0 && <p className="text-[10px] text-ink-3">此分類已有選配項目；取消選配後才能勾「沒有選配」。</p>}
                      {showDesc ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {list.map((a) => {
                            const picked = isPicked(a);
                            return (
                              <div key={a.id}
                                className={`flex flex-col rounded-lg px-2.5 py-2 border transition-colors ${picked ? '' : 'bg-s1 border-bdr/50'}`}
                                style={picked ? { background: color + '18', borderColor: color } : undefined}>
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-xs text-ink font-medium leading-snug">
                                    {a.parentId && <span className="text-ink-3">↳ </span>}
                                    {picked && <span style={{ color }}>✓ </span>}{a.name}
                                  </p>
                                  <span className="text-xs font-bold shrink-0" style={{ color }}>
                                    {a.pendingPrice ? '待報價' : formatMoney(a.price)}
                                  </span>
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
                            const picked = isPicked(a);
                            return (
                              <button key={a.id} type="button" title={a.desc || ''}
                                onClick={() => toggleLine(a)}
                                className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] transition-colors"
                                style={picked
                                  ? { background: color, borderColor: color, color: '#fff' }
                                  : { borderColor: color + '55' }}>
                                {picked && <span>✓</span>}
                                {a.parentId && <span className={picked ? '' : 'text-ink-3'}>↳</span>}
                                <span style={picked ? { color: '#fff' } : undefined} className={picked ? '' : 'text-ink-2'}>{a.name}</span>
                                <span className="font-semibold" style={{ color: picked ? '#fff' : color }}>
                                  {a.pendingPrice ? '待報價' : formatMoney(a.price)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
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
            <div className="rounded-xl border border-accent/35 bg-accent/5 p-3 space-y-2">
              <div>
                <p className="text-xs font-semibold text-ink-2">➕ 額外配件／未列配件</p>
                <p className="text-[10px] text-ink-3 mt-0.5">型錄沒有的配件可自行輸入；價格還不知道時，直接勾選「待確認金額」。</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_7rem] gap-2">
                <input value={extraAddon.name}
                  onChange={(e) => setExtraAddon((value) => ({ ...value, name: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') addExtraAddon(); }}
                  placeholder="額外配件名稱" className="w-full text-sm" />
                <input type="number" min="0" value={extraAddon.price}
                  onChange={(e) => setExtraAddon((value) => ({ ...value, price: e.target.value }))}
                  disabled={extraAddon.pending}
                  placeholder={extraAddon.pending ? '待確認' : '金額'} className="w-full text-sm disabled:opacity-40" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-[11px] text-ink-2 cursor-pointer">
                  <input type="checkbox" checked={extraAddon.pending}
                    onChange={(e) => setExtraAddon((value) => ({ ...value, pending: e.target.checked, price: e.target.checked ? '' : value.price }))} />
                  待確認金額（暫不計入總額）
                </label>
                <button type="button" onClick={addExtraAddon}
                  disabled={!extraAddon.name.trim() || (!extraAddon.pending && !(Number(extraAddon.price) > 0))}
                  className="btn-primary text-xs shrink-0 disabled:opacity-40">加入報價</button>
              </div>
            </div>
            <div className="flex gap-2 text-[11px] font-medium text-ink-3">
              <span className="flex-1">項目名稱</span>
              <span className="w-28">金額／待報價</span>
              <span className="w-4" />
            </div>
            {items.map((it) => {
              const selected = it.name.trim() && (it.pending || Number(it.price) > 0);
              const discountSum = (it.discounts || []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
              const needsColorNote = PAINT_COLOR_CATALOG_IDS.has(it.catalogId);
              return (
                <div key={it.id} className="rounded-xl border border-bdr bg-s1 p-2.5 space-y-2">
                  <div className="flex gap-2">
                    <input value={it.name} onChange={(e) => setItem(it.id, { name: e.target.value })}
                      placeholder="配備 / 保險 / 領牌…" className="flex-1 text-sm min-w-0" />
                    <input type="number" min="0" value={it.price}
                      onChange={(e) => setItem(it.id, { price: e.target.value })}
                      disabled={it.pending} placeholder={it.pending ? '待報價' : '0'}
                      className="w-28 text-sm disabled:opacity-40" />
                    <button onClick={() => removeItem(it.id)}
                      className="text-danger/50 hover:text-danger shrink-0 px-1">✕</button>
                  </div>
                  {needsColorNote && (
                    <div className="rounded-lg border border-accent/25 bg-accent/5 p-2">
                      <label className="block text-[10px] font-medium text-ink-2 mb-1">🎨 車色備註</label>
                      <input value={it.note || ''}
                        onChange={(e) => setItem(it.id, { note: e.target.value })}
                        placeholder="例如：珍珠白、消光黑、指定色號…"
                        className="w-full text-xs" />
                    </div>
                  )}
                  {it.name.trim() && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-ink-3">
                        {it.pending
                          ? '此項待向廠商確認價格，暫不列入總額'
                          : (it.discounts || []).length > 0
                          ? `已優惠 ${formatMoney(discountSum)}・折後 ${formatMoney(Math.max(0, Number(it.price) - discountSum))}`
                          : selected ? '此項目目前沒有優惠' : '請輸入金額或標記待報價'}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => setItem(it.id, { pending: !it.pending, discounts: it.pending ? it.discounts : [] })}
                          className={`text-[11px] rounded-lg border px-2 py-1 ${it.pending ? 'border-warn bg-warn/10 text-warn' : 'border-bdr text-ink-3'}`}>
                          {it.pending ? '✓ 待報價' : '設為待報價'}
                        </button>
                        {selected && !it.pending && (
                          <button type="button" onClick={() => addItemDiscount(it.id)}
                            className="text-[11px] text-accent hover:bg-accent/10 rounded-lg px-2 py-1">
                            ＋ 新增優惠折扣
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {!it.pending && (it.discounts || []).length > 0 && (
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
            <button onClick={addItem} className="btn-outline text-xs">＋ 新增其他費用</button>

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

            {/* 貸款試算：只提供期數、利率與月付概算，不揭露配合公司或總利息。 */}
            <div className="bg-s2 rounded-lg p-2.5 space-y-2">
              <div>
                <p className="text-[11px] font-medium text-ink-2">🏦 貸款概算（選填）</p>
                <p className="text-[10px] text-ink-3 mt-1 leading-relaxed">預設用年利率 4.5% 試算；正式利率由貸款公司依客戶信用、金額與方案核定。</p>
              </div>
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
                <div className="bg-s1 rounded-lg px-3 py-2 space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] text-ink-3">分 {selMonths} 期・年利率 {annualRate}% 概算</span>
                    <span className="text-sm text-ink">每月約 <strong className="text-accent text-base">NT$ {formatMoney(monthlyPay)}</strong></span>
                  </div>
                </div>
              )}
              {selMonths > 0 && monthlyPay === 0 && (
                <p className="text-[10px] text-ink-3">此期數尚未在「設定 → 報價選單」設定年利率</p>
              )}
              <p className="text-[10px] text-ink-3 leading-relaxed">以上僅供概算；實際利率、額度、頭期款與還款方式仍以金融機構正式核定為準。</p>
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
                  <p style={{ color: '#2e3a42', fontSize: 16, fontWeight: 700 }}>{customerName || client?.name || '貴賓'}</p>
                  {(customerPhone || client?.phone) && <p style={{ color: '#8b98a1', fontSize: 11, marginTop: 1 }}>{customerPhone || client.phone}</p>}
                </div>
                {(profile.name || profile.phone) && (
                  <div style={{ textAlign: 'right', minWidth: 0 }}>
                    <p style={{ color: '#9aa7b0', fontSize: 9.5, letterSpacing: 1, marginBottom: 3 }}>業務專員</p>
                    <p style={{ color: '#2e3a42', fontSize: 14, fontWeight: 600 }}>{profile.name || '—'}</p>
                    {profile.phone && <p style={{ color: '#8b98a1', fontSize: 11, marginTop: 1 }}>{profile.phone}</p>}
                  </div>
                )}
              </div>

              {requirements.trim() && (
                <div style={{ background: '#f4f7f9', borderRadius: 9, padding: '9px 12px', marginBottom: 14 }}>
                  <p style={{ color: '#84929c', fontSize: 9.5, fontWeight: 700, letterSpacing: 1.2, marginBottom: 4 }}>客戶需求</p>
                  <p style={{ color: '#4a5862', fontSize: 11.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{requirements}</p>
                </div>
              )}

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
                            <span style={{ color: '#4a5862', fontSize: 12.5, lineHeight: 1.45 }}>
                              {item.name}
                              {item.note && (
                                <span style={{ display: 'block', color: '#8b98a1', fontSize: 10.5, marginTop: 2 }}>
                                  車色備註：{item.note}
                                </span>
                              )}
                            </span>
                            <span style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                              {item.pending ? (
                                <span style={{ color: '#a9793f', background: '#fff7e8', border: '1px solid #ecd8b7', borderRadius: 999, padding: '2px 7px', fontSize: 9.5, fontWeight: 700 }}>
                                  待廠商報價
                                </span>
                              ) : hasDiscount && (
                                <span style={{ color: '#aab4bc', fontSize: 10.5, textDecoration: 'line-through', marginRight: 6 }}>
                                  {formatMoney(itemTotal.original)}
                                </span>
                              )}
                              {!item.pending && (
                                <span style={{ color: hasDiscount ? '#3f7652' : '#2e3a42', fontSize: hasDiscount ? 15 : 13.5, fontWeight: 800 }}>
                                  {formatMoney(itemTotal.net)}
                                </span>
                              )}
                            </span>
                          </div>
                          {!item.pending && hasDiscount && (
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
                {selectedItems.length === 0 && (
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

              {/* 客戶版只顯示售價、優惠折扣與專案價；細項優惠仍列在各項目下方。 */}
              <div style={{ borderTop: '1px solid #e8ecef', marginTop: 14, paddingTop: 10 }}>
                {[
                  ['售價', totals.originalTotal],
                  ['優惠折扣', -totals.discountTotal],
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
                <span style={{ color: '#c9d6e0', fontSize: 12, fontWeight: 600, letterSpacing: 2 }}>
                  {pendingItems.length > 0 ? '目前已確認金額' : '最終專案價'}
                </span>
                <span style={{ color: '#fff', fontSize: 23, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#bf8a5e', marginRight: 4 }}>NT$</span>
                  {formatMoney(total)}
                </span>
              </div>
              {pendingItems.length > 0 && (
                <p style={{ color: '#9a6d3e', background: '#fff8ec', borderRadius: 8, padding: '7px 10px', fontSize: 9.5, lineHeight: 1.5, marginTop: 8 }}>
                  尚有 {pendingItems.length} 項待廠商報價，以上金額不包含待報價項目，完整總價確認後更新。
                </p>
              )}

              {/* 分期試算：使用 4.5% 或設定值做概算，實際條件仍以核貸為準 */}
              {monthlyPay > 0 && (
                <div style={{ border: '1px solid #ecdfce', background: '#fdfaf6', borderRadius: 10, padding: '12px 16px', marginTop: 12 }}>
                  <p style={{ color: '#b08650', fontSize: 10, fontWeight: 700, letterSpacing: 2, marginBottom: 8 }}>貸款概算</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ color: '#8b7355', fontSize: 11, fontWeight: 600 }}>
                      分 {selMonths} 期・年利率 {annualRate}%
                    </span>
                    <span style={{ color: '#2e3a42', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, marginRight: 3 }}>每月約</span>
                      <span style={{ fontSize: 19 }}>{formatMoney(monthlyPay)}</span>
                    </span>
                  </div>
                  <p style={{ color: '#a5937e', fontSize: 8.8, lineHeight: 1.5, marginTop: 6 }}>以上為概算；實際利率、額度、還款方式與核貸結果依貸款機構及客戶條件為準。</p>
                </div>
              )}

              {/* 備註 */}
              {note.trim() && (
                <p style={{ color: '#9aa7b0', fontSize: 10.5, marginTop: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>備註　{note}</p>
              )}

            </div>
          </div>

          {/* 下載整張報價單圖片（不論多長都是一張完整 PNG） */}
          <button onClick={downloadImage} disabled={selectedItems.length === 0 || capturing}
            className="btn-primary w-full mt-3 disabled:opacity-40">
            {capturing ? '產生圖片中…' : '📥 下載報價單圖片（一張完整）'}
          </button>
          <p className="text-center text-[11px] text-ink-3 mt-1.5">
            手機會跳出分享，可存到相簿或直接傳 LINE 給客人
          </p>
          <div className="flex gap-2 mt-3">
            <button onClick={onClose} className="btn-outline flex-1">關閉</button>
            <button onClick={handleRecord} disabled={selectedItems.length === 0}
              className="btn-outline flex-1 disabled:opacity-40">
              💾 {isEdit ? '儲存修改' : (client?.id ? '記錄報價' : '儲存報價草稿')}
            </button>
          </div>
        </div>
      </div>
      {showCatalog && <ProductCatalog onClose={() => setShowCatalog(false)} />}
    </>
  );
}
