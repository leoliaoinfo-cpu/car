import test from 'node:test';
import assert from 'node:assert/strict';
import { planWonQuoteSync, nextDealAmount, mergeStockItems } from './wonQuote.js';

const item = (id, name, price, extra = {}) => ({ id, kind: 'addon', name, price, ...extra });

test('追加配件：金額加上差額、新配件進核對表、舊配件狀態不被洗掉', () => {
  const oldQuote = { total: 920000, items: [item('a', '特仕版套件', 30000), item('b', '三面帆布－雙廂降低版', 13500)] };
  const deal = {
    amount: 920000, quoteSnapshot: oldQuote,
    stockItems: [
      { id: 'a', name: '特仕版套件', status: 'ready', quantity: 1, note: '' },
      { id: 'b', name: '三面帆布－雙廂降低版', status: 'inquiry', followUpDate: '2026-11-25', note: '' },
    ],
    deliveryWorkflow: [{ id: 'contract' }, { id: 'delivery' }],
  };
  const newQuote = { total: 957000, items: [...oldQuote.items, item('c', '升降尾門（2.5尺）', 37000)] };
  const plan = planWonQuoteSync({ deal, quote: newQuote });
  assert.equal(plan.amount, 957000);
  assert.equal(plan.amountDelta, 37000);
  assert.deepEqual(plan.addedStock, ['升降尾門（2.5尺）']);
  const a = plan.stockItems.find((r) => r.id === 'a');
  assert.equal(a.status, 'ready');
  assert.equal(plan.stockItems.find((r) => r.id === 'b').followUpDate, '2026-11-25');
  assert.equal(plan.stockItems.find((r) => r.id === 'c').status, 'todo');
  assert.ok(plan.missingSteps.some((label) => /尾門/.test(label)));
});

test('舊成交的特殊金額不會被洗掉：用差額計算', () => {
  const deal = { amount: 1423300, quoteSnapshot: { total: 1400000 } };
  assert.equal(nextDealAmount({ deal, quote: { total: 1437000 } }), 1460300);
  assert.equal(nextDealAmount({ deal: { amount: 5 }, quote: { total: 100 } }), 100); // 沒有舊快照就用報價總額
});

test('拿掉配件：沒備貨的移除，已備妥的保留並列出來；不會默默消失', () => {
  const r = mergeStockItems({
    oldItems: [{ id: 'x', name: 'X', status: 'todo' }, { id: 'y', name: 'Y', status: 'ready' }, { id: 'z', name: 'Z', status: 'inquiry' }],
    freshItems: [{ id: 'z', name: 'Z', status: 'todo', note: '' }],
  });
  assert.deepEqual(r.items.map((x) => x.id).sort(), ['y', 'z']);
  assert.deepEqual(r.removed.map((x) => x.id), ['x']);
  assert.deepEqual(r.kept.map((x) => x.id), ['y']);
  assert.equal(r.items.find((x) => x.id === 'z').status, 'inquiry'); // 保留原狀態
});

test('使用者自己改過的備註不被報價覆蓋；沒改過的跟著報價更新', () => {
  const prevDerived = [{ id: 'a', note: '黑色' }, { id: 'b', note: '' }];
  const r = mergeStockItems({
    oldItems: [{ id: 'a', name: 'A', status: 'todo', note: '黑色' }, { id: 'b', name: 'B', status: 'todo', note: '我自己寫的' }],
    freshItems: [{ id: 'a', name: 'A', status: 'todo', note: '白色' }, { id: 'b', name: 'B', status: 'todo', note: '新備註' }],
    previousDerived: prevDerived,
  });
  assert.equal(r.items.find((x) => x.id === 'a').note, '白色');
  assert.equal(r.items.find((x) => x.id === 'b').note, '我自己寫的');
});

test('待廠商確認的新配件自動排 3 天後再追', () => {
  const r = mergeStockItems({ oldItems: [], freshItems: [{ id: 'n', name: 'N', status: 'inquiry' }], followUpDate: '2026-11-22' });
  assert.equal(r.items[0].followUpDate, '2026-11-22');
});

test('成交後改報價：使用者刪掉的配件核對項目不會被加回來，隱藏與報價資訊旗標保留', async () => {
  const { mergeStockItems } = await import('./wonQuote.js');
  const fresh = [
    { id: 'a', name: '帆布', status: 'todo', note: '' },
    { id: 'fee', name: '領牌費', status: 'todo', info: true, quotePrice: 3000, note: '' },
    { id: 'n', name: '新配件', status: 'todo', note: '' },
  ];
  const old = [{ id: 'a', name: '帆布', status: 'inquiry', hidden: true, note: '' }];
  const merged = mergeStockItems({ oldItems: old, freshItems: fresh, removedIds: ['fee'] });
  assert.deepEqual(merged.items.map((row) => row.id), ['a', 'n']);
  assert.equal(merged.items[0].hidden, true);
  assert.equal(merged.items[0].status, 'inquiry');
});
