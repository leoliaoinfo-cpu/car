// 成交配件核對表與中央缺品統計。只取已指定成交的報價快照，不讀同案其他報價。
export const STOCK_STATUSES = [
  ['todo', '未處理'], ['inquiry', '待廠商確認'], ['ready', '已備妥'], ['installed', '已安裝'], ['not_needed', '不需備品'],
];

/** 已備妥／已安裝／不需備品都算「不缺」。 */
export const STOCK_SETTLED = ['ready', 'installed', 'not_needed'];

/** 還沒備妥的配件（交車前警示、案件卡片共用同一個判斷）。 */
export function missingStockItems(deal) {
  return (deal?.stockItems || []).filter((item) => !STOCK_SETTLED.includes(item.status));
}

export function stockItemsFromQuote(quote, addons = []) {
  const catalog = new Map(addons.map((item) => [item.id, item]));
  const result = [];
  for (const item of quote?.items || []) {
    // 一般費用／服務不是備品；非 addon 的實體贈品仍留給業務核對。
    if ((item.kind !== 'addon' && !item.gift) || !String(item.name || '').trim()) continue;
    const components = item.bundlePricingMode === 'components' && item.bundleIncludedIds?.length
      ? item.bundleIncludedIds.filter((id) => !item.bundleExcludedIds?.includes(id)) : [];
    if (components.length) {
      for (const id of components) {
        const component = catalog.get(id);
        result.push({ id: `${item.id}:${id}`, catalogId: id, name: component?.name || `${item.name}・${id}`,
          specification: String(component?.choiceLabel || '').trim(), quantity: 1, status: item.pending ? 'inquiry' : 'todo',
          note: String(item.note || item.description || '').trim(), gift: !!item.gift, fromBundle: item.name });
      }
    } else {
      result.push({ id: item.id, catalogId: item.catalogId || null, name: item.name.trim(),
        specification: String(item.optionValue || item.optionLabel || '').trim(), quantity: 1,
        status: item.pending ? 'inquiry' : 'todo', note: String(item.note || item.vendorInquiryNote || item.description || '').trim(), gift: !!item.gift });
    }
  }
  return result;
}

export function summarizeStock(deals = [], cases = []) {
  const activeCaseIds = new Set(cases.filter((item) => !item.deletedAt && item.status !== 'completed').map((item) => item.id));
  const rows = [];
  for (const deal of deals) {
    if (!deal.quoteId || deal.caseArchivedAt || !activeCaseIds.has(deal.caseId)) continue;
    for (const item of deal.stockItems || []) {
      if (['installed', 'not_needed'].includes(item.status)) continue;
      rows.push({ ...item, caseId: deal.caseId, dealId: deal.id, clientName: deal.clientName || '' });
    }
  }
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.catalogId || row.name}|${row.specification || ''}`;
    const group = grouped.get(key) || { key, name: row.name, specification: row.specification || '', needed: 0, ready: 0, missing: 0, cases: [] };
    const count = Math.max(1, Number(row.quantity) || 1);
    group.needed += count;
    if (row.status === 'ready') group.ready += count;
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
    inquiryNoDate: missing.some((item) => item.status === 'inquiry' && !item.followUpDate),
    days,
  };
}
