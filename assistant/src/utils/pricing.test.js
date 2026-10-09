import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPricingDiscountsToQuote, buildPricingRecord, calculateQuoteTotals, normalizeQuoteItems,
  applicableSupplierCosts, includedQuoteItems, normalizeCostCatalog, pricingSafetyStatus, resolveAddonCost,
  synchronizeQuoteDiscounts, updatePricingCosts,
} from './pricing.js';
import { bundledAddonIds, canonicalAddonCategories, DEFAULT_QUOTE_PRESETS, formatChineseTwd, QUOTE_ADDON_SECTIONS, removeBundledQuoteItems, renameAddonCategory, resolveLoanTerms, resolveQuotePresets } from './crm.js';

test('formats quotation totals as formal Traditional Chinese currency', () => {
  assert.equal(formatChineseTwd(0), '新臺幣零元整');
  assert.equal(formatChineseTwd(902000), '新臺幣玖拾萬貳仟元整');
  assert.equal(formatChineseTwd(1000100), '新臺幣壹佰萬零壹佰元整');
  assert.equal(formatChineseTwd(100000001), '新臺幣壹億零壹元整');
});

test('calculates item and whole-quote discounts', () => {
  const items = [
    { id: 'vehicle', price: 800000, discounts: [{ id: 'd1', amount: 20000 }] },
    { id: 'addon', price: 30000, discounts: [{ id: 'd2', amount: 3000 }, { id: 'd3', amount: 2000 }] },
  ];
  const result = calculateQuoteTotals(items, [{ id: 'g1', amount: 10000 }]);
  assert.equal(result.originalTotal, 830000);
  assert.equal(result.itemDiscountTotal, 25000);
  assert.equal(result.generalDiscountTotal, 10000);
  assert.equal(result.total, 795000);
  assert.equal(result.itemTotals.addon.net, 25000);
});

test('treats a gift as a full line discount while retaining its cost internally', () => {
  const totals = calculateQuoteTotals([
    { id: 'gift', kind: 'addon', price: 3000, gift: true, discounts: [] },
  ]);
  assert.equal(totals.originalTotal, 3000);
  assert.equal(totals.itemDiscountTotal, 3000);
  assert.equal(totals.itemTotals.gift.net, 0);
  assert.equal(totals.total, 0);

  const record = buildPricingRecord({
    quote: {
      id: 'q-gift', items: [{ id: 'gift', kind: 'addon', catalogId: 'gift-addon', name: '贈品', price: 0, gift: true }],
    },
    costCatalog: { models: {}, addons: { 'gift-addon': { cost: 1200 } } },
  });
  assert.equal(record.lines.length, 1);
  assert.equal(record.lines[0].netPrice, 0);
  assert.equal(record.profit, -1200);
});

test('excludes vehicle sale from an accessory-only quote without losing its model or accessory costs', () => {
  const items = [
    { id: 'v', kind: 'vehicle', catalogId: 'm1', name: '車輛售價', price: 800000 },
    { id: 'a', kind: 'addon', catalogId: 'a1', name: '升降尾門', price: 40000 },
  ];
  const accessoryOnly = includedQuoteItems(items, true);
  assert.deepEqual(accessoryOnly.map((item) => item.id), ['a']);
  assert.equal(calculateQuoteTotals(accessoryOnly).total, 40000);
  const record = buildPricingRecord({
    quote: { id: 'q-accessory', modelId: 'm1', excludeVehiclePrice: true, items: accessoryOnly },
    costCatalog: { models: { m1: { cost: 700000 } }, addons: { a1: { cost: 30000 } } },
  });
  assert.equal(record.costTotal, 30000);
  assert.equal(record.profit, 10000);
  assert.deepEqual(includedQuoteItems(items, false), items);
});

test('caps a line discount so its net price cannot become negative', () => {
  const result = calculateQuoteTotals([
    { id: 'addon', price: 10000, discounts: [{ amount: 12000 }] },
  ]);
  assert.deepEqual(result.overDiscountedItemIds, ['addon']);
  assert.equal(result.itemTotals.addon.net, 0);
  assert.equal(result.total, 0);
});

test('moves legacy negative rows to whole-quote discounts', () => {
  const result = normalizeQuoteItems([
    { id: 'v', name: '車輛售價', price: 800000 },
    { id: 'old', name: '汰舊換新', price: -50000 },
  ]);
  assert.equal(result.items.length, 1);
  assert.equal(result.legacyDiscounts[0].amount, 50000);
});

test('uses vehicle commission plus accessory margin and detects an over-discounted quote', () => {
  const record = buildPricingRecord({
    quote: {
      id: 'q1', modelId: 'm1', model: '卡旺',
      items: [
        { id: 'v', kind: 'vehicle', catalogId: 'm1', price: 800000 },
        { id: 'a', kind: 'addon', catalogId: 'a1', price: 20000 },
      ],
      generalDiscounts: [{ amount: 50000 }],
    },
    costCatalog: { models: { m1: { commission: 40000 } }, addons: { a1: { cost: 15000 } } },
  });
  assert.equal(record.costComplete, true);
  assert.equal(record.costTotal, 15000);
  assert.equal(record.commissionTotal, 40000);
  assert.equal(record.saleTotal, 770000);
  assert.equal(record.profit, -5000);
  assert.equal(record.belowCost, true);
});

test('keeps profit unknown until every line has a cost', () => {
  const record = buildPricingRecord({
    quote: {
      id: 'q2', modelId: 'm1',
      items: [
        { id: 'v', kind: 'vehicle', catalogId: 'm1', price: 800000 },
        { id: 'manual', kind: 'other', price: 10000 },
      ],
    },
    costCatalog: { models: { m1: { commission: 100000 } }, addons: {} },
  });
  assert.equal(record.costComplete, false);
  assert.equal(record.knownCostTotal, 0);
  assert.equal(record.commissionTotal, 100000);
  assert.equal(record.costTotal, null);
  assert.equal(record.profit, null);

  const completed = updatePricingCosts(record, { v: 100000, manual: 5000 });
  assert.equal(completed.costComplete, true);
  assert.equal(completed.costTotal, 5000);
  assert.equal(completed.profit, 105000);
});

