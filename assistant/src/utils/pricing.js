/** 報價／成本純計算工具。此檔不碰 UI 或 IndexedDB，方便單元測試。 */

const COST_CATALOG_VERSION = 2;

// 來源：使用者提供的「2026 卡旺配件清單」與「商用車隔熱紙速查表 2025/11」。
// 隔熱紙表的「業務價（含稅）」依使用者指示視為成本；成本只供內部區域使用。
const SUPPLIER_ADDON_COSTS = {
  'qa-pkg2': { cost: 29000 },
  'qa-android-surround': { cost: 25000 },
  'qa-tpms-6': { cost: 4000 },
  'qa-pkg3': { cost: 11000 },
  'qa-cruise': { cost: 3000 },
  'qa-media-controls': { cost: 8000 },
  'qa-aero': { cost: 10000 },
  'qa-lip': { cost: 7000 },
  'qa-mcover': { cost: 2000 },
  'qa-turn': { cost: 1000 },
  'qa-audio-65': { cost: 4000 },
  'qa-tweeter': { cost: 2000 },
  'qa-led': { cost: 9500 },
  'qa-star-led-head': { cost: 3200 },
  'qa-star-led-tail': { cost: 2000 },
  'qa-star-led-fog': { cost: 1440 },
  'qa-puddle-lamp': { cost: 2800 },
  'qa-interior-led-single': { cost: 400 },
  'qa-interior-led-double': { cost: 480 },
  'qa-phone-basic': { cost: 1040 },
  'qa-phone-a-pillar': { cost: 1200 },
  'qa-mirror1': { cost: 7000 },
  'qa-mirror2': { cost: 3000 },
  'qa-speaker': { cost: 2000 },
  'qa-ts': { cost: 25000 },
  'qa-brake-kit': { cost: 12000 },
  'qa-roof': { cost: 11000 },
  'qa-side': { cost: 15000 },
  'qa-urea': { cost: 3500 },
  'qa-rear': { cost: 5500 },
  'qa-skid': { cost: 9500 },
  'qa-ext': { cost: 7000 },
  'qa-film-fsk-front': { cost: 2160 },
  'qa-film-fsk-body-s': { cost: 2160 },
  'qa-film-fsk-body-l': { cost: 2477 },
  'qa-film-fsk-body-d': { cost: 3812 },
  'qa-film-smith-front': { cost: 1525 },
  'qa-film-smith-body-s': { cost: 1525 },
  'qa-film-smith-body-l': { cost: 1779 },
  'qa-film-smith-body-d': { cost: 3049 },
  'qa-film-3m-front': { cost: 1620 },
  'qa-film-3m-body-s': { cost: 1768 },
  'qa-film-3m-body-l': { cost: 1964 },
  'qa-film-3m-body-d': { cost: 3142 },
};

export const EMPTY_COST_CATALOG = {
  key: 'costCatalog',
  version: COST_CATALOG_VERSION,
  models: {},
  addons: SUPPLIER_ADDON_COSTS,
};

const money = (value) => Math.max(0, Math.round(Number(value) || 0));

export function normalizeDiscount(row, fallbackName = '專案優惠') {
  return {
    id: row?.id || '',
    name: String(row?.name || fallbackName).trim() || fallbackName,
    amount: money(row?.amount ?? Math.abs(Number(row?.price) || 0)),
  };
}

export function normalizeQuoteItems(items = []) {
  const positive = [];
  const legacyDiscounts = [];
  for (const row of Array.isArray(items) ? items : []) {
    const price = Number(row?.price) || 0;
    if (price < 0) {
      legacyDiscounts.push(normalizeDiscount(row, row?.name || '優惠折抵'));
      continue;
    }
    positive.push({
      ...row,
      price: money(price),
      kind: row?.kind || (row?.name === '車輛售價' ? 'vehicle' : 'other'),
      catalogId: row?.catalogId || null,
      discounts: (Array.isArray(row?.discounts) ? row.discounts : [])
        .map((discount) => normalizeDiscount(discount)),
    });
  }
  return { items: positive, legacyDiscounts };
}

export function calculateQuoteTotals(items = [], generalDiscounts = []) {
  let originalTotal = 0;
  let itemDiscountTotal = 0;
  const itemTotals = {};
  const overDiscountedItemIds = [];

  for (const item of items) {
    const price = money(item?.price);
    const requestedDiscount = (item?.discounts || [])
      .reduce((sum, row) => sum + money(row?.amount), 0);
    const appliedDiscount = Math.min(price, requestedDiscount);
    originalTotal += price;
    itemDiscountTotal += appliedDiscount;
    if (requestedDiscount > price) overDiscountedItemIds.push(item.id);
    itemTotals[item.id] = {
      original: price,
      requestedDiscount,
      discount: appliedDiscount,
      net: Math.max(0, price - appliedDiscount),
    };
  }

  const generalDiscountTotal = generalDiscounts
    .reduce((sum, row) => sum + money(row?.amount), 0);
  const discountTotal = itemDiscountTotal + generalDiscountTotal;
  return {
    originalTotal,
    itemDiscountTotal,
    generalDiscountTotal,
    discountTotal,
    total: Math.max(0, originalTotal - discountTotal),
    itemTotals,
    overDiscountedItemIds,
  };
}

