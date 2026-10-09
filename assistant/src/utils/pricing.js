/** 報價／成本純計算工具。此檔不碰 UI 或 IndexedDB，方便單元測試。 */
import { VEHICLE_VARIANTS } from './vehicles.js';

const COST_CATALOG_VERSION = 8;

// 來源：使用者提供的「2026 卡旺配件清單」與「商用車隔熱紙速查表 2025/11」。
// 隔熱紙表的「業務價（含稅）」依使用者指示視為成本；成本只供內部區域使用。
const SUPPLIER_ADDON_COSTS = {
  'qa-pkg2': { cost: 29000 },
  'qa-android-surround': { cost: 25000 },
  'qa-android-console-box': { cost: 500 },
  'qa-tpms-6': { cost: 4000 },
  'qa-pkg3': { cost: 11000 },
  'qa-cruise': { cost: 3000 },
  'qa-media-controls': { cost: 8000 },
  'qa-aero': { cost: 10000 },
  'qa-lip': { cost: 7500 },
  'qa-mcover': { cost: 2000 },
  'qa-audio-65': { cost: 4000 },
  'qa-tweeter': { cost: 2000 },
  'qa-tlsound': { cost: 7500 },
  'qa-led': { cost: 9500 },
  'qa-star-led-head': { cost: 3000 },
  'qa-star-led-tail': { cost: 2000 },
  'qa-star-led-fog': { cost: 1400 },
  'qa-puddle-lamp': { cost: 2800 },
  'qa-phone-basic': { cost: 1040 },
  'qa-phone-a-pillar': { cost: 1200 },
  'qa-phone': { cost: 2300 },
  'qa-mirror1': { cost: 7000 },
  'qa-mirror2': { cost: 4000 },
  'qa-speaker': { cost: 2000 },
  'qa-ts': { cost: 25300 },
  'qa-block': { cost: 6800 },
  'qa-atc': { cost: 17000 },
  'qa-leaf': { cost: 14500 },
  'qa-brake-kit': { cost: 12000 },
  'qa-roof': { cost: 13500 },
  'qa-side': { cost: 15900 },
  'qa-urea': { cost: 4500 },
  'qa-rear': { cost: 6000 },
  'qa-rear-dr': { cost: 10800 },
  'qa-skid': { cost: 9500 },
  'qa-ext': { cost: 7000 },
  'qa-omega': { cost: 29800 },
  'qa-fog': { cost: 4300 },
  'qa-tail': { cost: 9300 },
  'qa-gtr': { cost: 25900 },
  'qa-paint1': { cost: 33000 },
  'qa-paint2': { cost: 34000 },
  'qa-paint3': { cost: 36000 },
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

const V5_ADDON_COSTS = {
  'qa-pkg1': { cost: 11000 },
  'qa-h-rack-single': { cost: 4000 },
  'qa-h-rack-pair': { cost: 7000 },
};

const V6_ADDON_COSTS = {
  'qa-tailgate-35': { cost: 35000 },
  'qa-tailgate-step': { cost: 1000 },
  'qa-tailgate-remote': { cost: 2000 },
};

// 2027 雙廂高階套裝由使用者確認的整套成本；Travel 橫桿沒有獎金資料，維持待補成本。
const V8_ADDON_COSTS = {
  'qa-double-cab-package': { cost: 203500 },
};

// 最新「2026 卡旺配件清單」成本＝建議售價－獎金。
// from 為舊內建成本；只有仍等於舊值才更新，避免覆蓋業務手動調整。
// to: null 表示清單的獎金為「＊」，無法可靠反推成本，應改回待補成本。
const V7_COST_REVISIONS = {
  'qa-lip': { from: 7000, to: 7500 },
  'qa-turn': { from: 1000, to: null },
  'qa-android-console-box': { to: 500, addIfMissing: true },
  'qa-tlsound': { to: 7500, addIfMissing: true },
  'qa-star-led-head': { from: 3200, to: 3000 },
  'qa-star-led-fog': { from: 1440, to: 1400 },
  'qa-interior-led-single': { from: 400, to: null },
  'qa-interior-led-double': { from: 480, to: null },
  'qa-phone': { to: 2300, addIfMissing: true },
  'qa-mirror2': { from: 3000, to: 4000 },
  'qa-ts': { from: 25000, to: 25300 },
  'qa-block': { to: 6800, addIfMissing: true },
  'qa-atc': { to: 17000, addIfMissing: true },
  'qa-leaf': { to: 14500, addIfMissing: true },
  'qa-roof': { from: 11000, to: 13500 },
  'qa-side': { from: 15000, to: 15900 },
  'qa-urea': { from: 3500, to: 4500 },
  'qa-rear': { from: 5500, to: 6000 },
  'qa-rear-dr': { to: 10800, addIfMissing: true },
  'qa-omega': { to: 29800, addIfMissing: true },
  'qa-fog': { to: 4300, addIfMissing: true },
  'qa-tail': { to: 9300, addIfMissing: true },
  'qa-gtr': { to: 25900, addIfMissing: true },
  'qa-paint1': { to: 33000, addIfMissing: true },
  'qa-paint2': { to: 34000, addIfMissing: true },
  'qa-paint3': { to: 36000, addIfMissing: true },
};

const DEFAULT_ADDON_COSTS = {
  ...SUPPLIER_ADDON_COSTS,
  ...V3_ADDON_COSTS,
  ...V5_ADDON_COSTS,
  ...V6_ADDON_COSTS,
  ...V8_ADDON_COSTS,
};

function migrateV7Costs(addons) {
  const next = { ...(addons || {}) };
  for (const [id, revision] of Object.entries(V7_COST_REVISIONS)) {
    const hasValue = Object.prototype.hasOwnProperty.call(next, id);
    if (!hasValue) {
      if (revision.addIfMissing && revision.to != null) next[id] = { cost: revision.to };
      continue;
    }
    const currentEntry = next[id];
    const currentCost = Number(currentEntry?.cost ?? currentEntry);
    if (!Number.isFinite(currentCost) || currentCost !== revision.from) continue;
    if (revision.to == null) {
      delete next[id];
    } else {
      next[id] = typeof currentEntry === 'object' && currentEntry != null
        ? { ...currentEntry, cost: revision.to }
        : { cost: revision.to };
    }
  }
  return next;
}

// 車輛不以「售價－成本」估利潤，而是直接使用公司公告的每台傭金。
const DEFAULT_MODEL_COMMISSIONS = Object.fromEntries(VEHICLE_VARIANTS.map((variant) => [
  variant.id,
  { commission: variant.commissionTwd },
]));

export const EMPTY_COST_CATALOG = {
  key: 'costCatalog',
  version: COST_CATALOG_VERSION,
  models: DEFAULT_MODEL_COMMISSIONS,
  addons: DEFAULT_ADDON_COSTS,
};

const money = (value) => Math.max(0, Math.round(Number(value) || 0));

export function normalizeDiscount(row, fallbackName = '專案優惠') {
  const normalizedName = String(row?.name || fallbackName).trim() || fallbackName;
  return {
    id: row?.id || '',
    name: normalizedName === '業務優惠' ? '優惠' : normalizedName,
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
    const requestedDiscount = item?.gift ? price : (item?.discounts || [])
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

export const PRICING_DISCOUNT_NAME = '優惠';

function isPricingDiscount(row) {
  return row?.name === PRICING_DISCOUNT_NAME || row?.name === '業務優惠'
    || String(row?.id || '').startsWith('pricing-discount:');
}

/**
 * 把中央利潤試算的單項優惠寫回客戶報價。
 * 每個品項只保留一筆中央優惠，避免前台與後台各自折扣後被重複加總。
 */
export function applyPricingDiscountsToQuote(quote, lineDiscounts = {}, lineGifts = {}) {
  const normalized = normalizeQuoteItems(quote?.items || []);
  const items = normalized.items.map((item) => {
    if (!Object.prototype.hasOwnProperty.call(lineDiscounts, item.id)) return item;
    const amount = Math.min(money(lineDiscounts[item.id]), money(item.price));
    const previous = (item.discounts || []).find((row) => isPricingDiscount(row));
    const pricingDiscount = amount > 0 ? [{
      id: previous?.id || `pricing-discount:${item.id}`,
      name: PRICING_DISCOUNT_NAME,
      amount,
    }] : [];
    const hasGiftControl = Object.prototype.hasOwnProperty.call(lineGifts, item.id);
    const requestedGift = hasGiftControl ? !!lineGifts[item.id] : !!item.gift;
    return {
      ...item,
      // 後台將贈送折扣改成非全額時，即視為取消贈送，避免標示與金額不一致。
      gift: requestedGift && amount >= money(item.price),
      discounts: pricingDiscount,
    };
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

/**
 * 後台 pricing record 是單項優惠的主資料；沒有舊紀錄的品項才採用報價上既有優惠總額。
 * 這也會把舊版多筆單項優惠安全合併為同一筆中央優惠。
 */
export function synchronizeQuoteDiscounts(quote, pricingRecord = null) {
  if (!quote) return quote;
  const recordLines = new Map((pricingRecord?.lines || []).map((line) => [line.id, line]));
  const lineDiscounts = Object.fromEntries(normalizeQuoteItems(quote.items || []).items.map((item) => {
    const central = recordLines.get(item.id);
    const amount = central
      ? Math.max(0, money(central.salePrice) - money(central.netPrice))
      : item.gift ? money(item.price) : (item.discounts || []).reduce((sum, row) => sum + money(row?.amount), 0);
    return [item.id, Math.min(money(item.price), amount)];
  }));
  return applyPricingDiscountsToQuote(quote, lineDiscounts);
}

export function normalizeCostCatalog(row) {
  const previousVersion = Number(row?.version) || 0;
  const savedModels = row?.models || {};
  const models = { ...DEFAULT_MODEL_COMMISSIONS };
  for (const [id, entry] of Object.entries(savedModels)) {
    const normalized = typeof entry === 'object' && entry != null ? { ...entry } : {};
    if (normalized.commission == null && DEFAULT_MODEL_COMMISSIONS[id]) {
      normalized.commission = DEFAULT_MODEL_COMMISSIONS[id].commission;
    }
    models[id] = normalized;
  }
  const versionedAddons = {
    ...(!row ? DEFAULT_ADDON_COSTS : {}),
    ...(row && previousVersion < 2 ? SUPPLIER_ADDON_COSTS : {}),
    ...(row && previousVersion < 3 ? V3_ADDON_COSTS : {}),
    ...(row && previousVersion < 5 ? V5_ADDON_COSTS : {}),
    ...(row && previousVersion < 6 ? V6_ADDON_COSTS : {}),
    ...(row && previousVersion < 8 ? V8_ADDON_COSTS : {}),
    ...(row?.addons || {}),
  };
  return {
    ...EMPTY_COST_CATALOG,
    ...(row || {}),
    version: COST_CATALOG_VERSION,
    models,
    addons: row && previousVersion < 7 ? migrateV7Costs(versionedAddons) : versionedAddons,
  };
}

function ownCost(map, key) {
  if (!key || !Object.prototype.hasOwnProperty.call(map || {}, key)) return null;
  const value = Number(map[key]?.cost ?? map[key]);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function ownCommission(map, key) {
  if (!key || !Object.prototype.hasOwnProperty.call(map || {}, key)) return null;
  const value = Number(map[key]?.commission);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function calculatePricingSnapshot(lines, otherCosts, generalDiscountTotal, saleTotal = null) {
  const complete = lines.length > 0 && lines.every((line) => line.costKnown);
  const knownCostTotal = lines.reduce((sum, line) => (
    line.kind === 'vehicle' ? sum : sum + (line.cost ?? 0)
  ), 0) + otherCosts.reduce((sum, row) => sum + row.amount, 0);
  const commissionTotal = lines.reduce((sum, line) => (
    line.kind === 'vehicle' && line.costKnown ? sum + (line.cost ?? 0) : sum
  ), 0);
  const calculatedSaleTotal = Math.max(0,
    lines.reduce((sum, line) => sum + money(line.netPrice), 0) - money(generalDiscountTotal));
  const resolvedSaleTotal = saleTotal == null ? calculatedSaleTotal : money(saleTotal);
  const knownProfit = lines.reduce((sum, line) => {
    if (!line.costKnown) return sum;
    if (line.kind === 'vehicle') {
      const lineDiscount = Math.max(0, money(line.salePrice) - money(line.netPrice));
      return sum + money(line.cost) - lineDiscount;
    }
    return sum + money(line.netPrice) - money(line.cost);
  }, 0) - money(generalDiscountTotal) - otherCosts.reduce((sum, row) => sum + row.amount, 0);
  // 成交金額若後續被手動修改，差額同樣會直接增減整台利潤。
  const saleAdjustment = resolvedSaleTotal - calculatedSaleTotal;
  return {
    complete,
    knownCostTotal,
    costTotal: complete ? knownCostTotal : null,
    commissionTotal,
    saleTotal: resolvedSaleTotal,
    profit: complete ? knownProfit + saleAdjustment : null,
  };
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
  const items = normalized.items.filter((item) => !item.pending && (money(item.price) > 0 || item.gift));
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
    const preservedManual = item.kind !== 'vehicle' && hasExistingCost
      && (!existingSources[item.id] || existingSources[item.id] === 'manual');
    const preservedCommission = item.kind === 'vehicle' && hasExistingCost
      && String(existingSources[item.id] || '').startsWith('commission');
    let cost = preservedManual ? money(existingCosts[item.id]) : null;
    let costSource = preservedManual ? 'manual' : null;
    let supplierId = null;
    let supplierName = null;
    if (item.kind === 'vehicle') {
      cost = preservedCommission
        ? money(existingCosts[item.id])
        : ownCommission(catalog.models, quote?.modelId || item.catalogId);
      costSource = preservedCommission ? existingSources[item.id] : 'commission-catalog';
    }
    if (!preservedManual && item.kind === 'addon') {
      const componentIds = item.bundlePricingMode === 'components' && Array.isArray(item.bundleIncludedIds)
        ? item.bundleIncludedIds.filter(Boolean)
        : [];
      if (componentIds.length > 0) {
        const componentCosts = componentIds.map((addonId) => resolveAddonCost(catalog, addonId, quote?.modelId));
        cost = componentCosts.every((resolved) => resolved.cost != null)
          ? componentCosts.reduce((sum, resolved) => sum + resolved.cost, 0)
          : null;
        costSource = 'bundle-components';
      } else {
        const resolved = resolveAddonCost(catalog, item.catalogId, quote?.modelId,
          sameModel && sameItem ? existing?.supplierSelections?.[item.id] : null);
        cost = resolved.cost;
        costSource = resolved.source;
        supplierId = resolved.supplierId;
        supplierName = resolved.supplierName;
      }
    }
    const discounts = (item.discounts || []).map((row) => normalizeDiscount(row));
    const totalDiscount = totals.itemTotals[item.id]?.discount || 0;
    // 所有單項優惠都併入中央優惠；前台與後台不再各自保留一套折扣。
    const pricingDiscount = totalDiscount;
    return {
      id: item.id,
      catalogId: item.catalogId || null,
      kind: item.kind || 'other',
      name: item.name || '',
      salePrice: money(item.price),
      netPrice: totals.itemTotals[item.id]?.net || 0,
      discounts,
      baseDiscountTotal: 0,
      pricingDiscount,
      cost,
      costKnown: cost != null,
      costSource,
      valueType: item.kind === 'vehicle' ? 'commission' : 'cost',
      supplierId,
      supplierName,
    };
  });
  const otherCosts = (existing?.otherCosts || []).map((row) => ({
    id: row.id,
    name: String(row.name || '其他成本'),
    amount: money(row.amount),
  }));
  const snapshot = calculatePricingSnapshot(lines, otherCosts, totals.generalDiscountTotal, totals.total);
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
    saleTotal: snapshot.saleTotal,
    originalTotal: totals.originalTotal,
    itemDiscountTotal: totals.itemDiscountTotal,
    generalDiscountTotal: totals.generalDiscountTotal,
    discountTotal: totals.discountTotal,
    costComplete: snapshot.complete,
    costTotal: snapshot.costTotal,
    knownCostTotal: snapshot.knownCostTotal,
    commissionTotal: snapshot.commissionTotal,
    profit: snapshot.profit,
    belowCost: snapshot.profit != null && snapshot.profit < 0,
    capturedAt: existing?.capturedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function updatePricingCosts(record, lineCosts = {}, otherCosts = [], lineDiscounts = null) {
  const lines = (record?.lines || []).map((line) => {
    const has = Object.prototype.hasOwnProperty.call(lineCosts, line.id);
    const cost = has ? money(lineCosts[line.id]) : null;
    const hasPricingDiscount = lineDiscounts != null
      && Object.prototype.hasOwnProperty.call(lineDiscounts, line.id);
    const baseDiscountTotal = lineDiscounts != null ? 0 : money(line.baseDiscountTotal
      ?? Math.max(0, money(line.salePrice) - money(line.netPrice) - money(line.pricingDiscount)));
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
  const snapshot = calculatePricingSnapshot(lines, normalizedOther, generalDiscountTotal, saleTotal);
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
    costComplete: snapshot.complete,
    knownCostTotal: snapshot.knownCostTotal,
    costTotal: snapshot.costTotal,
    commissionTotal: snapshot.commissionTotal,
    profit: snapshot.profit,
    belowCost: snapshot.profit != null && snapshot.profit < 0,
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