test('ignores legacy vehicle cost snapshots and refreshes the current commission', () => {
  const record = buildPricingRecord({
    quote: {
      id: 'q-refresh', modelId: 'm1', model: '卡旺',
      items: [
        { id: 'v', kind: 'vehicle', catalogId: 'm1', price: 800000 },
        { id: 'a', kind: 'addon', catalogId: 'a1', price: 20000 },
      ],
    },
    costCatalog: { models: { m1: { commission: 50000 } }, addons: { a1: { cost: 15000 } } },
    existing: { lineCosts: { v: 755000 }, otherCosts: [] },
  });
  assert.equal(record.lines.find((line) => line.id === 'v').cost, 50000);
  assert.equal(record.lines.find((line) => line.id === 'v').costSource, 'commission-catalog');
  assert.equal(record.lines.find((line) => line.id === 'a').cost, 15000);
  assert.equal(record.costTotal, 15000);
  assert.equal(record.profit, 55000);
});

test('selects costs by supplier and vehicle, using the highest applicable cost until a supplier is chosen', () => {
  const catalog = normalizeCostCatalog({
    version: 4, models: {}, addons: {
      tailgate: { cost: 10000, supplierCosts: [
        { id: 'a-all', supplier: '甲廠', modelId: '', cost: 22000 },
        { id: 'a-m1', supplier: '甲廠', modelId: 'm1', cost: 26000 },
        { id: 'b-all', supplier: '乙廠', modelId: '', cost: 24000 },
        { id: 'c-m2', supplier: '丙廠', modelId: 'm2', cost: 32000 },
      ] },
    },
  });
  assert.deepEqual(applicableSupplierCosts(catalog, 'tailgate', 'm1').map((row) => row.id), ['a-m1', 'b-all']);
  assert.equal(resolveAddonCost(catalog, 'tailgate', 'm1').cost, 26000);
  assert.equal(resolveAddonCost(catalog, 'tailgate', 'm1', 'b-all').cost, 24000);
  assert.equal(resolveAddonCost(catalog, 'tailgate', 'm2').cost, 32000);
  assert.equal(resolveAddonCost(catalog, 'tailgate', null).cost, 24000);
});

test('requires a matching vehicle cost rather than silently falling back to an old base cost', () => {
  const catalog = normalizeCostCatalog({ version: 4, models: {}, addons: {
    tarp: { cost: 10000, supplierCosts: [{ id: 'a-m1', supplier: '甲廠', modelId: 'm1', cost: 18000 }] },
  } });
  const quote = { id: 'q-supplier', modelId: 'm2', items: [{ id: 'a', kind: 'addon', catalogId: 'tarp', price: 25000 }] };
  const record = buildPricingRecord({ quote, costCatalog: catalog });
  assert.equal(record.lines[0].cost, null);
  assert.equal(pricingSafetyStatus(record), 'incomplete');
});

test('keeps a chosen supplier and refreshes its cost, while preserving manual cost edits', () => {
  const quote = { id: 'q-supplier-edit', modelId: 'm1', items: [{ id: 'a', kind: 'addon', catalogId: 'tarp', price: 30000 }] };
  const catalog = { version: 4, models: {}, addons: { tarp: { supplierCosts: [
    { id: 'a1', supplier: '甲廠', modelId: 'm1', cost: 18000 },
    { id: 'b1', supplier: '乙廠', modelId: 'm1', cost: 21000 },
  ] } } };
  const initial = buildPricingRecord({ quote, costCatalog: catalog });
  assert.equal(initial.lines[0].cost, 21000);
  assert.equal(initial.lines[0].costSource, 'supplier-max');
  const chosen = updatePricingCosts({ ...initial, supplierSelections: { a: 'a1' }, lineCostSources: { a: 'supplier' } }, { a: 18000 }, []);
  const refreshed = buildPricingRecord({ quote, costCatalog: { ...catalog, addons: { tarp: { supplierCosts: [
    { id: 'a1', supplier: '甲廠', modelId: 'm1', cost: 19000 },
  ] } } }, existing: chosen });
  assert.equal(refreshed.lines[0].cost, 19000);
  assert.equal(refreshed.supplierSelections.a, 'a1');
  const manual = buildPricingRecord({ quote, costCatalog: catalog, existing: {
    ...chosen, lineCosts: { a: 17000 }, lineCostSources: { a: 'manual' }, supplierSelections: {},
  } });
  assert.equal(manual.lines[0].cost, 17000);
});

test('consolidates old front discounts into the single central discount', () => {
  const quote = {
    id: 'q-discount',
    items: [{
      id: 'a', kind: 'addon', catalogId: 'a1', name: '配件', price: 20000,
      discounts: [{ id: 'campaign', name: '活動優惠', amount: 2000 }],
    }],
    generalDiscounts: [],
  };
  const record = buildPricingRecord({ quote, costCatalog: { models: {}, addons: { a1: { cost: 10000 } } } });
  const preview = updatePricingCosts(record, { a: 10000 }, [], { a: 5000 });
  assert.equal(record.lines[0].pricingDiscount, 2000);
  assert.equal(record.lines[0].baseDiscountTotal, 0);
  assert.equal(preview.itemDiscountTotal, 5000);
  assert.equal(preview.saleTotal, 15000);
  assert.equal(preview.profit, 5000);

  const updatedQuote = applyPricingDiscountsToQuote(quote, { a: 5000 });
  assert.equal(updatedQuote.items[0].discounts.length, 1);
  assert.equal(updatedQuote.items[0].discounts[0].name, '優惠');
  assert.equal(updatedQuote.items[0].discounts[0].amount, 5000);
  assert.equal(updatedQuote.total, 15000);
});

test('backend gift approval is the only source that can add or remove a gift', () => {
  const quote = { id: 'q-gift-control', items: [{ id: 'a', kind: 'addon', name: '配件', price: 3000, gift: false }], generalDiscounts: [] };
  const gifted = applyPricingDiscountsToQuote(quote, { a: 3000 }, { a: true });
  assert.equal(gifted.items[0].gift, true);
  assert.equal(gifted.total, 0);
  const restored = applyPricingDiscountsToQuote(gifted, { a: 0 }, { a: false });
  assert.equal(restored.items[0].gift, false);
  assert.equal(restored.total, 3000);
});

test('renames a legacy business discount to the customer-facing discount label', () => {
  const quote = {
    id: 'q-legacy-discount-name',
    items: [{
      id: 'a', kind: 'addon', catalogId: 'a1', name: '配件', price: 20000,
      discounts: [{ id: 'pricing-discount:a', name: '業務優惠', amount: 500 }],
    }],
    generalDiscounts: [],
  };
  const updatedQuote = applyPricingDiscountsToQuote(quote, { a: 500 });
  assert.equal(updatedQuote.items[0].discounts.length, 1);
  assert.equal(updatedQuote.items[0].discounts[0].name, '優惠');
  assert.equal(updatedQuote.items[0].discounts[0].amount, 500);
});

