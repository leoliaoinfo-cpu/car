import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPricingRecord, calculateQuoteTotals, normalizeQuoteItems,
  pricingSafetyStatus, updatePricingCosts,
} from './pricing.js';

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

test('classifies all three quote safety states', () => {
  assert.equal(pricingSafetyStatus({ costComplete: false, belowCost: false }), 'incomplete');
  assert.equal(pricingSafetyStatus({ costComplete: true, belowCost: true }), 'belowCost');
  assert.equal(pricingSafetyStatus({ costComplete: true, belowCost: false }), 'ok');
});
