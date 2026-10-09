import { useState, useEffect, useRef } from 'react';
import html2canvas from 'html2canvas';
import { db } from '../../db';
import { generateId, formatMoney, formatChineseTwd, calcMonthlyPayment, canonicalAddonCategories, bundledAddonIds, removeBundledQuoteItems, findDuplicateClient, QUOTE_ADDON_CATS, QUOTE_ADDON_SECTIONS, DEFAULT_LOAN_TERMS, resolveLoanTerms } from '../../utils/crm';
import { useApp } from '../../context';
import dayjs from 'dayjs';
import { Field } from '../ui';
import ProductCatalog from '../catalog/ProductCatalog';
import {
  buildPricingRecord, calculateQuoteTotals, includedQuoteItems, normalizeDiscount, normalizeQuoteItems,
  synchronizeQuoteDiscounts,
} from '../../utils/pricing';
import { buildQuoteMessage, DEFAULT_QUOTE_MODEL_YEAR } from '../../utils/quoteText';

/** 依類別分組配備，照 QUOTE_ADDON_CATS 順序排列（未知類別歸「其他」放最後）；
 *  每組內金額由高到低排序 */
function groupAddonsByCat(addons, categoryOrder = QUOTE_ADDON_CATS) {
  const map = new Map();
  for (const a of addons) {
    const cat = a.cat || '其他';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(a);
  }
  for (const list of map.values()) list.sort((x, y) => {
    if (!!x.pendingPrice !== !!y.pendingPrice) return x.pendingPrice ? -1 : 1;
    return (Number(y.price) || 0) - (Number(x.price) || 0);
  });
  const ordered = [];
  for (const cat of categoryOrder) if (map.has(cat)) { ordered.push([cat, map.get(cat)]); map.delete(cat); }
  for (const [cat, list] of map) ordered.push([cat, list]); // 剩下未列在順序中的
  return ordered;
}

function groupAddonSections(groups, aliases = {}) {
  const categoryToSection = new Map();
  for (const section of QUOTE_ADDON_SECTIONS) {
    for (const category of section.categories) categoryToSection.set(aliases[category] || category, section);
  }
  const emitted = new Set();
  const result = [];
  for (const group of groups) {
    const section = categoryToSection.get(group[0]);
    if (!section) {
      result.push({ key: group[0], label: group[0], nested: false, groups: [group] });
      continue;
    }
    if (emitted.has(section.key)) continue;
    emitted.add(section.key);
    const categories = new Set(section.categories.map((category) => aliases[category] || category));
    result.push({
      key: section.key,
      label: section.label,
      nested: true,
      groups: groups.filter(([category]) => categories.has(category)),
    });
  }
  return result;
}

function sortQuoteRows(rows) {
  return [...rows].sort((a, b) => {
    if (!!a.pending !== !!b.pending) return a.pending ? -1 : 1;
    return (Number(b.price) || 0) - (Number(a.price) || 0);
  });
}

function splitQuoteItemName(name) {
  const text = String(name || '').trim();
  const match = text.match(/^(.+?)\s*([（(].+[）)])$/);
  if (!match) return { main: text, detail: '' };
  const detailText = match[2].slice(1, -1);
  if (detailText.length < 9 && !/[\/／…]/.test(detailText)) return { main: text, detail: '' };
  return { main: match[1].trim(), detail: match[2] };
}

// 類別顏色（視覺區分，莫蘭迪色）
const CAT_COLORS_Q = ['#bf8a5e', '#7d9b76', '#7291a8', '#9382a5', '#6f9a9c', '#b58a96', '#9a9a6f', '#8f7a68', '#a99760', '#b26b6b'];
function catColor(cat) {
  let h = 0;
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) >>> 0;
  return CAT_COLORS_Q[h % CAT_COLORS_Q.length];
}

const PACKAGE_ADDON_IDS = new Set([
  'qa-double-cab-package', 'qa-pkg1', 'qa-pkg2', 'qa-pkg3',
  'qa-aero', 'qa-led', 'qa-tlsound', 'qa-phone',
]);

function isPackageAddon(addon) {
  return PACKAGE_ADDON_IDS.has(addon.id)
    || (Array.isArray(addon.includes) && addon.includes.length > 0);
}