test('uses the backend pricing record as the central discount source', () => {
  const quote = {
    id: 'q-central-discount',
    items: [{
      id: 'a', kind: 'addon', name: '配件', price: 20000,
      discounts: [{ id: 'front-only', name: '前台優惠', amount: 1500 }],
    }],
    generalDiscounts: [],
  };
  const synced = synchronizeQuoteDiscounts(quote, {
    lines: [{ id: 'a', salePrice: 20000, netPrice: 16500 }],
  });
  assert.deepEqual(synced.items[0].discounts, [{
    id: 'pricing-discount:a', name: '優惠', amount: 3500,
  }]);
  assert.equal(synced.itemDiscountTotal, 3500);
  assert.equal(synced.total, 16500);
});

test('does not carry a reused line id cost or supplier to a different accessory', () => {
  const catalog = { version: 4, models: {}, addons: {
    tarp: { supplierCosts: [{ id: 't1', supplier: '甲', modelId: 'm1', cost: 18000 }] },
    tailgate: { supplierCosts: [{ id: 'g1', supplier: '乙', modelId: 'm1', cost: 32000 }] },
  } };
  const original = buildPricingRecord({
    quote: { id: 'q-reuse', modelId: 'm1', items: [{ id: 'slot', kind: 'addon', catalogId: 'tarp', price: 25000 }] },
    costCatalog: catalog,
  });
  const old = { ...original, lineCosts: { slot: 15000 }, lineCostSources: { slot: 'manual' },
    supplierSelections: { slot: 't1' } };
  const next = buildPricingRecord({
    quote: { id: 'q-reuse', modelId: 'm1', items: [{ id: 'slot', kind: 'addon', catalogId: 'tailgate', price: 40000 }] },
    costCatalog: catalog, existing: old,
  });
  assert.equal(next.lines[0].cost, 32000);
  assert.equal(next.supplierSelections.slot, undefined);
});

test('keeps vendor-pending items out of current totals and cost checks', () => {
  const record = buildPricingRecord({
    quote: {
      id: 'q-pending', modelId: 'm1',
      items: [
        { id: 'v', kind: 'vehicle', catalogId: 'm1', price: 800000 },
        { id: 'floor', kind: 'addon', catalogId: 'floor1', price: 0, pending: true },
      ],
    },
    costCatalog: { models: { m1: { commission: 100000 } }, addons: {} },
  });
  assert.equal(record.lines.length, 1);
  assert.equal(record.saleTotal, 800000);
  assert.equal(record.costComplete, true);
  assert.equal(record.profit, 100000);
});

test('classifies all three quote safety states', () => {
  assert.equal(pricingSafetyStatus({ lines: [], saleTotal: 0, costComplete: false }), 'ok');
  assert.equal(pricingSafetyStatus({ costComplete: false, belowCost: false }), 'incomplete');
  assert.equal(pricingSafetyStatus({ costComplete: true, belowCost: true }), 'belowCost');
  assert.equal(pricingSafetyStatus({ costComplete: true, belowCost: false }), 'ok');
});

test('seeds the latest supplier sheet costs from sale price minus bonus', () => {
  const catalog = normalizeCostCatalog(null);
  assert.equal(catalog.models['qm-1'].commission, 35000);
  assert.equal(catalog.models['qm-5'].commission, 50000);
  assert.equal(catalog.models['qm-7'].commission, 45000);
  assert.equal(catalog.addons['qa-pkg1'].cost, 11000);
  assert.equal(catalog.addons['qa-h-rack-single'].cost, 4000);
  assert.equal(catalog.addons['qa-h-rack-pair'].cost, 7000);
  assert.equal(catalog.addons['qa-tailgate-35'].cost, 35000);
  assert.equal(catalog.addons['qa-tailgate-step'].cost, 1000);
  assert.equal(catalog.addons['qa-tailgate-remote'].cost, 2000);
  assert.equal(catalog.addons['qa-double-cab-package'].cost, 203500);
  assert.equal(catalog.addons['qa-travel-crossbar'], undefined);
  assert.equal(catalog.addons['qa-android-console-box'].cost, 500);
  assert.equal(catalog.addons['qa-star-led-head'].cost, 3000);
  assert.equal(catalog.addons['qa-star-led-tail'].cost, 2000);
  assert.equal(catalog.addons['qa-star-led-fog'].cost, 1400);
  assert.equal(catalog.addons['qa-puddle-lamp'].cost, 2800);
  assert.equal(catalog.addons['qa-interior-led-single'], undefined);
  assert.equal(catalog.addons['qa-interior-led-double'], undefined);
  assert.equal(catalog.addons['qa-turn'], undefined);
  assert.equal(catalog.addons['qa-phone-basic'].cost, 1040);
  assert.equal(catalog.addons['qa-phone-a-pillar'].cost, 1200);
  assert.equal(catalog.addons['qa-phone'].cost, 2300);
  assert.equal(catalog.addons['qa-tlsound'].cost, 7500);
  assert.equal(catalog.addons['qa-mirror2'].cost, 4000);
  assert.equal(catalog.addons['qa-ts'].cost, 25300);
  assert.equal(catalog.addons['qa-block'].cost, 6800);
  assert.equal(catalog.addons['qa-atc'].cost, 17000);
  assert.equal(catalog.addons['qa-leaf'].cost, 14500);
  assert.equal(catalog.addons['qa-urea'].cost, 4500);
  assert.equal(catalog.addons['qa-side'].cost, 15900);
  assert.equal(catalog.addons['qa-rear'].cost, 6000);
  assert.equal(catalog.addons['qa-rear-dr'].cost, 10800);
  assert.equal(catalog.addons['qa-roof'].cost, 13500);
  assert.equal(catalog.addons['qa-omega'].cost, 29800);
  assert.equal(catalog.addons['qa-fog'].cost, 4300);
  assert.equal(catalog.addons['qa-tail'].cost, 9300);
  assert.equal(catalog.addons['qa-gtr'].cost, 25900);
  assert.equal(catalog.addons['qa-paint1'].cost, 33000);
  assert.equal(catalog.addons['qa-paint2'].cost, 34000);
  assert.equal(catalog.addons['qa-paint3'].cost, 36000);
  assert.equal(catalog.addons['qa-truck-air-deflector'].cost, 3000);
});

