// 成交配件核對表與中央缺品統計。只取已指定成交的報價快照，不讀同案其他報價。
//
// 兩種流程（使用者 2026-11-19 定義）：
//  • 外包（帆布、箱體、尾門、烤漆、H 架…）：未聯繫廠商 → 已聯繫廠商 → 廠商已施作 → 已確認沒問題 → 已經回報客戶進度
//  • 改裝部配件：缺貨中 → 已叫貨 → 已到貨 → 已安裝（「已處理」與「已安裝」同義，合併）
// 狀態代碼沿用舊的 todo／inquiry／ready／installed／not_needed，外包另加 vendor_done／checked／reported，
// 舊資料不用轉換：外包項目的舊 ready 視為「廠商已施作」、舊 installed 視為「已確認沒問題」。
import { DEFAULT_QUOTE_PRESETS } from './crm.js';

export const TRACK_LABELS = { vendor: '外包', inhouse: '改裝部' };
export const VENDOR_STATUSES = [
  ['todo', '未聯繫廠商'], ['inquiry', '已聯繫廠商'], ['vendor_done', '廠商已施作'], ['checked', '已確認沒問題'], ['reported', '已經回報客戶進度'], ['not_needed', '不需要'],
];
export const INHOUSE_STATUSES = [
  ['todo', '缺貨中'], ['inquiry', '已叫貨'], ['ready', '已到貨'], ['installed', '已安裝'], ['not_needed', '不需備品'],
];
/** 相容舊程式：以改裝部的名稱當預設標籤。 */
export const STOCK_STATUSES = INHOUSE_STATUSES;

// 預設歸外包：帆布、各種箱體、尾門系統、烤漆／改色、H 架
const VENDOR_CATEGORY = /尾門|帆布|冷凍|歐翼|露營|改色|防刮|烤漆/;
const VENDOR_NAME = /帆布|[蓬篷]頂|[二三四五]面帆|箱體|冷凍冷藏|鋁塑箱|尾門|烤漆|噴漆|改色|H\s*架/i;
const CATALOG = new Map((DEFAULT_QUOTE_PRESETS.addons || []).map((addon) => [addon.id, addon]));

/** 新配件預設歸哪一類（使用者可以逐項改）。 */
export function defaultTrack(item, catalog = CATALOG) {
  const cat = String(catalog.get?.(item?.catalogId)?.cat || '');
  const name = `${item?.name || ''} ${item?.fromBundle || ''}`;
  return VENDOR_CATEGORY.test(cat) || VENDOR_NAME.test(name) ? 'vendor' : 'inhouse';
}

export function stockTrack(item) {
  return item?.track === 'vendor' || item?.track === 'inhouse' ? item.track : defaultTrack(item);
}

/** 舊資料相容：外包項目的舊 ready／installed 換成外包的說法。 */
export function stockStatus(item) {
  const status = item?.status || 'todo';
  if (stockTrack(item) === 'vendor') {
    if (status === 'ready') return 'vendor_done';
    if (status === 'installed') return 'checked';
  } else if (['vendor_done', 'checked', 'reported'].includes(status)) {
    return status === 'vendor_done' ? 'ready' : 'installed';
  }
  return status;
}

export function statusOptions(item) {
  return stockTrack(item) === 'vendor' ? VENDOR_STATUSES : INHOUSE_STATUSES;
}

export function statusLabel(item) {
  const status = stockStatus(item);
  return statusOptions(item).find(([id]) => id === status)?.[1] || status;
}

/** 下一步按鈕：目前狀態的下一個（最後一步回傳 null）。 */
export function nextStatus(item) {
  const options = statusOptions(item).filter(([id]) => id !== 'not_needed');
  const index = options.findIndex(([id]) => id === stockStatus(item));
  return index >= 0 && index < options.length - 1 ? options[index + 1] : null;
}

/** 「不缺」：改裝部＝已到貨／已安裝；外包＝廠商已施作之後。不需要的也算。 */
export function isSettledStock(item) {
  if (item?.hidden || item?.info) return true; // 隱藏的、報價資訊（費用／車價備註）不算缺貨
  const status = stockStatus(item);
  if (status === 'not_needed') return true;
  return stockTrack(item) === 'vendor' ? ['vendor_done', 'checked', 'reported'].includes(status) : ['ready', 'installed'].includes(status);
}