function AddonCategoryCard({
  cat, list, aliases, expanded, isPicked, reviewedNoOptionCategories,
  setExpandedAddonCategories, setNoOptionCategories, showDesc, toggleLine, bundleLocks,
  allAddons,
}) {
  const color = catColor(cat);
  const pickedCount = list.filter((addon) => isPicked(addon)).length;
  const noOption = pickedCount === 0 && reviewedNoOptionCategories.includes(cat);
  const groupSet = new Set(list.map((addon) => addon.group || ''));
  const allOneGroup = list.length > 1 && groupSet.size === 1 && !groupSet.has('');
  const numberedDescription = (addon) => {
    if (!addon.desc) return [];
    if (addon.id === 'qa-pkg2') {
      return [
        '安卓四錄整合多媒體（台灣美邁', '9吋安卓觸控螢幕', '高清四錄影監控 & 360度環景',
        '無線 CarPlay', '卡旺專用底座）', '6輪胎壓偵測器（6輪數據獨立顯示）', '太陽能與 USB 供電',
      ];
    }
    if (addon.id === 'qa-double-cab-package') {
      return [
        '特仕版', '多功能方向盤', '安全科技版', 'LED 後照鏡', 'GTR 魚眼頭燈',
        'X7 魚眼霧燈', 'TS 避震', '音響升級', '延長側踏', 'Travel 橫桿', '尿素桶防撞桿',
        '雙手機架', '室內牌照燈', '側邊照地燈', 'OMEGA 鋁圈', 'HALO 光環尾燈', 'KDM 擾流前下巴',
      ];
    }
    const separators = isPackageAddon(addon) ? /[\uff1b\u3001]/ : /\uff1b/;
    return addon.desc.split(separators).map((part) => part.trim()).filter(Boolean);
  };
  return (
    <div className="rounded-lg border border-bdr/60 bg-s1/70 overflow-hidden">
      <button type="button"
        onClick={() => setExpandedAddonCategories((current) => ({ ...current, [cat]: !expanded }))}
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
              onChange={(event) => setNoOptionCategories((current) => {
                const canonical = canonicalAddonCategories(current, aliases);
                return event.target.checked
                  ? [...new Set([...canonical, cat])]
                  : canonical.filter((category) => category !== cat);
              })} />
            沒有選配（已向客戶確認）
          </label>
          {pickedCount > 0 && <p className="text-[10px] text-ink-3">此分類已有選配項目；取消選配後才能勾「沒有選配」。</p>}
          {cat === '貨斗底板' && (
            <p className="rounded-md border border-orange-300 bg-orange-50 px-2 py-1.5 text-[11px] font-bold text-black">
              統一說明：本分類所有貨斗底板材質厚度均為 5mm。
            </p>
          )}
          {showDesc ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {list.map((addon) => {
                const picked = isPicked(addon);
                const lockedBy = bundleLocks.get(addon.id);
                const packageAddon = isPackageAddon(addon);
                const descriptionLines = numberedDescription(addon);
                const bundleParts = (Array.isArray(addon.includes) ? addon.includes : [])
                  .map((id) => allAddons.find((candidate) => candidate.id === id))
                  .filter(Boolean);
                return (
                  <div key={addon.id}
                    className={`flex flex-col rounded-lg px-2.5 py-2 transition-colors ${packageAddon ? 'border-2 border-red-500 shadow-sm' : 'border'} ${picked ? '' : packageAddon ? 'bg-red-50/40' : 'bg-white border-slate-300'} ${lockedBy ? 'opacity-70' : ''}`}
                    style={picked ? { background: '#fff7ed', borderColor: packageAddon ? '#dc2626' : color } : undefined}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-bold leading-snug" style={{ color: '#c55a11' }}>
                        {addon.parentId && <span className="text-ink-3">↳ </span>}
                        {picked && <span style={{ color }}>✓ </span>}{addon.name}
                        {packageAddon && <span className="ml-1.5 rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold text-white">套餐</span>}
                      </p>
                      <span className="text-xs font-bold shrink-0" style={{ color }}>
                        {addon.pendingPrice ? '待廠商報價' : formatMoney(addon.price)}
                      </span>
                    </div>
                    {descriptionLines.length > 0 && (
                      packageAddon ? (
                        <>
                          {addon.id === 'qa-double-cab-package' && (
                            <p className="mt-1.5 text-[11px] leading-relaxed text-black">
                              雙廂專用｜方案價 250,000 元｜原配件價值標示 275,000 元
                            </p>
                          )}
                          {addon.id !== 'qa-double-cab-package' && (
                            <ol className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-black list-none">
                              {descriptionLines.map((line, index) => (
                                <li key={`${addon.id}-desc-${index}`} className="flex items-start gap-1.5">
                                  <span className="font-bold shrink-0" style={{ color: '#c55a11' }}>{index + 1}.</span>
                                  <span className="text-black">{line}</span>
                                </li>
                              ))}
                            </ol>
                          )}
                          {addon.id === 'qa-double-cab-package' && bundleParts.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {bundleParts.map((part, index) => (
                                <div key={part.id} className="flex items-start justify-between gap-2 text-[11px] leading-relaxed text-black">
                                  <span><span className="font-bold mr-1" style={{ color: '#c55a11' }}>{index + 1}.</span>{part.name}</span>
                                  <span className="font-bold shrink-0">{part.pendingPrice ? '待報價' : formatMoney(part.price)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-[11px] text-black mt-1.5 leading-relaxed">{addon.desc}</p>
                      )
                    )}
                    {lockedBy && <p className="text-[10px] text-warn mt-1 leading-relaxed">🔒 已含於「{lockedBy.name}」，不可重複加入</p>}
                    <button type="button" onClick={() => toggleLine(addon)} disabled={!!lockedBy}
                      className={`text-[10px] px-2 py-0.5 mt-1.5 self-end rounded-md border transition-colors ${lockedBy ? 'cursor-not-allowed' : ''}`}
                      style={picked ? { background: color, borderColor: color, color: '#fff' } : { borderColor: color + '66', color }}>
                      {lockedBy ? '🔒 套裝已含' : picked ? '✓ 已加入' : '＋ 加入報價'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex gap-1.5 flex-wrap">
              {list.map((addon) => {
                const picked = isPicked(addon);
                const lockedBy = bundleLocks.get(addon.id);
                const packageAddon = isPackageAddon(addon);
                return (
                  <button key={addon.id} type="button" disabled={!!lockedBy}
                    title={lockedBy ? `已含於「${lockedBy.name}」，不可重複加入` : addon.desc || ''}
                    onClick={() => toggleLine(addon)}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors ${packageAddon ? 'border-2 border-red-500' : 'border'} ${lockedBy ? 'opacity-60 cursor-not-allowed' : ''}`}
                    style={picked
                      ? { background: color, borderColor: packageAddon ? '#dc2626' : color, color: '#fff' }
                      : { borderColor: packageAddon ? '#dc2626' : color + '55' }}>
                    {lockedBy && <span>🔒</span>}
                    {picked && <span>✓</span>}
                    {addon.parentId && <span className={picked ? '' : 'text-ink-3'}>↳</span>}
                    <span style={picked ? { color: '#fff' } : undefined} className={picked ? '' : 'text-ink-2'}>{addon.name}</span>
                    {packageAddon && <span className="rounded bg-red-600 px-1 py-0.5 text-[9px] font-bold text-white">套餐</span>}
                    <span className="font-semibold" style={{ color: picked ? '#fff' : color }}>
                      {lockedBy ? '套裝已含' : addon.pendingPrice ? '待廠商報價' : formatMoney(addon.price)}
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
}

const PAINT_COLOR_CATALOG_IDS = new Set(['qa-paint1', 'qa-paint2', 'qa-paint3']);

/** 由字串推導 4 碼英數（報價單編號用，同輸入固定輸出） */
function shortHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h.toString(36).toUpperCase().padStart(4, '0').slice(-4);
}

/**
 * 建立報價單：填需求、車型、項目與優惠 → 產生固定淺色的客戶報價圖片。
 * 可由客戶頁寫入時間軸，也可由主導覽的報價管理工作區儲存草稿。
 */
export default function QuoteModal({ client, clients = [], quote, initialCaseId = '', onSaveQuote, onClose }) {
  const { quotePresets, costCatalog, pricingRecords, cases } = useApp();
  const isEdit = !!quote;
  const [quoteId] = useState(() => quote?.id || generateId('quote'));
  const existingPricingRecord = pricingRecords.find((row) => row.id === `quote:${quoteId}`) || null;
  const synchronizedQuote = quote ? synchronizeQuoteDiscounts(quote, existingPricingRecord) : null;
  const normalizedInitial = normalizeQuoteItems(synchronizedQuote?.items || []);
  const dedupedInitialItems = removeBundledQuoteItems(normalizedInitial.items, quotePresets.addons);
  const [model, setModel] = useState(quote?.model || '');
  const [modelYear, setModelYear] = useState(() => String(quote?.modelYear || DEFAULT_QUOTE_MODEL_YEAR));
  const [modelId, setModelId] = useState(() => quote?.modelId
    || quotePresets.models?.find((row) => row.name === quote?.model)?.id
    || null);
  const [excludeVehiclePrice, setExcludeVehiclePrice] = useState(!!quote?.excludeVehiclePrice);
  const [items, setItems] = useState(() =>
    dedupedInitialItems.length
      ? dedupedInitialItems.map((it) => {
        const catalogItem = quotePresets.addons.find((addon) => addon.id === it.catalogId);
        const restorePackage = catalogItem && isPackageAddon(catalogItem) && it.bundlePricingMode === 'components';
        return {
          ...it,
          price: String(restorePackage ? catalogItem.price : it.price),
          description: restorePackage ? (catalogItem.desc || '') : it.description,
          pending: !!it.pending,
          gift: !!it.gift,
          bundlePricingMode: null,
          bundleIncludedIds: null,
          bundleExcludedIds: [],
          discounts: (it.discounts || []).map((row) => ({ ...row, amount: String(row.amount) })),
        };
      })
      : [{ id: generateId('qi'), name: '車輛售價', price: '', pending: false, gift: false, kind: 'vehicle', catalogId: null, discounts: [] }]
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
  const initialClientId = quote?.clientId || client?.id || '';
  const initialCaseCandidates = cases.filter((row) => row.clientId === initialClientId && row.status !== 'completed');
  const [linkedCaseId, setLinkedCaseId] = useState(quote?.caseId || initialCaseId
    || (initialCaseCandidates.length === 1 ? initialCaseCandidates[0].id : ''));
  const [caseError, setCaseError] = useState('');
  const [customerName, setCustomerName] = useState(quote?.customerName || (client?.pendingCustomerDetails ? '' : client?.name) || '');
  const [customerPhone, setCustomerPhone] = useState(quote?.customerPhone || client?.phone || '');
  const [customerMode, setCustomerMode] = useState(() => {
    if (quote?.clientId || client?.id) return 'existing';
    return quote ? 'quote-only' : 'new';
  });
  const [customerError, setCustomerError] = useState('');
  const [extraAddon, setExtraAddon] = useState({ name: '', price: '', pending: false });
  const [profile, setProfile] = useState({ name: '', phone: '' });
  const [watermark, setWatermark] = useState('報價僅供參考'); // 浮水印文字（設定可改，留空不顯示）
  const [showDesc, setShowDesc] = useState(false); // 配備介紹展開
  const [expandedAddonCategories, setExpandedAddonCategories] = useState({});
  const [expandedAddonSections, setExpandedAddonSections] = useState({});
  const [noOptionCategories, setNoOptionCategories] = useState(() =>
    Array.isArray(quote?.noOptionCategories) ? quote.noOptionCategories : []);
  const [capturing, setCapturing] = useState(false);
  const [exportedImage, setExportedImage] = useState(null);
  const [exportError, setExportError] = useState('');
  const [showCatalog, setShowCatalog] = useState(false); // 產品型錄覆蓋層
  const [showTextQuote, setShowTextQuote] = useState(false);
  const [textCopyStatus, setTextCopyStatus] = useState('');
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

  useEffect(() => () => {
    if (exportedImage?.url) URL.revokeObjectURL(exportedImage.url);
  }, [exportedImage]);

  function saveProfile(next) {
    setProfile(next);
    db.put('settings', { key: 'quoteProfile', ...next }).catch(() => {});
  }

  const selectedItems = includedQuoteItems(items, excludeVehiclePrice)
    .filter((it) => it.name.trim() && (it.pending || it.gift || Number(it.price) > 0));
  const pricedItems = selectedItems.filter((it) => !it.pending && (it.gift || Number(it.price) > 0));
  const pendingItems = selectedItems.filter((it) => it.pending);
  const validGeneralDiscounts = generalDiscounts
    .filter((row) => row.name.trim() && Number(row.amount) > 0);
  const totals = calculateQuoteTotals(pricedItems, validGeneralDiscounts);
  const total = totals.total;
  const textQuote = buildQuoteMessage({
    customerName,
    model,
    modelYear,
    items: selectedItems,
    generalDiscounts: validGeneralDiscounts,
  });

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
        ...it, name: '車輛售價', price: String(m.price), pending: false, gift: false, kind: 'vehicle', catalogId: m.id,
      } : it));
      return [{
        id: generateId('qi'), name: '車輛售價', price: String(m.price),
        pending: false, gift: false, kind: 'vehicle', catalogId: m.id, discounts: [],
      }, ...list];
    });
  }

  function toggleVehiclePrice(exclude) {
    setExcludeVehiclePrice(exclude);
    if (exclude) return;
    const selectedModel = quotePresets.models?.find((row) => row.id === modelId);
    if (!selectedModel) return;
    setItems((list) => list.some((item) => item.kind === 'vehicle') ? list : [{
      id: generateId('qi'), name: '車輛售價', price: String(selectedModel.price),
      pending: false, gift: false, kind: 'vehicle', catalogId: selectedModel.id, discounts: [],
    }, ...list]);
  }

  function pickClient(clientId) {
    setLinkedClientId(clientId);
    setCustomerError('');
    const picked = clients.find((row) => row.id === clientId);
    if (picked) {
      setCustomerName(picked.pendingCustomerDetails ? '' : (picked.name || ''));
      setCustomerPhone(picked.phone || '');
    }
    const matches = cases.filter((row) => row.clientId === clientId && row.status !== 'completed');
    setLinkedCaseId(matches.length === 1 ? matches[0].id : '');
    setCaseError('');
  }

  const duplicateClient = customerMode === 'new'
    ? findDuplicateClient(clients, { name: customerName, phone: customerPhone })
    : null;

  function switchCustomerMode(nextMode) {
    setCustomerMode(nextMode);
    setCustomerError('');
    if (nextMode !== 'existing') {
      setLinkedClientId('');
      setLinkedCaseId('');
      setCaseError('');
    }
  }

  // 此配備/折抵是否已在報價項目中（用於顯示已選狀態）
  const isCatalogPicked = (catalogId) => items.some((it) => it.catalogId === catalogId);
  const isPicked = (addon) => items.some((it) => it.catalogId === addon.id || it.name.trim() === addon.name);
  const selectedCatalogIds = new Set(items.map((item) => item.catalogId).filter(Boolean));
  const bundleLocks = new Map();
  for (const addon of quotePresets.addons) {
    if (!selectedCatalogIds.has(addon.id) || !Array.isArray(addon.includes)) continue;
    const activeIncludedIds = addon.includes
      .flatMap((includedId) => [includedId, ...bundledAddonIds(quotePresets.addons, includedId)]);
    for (const includedId of activeIncludedIds) {
      if (!bundleLocks.has(includedId)) bundleLocks.set(includedId, addon);
    }
  }
  const visibleAddons = quotePresets.addons.filter((addon) => !addon.parentId || isCatalogPicked(addon.parentId));
  const addonGroups = groupAddonsByCat(visibleAddons, quotePresets.addonCategories);
  const addonSections = groupAddonSections(addonGroups, quotePresets.addonCategoryAliases);
  const reviewedNoOptionCategories = canonicalAddonCategories(noOptionCategories, quotePresets.addonCategoryAliases);
  const reviewedAddonCount = addonGroups.filter(([cat, list]) => reviewedNoOptionCategories.includes(cat)
    || list.some((addon) => isPicked(addon))).length;

  /** 切換一筆項目：已選→移除；未選→加入。有 group 者為擇一，加入時先移除同組其他項 */
  function toggleLine(addon) {
    const { id: catalogId, name, price, group, cat, desc = '', pendingPrice = false } = addon;
    if (bundleLocks.has(catalogId)) return;
    const currentlyPicked = isPicked({ id: catalogId, name });
    if (!currentlyPicked && Array.isArray(addon.includes) && addon.includes.length > 0) {
      setShowDesc(true);
    }
    if (!currentlyPicked && cat) {
      setNoOptionCategories((list) => canonicalAddonCategories(list, quotePresets.addonCategoryAliases)
        .filter((category) => category !== cat));
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
        return next.length ? next : [{ id: generateId('qi'), name: '', price: '', pending: false, gift: false, kind: 'other', catalogId: null, discounts: [] }];
      }
      let base = list;
      const includedIds = new Set(bundledAddonIds(quotePresets.addons, catalogId));
      if (includedIds.size > 0) {
        base = base.filter((item) => !includedIds.has(item.catalogId));
      }
      if (group) {
        const siblings = quotePresets.addons.filter((x) => x.group === group).map((x) => x.name);
        base = base.filter((it) => !siblings.includes(it.name.trim()));
      }
      const emptyIdx = base.findIndex((it) => !it.name.trim() && !Number(it.price));
      const value = {
        name,
        price: pendingPrice ? '' : String(price),
        pending: !!pendingPrice,
        gift: false,
        kind: 'addon',
        catalogId,
        description: desc,
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
      id: generateId('qi'), name: '', price: '', pending: false, gift: false, kind: 'other', catalogId: null, discounts: [],
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
      gift: false,
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

  function setCentralItemDiscount(itemId, amount) {
    setItems((list) => list.map((item) => {
      if (item.id !== itemId) return item;
      const value = Math.min(Math.max(0, Number(item.price) || 0), Math.max(0, Number(amount) || 0));
      return {
        ...item,
        gift: false,
        discounts: value > 0 ? [{
          id: `pricing-discount:${item.id}`,
          name: '優惠',
          amount: String(value),
        }] : [],
      };
    }));
  }

  function addGeneralDiscount(row = null) {
    const value = row ? normalizeDiscount(row) : { name: '優惠折扣', amount: 0 };
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
      ...(quote || {}),
      id: quoteId,
      clientId: client?.id || linkedClientId || null,
      caseId: linkedCaseId || null,
      date: quote?.date || dayjs().format('YYYY-MM-DD'),
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      model: model.trim(),
      modelYear: Number(modelYear) || null,
      modelId,
      excludeVehiclePrice,
      noOptionCategories: reviewedNoOptionCategories,
      items: selectedItems.map((it) => ({
        id: it.id,
        catalogId: it.catalogId || null,
        kind: it.kind || 'other',
        name: it.name.trim(),
        price: it.pending ? 0 : (Number(it.price) || 0),
        pending: !!it.pending,
        gift: !!it.gift,
        description: String(it.description || quotePresets.addons.find((addon) => addon.id === it.catalogId)?.desc || '').trim(),
        note: String(it.note || '').trim(),
        requirementStatus: it.requirementStatus || null,
        bundlePricingMode: it.bundlePricingMode || null,
        bundleIncludedIds: Array.isArray(it.bundleIncludedIds) ? [...it.bundleIncludedIds] : null,
        bundleExcludedIds: Array.isArray(it.bundleExcludedIds) ? [...it.bundleExcludedIds] : [],
        discounts: it.pending || it.gift ? [] : (it.discounts || [])
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
      .filter(([cat, list]) => !reviewedNoOptionCategories.includes(cat) && !list.some((addon) => isPicked(addon)));
    return unreviewed.length === 0 || window.confirm(
      `還有 ${unreviewed.length} 個配備分類未確認（例如：${unreviewed.slice(0, 3).map(([cat]) => cat).join('、')}）。請先問客戶並選配，或勾選「沒有選配」。確定仍要繼續嗎？`,
    );
  }

  function closeExportPreview() {
    setExportedImage(null);
    setExportError('');
  }

  function openTextQuote() {
    if (!confirmAddonReview()) return;
    setTextCopyStatus('');
    setShowTextQuote(true);
  }

  async function copyTextQuote() {
    try {
      await navigator.clipboard.writeText(textQuote);
      setTextCopyStatus('已複製，可直接貼到 LINE');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = textQuote;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      setTextCopyStatus(copied ? '已複製，可直接貼到 LINE' : '無法自動複製，請長按文字全選複製');
    }
  }

  function downloadExportedImage() {
    if (!exportedImage) return;
    const a = document.createElement('a');
    a.href = exportedImage.url;
    a.download = exportedImage.fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function openExportedImage() {
    if (!exportedImage) return;
    const opened = window.open(exportedImage.url, '_blank', 'noopener');
    if (!opened) window.location.href = exportedImage.url;
  }

  async function shareExportedImage() {
    if (!exportedImage) return;
    setExportError('');
    if (navigator.canShare?.({ files: [exportedImage.file] }) && navigator.share) {
      try {
        // 由「分享／存到相簿」按鈕直接呼叫，保留手機要求的使用者點擊權限。
        await navigator.share({ files: [exportedImage.file], title: exportedImage.fileName });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
        setExportError('這台手機無法直接分享，請改按「開啟圖片」後長按儲存。');
        return;
      }
    }
    downloadExportedImage();
  }

  // 先把整張報價單輸出成 PNG 預覽，再讓使用者以第二次點擊分享／儲存。
  async function downloadImage() {
    const src = previewRef.current;
    if (!src || capturing) return;
    if (!confirmAddonReview()) return;
    setCapturing(true);
    setExportError('');
    // 複製一份到頁面底層、完整展開（脫離捲動容器），避免 WebKit 不繪製超出畫面很遠的元素。
    const clone = src.cloneNode(true);
    clone.style.position = 'fixed';
    clone.style.top = '0';
    clone.style.left = '-10000px';
    clone.style.zIndex = '1';
    clone.style.pointerEvents = 'none';
    clone.style.margin = '0';
    clone.style.transform = 'none';
    clone.style.maxHeight = 'none';
    clone.style.overflow = 'visible';
    clone.style.width = `${src.offsetWidth}px`; // 保持與畫面上相同的斷行
    document.body.appendChild(clone);
    try {
      if (document.fonts?.ready) {
        await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1500))]);
      }
      const width = Math.max(1, clone.offsetWidth);
      const height = Math.max(1, clone.offsetHeight);
      // iOS Safari 的大畫布容易失敗；保留清晰度，同時將總像素控制在安全範圍。
      const pixelBudgetScale = Math.sqrt(8_000_000 / (width * height));
      const dimensionScale = Math.min(8192 / width, 8192 / height);
      const scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1, pixelBudgetScale, dimensionScale));
      const capture = html2canvas(clone, {
        scale, backgroundColor: '#ffffff', useCORS: true, logging: false,
        imageTimeout: 4000, removeContainer: true,
        width, height, windowWidth: width, windowHeight: height,
      });
      const canvas = await Promise.race([
        capture,
        new Promise((_, reject) => setTimeout(() => reject(new Error('capture timeout')), 20000)),
      ]);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('capture failed');
      const fileName = `報價單-${(customerName || (client?.pendingCustomerDetails ? '貴賓' : client?.name) || '客戶').replace(/[\\/:*?"<>|]/g, '')}-${dayjs().format('YYYYMMDD')}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });
      setExportedImage((previous) => {
        if (previous?.url) URL.revokeObjectURL(previous.url);
        return { blob, file, fileName, url: URL.createObjectURL(blob) };
      });
    } catch (error) {
      console.error('quote image export failed', error);
      setExportError(error?.message === 'capture timeout'
        ? '圖片產生超過 20 秒，已自動停止。請先關閉其他 App 後重試，或改用 LINE 文字版。'
        : '圖片產生失敗。請先重新開啟這張報價；若仍失敗，請回報手機型號與瀏覽器。');
    } finally {
      if (clone.parentNode) clone.parentNode.removeChild(clone);
      setCapturing(false);
    }
  }

  async function handleRecord() {
    if (!confirmAddonReview()) return;
    if (!client?.id && customerMode === 'new' && !customerName.trim()) {
      setCustomerError('請先填客戶姓名／公司名，才能建立客戶追蹤。');
      return;
    }
    if (!client?.id && customerMode === 'existing' && !linkedClientId) {
      setCustomerError('請先選擇要連結的既有客戶。');
      return;
    }
    const effectiveClientId = client?.id || (customerMode === 'existing' ? linkedClientId : null);
    const activeCases = cases.filter((row) => row.clientId === effectiveClientId && row.status !== 'completed');
    if (effectiveClientId && activeCases.length > 1 && !linkedCaseId) {
      setCaseError('這位客戶有多筆進行中案件，請先選擇報價要歸入哪一筆。');
      return;
    }
    const payload = makeQuotePayload();
    await onSaveQuote({
      ...payload,
      clientId: client?.id || (customerMode === 'existing' ? linkedClientId : null),
      _customerMode: client?.id ? 'existing' : customerMode,
      _pricingRecord: pricingForCurrentQuote(),
    });
  }

  const previewGroups = [
    { key: 'vehicle', label: '車輛', rows: sortQuoteRows(selectedItems.filter((item) => item.kind === 'vehicle')) },
    { key: 'addon', label: '專屬改裝', rows: sortQuoteRows(selectedItems.filter((item) => item.kind === 'addon')) },
    { key: 'other', label: '其他費用', rows: sortQuoteRows(selectedItems.filter((item) => item.kind !== 'vehicle' && item.kind !== 'addon')) },
  ].filter((group) => group.rows.length > 0);

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="safe-screen fixed inset-0 z-50 overflow-y-auto px-4 flex items-start justify-center">
        <div className="bg-s1 rounded-2xl shadow-panel border border-bdr w-full max-w-md md:max-w-2xl p-4 md:p-5 anim-scale-in my-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-lg text-ink">🧾 {isEdit ? '編輯報價單' : '建立報價單'}</h3>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setShowCatalog(true)}
                className="btn-outline text-xs gap-1 py-1">📖 看型錄</button>
              <button onClick={onClose} className="btn-ghost text-xl leading-none px-2 py-1">✕</button>
            </div>
          </div>
          {/* 輸入區 */}
          <div className="space-y-2 mb-4">
            {!client?.id && (
              <div className="bg-s2 rounded-xl p-3 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-ink-2">👤 客戶資料</p>
                  <p className="text-[11px] text-ink-3 mt-0.5">不用先走接待流程；可在儲存報價時直接建立客戶追蹤。</p>
                </div>
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-s1 p-1 border border-bdr">
                  <button type="button" onClick={() => switchCustomerMode('new')}
                    className={`min-h-10 rounded-lg px-2 text-xs font-semibold ${customerMode === 'new' ? 'bg-accent text-on-accent' : 'text-ink-2'}`}>
                    建立新客戶
                  </button>
                  <button type="button" onClick={() => switchCustomerMode('existing')}
                    className={`min-h-10 rounded-lg px-2 text-xs font-semibold ${customerMode === 'existing' ? 'bg-accent text-on-accent' : 'text-ink-2'}`}>
                    連結既有
                  </button>
                  <button type="button" onClick={() => switchCustomerMode('quote-only')}
                    className={`min-h-10 rounded-lg px-2 text-xs font-semibold ${customerMode === 'quote-only' ? 'bg-accent text-on-accent' : 'text-ink-2'}`}>
                    只做報價
                  </button>
                </div>
                {customerMode === 'existing' ? (
                  <select value={linkedClientId} onChange={(e) => pickClient(e.target.value)} className="w-full text-sm">
                    <option value="">選擇既有客戶…</option>
                    {clients.map((row) => <option key={row.id} value={row.id}>{row.name || '未命名客戶'}{row.phone ? `・${row.phone}` : ''}</option>)}
                  </select>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input value={customerName} onChange={(e) => { setCustomerName(e.target.value); setCustomerError(''); }}
                      placeholder={customerMode === 'new' ? '客戶姓名／公司 *' : '報價抬頭（選填）'} className="w-full text-sm" />
                    <input value={customerPhone} onChange={(e) => { setCustomerPhone(e.target.value); setCustomerError(''); }}
                      placeholder="聯絡電話（選填）" className="w-full text-sm" />
                  </div>
                )}
                {customerMode === 'new' && (
                  <p className="text-[11px] text-ok">儲存後會自動進入「客戶追蹤」，客戶階段設為「報價」，並連結這張報價。</p>
                )}
                {duplicateClient && (
                  <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 flex items-center gap-2">
                    <p className="text-[11px] text-warn flex-1">已有{duplicateClient.reason === 'phone' ? '相同電話' : '同名'}客戶「{duplicateClient.client.name}」。</p>
                    <button type="button" className="btn-outline text-[10px] px-2 py-1 shrink-0"
                      onClick={() => { setCustomerMode('existing'); pickClient(duplicateClient.client.id); }}>
                      改為連結
                    </button>
                  </div>
                )}
                {customerError && <p role="alert" className="text-xs text-danger">{customerError}</p>}
              </div>
            )}
            {(client?.id || (customerMode === 'existing' && linkedClientId)) && (() => {
              const effectiveClientId = client?.id || linkedClientId;
              const activeCases = cases.filter((row) => row.clientId === effectiveClientId && row.status !== 'completed');
              return (
                <div className="rounded-xl border border-teal/30 bg-teal/8 p-3 space-y-2">
                  <div><p className="text-xs font-semibold text-teal">📁 歸入客戶案件</p><p className="text-[11px] text-ink-3 mt-0.5">報價會直接留在這筆案件，不會另外產生重複案件。</p></div>
                  {activeCases.length > 0 ? <select value={linkedCaseId} onChange={(event) => { setLinkedCaseId(event.target.value); setCaseError(''); }} className="w-full text-sm">
                    {activeCases.length > 1 && <option value="">請選擇案件…</option>}
                    {activeCases.map((row) => <option key={row.id} value={row.id}>{row.caseNumber != null ? `#${row.caseNumber}・` : ''}{row.type === 'modification' ? '改車' : '購車'}・{row.title || '未命名案件'}</option>)}
                  </select> : <p className="text-xs text-ink-2">儲存後會自動建立一筆新案件。</p>}
                  {caseError && <p role="alert" className="text-xs text-danger">{caseError}</p>}
                </div>
              );
            })()}
            {(quote?.internalHeightPlanSummary || quote?.pendingRequirements?.length > 0) && (
              <details className="rounded-xl border border-warn/35 bg-warn/10 p-3" defaultOpen={quote?.pendingRequirements?.length > 0}>
                <summary className="cursor-pointer text-sm font-semibold text-warn">⚠️ 接待需求與施工檢查（僅內部顯示）</summary>
                <div className="mt-3 space-y-3">
                  {quote?.pendingRequirements?.length > 0
                    ? <div><p className="text-xs font-semibold text-warn mb-2">這是初步報價，仍待確認：</p><div className="flex flex-wrap gap-1.5">{quote.pendingRequirements.map((item) => <span key={item} className="badge bg-s1 text-ink-2">○ {item}</span>)}</div></div>
                    : <p className="text-xs text-ok">高度與改裝需求目前沒有缺漏項目。</p>}
                  {quote?.internalHeightPlanSummary && <pre className="whitespace-pre-wrap rounded-lg bg-s1 border border-bdr p-3 text-xs leading-relaxed font-sans">{quote.internalHeightPlanSummary}</pre>}
                  <p className="text-[11px] text-ink-3">此區不會出現在客戶報價圖片；未確認項目仍可先報初步價格，但不能視為施工規格已確認。</p>
                </div>
              </details>
            )}
            <Field label="客戶需求／用途（內部備忘，不會出現在報價圖片）">
              <textarea value={requirements} onChange={(e) => setRequirements(e.target.value)} rows={3}
                placeholder="例：市場載貨、需要防滑底板、尾門載重與平台尺寸待確認…"
                className="w-full text-sm resize-y" />
            </Field>
            <Field label="車型">
              <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
                <input type="number" min="2000" max="2100" value={modelYear}
                  onChange={(e) => setModelYear(e.target.value)} aria-label="車輛年式"
                  placeholder="年式" className="w-full text-sm" />
                <input value={model} onChange={(e) => { setModel(e.target.value); setModelId(null); }}
                  placeholder="例：單廂三人座 手排六速" className="flex-1 min-w-0 text-sm" />
                {quotePresets.models?.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => { const m = quotePresets.models.find((x) => x.id === e.target.value); if (m) pickModel(m); }}
                    className="text-xs col-span-2 w-full"
                  >
                    <option value="">選車型帶入</option>
                    {quotePresets.models.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}（{formatMoney(m.price)}）</option>
                    ))}
                  </select>
                )}
              </div>
              <label className="flex items-center gap-2 mt-2 text-xs text-ink-2 cursor-pointer">
                <input type="checkbox" checked={excludeVehiclePrice}
                  onChange={(event) => toggleVehiclePrice(event.target.checked)} />
                此單只報改裝，不含車輛售價
              </label>
              {excludeVehiclePrice && <p className="text-[11px] text-ink-3 mt-1">保留車型供選配與成本比對；車價不計入總額，也不顯示在報價圖片。</p>}
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
                {addonSections.map((section) => {
                  if (!section.nested) {
                    const [cat, list] = section.groups[0];
                    return <AddonCategoryCard key={section.key} cat={cat} list={list}
                      aliases={quotePresets.addonCategoryAliases} expanded={!!expandedAddonCategories[cat]}
                      isPicked={isPicked} reviewedNoOptionCategories={reviewedNoOptionCategories}
                      setExpandedAddonCategories={setExpandedAddonCategories}
                      setNoOptionCategories={setNoOptionCategories} showDesc={showDesc} toggleLine={toggleLine}
                      bundleLocks={bundleLocks} allAddons={quotePresets.addons} />;
                  }
                  const expanded = !!expandedAddonSections[section.key];
                  const itemCount = section.groups.reduce((total, [, list]) => total + list.length, 0);
                  const pickedCount = section.groups.reduce((total, [, list]) =>
                    total + list.filter((addon) => isPicked(addon)).length, 0);
                  const reviewedCount = section.groups.filter(([cat, list]) => reviewedNoOptionCategories.includes(cat)
                    || list.some((addon) => isPicked(addon))).length;
                  const complete = reviewedCount === section.groups.length;
                  const color = catColor(section.label);
                  return (
                    <div key={section.key} className="rounded-xl border-2 border-bdr/70 bg-s1/45 overflow-hidden">
                      <button type="button"
                        onClick={() => setExpandedAddonSections((current) => ({ ...current, [section.key]: !expanded }))}
                        aria-expanded={expanded} className="w-full flex items-center gap-2 px-3 py-2.5 text-left">
                        <span className="w-1.5 h-5 rounded-full shrink-0" style={{ background: color }} />
                        <span className="text-xs font-bold text-ink flex-1">{section.label}</span>
                        <span className="text-[10px] text-ink-3">{section.groups.length} 類・{itemCount} 項</span>
                        <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${complete || pickedCount ? 'text-ok bg-ok/10' : 'text-warn bg-warn/10'}`}>
                          {complete ? '全部已處理' : pickedCount ? `已選 ${pickedCount}` : '待確認'}
                        </span>
                        <span className="text-xs text-ink-3">{expanded ? '▲' : '▼'}</span>
                      </button>
                      {expanded && (
                        <div className="border-t border-bdr/60 bg-s2/45 p-2 space-y-2">
                          {section.groups.map(([cat, list]) => (
                            <AddonCategoryCard key={cat} cat={cat} list={list}
                              aliases={quotePresets.addonCategoryAliases} expanded={!!expandedAddonCategories[cat]}
                              isPicked={isPicked} reviewedNoOptionCategories={reviewedNoOptionCategories}
                              setExpandedAddonCategories={setExpandedAddonCategories}
                              setNoOptionCategories={setNoOptionCategories} showDesc={showDesc} toggleLine={toggleLine}
                              bundleLocks={bundleLocks} allAddons={quotePresets.addons} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {/* 優惠折扣範本：加入後才出現可編輯欄位 */}
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
                <p className="text-[10px] text-ink-3 mt-0.5">型錄沒有的配件可自行輸入；贈送項目須由後台利潤試算核定。</p>
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
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="flex items-center gap-2 text-[11px] text-ink-2 cursor-pointer min-h-11">
                  <input type="checkbox" checked={extraAddon.pending}
                    onChange={(e) => setExtraAddon((value) => ({
                      ...value, pending: e.target.checked, price: e.target.checked ? '' : value.price,
                    }))} />
                  待廠商報價
                </label>
                <button type="button" onClick={addExtraAddon}
                  disabled={!extraAddon.name.trim() || (!extraAddon.pending && !(Number(extraAddon.price) > 0))}
                  className="btn-primary text-xs shrink-0 disabled:opacity-40">加入報價</button>
              </div>
            </div>
            <div className="flex gap-2 text-[11px] font-medium text-ink-3">
              <span className="flex-1">項目名稱</span>
              <span className="w-28">金額／待廠商報價</span>
              <span className="w-4" />
            </div>
            {includedQuoteItems(items, excludeVehiclePrice).map((it) => {
              const selected = it.name.trim() && (it.pending || it.gift || Number(it.price) > 0);
              const discountSum = (it.discounts || []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
              const needsColorNote = PAINT_COLOR_CATALOG_IDS.has(it.catalogId);
              return (
                <div key={it.id} className="rounded-xl border border-bdr bg-s1 p-2.5 space-y-2">
                  <div className="flex gap-2">
                    <input value={it.name} onChange={(e) => setItem(it.id, { name: e.target.value })}
                      placeholder="配備 / 保險 / 領牌…" className="flex-1 text-sm min-w-0" />
                    <input type="number" min="0" value={it.price}
                      onChange={(e) => setItem(it.id, { price: e.target.value })}
                      disabled={it.pending} placeholder={it.pending ? '待廠商報價' : it.gift ? '贈送價值' : '0'}
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
                          : it.gift
                          ? `此項贈送${Number(it.price) > 0 ? `・價值 ${formatMoney(it.price)}` : ''}`
                          : (it.discounts || []).length > 0
                          ? `已優惠 ${formatMoney(discountSum)}・折後 ${formatMoney(Math.max(0, Number(it.price) - discountSum))}`
                          : selected ? '此項目目前沒有優惠' : '請輸入金額或標記待廠商報價'}
                      </span>
                      <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                        {!it.gift && <button type="button" onClick={() => setItem(it.id, {
                          pending: !it.pending, discounts: it.pending ? it.discounts : [],
                        })}
                          className={`text-[11px] rounded-lg border px-2 py-1 ${it.pending ? 'border-warn bg-warn/10 text-warn' : 'border-bdr text-ink-3'}`}>
                          {it.pending ? '✓ 待廠商報價' : '設為待廠商報價'}
                        </button>}
                        {it.gift && <span className="text-[11px] rounded-lg border border-ok bg-ok/10 text-ok px-2 py-1">🎁 後台核定贈送</span>}
                      </div>
                    </div>
                  )}
                  {selected && !it.pending && !it.gift && (
                    <div className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/5 p-2">
                      <label htmlFor={`central-discount-${it.id}`} className="flex-1 min-w-0">
                        <span className="block text-[11px] font-semibold text-ink-2">中央優惠</span>
                        <span className="block text-[10px] text-ink-3">與後台利潤試算同步，只會保留一筆</span>
                      </label>
                      <input id={`central-discount-${it.id}`} type="number" min="0" max={Math.max(0, Number(it.price) || 0)}
                        value={(it.discounts || [])[0]?.amount || ''}
                        onChange={(e) => setCentralItemDiscount(it.id, e.target.value)}
                        placeholder="0" className="w-28 min-h-11 text-xs" />
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
                  className="btn-outline text-[11px] shrink-0">＋ 新增優惠折扣</button>
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
              {generalDiscounts.length === 0 && <p className="text-[11px] text-ink-3">尚未加入優惠折扣。</p>}
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
                        {p === 0 ? '頭款 0 元試算' : `${p}%`}
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
                  <p style={{ color: '#2e3a42', fontSize: 16, fontWeight: 700 }}>{customerName || (client?.pendingCustomerDetails ? '貴賓' : client?.name) || '貴賓'}</p>
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

              {/* 車型 */}
              {model.trim() && (
                <div style={{
                  borderLeft: '3px solid #bf8a5e', background: '#faf6f1',
                  borderRadius: '0 8px 8px 0', padding: '9px 14px', marginBottom: 16,
                }}>
                  <p style={{ color: '#9aa7b0', fontSize: 9.5, letterSpacing: 1, marginBottom: 2 }}>車型</p>
                  <p style={{ color: '#5a4632', fontSize: 14, fontWeight: 700 }}>
                    {modelYear ? `${modelYear}年式 ${model}` : model}
                  </p>
                  {excludeVehiclePrice && <p style={{ color: '#8b98a1', fontSize: 10, marginTop: 3 }}>本報價不含車輛售價</p>}
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
                      const itemName = splitQuoteItemName(item.name);
                      const itemDescription = item.description
                        || quotePresets.addons.find((addon) => addon.id === item.catalogId)?.desc
                        || '';
                      return (
                        <div key={item.id} style={{ padding: '10px 0', borderBottom: '1px solid #f0f3f5' }}>
                          <div style={{
                            display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 92px',
                            columnGap: 12, alignItems: 'start',
                          }}>
                            <span style={{
                              color: '#4a5862', fontSize: 12.5, lineHeight: 1.45,
                              minWidth: 0, overflowWrap: 'anywhere',
                            }}>
                              {itemName.main}
                              {itemName.detail && (
                                <span style={{ display: 'block', color: '#7f8d97', fontSize: 9.5, lineHeight: 1.5, marginTop: 2 }}>
                                  {itemName.detail}
                                </span>
                              )}
                              {itemDescription && (
                                <span style={{ display: 'block', color: '#8b98a1', fontSize: 9.2, lineHeight: 1.55, marginTop: 3 }}>
                                  {itemDescription}
                                </span>
                              )}
                              {item.note && (
                                <span style={{ display: 'block', color: '#8b98a1', fontSize: 10.5, marginTop: 2 }}>
                                  備註：{item.note}
                                </span>
                              )}
                            </span>
                            <span style={{
                              width: 92, minWidth: 92, textAlign: 'right', whiteSpace: 'nowrap',
                              fontVariantNumeric: 'tabular-nums', lineHeight: 1.2,
                            }}>
                              {item.pending ? (
                                <span style={{ color: '#a9793f', background: '#fff7e8', border: '1px solid #ecd8b7', borderRadius: 999, padding: '2px 7px', fontSize: 9.5, fontWeight: 700 }}>
                                  待廠商報價
                                </span>
                              ) : item.gift ? (
                                <>
                                  {itemTotal.original > 0 && (
                                    <span style={{ display: 'block', color: '#aab4bc', fontSize: 9.5, marginBottom: 3 }}>
                                      價值 {formatMoney(itemTotal.original)}
                                    </span>
                                  )}
                                  <span style={{ color: '#3f7652', background: '#edf5ef', border: '1px solid #d8e9dc', borderRadius: 999, padding: '3px 8px', fontSize: 10, fontWeight: 800 }}>
                                    🎁 贈送
                                  </span>
                                </>
                              ) : hasDiscount ? (
                                <>
                                  <span style={{ display: 'block', color: '#aab4bc', fontSize: 10.5, marginBottom: 3 }}>
                                    <span style={{ display: 'inline-block', position: 'relative', padding: '0 1px' }}>
                                      {formatMoney(itemTotal.original)}
                                      <span aria-hidden style={{
                                        position: 'absolute', left: 0, right: 0, top: '50%',
                                        borderTop: '1px solid #9ba8b0', transform: 'translateY(-50%)',
                                      }} />
                                    </span>
                                  </span>
                                  <span style={{ display: 'block', color: '#3f7652', fontSize: 15, fontWeight: 800 }}>
                                    {formatMoney(itemTotal.net)}
                                  </span>
                                </>
                              ) : (
                                <span style={{ display: 'block', color: '#2e3a42', fontSize: 13.5, fontWeight: 800 }}>
                                  {formatMoney(itemTotal.net)}
                                </span>
                              )}
                            </span>
                          </div>
                          {!item.pending && !item.gift && hasDiscount && (
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
                  <p style={{ color: '#6f957a', fontSize: 9.5, fontWeight: 700, letterSpacing: 1.5, marginBottom: 5 }}>優惠折扣</p>
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
                  [selectedItems.some((item) => item.gift) ? '優惠／贈送' : '優惠折扣', -totals.discountTotal],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', color: value < 0 ? '#6f957a' : '#8b98a1', fontSize: 10.5, padding: '2px 2px' }}>
                    <span>{label}</span><span>{value < 0 ? '−' : ''}{formatMoney(Math.abs(value))}</span>
                  </div>
                ))}
              </div>
              <div style={{
                background: 'linear-gradient(135deg,#3f4d5a,#2b343d)', borderRadius: 10,
                padding: '13px 18px', marginTop: 10,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                  <span style={{ color: '#c9d6e0', fontSize: 12, fontWeight: 600, letterSpacing: 2, flexShrink: 0 }}>
                    {pendingItems.length > 0 ? '目前已確認金額' : '最終專案價'}
                  </span>
                  <div style={{ color: '#fff', fontSize: 23, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#bf8a5e', marginRight: 4 }}>NT$</span>
                    {formatMoney(total)}
                  </div>
                </div>
                <div style={{
                  color: '#c9d6e0', borderTop: '1px solid rgba(201,214,224,0.22)',
                  fontSize: 10.5, fontWeight: 600, lineHeight: 1.4, letterSpacing: 0.7,
                  marginTop: 7, paddingTop: 6, textAlign: 'right', whiteSpace: 'nowrap',
                }}>
                  {formatChineseTwd(total)}
                </div>
              </div>
              {pendingItems.length > 0 && (
                <p style={{ color: '#9a6d3e', background: '#fff8ec', borderRadius: 8, padding: '7px 10px', fontSize: 9.5, lineHeight: 1.5, marginTop: 8 }}>
                  尚有 {pendingItems.length} 項待廠商報價，以上金額不包含待廠商報價項目，完整總價確認後更新。
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

          {/* 圖片版與 LINE 純文字版 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
            <button onClick={downloadImage} disabled={selectedItems.length === 0 || capturing}
              className="btn-primary w-full disabled:opacity-40">
              {capturing ? '產生圖片中…' : '🖼️ 產生報價單圖片'}
            </button>
            <button type="button" onClick={openTextQuote} disabled={selectedItems.length === 0}
              className="btn-outline w-full disabled:opacity-40">📝 文字版報價（LINE）</button>
          </div>
          <p className="text-center text-[11px] text-ink-3 mt-1.5">
            先預覽確認，再分享、存到相簿或傳 LINE
          </p>
          {exportError && <p role="alert" className="mt-2 rounded-lg bg-danger/10 border border-danger/30 px-3 py-2 text-xs text-danger">{exportError}</p>}
          <div className="flex gap-2 mt-3">
            <button onClick={onClose} className="btn-outline flex-1">關閉</button>
            <button onClick={handleRecord} disabled={selectedItems.length === 0}
              className="btn-outline flex-1 disabled:opacity-40">
              💾 {isEdit ? '儲存修改' : (client?.id ? '記錄報價' : customerMode === 'new' ? '建立客戶並儲存報價' : '儲存報價')}
            </button>
          </div>
        </div>
      </div>
      {showTextQuote && (
        <div className="safe-screen fixed inset-0 z-[85] bg-black/80 overflow-y-auto px-3 flex items-start justify-center">
          <div className="w-full max-w-md my-3 rounded-2xl bg-s1 border border-bdr shadow-panel p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="font-bold text-ink">📝 文字版報價</h3>
                <p className="text-[11px] text-ink-3 mt-0.5">會隨車型、配件、優惠與總價自動更新。</p>
              </div>
              <button type="button" onClick={() => setShowTextQuote(false)}
                className="btn-ghost text-2xl leading-none px-2" aria-label="關閉文字報價">✕</button>
            </div>
            <textarea readOnly value={textQuote} aria-label="文字版報價內容"
              className="w-full min-h-[22rem] resize-y text-sm leading-relaxed bg-s2 p-3" />
            <button type="button" onClick={copyTextQuote} className="btn-primary w-full mt-3 text-base py-2.5">
              📋 複製文字報價
            </button>
            {textCopyStatus && <p role="status" className="text-center text-xs text-ok font-semibold mt-2">{textCopyStatus}</p>}
            <p className="text-center text-[11px] text-ink-3 mt-2">複製後可直接貼到客人 LINE，也可在 LINE 內再調整。</p>
          </div>
        </div>
      )}
      {showCatalog && <ProductCatalog onClose={() => setShowCatalog(false)} />}
      {exportedImage && (
        <div className="safe-screen fixed inset-0 z-[80] bg-black/85 overflow-y-auto px-3 flex items-start justify-center">
          <div className="w-full max-w-md my-2 rounded-2xl bg-s1 border border-bdr shadow-panel p-3">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="font-bold text-ink">報價圖片已產生</h3>
                <p className="text-[11px] text-ink-3 mt-0.5">請檢查內容，再選擇分享或儲存。</p>
              </div>
              <button type="button" onClick={closeExportPreview} className="btn-ghost text-2xl leading-none px-2" aria-label="關閉圖片預覽">✕</button>
            </div>
            <img src={exportedImage.url} alt="報價單圖片預覽" className="block w-full h-auto rounded-xl bg-white border border-bdr" />
            {exportError && <p role="alert" className="mt-3 rounded-lg bg-danger/10 border border-danger/30 px-3 py-2 text-xs text-danger">{exportError}</p>}
            <div className="grid grid-cols-1 gap-2 mt-3">
              <button type="button" onClick={shareExportedImage} className="btn-primary w-full text-base py-2.5">
                📤 分享／存到相簿／傳 LINE
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={openExportedImage} className="btn-outline">開啟圖片（可長按儲存）</button>
                <a href={exportedImage.url} download={exportedImage.fileName} className="btn-outline">下載 PNG</a>
              </div>
            </div>
            <p className="text-center text-[11px] text-ink-3 mt-2">若 iPhone 沒有「儲存影像」，請點「開啟圖片」後長按圖片。</p>
          </div>
        </div>
      )}
    </>
  );
}