test('adds the double-cab package and keeps its unverified crossbar cost pending', () => {
  const resolved = resolveQuotePresets({
    ...DEFAULT_QUOTE_PRESETS,
    _catalog: 'kavan-2026-v17',
    addons: DEFAULT_QUOTE_PRESETS.addons
      .filter((item) => !['qa-double-cab-package', 'qa-travel-crossbar'].includes(item.id))
      .map((item) => {
        const { includes, ...legacyItem } = item;
        return legacyItem;
      }),
  });
  const doubleCabPackage = resolved.addons.find((item) => item.id === 'qa-double-cab-package');
  assert.equal(doubleCabPackage.price, 250000);
  assert.equal(doubleCabPackage.includes.length, 17);
  assert.equal(resolved.addons.find((item) => item.id === 'qa-travel-crossbar').price, 12000);
  assert.deepEqual(resolved.addons.find((item) => item.id === 'qa-pkg2').includes,
    ['qa-android-surround', 'qa-tpms-6']);

  const costs = normalizeCostCatalog({ key: 'costCatalog', version: 7, models: {}, addons: {} });
  assert.equal(costs.addons['qa-double-cab-package'].cost, 203500);
  assert.equal(costs.addons['qa-travel-crossbar'], undefined);
});

test('upgrades the safety package punctuation and USB capitalization', () => {
  const oldDescription = '安卓四錄整合多媒體（台灣美邁、9吋安卓觸控螢幕、高清四錄影監控&360度環景、無線Carplay、卡旺專用底座）；六輪胎壓偵測器（6輪數據獨立顯示、太陽能與usb供電）';
  const resolved = resolveQuotePresets({
    ...DEFAULT_QUOTE_PRESETS,
    _catalog: 'kavan-2026-v18',
    addons: DEFAULT_QUOTE_PRESETS.addons.map((item) => item.id === 'qa-pkg2'
      ? { ...item, desc: oldDescription }
      : item),
  });
  const description = resolved.addons.find((item) => item.id === 'qa-pkg2').desc;
  assert.match(description, /6輪數據獨立顯示、太陽能與 USB 供電）$/);
  assert.match(description, /無線 CarPlay/);
});

test('adds paint accessories as a category under body color without inventing costs', () => {
  const resolved = resolveQuotePresets({
    ...DEFAULT_QUOTE_PRESETS,
    _catalog: 'kavan-2026-v20',
    addons: DEFAULT_QUOTE_PRESETS.addons
      .filter((item) => !['qa-paint-logo', 'qa-paint-wheel-cap'].includes(item.id)),
  });
  const logo = resolved.addons.find((item) => item.id === 'qa-paint-logo');
  const wheelCap = resolved.addons.find((item) => item.id === 'qa-paint-wheel-cap');
  assert.deepEqual(
    { cat: logo.cat, name: logo.name, price: logo.price },
    { cat: '烤漆周邊', name: 'Logo', price: 1500 },
  );
  assert.deepEqual(
    { cat: wheelCap.cat, name: wheelCap.name, price: wheelCap.price },
    { cat: '烤漆周邊', name: '輪胎蓋', price: 3000 },
  );
  assert.ok(QUOTE_ADDON_SECTIONS.find((section) => section.key === 'body-color').categories.includes('烤漆周邊'));
  const costs = normalizeCostCatalog(null);
  assert.equal(costs.addons['qa-paint-logo'], undefined);
  assert.equal(costs.addons['qa-paint-wheel-cap'], undefined);
});

test('customized bundle uses retained component costs instead of the package cost', () => {
  const record = buildPricingRecord({
    quote: {
      id: 'q-custom-bundle',
      items: [{
        id: 'bundle', kind: 'addon', catalogId: 'qa-pkg2', name: '安全科技版', price: 35000,
        bundlePricingMode: 'components', bundleIncludedIds: ['qa-android-surround'],
      }],
    },
    costCatalog: null,
  });
  assert.equal(record.lines[0].salePrice, 35000);
  assert.equal(record.lines[0].cost, 25000);
  assert.equal(record.lines[0].costSource, 'bundle-components');
  assert.equal(record.profit, 10000);
});

test('customized bundle keeps cost unknown when any retained component has no cost', () => {
  const record = buildPricingRecord({
    quote: {
      id: 'q-custom-bundle-missing-cost',
      items: [{
        id: 'bundle', kind: 'addon', catalogId: 'qa-double-cab-package', name: '雙廂高階套裝', price: 45800,
        bundlePricingMode: 'components', bundleIncludedIds: ['qa-omega', 'qa-interior-led-double', 'qa-tail'],
      }],
    },
    costCatalog: null,
  });
  assert.equal(record.lines[0].cost, null);
  assert.equal(record.lines[0].costKnown, false);
  assert.equal(record.costComplete, false);
});

test('removes standalone components already included by a selected package', () => {
  assert.deepEqual(new Set(bundledAddonIds(DEFAULT_QUOTE_PRESETS.addons, 'qa-pkg2')),
    new Set(['qa-android-surround', 'qa-tpms-6']));
  const doubleCabIncluded = new Set(bundledAddonIds(DEFAULT_QUOTE_PRESETS.addons, 'qa-double-cab-package'));
  assert.ok(doubleCabIncluded.has('qa-pkg2'));
  assert.ok(doubleCabIncluded.has('qa-android-surround'));
  assert.ok(doubleCabIncluded.has('qa-tpms-6'));
  assert.ok(doubleCabIncluded.has('qa-travel-crossbar'));

  const cleaned = removeBundledQuoteItems([
    { id: 'bundle', catalogId: 'qa-double-cab-package' },
    { id: 'nested-bundle', catalogId: 'qa-pkg2' },
    { id: 'android', catalogId: 'qa-android-surround' },
    { id: 'unrelated', catalogId: 'qa-tailgate-step' },
  ], DEFAULT_QUOTE_PRESETS.addons);
  assert.deepEqual(cleaned.map((item) => item.catalogId), ['qa-double-cab-package', 'qa-tailgate-step']);
});

test('adds priced H-rack options to an existing quote menu', () => {
  const resolved = resolveQuotePresets({
    key: 'quotePresets', _catalog: 'kavan-2026-v12', models: [], subsidies: [],
    addonCategories: [...DEFAULT_QUOTE_PRESETS.addonCategories], addons: [],
  });
  assert.equal(resolved.addons.find((item) => item.id === 'qa-h-rack-single').price, 5000);
  assert.equal(resolved.addons.find((item) => item.id === 'qa-h-rack-pair').price, 9000);
});

