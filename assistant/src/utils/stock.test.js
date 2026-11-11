import test from 'node:test';
import assert from 'node:assert/strict';
import { stockAlert, stockItemsFromQuote, summarizeStock } from './stock.js';

test('accessories and gifts enter the case checklist, while vehicle and other fees do not', () => {
  const items = stockItemsFromQuote({ items: [
    { id: 'v', kind: 'vehicle', name: '車輛售價' },
    { id: 'fee', kind: 'other', name: '文件費', price: 300 },
    { id: 'a', kind: 'addon', catalogId: 'mirror', name: '韓版後照鏡', gift: true, note: '黑色' },
    { id: 'b', kind: 'addon', name: '客製帆布', pending: true },
  ] });
  assert.deepEqual(items.map((item) => [item.name, item.status]), [['韓版後照鏡', 'todo'], ['客製帆布', 'inquiry']]);
  assert.equal(items[0].gift, true);
  assert.equal(items[0].note, '黑色');
});

test('bundle components are counted individually without counting the package again', () => {
  const items = stockItemsFromQuote({ items: [{ id: 'bundle', kind: 'addon', name: '套件', bundlePricingMode: 'components', bundleIncludedIds: ['mirror', 'rack'], bundleExcludedIds: ['rack'] }] }, [{ id: 'mirror', name: '後照鏡' }, { id: 'rack', name: '橫桿' }]);
  assert.deepEqual(items.map((item) => item.name), ['後照鏡']);
});

test('central list counts only active confirmed deals and keeps distinct specifications apart', () => {
  const cases = [{ id: 'c1', status: 'active' }, { id: 'c2', status: 'active' }, { id: 'c3', status: 'completed' }];
  const deals = [
    { id: 'd1', caseId: 'c1', quoteId: 'q1', stockItems: [{ id: 'a', catalogId: 'mirror', name: '後照鏡', specification: '黑', quantity: 2, status: 'todo' }] },
    { id: 'd2', caseId: 'c2', quoteId: 'q2', stockItems: [{ id: 'b', catalogId: 'mirror', name: '後照鏡', specification: '白', quantity: 1, status: 'ready' }] },
    { id: 'd3', caseId: 'c3', quoteId: 'q3', stockItems: [{ id: 'c', catalogId: 'mirror', name: '後照鏡', specification: '黑', quantity: 1, status: 'todo' }] },
    { id: 'd4', caseId: 'c2', stockItems: [{ id: 'd', name: '未知', status: 'todo' }] },
  ];
  const groups = summarizeStock(deals, cases);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => [group.specification, group.needed, group.missing]), [['黑', 2, 2], ['白', 1, 0]]);
});

test('alerts only when delivery is near with missing goods or inquiry lacks follow-up date', () => {
  const deal = { stockItems: [{ id: 'a', status: 'inquiry' }] };
  const alert = stockAlert(deal, { desiredDeliveryDate: '2026-11-13' }, new Date('2026-11-10T10:00:00'));
  assert.equal(alert.deliveryRisk, true);
  assert.equal(alert.inquiryNoDate, true);
  assert.equal(stockAlert({ stockItems: [{ status: 'ready' }] }, { desiredDeliveryDate: '2026-11-13' }, new Date('2026-11-10T10:00:00')).deliveryRisk, false);
});
