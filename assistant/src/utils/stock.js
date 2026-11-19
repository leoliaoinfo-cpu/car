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
const VENDOR_NAME = /帆布|箱體|冷凍冷藏|鋁塑箱|尾門|烤漆|噴漆|改色|H\s*架/i;
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
  const status = stockStatus(item);
  if (status === 'not_needed') return true;
  return stockTrack(item) === 'vendor' ? ['vendor_done', 'checked', 'reported'].includes(status) : ['ready', 'installed'].includes(status);
}

/** 全部做完、不用再追：改裝部＝已安裝；外包＝已回報客戶進度。 */
export function isFinishedStock(item) {
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
    // 一般費用／服務不是備品；非 addon 的實體贈品仍留給業務核對。
    if ((item.kind !== 'addon' && !item.gift) || !String(item.name || '').trim()) continue;
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

export function stockAlert(deal, caseItem, now = new Date()) {
  // 已交車（已完成）的案件不再提醒缺貨，舊資料只有 status=completed 也要算。
  if (caseItem?.status === 'completed' || caseItem?.pipelineStage === 'completed') {
    return { missing: 0, deliveryRisk: false, inquiryNoDate: false, days: null, delivered: true };
  }
  const missing = missingStockItems(deal);
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
    out.push({
      caseId: caseItem.id, dealId: deal.id, deal, clientName: deal.clientName || caseItem.clientName || '未命名客戶',
      deliveryDate: target, days, urgent: missing > 0 && days != null && days <= 7, missing,
      rows: [...rows].sort((a, b) => rank(a) - rank(b)),
    });
  }
  return out.sort((a, b) => (a.days == null) - (b.days == null) || (a.days ?? 0) - (b.days ?? 0) || a.clientName.localeCompare(b.clientName, 'zh-Hant'));
}