test('upgrades unchanged supplier prices and costs while preserving manual edits', () => {
  const resolved = resolveQuotePresets({
    key: 'quotePresets', _catalog: 'kavan-2026-v15', models: [], subsidies: [],
    addonCategories: [...DEFAULT_QUOTE_PRESETS.addonCategories],
    addons: [
      { id: 'qa-gtr', cat: '燈組', name: 'GTR大燈升級（三階切線）', price: 27000 },
      { id: 'qa-atc', cat: '底盤強化', name: 'ATC防傾桿', price: 15000 },
      { id: 'qa-urea', cat: '金屬製研', name: '尿素桶防撞桿', price: 5000 },
      { id: 'qa-roof', cat: '金屬製研', name: '車頂行李架/籃（單廂/大單廂專用）', price: 16000 },
    ],
  });
  assert.equal(resolved.addons.find((item) => item.id === 'qa-gtr').price, 28900);
  assert.equal(resolved.addons.find((item) => item.id === 'qa-atc').price, 18500);
  assert.equal(resolved.addons.find((item) => item.id === 'qa-urea').price, 5500);
  assert.equal(resolved.addons.find((item) => item.id === 'qa-roof').price, 16000);
  assert.equal(resolved.addons.find((item) => item.id === 'qa-rear-dr').price, 12800);
  assert.equal(resolved.addons.some((item) => item.id === 'qa-lighting-custom'), false);

  const costs = normalizeCostCatalog({
    key: 'costCatalog', version: 6, models: {}, addons: {
      'qa-star-led-head': { cost: 3200 },
      'qa-turn': { cost: 1000 },
      'qa-lip': { cost: 7000 },
      'qa-ts': { cost: 24000 },
    },
  });
  assert.equal(costs.addons['qa-star-led-head'].cost, 3000);
  assert.equal(costs.addons['qa-turn'], undefined);
  assert.equal(costs.addons['qa-lip'].cost, 7500);
  assert.equal(costs.addons['qa-ts'].cost, 24000);
  assert.equal(costs.addons['qa-gtr'].cost, 25900);
});

test('matches every known latest-sheet cost to sale price minus bonus', () => {
  const costs = normalizeCostCatalog(null).addons;
  const rows = [
    ['qa-android-surround', 35000, 10000], ['qa-tpms-6', 5000, 1000],
    ['qa-cruise', 8000, 5000], ['qa-media-controls', 12000, 4000],
    ['qa-lip', 9500, 2000], ['qa-mcover', 2800, 800],
    ['qa-tlsound', 9500, 2000], ['qa-led', 15000, 5500],
    ['qa-star-led-head', 4000, 1000], ['qa-star-led-tail', 2500, 500],
    ['qa-star-led-fog', 1800, 400], ['qa-puddle-lamp', 3500, 700],
    ['qa-phone', 3000, 700], ['qa-mirror1', 8500, 1500],
    ['qa-mirror2', 5000, 1000], ['qa-speaker', 2800, 800],
    ['qa-ts', 29800, 4500], ['qa-block', 7800, 1000],
    ['qa-atc', 18500, 1500], ['qa-leaf', 15500, 1000],
    ['qa-urea', 5500, 1000], ['qa-side', 18900, 3000],
    ['qa-skid', 12500, 3000], ['qa-rear', 7500, 1500],
    ['qa-rear-dr', 12800, 2000], ['qa-roof', 15500, 2000],
    ['qa-omega', 33800, 4000], ['qa-fog', 5800, 1500],
    ['qa-tail', 11800, 2500], ['qa-gtr', 28900, 3000],
    ['qa-paint1', 36000, 3000], ['qa-paint2', 37000, 3000],
    ['qa-paint3', 39000, 3000],
  ];
  for (const [id, sale, bonus] of rows) {
    assert.equal(DEFAULT_QUOTE_PRESETS.addons.find((item) => item.id === id)?.price, sale, `${id} sale`);
    assert.equal(costs[id]?.cost, sale - bonus, `${id} cost`);
  }
});

test('adds tailgate accessories and costs while preserving a manually edited tailgate cost', () => {
  const resolved = resolveQuotePresets({
    ...DEFAULT_QUOTE_PRESETS,
    _catalog: 'kavan-2026-v14',
    addonCategories: DEFAULT_QUOTE_PRESETS.addonCategories.filter((category) => category !== '尾門配件'),
    addons: DEFAULT_QUOTE_PRESETS.addons.filter((item) => !['qa-tailgate-step', 'qa-tailgate-remote'].includes(item.id)),
  });
  assert.deepEqual(
    resolved.addons.filter((item) => item.cat === '尾門配件').map((item) => [item.id, item.price]),
    [['qa-tailgate-step', 1000], ['qa-tailgate-remote', 2000]],
  );
  assert.equal(resolved.addonCategories.indexOf('尾門配件'), resolved.addonCategories.indexOf('升降尾門的油壓缸') + 1);

  const costs = normalizeCostCatalog({
    key: 'costCatalog', version: 5, models: {}, addons: { 'qa-tailgate-35': { cost: 36000 } },
  });
  assert.equal(costs.addons['qa-tailgate-35'].cost, 36000);
  assert.equal(costs.addons['qa-tailgate-step'].cost, 1000);
  assert.equal(costs.addons['qa-tailgate-remote'].cost, 2000);
});

test('separates regular and double-fold liftgates and restores the accessory section', () => {
  const resolved = resolveQuotePresets({
    ...DEFAULT_QUOTE_PRESETS,
    _catalog: 'kavan-2026-v16',
    addonCategories: DEFAULT_QUOTE_PRESETS.addonCategories.filter((category) => category !== '尾門配件'),
    addons: DEFAULT_QUOTE_PRESETS.addons
      .filter((item) => !['qa-tailgate-step', 'qa-tailgate-remote'].includes(item.id))
      .map((item) => item.id.startsWith('qa-tailgate-double-fold-')
        ? { ...item, cat: '滑特(升降尾門)', group: 'g-tailgate-size' }
        : item),
  });
  assert.equal(resolved.addons.filter((item) => item.cat === '滑特(升降尾門)').length, 8);
  assert.equal(resolved.addons.filter((item) => item.cat === '雙折尾門').length, 6);
  assert.deepEqual(
    resolved.addons.filter((item) => item.cat === '尾門配件').map((item) => item.name),
    ['尾門腳踏', '尾門遙控'],
  );
  assert.deepEqual(
    resolved.addonCategories.slice(3, 7),
    ['滑特(升降尾門)', '雙折尾門', '升降尾門的油壓缸', '尾門配件'],
  );
  assert.deepEqual(QUOTE_ADDON_SECTIONS.map((section) => [section.label, section.categories.length]), [
    ['尾門系統', 4], ['隔熱紙', 4], ['車身顏色', 3], ['車體打造', 4],
  ]);
});

