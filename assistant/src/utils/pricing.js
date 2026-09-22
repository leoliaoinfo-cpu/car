/** 報價／成本純計算工具。此檔不碰 UI 或 IndexedDB，方便單元測試。 */

const COST_CATALOG_VERSION = 4;

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

// v3 新增成本：舊版只補這個新項目，不重新塞回使用者刻意清空的其他成本。
const V3_ADDON_COSTS = {
  'qa-truck-air-deflector': { cost: 3000 },
};

const DEFAULT_ADDON_COSTS = {
  ...SUPPLIER_ADDON_COSTS,
  ...V3_ADDON_COSTS,
};

export const EMPTY_COST_CATALOG = {
  key: 'costCatalog',
  version: COST_CATALOG_VERSION,
  models: {},
  addons: DEFAULT_ADDON_COSTS,
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

export function includedQuoteItems(items = [], excludeVehiclePrice = false) {
  return items.filter((item) => !excludeVehiclePrice || item.kind !== 'vehicle');
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

export const PRICING_DISCOUNT_NAME = '業務優惠';

function isPricingDiscount(row) {
  return row?.name === PRICING_DISCOUNT_NAME || String(row?.id || '').startsWith('pricing-discount:');
}

/** 把內部試算輸入的單項優惠寫回客戶報價，保留原有其他優惠名稱與金額。 */
export function applyPricingDiscountsToQuote(quote, lineDiscounts = {}) {
  const normalized = normalizeQuoteItems(quote?.items || []);
  const items = normalized.items.map((item) => {
    if (!Object.prototype.hasOwnProperty.call(lineDiscounts, item.id)) return item;
    const otherDiscounts = (item.discounts || [])
      .filter((row) => !isPricingDiscount(row))
      .map((row) => normalizeDiscount(row))
      .filter((row) => row.amount > 0);
    const otherTotal = otherDiscounts.reduce((sum, row) => sum + row.amount, 0);
    const amount = Math.min(money(lineDiscounts[item.id]), Math.max(0, money(item.price) - otherTotal));
    const previous = (item.discounts || []).find((row) => isPricingDiscount(row));
    const pricingDiscount = amount > 0 ? [{
      id: previous?.id || `pricing-discount:${item.id}`,
      name: PRICING_DISCOUNT_NAME,
      amount,
    }] : [];
    return { ...item, discounts: [...otherDiscounts, ...pricingDiscount] };
  });
  const generalDiscounts = [
    ...(Array.isArray(quote?.generalDiscounts) ? quote.generalDiscounts : []),
    ...normalized.legacyDiscounts,
  ].map((row) => normalizeDiscount(row)).filter((row) => row.amount > 0);
  const totals = calculateQuoteTotals(items, generalDiscounts);
  return {
    ...quote,
    items,
    generalDiscounts,
    originalTotal: totals.originalTotal,
    itemDiscountTotal: totals.itemDiscountTotal,
    generalDiscountTotal: totals.generalDiscountTotal,
    discountTotal: totals.discountTotal,
    total: totals.total,
  };
}

export function normalizeCostCatalog(row) {
  const previousVersion = Number(row?.version) || 0;
  return {
    ...EMPTY_COST_CATALOG,
    ...(row || {}),
    version: COST_CATALOG_VERSION,
    models: { ...(row?.models || {}) },
    addons: {
      ...(!row ? DEFAULT_ADDON_COSTS : {}),
      ...(row && previousVersion < 2 ? SUPPLIER_ADDON_COSTS : {}),
      ...(row && previousVersion < 3 ? V3_ADDON_COSTS : {}),
      ...(row?.addons || {}),
    },
  };
}

function ownCost(map, key) {
  if (!key || !Object.prototype.hasOwnProperty.call(map || {}, key)) return null;
  const value = Number(map[key]?.cost ?? map[key]);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/** 同供應商有指定車型成本時，該車型優先於其「全部車型」成本。 */
export function applicableSupplierCosts(costCatalog, addonId, modelId) {
  const entries = costCatalog?.addons?.[addonId]?.supplierCosts;
  if (!Array.isArray(entries)) return [];
  const valid = entries.filter((row) => {
    const cost = Number(row?.cost);
    return row?.id && String(row.supplier || '').trim()
      && row.cost !== '' && row.cost != null && Number.isFinite(cost) && cost >= 0;
  });
  const exactSuppliers = new Set(valid.filter((row) => modelId && row.modelId === modelId)
    .map((row) => String(row.supplier).trim().toLowerCase()));
  return valid.filter((row) => row.modelId === modelId
    || (!row.modelId && !exactSuppliers.has(String(row.supplier).trim().toLowerCase())))
    .map((row) => ({ ...row, supplier: String(row.supplier).trim(), cost: money(row.cost) }));
}

/** 未指定供應商先採適用成本最高者；有供應商資料卻沒有適用車型時視為缺成本。 */
export function resolveAddonCost(costCatalog, addonId, modelId, supplierId = null) {
  const entry = costCatalog?.addons?.[addonId];
  if (Array.isArray(entry?.supplierCosts) && entry.supplierCosts.length > 0) {
    const options = applicableSupplierCosts(costCatalog, addonId, modelId);
    const selected = options.find((row) => row.id === supplierId);
    const conservative = options.reduce((highest, row) => (!highest || row.cost > highest.cost ? row : highest), null);
    const chosen = selected || conservative;
    return {
      cost: chosen?.cost ?? null,
      supplierId: selected?.id || null,
      supplierName: selected?.supplier || null,
      source: selected ? 'supplier' : 'supplier-max',
      options,
    };
  }
  return { cost: ownCost(costCatalog?.addons, addonId), supplierId: null, supplierName: null, source: 'catalog', options: [] };
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
  const existingSources = existing?.lineCostSources || {};
  // 舊紀錄可能沒有 modelId；此時沿用舊手填成本，避免升級時覆蓋既有資料。
  const sameModel = !existing?.modelId || existing.modelId === (quote?.modelId || null);
  const lines = items.map((item) => {
    const previousLine = existing?.lines?.find((line) => line.id === item.id);
    const sameItem = !previousLine || (previousLine.catalogId === (item.catalogId || null)
      && previousLine.kind === (item.kind || 'other'));
    const hasExistingCost = sameModel && sameItem
      && Object.prototype.hasOwnProperty.call(existingCosts, item.id);
    const preservedManual = hasExistingCost
      && (!existingSources[item.id] || existingSources[item.id] === 'manual');
    let cost = preservedManual ? money(existingCosts[item.id]) : null;
    let costSource = preservedManual ? 'manual' : null;
    let supplierId = null;
    let supplierName = null;
    if (!preservedManual && item.kind === 'vehicle') {
      cost = ownCost(catalog.models, quote?.modelId || item.catalogId);
      costSource = 'catalog';
    }
    if (!preservedManual && item.kind === 'addon') {
      const resolved = resolveAddonCost(catalog, item.catalogId, quote?.modelId,
        sameModel && sameItem ? existing?.supplierSelections?.[item.id] : null);
      cost = resolved.cost;
      costSource = resolved.source;
      supplierId = resolved.supplierId;
      supplierName = resolved.supplierName;
    }
    const discounts = (item.discounts || []).map((row) => normalizeDiscount(row));
    const pricingDiscountRequested = discounts
      .filter((row) => isPricingDiscount(row))
      .reduce((sum, row) => sum + row.amount, 0);
    const totalDiscount = totals.itemTotals[item.id]?.discount || 0;
    const pricingDiscount = Math.min(pricingDiscountRequested, totalDiscount);
    return {
      id: item.id,
      catalogId: item.catalogId || null,
      kind: item.kind || 'other',
      name: item.name || '',
      salePrice: money(item.price),
      netPrice: totals.itemTotals[item.id]?.net || 0,
      discounts,
      baseDiscountTotal: Math.max(0, totalDiscount - pricingDiscount),
      pricingDiscount,
      cost,
      costKnown: cost != null,
      costSource,
      supplierId,
      supplierName,
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
    lineCostSources: Object.fromEntries(lines.filter((line) => line.costKnown).map((line) => [line.id, line.costSource])),
    supplierSelections: Object.fromEntries(lines.filter((line) => line.supplierId).map((line) => [line.id, line.supplierId])),
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

export function updatePricingCosts(record, lineCosts = {}, otherCosts = [], lineDiscounts = null) {
  const lines = (record?.lines || []).map((line) => {
    const has = Object.prototype.hasOwnProperty.call(lineCosts, line.id);
    const cost = has ? money(lineCosts[line.id]) : null;
    const baseDiscountTotal = money(line.baseDiscountTotal
      ?? Math.max(0, money(line.salePrice) - money(line.netPrice) - money(line.pricingDiscount)));
    const hasPricingDiscount = lineDiscounts != null
      && Object.prototype.hasOwnProperty.call(lineDiscounts, line.id);
    const pricingDiscount = Math.min(
      hasPricingDiscount ? money(lineDiscounts[line.id]) : money(line.pricingDiscount),
      Math.max(0, money(line.salePrice) - baseDiscountTotal),
    );
    return {
      ...line,
      baseDiscountTotal,
      pricingDiscount,
      netPrice: Math.max(0, money(line.salePrice) - baseDiscountTotal - pricingDiscount),
      cost,
      costKnown: has,
      costSource: has ? (record?.lineCostSources?.[line.id] || line.costSource || 'manual') : null,
      supplierId: record?.supplierSelections?.[line.id] || null,
      supplierName: record?.supplierSelections?.[line.id] ? line.supplierName : null,
    };
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
  const calculatedOriginalTotal = lines.reduce((sum, line) => sum + money(line.salePrice), 0);
  const calculatedItemDiscountTotal = lines.reduce((sum, line) => sum + Math.max(0, money(line.salePrice) - money(line.netPrice)), 0);
  const editingQuoteDiscounts = lineDiscounts != null;
  const originalTotal = editingQuoteDiscounts ? calculatedOriginalTotal : money(record?.originalTotal ?? calculatedOriginalTotal);
  const itemDiscountTotal = editingQuoteDiscounts ? calculatedItemDiscountTotal : money(record?.itemDiscountTotal);
  const generalDiscountTotal = money(record?.generalDiscountTotal);
  const discountTotal = itemDiscountTotal + generalDiscountTotal;
  const saleTotal = editingQuoteDiscounts
    ? Math.max(0, originalTotal - discountTotal)
    : money(record?.saleTotal);
  const profit = costTotal == null ? null : saleTotal - costTotal;
  return {
    ...record,
    lines,
    lineCosts: Object.fromEntries(lines.filter((line) => line.costKnown).map((line) => [line.id, line.cost])),
    lineCostSources: Object.fromEntries(lines.filter((line) => line.costKnown).map((line) => [line.id, line.costSource])),
    supplierSelections: Object.fromEntries(lines.filter((line) => line.supplierId).map((line) => [line.id, line.supplierId])),
    otherCosts: normalizedOther,
    originalTotal,
    itemDiscountTotal,
    discountTotal,
    saleTotal,
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