export function normalizeCostCatalog(row) {
  const shouldSeedSupplierCosts = !row || (Number(row.version) || 0) < COST_CATALOG_VERSION;
  return {
    ...EMPTY_COST_CATALOG,
    ...(row || {}),
    version: COST_CATALOG_VERSION,
    models: { ...(row?.models || {}) },
    addons: {
      ...(shouldSeedSupplierCosts ? SUPPLIER_ADDON_COSTS : {}),
      ...(row?.addons || {}),
    },
  };
}

function ownCost(map, key) {
  if (!key || !Object.prototype.hasOwnProperty.call(map || {}, key)) return null;
  const value = Number(map[key]?.cost ?? map[key]);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

export function buildPricingRecord({ quote, costCatalog, existing = null, kind = 'quote', dealId = null }) {
  const catalog = normalizeCostCatalog(costCatalog);
  const normalized = normalizeQuoteItems(quote?.items || []);
  // 待廠商報價項目尚未形成售價或成本，不納入目前金額與安全底線判斷。
  const items = normalized.items.filter((item) => !item.pending && money(item.price) > 0);
  const generalDiscounts = [
    ...(Array.isArray(quote?.generalDiscounts) ? quote.generalDiscounts : []),
    ...normalized.legacyDiscounts,
  ].map((row) => normalizeDiscount(row));
  const totals = calculateQuoteTotals(items, generalDiscounts);
  const existingCosts = existing?.lineCosts || {};
  const lines = items.map((item) => {
    let cost = Object.prototype.hasOwnProperty.call(existingCosts, item.id)
      ? money(existingCosts[item.id])
      : null;
    if (cost == null && item.kind === 'vehicle') cost = ownCost(catalog.models, quote?.modelId || item.catalogId);
    if (cost == null && item.kind === 'addon') cost = ownCost(catalog.addons, item.catalogId);
    return {
      id: item.id,
      catalogId: item.catalogId || null,
      kind: item.kind || 'other',
      name: item.name || '',
      salePrice: money(item.price),
      netPrice: totals.itemTotals[item.id]?.net || 0,
      cost,
      costKnown: cost != null,
    };
  });
  const otherCosts = (existing?.otherCosts || []).map((row) => ({
    id: row.id,
    name: String(row.name || '其他成本'),
    amount: money(row.amount),
  }));
  const complete = lines.length > 0 && lines.every((line) => line.costKnown);
  const knownCostTotal = lines.reduce((sum, line) => sum + (line.cost ?? 0), 0)
    + otherCosts.reduce((sum, row) => sum + row.amount, 0);
  const costTotal = complete ? knownCostTotal : null;
  const profit = costTotal == null ? null : totals.total - costTotal;
  const id = kind === 'deal' ? `deal:${dealId}` : `quote:${quote?.id}`;
  return {
    id,
    kind,
    clientId: quote?.clientId || existing?.clientId || null,
    quoteId: quote?.id || existing?.quoteId || null,
    dealId: dealId || existing?.dealId || null,
    modelId: quote?.modelId || existing?.modelId || null,
    model: quote?.model || existing?.model || '',
    lines,
    lineCosts: Object.fromEntries(lines.filter((line) => line.costKnown).map((line) => [line.id, line.cost])),
    otherCosts,
    saleTotal: totals.total,
    originalTotal: totals.originalTotal,
    itemDiscountTotal: totals.itemDiscountTotal,
    generalDiscountTotal: totals.generalDiscountTotal,
    discountTotal: totals.discountTotal,
    costComplete: complete,
    costTotal,
    knownCostTotal,
    profit,
    belowCost: profit != null && profit < 0,
    capturedAt: existing?.capturedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function updatePricingCosts(record, lineCosts = {}, otherCosts = []) {
  const lines = (record?.lines || []).map((line) => {
    const has = Object.prototype.hasOwnProperty.call(lineCosts, line.id);
    const cost = has ? money(lineCosts[line.id]) : null;
    return { ...line, cost, costKnown: has };
  });
  const normalizedOther = otherCosts.map((row) => ({
    id: row.id,
    name: String(row.name || '其他成本'),
    amount: money(row.amount),
  }));
  const complete = lines.length > 0 && lines.every((line) => line.costKnown);
  const knownCostTotal = lines.reduce((sum, line) => sum + (line.cost ?? 0), 0)
    + normalizedOther.reduce((sum, row) => sum + row.amount, 0);
  const costTotal = complete ? knownCostTotal : null;
  const profit = costTotal == null ? null : money(record?.saleTotal) - costTotal;
  return {
    ...record,
    lines,
    lineCosts: Object.fromEntries(lines.filter((line) => line.costKnown).map((line) => [line.id, line.cost])),
    otherCosts: normalizedOther,
    costComplete: complete,
    knownCostTotal,
    costTotal,
    profit,
    belowCost: profit != null && profit < 0,
    updatedAt: new Date().toISOString(),
  };
}

export function pricingSafetyStatus(record) {
  // 全部都還在等廠商報價時沒有目前售價，也沒有可被壓低到成本以下的金額。
  if (Array.isArray(record?.lines) && record.lines.length === 0 && money(record.saleTotal) === 0) return 'ok';
  if (!record?.costComplete) return 'incomplete';
  if (record.belowCost) return 'belowCost';
  return 'ok';
}