/** 全部做完、不用再追：改裝部＝已安裝；外包＝已回報客戶進度。 */
export function isFinishedStock(item) {
  if (item?.hidden || item?.info) return true;
  const status = stockStatus(item);
  if (status === 'not_needed') return true;
  return stockTrack(item) === 'vendor' ? status === 'reported' : status === 'installed';
}

/** 外包／改裝部互換時，狀態換成對應的一步（不會讓進度倒退或憑空前進）。 */
export function switchTrack(item, track) {
  if (track === stockTrack(item)) return item;
  const status = stockStatus(item);
  const toInhouse = { vendor_done: 'ready', checked: 'installed', reported: 'installed' };
  const toVendor = { ready: 'vendor_done', installed: 'checked' };
  return { ...item, track, status: (track === 'inhouse' ? toInhouse : toVendor)[status] || status };
}

/** 保留舊名稱：還沒備妥（不缺的相反）。 */
export const STOCK_SETTLED = ['ready', 'installed', 'not_needed'];

/** 還沒備妥的配件（交車前警示、案件卡片共用同一個判斷）。 */
export function missingStockItems(deal) {
  return (deal?.stockItems || []).filter((item) => !isSettledStock(item));
}

// 客人不要的套裝項目（報價「扣項」）：寫進配件備註，點貨時一眼看到少哪幾項。
function deductionNote(item) {
  const names = (item.deductions || []).map((row) => String(row?.name || '').trim()).filter(Boolean);
  return names.length ? `客人不要：${names.join('、')}` : '';
}
function joinNotes(...parts) { return parts.map((x) => String(x || '').trim()).filter(Boolean).join('；'); }

export function stockItemsFromQuote(quote, addons = []) {
  const catalog = new Map(addons.map((item) => [item.id, item]));
  const withTrack = (row) => ({ ...row, track: defaultTrack(row, catalog) });
  const result = [];
  for (const item of quote?.items || []) {
    // 報價上的每一項（含「其他費用」、車價備註）都帶進來，由使用者自己判斷要備貨、隱藏或刪除（2026-11-20）。
    // 真的要備貨／找廠商的（addon、贈品、其他費用裡打的外包配件）照舊當配件；
    // 領牌費、保險這類費用與車價只當「報價資訊」帶過來（info），不算缺貨、不催，使用者可「改成要備貨」、隱藏或刪除。
    const name = String(item.name || '').trim();
    if (!name) continue;
    const noteText = joinNotes(item.note || item.vendorInquiryNote || item.description, deductionNote(item));
    if (item.kind === 'vehicle' && !noteText) continue; // 車價沒有任何備註就沒有資訊可帶
    const typedVendorItem = item.kind === 'other' && VENDOR_NAME.test(name);
    if (item.kind !== 'addon' && !item.gift && !typedVendorItem) {
      result.push({ id: item.id, catalogId: null, name, specification: String(item.optionValue || '').trim(), quantity: 1, status: 'todo',
        note: noteText, gift: false, track: 'inhouse', info: true, quotePrice: Math.max(0, Number(item.price) || 0), sourceKind: item.kind });
      continue;
    }
    const components = item.bundlePricingMode === 'components' && item.bundleIncludedIds?.length
      ? item.bundleIncludedIds.filter((id) => !item.bundleExcludedIds?.includes(id)) : [];
    if (components.length) {
      for (const id of components) {
        const component = catalog.get(id);
        result.push(withTrack({ id: `${item.id}:${id}`, catalogId: id, name: component?.name || `${item.name}・${id}`,
          specification: String(component?.choiceLabel || '').trim(), quantity: 1, status: item.pending ? 'inquiry' : 'todo',
          note: joinNotes(item.note || item.description, deductionNote(item)), gift: !!item.gift, fromBundle: item.name }));
      }
    } else {
      result.push(withTrack({ id: item.id, catalogId: item.catalogId || null, name: item.name.trim(),
        specification: String(item.optionValue || item.optionLabel || '').trim(), quantity: 1,
        status: item.pending ? 'inquiry' : 'todo', note: joinNotes(item.note || item.vendorInquiryNote || item.description, deductionNote(item)), gift: !!item.gift }));
    }
  }
  return result;
}

