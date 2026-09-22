import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPricingDiscountsToQuote, buildPricingRecord, calculateQuoteTotals, normalizeQuoteItems,
  applicableSupplierCosts, includedQuoteItems, normalizeCostCatalog, pricingSafetyStatus, resolveAddonCost, updatePricingCosts,
} from './pricing.js';
import { canonicalAddonCategories, DEFAULT_QUOTE_PRESETS, renameAddonCategory, resolveLoanTerms, resolveQuotePresets } from './crm.js';

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

test('builds a complete cost snapshot and detects below-cost quotes', () => {
  const record = buildPricingRecord({
    quote: {
      id: 'q1', modelId: 'm1', model: '卡旺',
      items: [
        { id: 'v', kind: 'vehicle', catalogId: 'm1', price: 800000 },
        { id: 'a', kind: 'addon', catalogId: 'a1', price: 20000 },
      ],
      generalDiscounts: [{ amount: 50000 }],
    },
    costCatalog: { models: { m1: { cost: 760000 } }, addons: { a1: { cost: 15000 } } },
  });
  assert.equal(record.costComplete, true);
  assert.equal(record.costTotal, 775000);
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
    costCatalog: { models: { m1: { cost: 700000 } }, addons: {} },
  });
  assert.equal(record.costComplete, false);
  assert.equal(record.knownCostTotal, 700000);
  assert.equal(record.costTotal, null);
  assert.equal(record.profit, null);

  const completed = updatePricingCosts(record, { v: 700000, manual: 5000 });
  assert.equal(completed.costComplete, true);
  assert.equal(completed.costTotal, 705000);
  assert.equal(completed.profit, 105000);
});

test('refreshes missing snapshot costs from the current catalog and keeps manual costs', () => {
  const record = buildPricingRecord({
    quote: {
      id: 'q-refresh', modelId: 'm1', model: '卡旺',
      items: [
        { id: 'v', kind: 'vehicle', catalogId: 'm1', price: 800000 },
        { id: 'a', kind: 'addon', catalogId: 'a1', price: 20000 },
      ],
    },
    costCatalog: { models: { m1: { cost: 760000 } }, addons: { a1: { cost: 15000 } } },
    existing: { lineCosts: { v: 755000 }, otherCosts: [] },
  });
  assert.equal(record.lines.find((line) => line.id === 'v').cost, 755000);
  assert.equal(record.lines.find((line) => line.id === 'a').cost, 15000);
  assert.equal(record.costTotal, 770000);
  assert.equal(record.profit, 50000);
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

test('recalculates line profit and writes an internal discount back to the quote', () => {
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
  assert.equal(preview.itemDiscountTotal, 7000);
  assert.equal(preview.saleTotal, 13000);
  assert.equal(preview.profit, 3000);

  const updatedQuote = applyPricingDiscountsToQuote(quote, { a: 5000 });
  assert.equal(updatedQuote.items[0].discounts.length, 2);
  assert.equal(updatedQuote.items[0].discounts.find((row) => row.name === '活動優惠').amount, 2000);
  assert.equal(updatedQuote.items[0].discounts.find((row) => row.name === '業務優惠').amount, 5000);
  assert.equal(updatedQuote.total, 13000);
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
    costCatalog: { models: { m1: { cost: 700000 } }, addons: {} },
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

test('seeds supplier sheet costs and converts each 80-percent row to a number', () => {
  const catalog = normalizeCostCatalog(null);
  assert.equal(catalog.addons['qa-star-led-head'].cost, 3200);
  assert.equal(catalog.addons['qa-star-led-tail'].cost, 2000);
  assert.equal(catalog.addons['qa-star-led-fog'].cost, 1440);
  assert.equal(catalog.addons['qa-puddle-lamp'].cost, 2800);
  assert.equal(catalog.addons['qa-interior-led-single'].cost, 400);
  assert.equal(catalog.addons['qa-interior-led-double'].cost, 480);
  assert.equal(catalog.addons['qa-phone-basic'].cost, 1040);
  assert.equal(catalog.addons['qa-phone-a-pillar'].cost, 1200);
  assert.equal(catalog.addons['qa-truck-air-deflector'].cost, 3000);
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
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-60-special').pendingPrice, true);
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-four-cylinder').pendingPrice, true);
  for (const [id, size] of [['35', '3.5'], ['40', '4'], ['45', '4.5'], ['50', '5'], ['55', '5.5'], ['60', '6']]) {
    const doubleFold = addons.find((item) => item.id === `qa-tailgate-double-fold-${id}`);
    assert.equal(doubleFold.name, `雙折尾門（${size}尺）`);
    assert.equal(doubleFold.cat, '升降尾門');
    assert.equal(doubleFold.group, 'g-tailgate-size');
    assert.equal(doubleFold.pendingPrice, true);
    assert.equal(doubleFold.price, 0);
  }
  assert.equal(addons.some((item) => item.id === 'qa-tailgate-double-fold-30'), false);
  assert.equal(addons.find((item) => item.id === 'qa-truck-air-deflector').price, 3500);
  assert.equal(addons.find((item) => item.id === 'qa-truck-air-deflector').pendingPrice, false);
});

test('adds pending double-fold tailgates to saved menus without restoring renamed categories', () => {
  const old = renameAddonCategory({ ...DEFAULT_QUOTE_PRESETS, _catalog: 'kavan-2026-v10',
    addonCategories: [...DEFAULT_QUOTE_PRESETS.addonCategories],
    addons: DEFAULT_QUOTE_PRESETS.addons.filter((item) => !item.id.startsWith('qa-tailgate-double-fold-')),
  }, '升降尾門', '尾門其他配備');
  const upgraded = resolveQuotePresets(old);
  assert.equal(upgraded.addons.filter((item) => item.id.startsWith('qa-tailgate-double-fold-')).length, 6);
  assert.ok(upgraded.addons.filter((item) => item.id.startsWith('qa-tailgate-double-fold-'))
    .every((item) => item.cat === '尾門其他配備' && item.pendingPrice && item.price === 0));
  assert.equal(upgraded.addonCategories.includes('升降尾門'), false);
  assert.equal(upgraded.addonCategories.includes('尾門其他配備'), true);
  assert.equal(upgraded.addons.find((item) => item.id === 'qa-tailgate-four-cylinder').cat, '尾門其他配備');
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
  assert.deepEqual(resolved.addonCategories.slice(0, 4), ['貨斗底板', '滑特(升降尾門)', '升降尾門', '配件']);
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

test('moves an existing four-cylinder liftgate out of the custom-body category', () => {
  const resolved = resolveQuotePresets({
    key: 'quotePresets', _catalog: 'kavan-2026-v6', models: [], subsidies: [],
    addons: [{
      id: 'qa-tailgate-four-cylinder', cat: '客製車體', name: '四缸升降尾門（特製規格）',
      price: 0, pendingPrice: true,
    }],
  });
  const fourCylinder = resolved.addons.find((item) => item.id === 'qa-tailgate-four-cylinder');
  assert.equal(fourCylinder.cat, '升降尾門');
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
  assert.equal(resolved.addons.find((item) => item.id === 'qa-android-surround').desc, '12 個月保固');
  assert.equal(resolved.addons.find((item) => item.id === 'qa-android-console-box').parentId, 'qa-android-surround');
});

test('keeps an item-level color note when normalizing a saved quote', () => {
  const normalized = normalizeQuoteItems([
    { id: 'paint', catalogId: 'qa-paint1', name: '車身烤漆改色（單廂）', price: 36000, note: '珍珠白' },
  ]);
  assert.equal(normalized.items[0].note, '珍珠白');
});
