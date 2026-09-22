import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPricingDiscountsToQuote, buildPricingRecord, calculateQuoteTotals, normalizeQuoteItems,
  normalizeCostCatalog, pricingSafetyStatus, updatePricingCosts,
} from './pricing.js';
import { DEFAULT_QUOTE_PRESETS, resolveLoanTerms, resolveQuotePresets } from './crm.js';

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
  assert.equal(addons.find((item) => item.id === 'qa-truck-air-deflector').price, 3500);
  assert.equal(addons.find((item) => item.id === 'qa-truck-air-deflector').pendingPrice, false);
});

test('preserves a custom addon category when upgrading saved quote presets', () => {
  const resolved = resolveQuotePresets({
    key: 'quotePresets', _catalog: 'kavan-2026-v8', models: [], subsidies: [],
    addons: [{ ...DEFAULT_QUOTE_PRESETS.addons.find((item) => item.id === 'qa-floor-rubber'), cat: '工地底板' }],
  });
  assert.equal(resolved.addons.find((item) => item.id === 'qa-floor-rubber').cat, '工地底板');
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