test('adds body-build categories with vendor-quote placeholders', () => {
  const resolved = resolveQuotePresets({
    key: 'quotePresets', _catalog: 'kavan-2026-v21',
    addonCategories: [...DEFAULT_QUOTE_PRESETS.addonCategories.filter((category) => !['客製帆布', '冷凍冷藏箱', '電動歐翼', '露營箱體'].includes(category))],
    models: [], addons: [], subsidies: [],
  });
  const section = QUOTE_ADDON_SECTIONS.find((row) => row.label === '車體打造');
  assert.deepEqual(section.categories, ['客製帆布', '冷凍冷藏箱', '電動歐翼', '露營箱體']);
  assert.deepEqual(section.categories.map((category) => {
    const item = resolved.addons.find((addon) => addon.cat === category);
    return [category, item?.name, item?.pendingPrice];
  }), [
    ['客製帆布', '客製帆布', true],
    ['冷凍冷藏箱', '冷凍冷藏箱', true],
    ['電動歐翼', '電動歐翼', true],
    ['露營箱體', '露營箱體', true],
  ]);
  assert.deepEqual(
    resolved.addonCategories.slice(resolved.addonCategories.indexOf('客製車體') + 1, resolved.addonCategories.indexOf('客製車體') + 5),
    section.categories,
  );
});

test('lets a version-2 cost catalog keep edited values and intentional blanks', () => {
  const catalog = normalizeCostCatalog({
    key: 'costCatalog', version: 2,
    models: {}, addons: { 'qa-star-led-head': { cost: 3000 } },
  });
  assert.equal(catalog.addons['qa-star-led-head'].cost, 3000);
  assert.equal(catalog.addons['qa-star-led-tail'], undefined);
  assert.equal(catalog.addons['qa-truck-air-deflector'].cost, 3000);
});

test('adds supplier sheet options to existing quote menus without exposing costs', () => {
  const resolved = resolveQuotePresets({
    key: 'quotePresets', _catalog: 'kavan-2026-v3', models: [], addons: [], subsidies: [],
  });
  const galvanized = resolved.addons.find((item) => item.id === 'qa-floor-galvanized');
  const galvanizedFlat = resolved.addons.find((item) => item.id === 'qa-floor-galvanized-flat');
  const consoleBox = resolved.addons.find((item) => item.id === 'qa-android-console-box');
  const film = resolved.addons.find((item) => item.id === 'qa-film-fsk-front');
  assert.equal(galvanized.name, '錏花板（鍍鋅鐵板） 台語：灰板(花紋的)');
  assert.equal(galvanizedFlat.name, '錏花平板（鍍鋅鋼板） 台語：灰板(沒花紋的)');
  assert.equal(galvanizedFlat.pendingPrice, true);
  assert.equal(consoleBox.parentId, 'qa-android-surround');
  assert.equal(consoleBox.price, 500);
  assert.equal(film.price, 8000);
  assert.equal(Object.prototype.hasOwnProperty.call(film, 'cost'), false);
  assert.ok(resolved.addons.find((item) => item.id === 'qa-brake-kit'));
});

test('removes the nonexistent lighting bundle and marks every cargo floor as 5mm', () => {
  const resolved = resolveQuotePresets({
    key: 'quotePresets', _catalog: 'kavan-2026-v19', models: [], subsidies: [],
    addonCategories: [...DEFAULT_QUOTE_PRESETS.addonCategories],
    addons: [
      { id: 'qa-lighting-custom', cat: '燈組', name: '專用燈系套裝', price: 0, pendingPrice: true },
      { id: 'qa-floor-rubber', cat: '貨斗底板', name: '貨斗橡膠底板', price: 0, pendingPrice: true, desc: '依車型報價' },
      { id: 'custom-floor', cat: '貨斗底板', name: '客製底板', price: 12000, desc: '客製施工' },
    ],
  });

  assert.equal(resolved.addons.some((item) => item.id === 'qa-lighting-custom'), false);
  const cargoFloors = resolved.addons.filter((item) => item.cat === '貨斗底板');
  assert.ok(cargoFloors.length >= 4);
  assert.ok(cargoFloors.every((item) => item.desc.includes('5mm')));
  assert.match(resolved.addons.find((item) => item.id === 'custom-floor').desc, /5mm；客製施工/);
});

test('groups window film into front glass and three cab types', () => {
  const filmItems = DEFAULT_QUOTE_PRESETS.addons.filter((item) => item.id.startsWith('qa-film-'));
  const groups = Object.groupBy(filmItems, (item) => item.cat);
  assert.deepEqual(Object.keys(groups), [
    '隔熱紙（前擋／全車型）', '隔熱紙（單廂）', '隔熱紙（大單廂）', '隔熱紙（雙廂）',
  ]);
  assert.ok(Object.values(groups).every((items) => items.length === 3));
  assert.equal(filmItems.some((item) => item.cat === '隔熱紙'), false);
});

test('uses 4.5 percent as the default customer loan estimate', () => {
  assert.ok(DEFAULT_QUOTE_PRESETS.addons.length > 0);
  assert.ok(resolveLoanTerms(null).every((term) => term.rate === 4.5));
  assert.equal(resolveLoanTerms(null).at(-1).months, 84);
  assert.ok(resolveLoanTerms([
    { months: 12, rate: 2.88 }, { months: 24, rate: 3 }, { months: 36, rate: 3.25 },
    { months: 48, rate: 3.5 }, { months: 60, rate: 3.75 }, { months: 72, rate: 4.2 },
  ]).every((term) => term.rate === 4.5));
  assert.equal(resolveLoanTerms([
    { months: 12, rate: 4.5 }, { months: 24, rate: 4.5 }, { months: 36, rate: 4.5 },
    { months: 48, rate: 4.5 }, { months: 60, rate: 4.5 }, { months: 72, rate: 4.5 },
  ]).at(-1).months, 84);
  assert.ok(resolveLoanTerms([{ months: 96, rate: 4.5 }]).every((term) => term.months <= 84));
});

