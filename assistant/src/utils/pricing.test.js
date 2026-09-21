import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPricingRecord, calculateQuoteTotals, normalizeQuoteItems,
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
  assert.equal(record.costTotal, null);
  assert.equal(record.profit, null);

  const completed = updatePricingCosts(record, { v: 700000, manual: 5000 });
  assert.equal(completed.costComplete, true);
  assert.equal(completed.profit, 105000);
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
  const film = resolved.addons.find((item) => item.id === 'qa-film-fsk-front');
  assert.equal(galvanized.name, '錏花板（鍍鋅鋼板） 台語：灰板');
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
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-50-55').price, 48000);
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-double-cylinder').price, 8000);
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-60-special').pendingPrice, true);
  assert.equal(addons.find((item) => item.id === 'qa-tailgate-four-cylinder').pendingPrice, true);
  assert.equal(addons.find((item) => item.id === 'qa-truck-air-deflector').price, 3500);
  assert.equal(addons.find((item) => item.id === 'qa-truck-air-deflector').pendingPrice, false);
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
