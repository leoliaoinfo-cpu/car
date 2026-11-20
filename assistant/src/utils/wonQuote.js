// 成交後再修改報價（客人追加改裝配件等）：把修改結果同步到成交資料。純邏輯，有測試。
import { stockItemsFromQuote } from './stock.js';
import { generateDeliveryWorkflow } from './delivery.js';

const SETTLED = ['ready', 'installed'];

/**
 * 合併配件核對表：
 * - 報價裡原本就有的配件：保留你已經填的狀態、數量、再追日（已備妥不會被洗掉）
 * - 新追加的配件：新增為未處理（待廠商確認的自動排 3 天後再追）
 * - 報價裡拿掉的配件：還沒備貨的就移除；已備妥／已安裝的保留（實體已經處理過，不能默默消失）
 */
export function mergeStockItems({ oldItems = [], freshItems: allFresh = [], previousDerived = [], followUpDate = '', removedIds = [] }) {
  const gone = new Set(removedIds); // 使用者刪掉的項目，報價再怎麼改也不要加回來
  const freshItems = allFresh.filter((row) => !gone.has(row.id));
  const prevNote = new Map(previousDerived.map((row) => [row.id, row.note || '']));
  const old = new Map(oldItems.map((row) => [row.id, row]));
  const freshIds = new Set(freshItems.map((row) => row.id));
  const merged = freshItems.map((row) => {
    const prev = old.get(row.id);
    if (!prev) return row.status === 'inquiry' && !row.followUpDate && followUpDate ? { ...row, followUpDate } : row;
    // 備註：使用者沒自己改過（和上次由報價帶出的一樣）才跟著報價更新
    const note = prev.note === (prevNote.get(row.id) ?? prev.note) ? row.note : prev.note;
    return { ...prev, name: row.name, specification: row.specification, gift: row.gift, note, ...(row.quotePrice != null ? { quotePrice: row.quotePrice } : {}) };
  });
  const kept = oldItems.filter((row) => !freshIds.has(row.id) && SETTLED.includes(row.status));
  return { items: [...merged, ...kept], added: merged.filter((row) => !old.has(row.id)), removed: oldItems.filter((row) => !freshIds.has(row.id) && !SETTLED.includes(row.status)), kept };
}

/** 金額：用「差額」套到原本的成交金額，才不會洗掉舊成交原本的特殊金額。 */
export function nextDealAmount({ deal, quote }) {
  const newTotal = Number(quote?.total) || 0;
  const oldSnapshotTotal = Number(deal?.quoteSnapshot?.total);
  if (Number.isFinite(oldSnapshotTotal) && Number.isFinite(Number(deal?.amount))) return Math.max(0, Number(deal.amount) + (newTotal - oldSnapshotTotal));
  return newTotal;
}

/** 報價追加了哪些施工步驟（目前施工進度還沒有的），只提示、不自動改你的進度。 */
export function missingWorkflowSteps({ deal, quote }) {
  const have = new Set((deal?.deliveryWorkflow || []).map((step) => step.id));
  if (!have.size) return [];
  const suggested = generateDeliveryWorkflow({ deal, pricing: { lines: quote?.items || [] } });
  return suggested.filter((step) => !have.has(step.id)).map((step) => step.label);
}

export function planWonQuoteSync({ deal, quote, addons = [], followUpDate = '' }) {
  const fresh = stockItemsFromQuote(quote, addons);
  const previousDerived = deal?.quoteSnapshot ? stockItemsFromQuote(deal.quoteSnapshot, addons) : [];
  const stock = mergeStockItems({ oldItems: deal?.stockItems || [], freshItems: fresh, previousDerived, followUpDate, removedIds: deal?.stockRemoved || [] });
  const amount = nextDealAmount({ deal, quote });
  return {
    amount,
    amountDelta: amount - (Number(deal?.amount) || 0),
    stockItems: stock.items,
    addedStock: stock.added.map((row) => row.name),
    removedStock: stock.removed.map((row) => row.name),
    keptStock: stock.kept.map((row) => row.name),
    missingSteps: missingWorkflowSteps({ deal, quote }),
  };
}