test('splits cargo floors and liftgates into quote categories with special orders pending', () => {
  const addons = DEFAULT_QUOTE_PRESETS.addons;
  assert.equal(addons.find((item) => item.id === 'qa-floor-rubber').cat, '貨斗底板');
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-30').price, 40000);
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-35').price, 40000);
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-40').price, 43000);
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-45').price, 43000);
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-50').price, 48000);
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-55').price, 48000);
  assert.equal(addons.some((item) => item.id === 'qa-tailgate-30-35'), false);
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-double-cylinder').price, 8000);
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-double-cylinder').cat, '升降尾門的油壓缸');
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-double-cylinder').name, '雙缸油壓缸（800～1,000kg）');
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-60-special').pendingPrice, true);
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-four-cylinder').pendingPrice, true);
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-four-cylinder').cat, '升降尾門的油壓缸');
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-four-cylinder').name, '四缸油壓缸（約1,200kg 特製規格）');
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-step').cat, '尾門配件');
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-step').price, 1000);
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-remote').cat, '尾門配件');
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-remote').price, 2000);
  assert.deepEqual(
    addons.filter((item) => item.cat === '升降尾門的油壓缸').map((item) => item.id).sort(),
    ['qa-tailgate-double-cylinder', 'qa-tailgate-four-cylinder'],
  );
  assert.equal(addons.some((item) => (item.desc || '').includes('單缸油壓')), false);
  for (const [id, size] of [['35', '3.5'], ['40', '4'], ['45', '4.5'], ['50', '5'], ['55', '5.5'], ['60', '6']]) {
    const doubleFold = addons.find((item) => item.id === `qa-tailgate-double-fold-${id}`);
    assert.equal(doubleFold.name, `雙折尾門（${size}尺）`);
    assert.equal(doubleFold.cat, '雙折尾門');
    assert.equal(doubleFold.group, 'g-tailgate-double-fold-size');
    assert.equal(doubleFold.pendingPrice, true);
    assert.equal(doubleFold.price, 0);
  }
  assert.equal(addons.some((item) => item.id === 'qa-tailgate-double-fold-30'), false);
  assert.equal(addons.find((item) => item.id === 'qa-truck-air-deflector').price, 3500);
  assert.equal(addons.find((item) => item.id === 'qa-truck-air-deflector').pendingPrice, false);
});

test('moves saved tailgates into size and cylinder categories without restoring the old category', () => {
  const old = {
    ...DEFAULT_QUOTE_PRESETS,
    _catalog: 'kavan-2026-v13',
    addonCategories: DEFAULT_QUOTE_PRESETS.addonCategories
      .map((category) => category === '升降尾門的油壓缸' ? '升降尾門' : category)
      .filter((category) => !category.startsWith('隔熱紙（'))
      .concat('隔熱紙'),
    addons: DEFAULT_QUOTE_PRESETS.addons.map((item) => {
      if (item.id === 'qa-tailgate-double-cylinder') return { ...item, cat: '升降尾門', name: '雙缸油壓升級（800～1,000kg）', desc: '搭配尾門尺寸選用；由單缸基本配置升級為雙缸油壓' };
      if (item.id === 'qa-tailgate-four-cylinder') return { ...item, cat: '升降尾門', name: '四缸升降尾門（約1,200kg 特製規格）' };
      if (item.id.startsWith('qa-tailgate-double-fold-')) return { ...item, cat: '升降尾門' };
      if (/^qa-tailgate-(?:25|30|35|40|45|50|55)$/.test(item.id)) return { ...item, desc: '單缸油壓基本配置；實際配置仍依車型、載重與施工內容確認' };
      if (item.id.startsWith('qa-film-')) return { ...item, cat: '隔熱紙' };
      return item;
    }),
  };
  const upgraded = resolveQuotePresets(old);
  assert.equal(upgraded.addons.filter((item) => item.id.startsWith('qa-tailgate-double-fold-')).length, 6);
  assert.ok(upgraded.addons.filter((item) => item.id.startsWith('qa-tailgate-double-fold-'))
    .every((item) => item.cat === '雙折尾門' && item.pendingPrice && item.price === 0));
  assert.equal(upgraded.addonCategories.includes('升降尾門'), false);
  assert.equal(upgraded.addonCategories.includes('尾門其他配備'), false);
  assert.equal(upgraded.addonCategories.includes('升降尾門的油壓缸'), true);
  assert.equal(upgraded.addonCategories.includes('尾門配件'), true);
  assert.equal(upgraded.addons.find((item) => item.id === 'qa-tailgate-four-cylinder').cat, '升降尾門的油壓缸');
  assert.equal(upgraded.addons.some((item) => (item.desc || '').includes('單缸油壓')), false);
  assert.equal(upgraded.addonCategories.includes('隔熱紙'), false);
  assert.ok(upgraded.addons.filter((item) => item.id.startsWith('qa-film-')).every((item) => item.cat.startsWith('隔熱紙（')));
});

test('preserves a custom addon category when upgrading saved quote presets', () => {
  const resolved = resolveQuotePresets({
    key: 'quotePresets', _catalog: 'kavan-2026-v8', models: [], subsidies: [],
    addons: [{ ...DEFAULT_QUOTE_PRESETS.addons.find((item) => item.id === 'qa-floor-rubber'), cat: '工地底板' }],
  });
  assert.equal(resolved.addons.find((item) => item.id === 'qa-floor-rubber').cat, '工地底板');
});

test('renames an addon category, its items and existing quote review markers without merging categories', () => {
  const presets = {
    ...DEFAULT_QUOTE_PRESETS,
    addonCategories: ['貨斗底板', '升降尾門', '自訂空分類'],
    addons: [
      { id: 'floor', cat: '貨斗底板', name: '底板', price: 10000 },
      { id: 'tail', cat: '升降尾門', name: '尾門', price: 40000 },
    ],
  };
  const renamed = renameAddonCategory(presets, '貨斗底板', '底板區');
  assert.deepEqual(renamed.addonCategories, ['底板區', '升降尾門', '自訂空分類']);
  assert.equal(renamed.addons.find((item) => item.id === 'floor').cat, '底板區');
  assert.equal(renamed.addons.find((item) => item.id === 'tail').cat, '升降尾門');
  assert.deepEqual(canonicalAddonCategories(['貨斗底板', '升降尾門'], renamed.addonCategoryAliases), ['底板區', '升降尾門']);
  assert.equal(renameAddonCategory(renamed, '底板區', '升降尾門'), renamed);
  const renamedAgain = renameAddonCategory(renamed, '底板區', '貨斗區');
  assert.deepEqual(canonicalAddonCategories(['貨斗底板', '底板區'], renamedAgain.addonCategoryAliases), ['貨斗區']);
  assert.equal(renameAddonCategory(renamedAgain, '貨斗區', '貨斗底板'), renamedAgain);
});