/**
 * 報價裡有、但配件核對表還沒列入的項目（例：舊成交當時「其他費用」裡的帆布沒被算進來）。
 * 只回傳「核對表裡沒有這個 id」的項目；不會動到已經有的項目與它們的狀態。
 */
export function unlistedStockItems(deal, quote, addons = []) {
  if (!deal?.quoteId || !quote) return [];
  const have = new Set([...(deal.stockItems || []).map((row) => row.id), ...(deal.stockRemoved || [])]); // 使用者刪掉的不再重新提示
  return stockItemsFromQuote(quote, addons).filter((row) => !have.has(row.id));
}

export function summarizeStock(deals = [], cases = []) {
  const activeCaseIds = new Set(cases.filter((item) => !item.deletedAt && !['completed', 'closed'].includes(item.status)).map((item) => item.id));
  const rows = [];
  for (const deal of deals) {
    if (!deal.quoteId || deal.caseArchivedAt || !activeCaseIds.has(deal.caseId)) continue;
    for (const item of deal.stockItems || []) {
      if (isFinishedStock(item)) continue;
      rows.push({ ...item, caseId: deal.caseId, dealId: deal.id, clientName: deal.clientName || '' });
    }
  }
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.catalogId || row.name}|${row.specification || ''}`;
    const group = grouped.get(key) || { key, name: row.name, specification: row.specification || '', needed: 0, ready: 0, missing: 0, cases: [] };
    const count = Math.max(1, Number(row.quantity) || 1);
    group.needed += count;
    if (isSettledStock(row)) group.ready += count;
    else group.missing += count;
    group.cases.push(row);
    grouped.set(key, group);
  }
  return [...grouped.values()].sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name, 'zh-Hant'));
}

const awaitingCar = (caseItem) => Boolean(caseItem?.awaitingCar) && !caseItem?.carArrivedAt;

export function stockAlert(deal, caseItem, now = new Date()) {
  // 已交車（已完成）的案件不再提醒缺貨，舊資料只有 status=completed 也要算。
  if (caseItem?.status === 'completed' || caseItem?.pipelineStage === 'completed') {
    return { missing: 0, deliveryRisk: false, inquiryNoDate: false, days: null, delivered: true };
  }
  const missing = missingStockItems(deal);
  // 等車中：車還沒到，不催缺貨、不要求排再追日（到貨日不確定時催了也沒用）
  if (awaitingCar(caseItem)) return { missing: missing.length, deliveryRisk: false, inquiryNoDate: false, days: null, awaiting: true };
  const target = caseItem?.desiredDeliveryDate;
  const days = target ? Math.ceil((new Date(`${target}T00:00:00`).getTime() - new Date(now).setHours(0, 0, 0, 0)) / 86400000) : null;
  return {
    missing: missing.length,
    deliveryRisk: missing.length > 0 && days != null && days <= 7,
    inquiryNoDate: missing.some((item) => stockStatus(item) === 'inquiry' && !item.followUpDate),
    days,
  };
}

/** 改狀態要一起存的欄位：改成「已聯繫廠商／已叫貨」時，沒排再追日就自動排 3 天後。 */
export function statusPatch(row, status, followUpDate = '') {
  return status === 'inquiry' && !row.followUpDate && followUpDate ? { status, followUpDate } : { status };
}

/**
 * 「尚缺配件」依客戶整理：一台車一組、依交車日排序（沒排交車日的放最後），7 天內要交的標急。
 * 外包排前面、改裝部其次、贈品最後；已經全部做完的項目不列出。
 */
export function stockByCase(deals = [], cases = [], now = new Date()) {
  const activeCases = new Map(cases.filter((item) => !item.deletedAt && !['completed', 'closed'].includes(item.status)).map((item) => [item.id, item]));
  const today0 = new Date(now).setHours(0, 0, 0, 0);
  const rank = (row) => (row.gift ? 2 : stockTrack(row) === 'vendor' ? 0 : 1);
  const out = [];
  for (const deal of deals) {
    if (!deal.quoteId || deal.caseArchivedAt) continue;
    const caseItem = activeCases.get(deal.caseId);
    if (!caseItem) continue;
    const rows = (deal.stockItems || []).filter((row) => !isFinishedStock(row));
    if (!rows.length) continue;
    const target = caseItem.desiredDeliveryDate || '';
    const days = target ? Math.ceil((new Date(`${target}T00:00:00`).getTime() - today0) / 86400000) : null;
    const missing = rows.filter((row) => !isSettledStock(row)).length;
    const awaiting = awaitingCar(caseItem);
    out.push({
      caseId: caseItem.id, dealId: deal.id, deal, clientName: deal.clientName || caseItem.clientName || '未命名客戶',
      deliveryDate: target, days, urgent: !awaiting && missing > 0 && days != null && days <= 7, missing,
      awaiting, expectedCarMonth: caseItem.expectedCarMonth || '', carArrivedAt: caseItem.carArrivedAt || '',
      rows: [...rows].sort((a, b) => rank(a) - rank(b)),
    });
  }
  return out.sort((a, b) => (a.days == null) - (b.days == null) || (a.days ?? 0) - (b.days ?? 0)
    || Number(a.awaiting) - Number(b.awaiting) || String(a.expectedCarMonth || '9999').localeCompare(String(b.expectedCarMonth || '9999'))
    || a.clientName.localeCompare(b.clientName, 'zh-Hant'));
}

// ── 依配件分區（集體作業）：同一種配件放在一起，一次處理好幾位客戶 ─────────────────────────────
const VENDOR_KINDS = [
  ['帆布', /帆布|[蓬篷]頂|[二三四五]面帆/],
  ['尾門', /尾門/],
  ['烤漆／改色', /烤漆|噴漆|改色|珍珠漆|logo|輪胎蓋/i],
  ['箱體', /箱體|鋁塑箱|冷凍|冷藏|歐翼|露營/],
  ['H 架', /H\s*架/i],
];

/** 這個配件屬於哪一區：外包看名稱（帆布、尾門…），改裝部看型錄分類（燈組、駕駛科技…），都對不到就歸「其他」。 */
export function stockKind(item, catalog = CATALOG) {
  const cat = String(catalog.get?.(item?.catalogId)?.cat || '');
  const text = `${item?.name || ''} ${item?.fromBundle || ''} ${cat}`;
  if (stockTrack(item) === 'vendor') {
    const hit = VENDOR_KINDS.find(([, re]) => re.test(text));
    return { key: `vendor:${hit ? hit[0] : '其他外包'}`, label: hit ? hit[0] : '其他外包', track: 'vendor' };
  }
  return { key: `inhouse:${cat || '其他配件'}`, label: cat || '其他配件', track: 'inhouse' };
}

/**
 * 把 stockByCase 的結果改成「依配件分區」：外包（帆布、尾門、烤漆…）在前，改裝部依報價選單的分類順序。
 * 每區的每一列都帶客戶、等車資訊，方便一次聯繫同一家廠商／一次叫貨。
 */
export function stockByKind(entries = []) {
  const catOrder = DEFAULT_QUOTE_PRESETS.addonCategories || [];
  const groups = new Map();
  for (const entry of entries) {
    for (const row of entry.rows) {
      const kind = stockKind(row);
      const group = groups.get(kind.key) || { ...kind, rows: [] };
      group.rows.push({
        ...row, caseId: entry.caseId, dealId: entry.dealId, deal: entry.deal, clientName: entry.clientName,
        awaiting: entry.awaiting, expectedCarMonth: entry.expectedCarMonth, urgent: entry.urgent, days: entry.days,
      });
      groups.set(kind.key, group);
    }
  }
  const rank = (group) => {
    if (group.track === 'vendor') { const i = VENDOR_KINDS.findIndex(([label]) => label === group.label); return i < 0 ? VENDOR_KINDS.length : i; }
    const i = catOrder.indexOf(group.label);
    return 100 + (i < 0 ? 999 : i);
  };
  return [...groups.values()].map((group) => ({
    ...group,
    // 急的客戶排前面、其次交車日近的，再其次等車的
    rows: group.rows.sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.days == null) - (b.days == null) || (a.days ?? 0) - (b.days ?? 0)
      || Number(a.awaiting) - Number(b.awaiting) || a.clientName.localeCompare(b.clientName, 'zh-Hant')),
    missing: group.rows.filter((row) => !isSettledStock(row)).length,
  })).sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'zh-Hant'));
}