test('moves default tailgate sizes into the Swift category without overwriting customized names', () => {
  const resolved = resolveQuotePresets({
    key: 'quotePresets', _catalog: 'kavan-2026-v9', models: [], subsidies: [],
    addonCategories: ['貨斗底板', '升降尾門', '配件'],
    addons: [
      { id: 'qa-tailgate-30', cat: '升降尾門', name: '滑特升降尾門（3尺）', price: 40000 },
      { id: 'qa-tailgate-35', cat: '我的尾門', name: '自訂款（3.5尺）', price: 42000 },
    ],
  });
  assert.equal(resolved.addons.find((item) => item.id === 'qa-tailgate-30').name, '升降尾門（3尺）');
  assert.equal(resolved.addons.find((item) => item.id === 'qa-tailgate-30').cat, '滑特(升降尾門)');
  assert.equal(resolved.addons.find((item) => item.id === 'qa-tailgate-35').name, '自訂款（3.5尺）');
  assert.equal(resolved.addons.find((item) => item.id === 'qa-tailgate-35').cat, '我的尾門');
  assert.deepEqual(resolved.addonCategories.slice(0, 6), ['貨斗底板', '滑特(升降尾門)', '雙折尾門', '升降尾門的油壓缸', '尾門配件', '配件']);
});

test('upgrades the old pending deflector price while preserving custom edits', () => {
  const oldDefault = resolveQuotePresets({
    key: 'quotePresets', _catalog: 'kavan-2026-v5', models: [], subsidies: [],
    addons: [{ id: 'qa-truck-air-deflector', cat: '客製車體', name: '貨車導流板', price: 0, pendingPrice: true }],
  });
  const migrated = oldDefault.addons.find((item) => item.id === 'qa-truck-air-deflector');
  assert.equal(migrated.price, 3500);
  assert.equal(migrated.pendingPrice, false);

  const customized = resolveQuotePresets({
    key: 'quotePresets', _catalog: 'kavan-2026-v5', models: [], subsidies: [],
    addons: [{ id: 'qa-truck-air-deflector', cat: '客製車體', name: '貨車導流板', price: 4000, pendingPrice: false }],
  });
  assert.equal(customized.addons.find((item) => item.id === 'qa-truck-air-deflector').price, 4000);
});

test('moves an existing four-cylinder liftgate into the cylinder-only category', () => {
  const resolved = resolveQuotePresets({
    key: 'quotePresets', _catalog: 'kavan-2026-v6', models: [], subsidies: [],
    addons: [{
      id: 'qa-tailgate-four-cylinder', cat: '客製車體', name: '四缸升降尾門（特製規格）',
      price: 0, pendingPrice: true,
    }],
  });
  const fourCylinder = resolved.addons.find((item) => item.id === 'qa-tailgate-four-cylinder');
  assert.equal(fourCylinder.cat, '升降尾門的油壓缸');
  assert.equal(fourCylinder.name, '四缸油壓缸（約1,200kg 特製規格）');
  assert.equal(fourCylinder.pendingPrice, true);
});

test('splits existing combined liftgate sizes into individual quote options', () => {
  const resolved = resolveQuotePresets({
    key: 'quotePresets', _catalog: 'kavan-2026-v7', models: [], subsidies: [],
    addons: [
      { id: 'qa-tailgate-30-35', cat: '升降尾門', group: 'g-tailgate-size', name: '滑特升降尾門（3～3.5尺）', price: 41000 },
      { id: 'qa-tailgate-40-45', cat: '升降尾門', group: 'g-tailgate-size', name: '滑特升降尾門（4～4.5尺）', price: 43000 },
      { id: 'qa-tailgate-50-55', cat: '升降尾門', group: 'g-tailgate-size', name: '滑特升降尾門（5～5.5尺）', price: 48000 },
    ],
  });
  assert.equal(resolved.addons.some((item) => item.id === 'qa-tailgate-30-35'), false);
  assert.equal(resolved.addons.find((item) => item.id === 'qa-tailgate-30').price, 41000);
  assert.equal(resolved.addons.find((item) => item.id === 'qa-tailgate-35').price, 41000);
  assert.ok(resolved.addons.find((item) => item.id === 'qa-tailgate-40'));
  assert.ok(resolved.addons.find((item) => item.id === 'qa-tailgate-45'));
  assert.ok(resolved.addons.find((item) => item.id === 'qa-tailgate-50'));
  assert.ok(resolved.addons.find((item) => item.id === 'qa-tailgate-55'));
});

test('upgrades the old galvanized floor name and adds the dependent console option', () => {
  const resolved = resolveQuotePresets({
    key: 'quotePresets', _catalog: 'kavan-2026-v8', models: [], subsidies: [],
    addons: [
      { id: 'qa-floor-galvanized', cat: '貨斗底板', group: 'g-cargo-floor', name: '錏花板（鍍鋅鋼板） 台語：灰板', price: 0, pendingPrice: true },
      { id: 'qa-android-surround', cat: '駕駛科技', name: '安卓＋四錄＆環景＋專用底座', price: 35000, desc: '中央置物盒另加 500 元；12 個月保固' },
    ],
  });
  assert.equal(
    resolved.addons.find((item) => item.id === 'qa-floor-galvanized').name,
    '錏花板（鍍鋅鐵板） 台語：灰板(花紋的)',
  );
  assert.equal(resolved.addons.find((item) => item.id === 'qa-android-surround').desc, '中央置物盒另加 500 元；1 年保固');
  assert.equal(resolved.addons.find((item) => item.id === 'qa-android-console-box').parentId, 'qa-android-surround');
});

test('keeps an item-level color note when normalizing a saved quote', () => {
  const normalized = normalizeQuoteItems([
    { id: 'paint', catalogId: 'qa-paint1', name: '車身烤漆改色（單廂）', price: 36000, note: '珍珠白' },
  ]);
  assert.equal(normalized.items[0].note, '珍珠白');
});
