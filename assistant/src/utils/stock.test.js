import test from 'node:test';
import assert from 'node:assert/strict';
import { stockAlert, stockItemsFromQuote, summarizeStock } from './stock.js';

test('報價上每一項都帶進配件核對：配件與贈品照舊當備品，費用與車價備註當「報價資訊」（不算缺貨）', () => {
  const items = stockItemsFromQuote({ items: [
    { id: 'v', kind: 'vehicle', name: '車輛售價' },
    { id: 'v2', kind: 'vehicle', name: '車輛售價', note: '領牌人 莊天旗', price: 888000 },
    { id: 'fee', kind: 'other', name: '文件費', price: 300 },
    { id: 'a', kind: 'addon', catalogId: 'mirror', name: '韓版後照鏡', gift: true, note: '黑色' },
    { id: 'b', kind: 'addon', name: '客製帆布', pending: true },
  ] });
  assert.deepEqual(items.map((item) => [item.id, item.status, !!item.info]), [['v2', 'todo', true], ['fee', 'todo', true], ['a', 'todo', false], ['b', 'inquiry', false]]);
  assert.equal(items.find((item) => item.id === 'a').gift, true);
  assert.equal(items.find((item) => item.id === 'a').note, '黑色');
  assert.equal(items.find((item) => item.id === 'fee').quotePrice, 300);
  // 報價資訊與隱藏的項目都不算缺貨、不進尚缺配件
  const deal = { stockItems: items };
  assert.deepEqual(missingStockItems(deal).map((row) => row.id), ['a', 'b']);
  assert.equal(isSettledStock({ id: 'x', status: 'todo', hidden: true }), true);
  assert.equal(isFinishedStock({ id: 'x', status: 'todo', hidden: true }), true);
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

test('報價扣項會寫進配件核對表備註', async () => {
  const { stockItemsFromQuote } = await import('./stock.js');
  const rows = stockItemsFromQuote({ items: [
    { id: 'a', kind: 'addon', name: '特仕版套件', price: 27000, note: '黑色',
      deductions: [{ id: 'd1', name: '行車紀錄器', amount: 3000 }, { id: 'd2', name: 'GPS天眼測速', amount: 1000 }] },
    { id: 'b', kind: 'addon', name: '尿素桶防撞桿', price: 5000 },
  ] });
  assert.equal(rows[0].note, '黑色；客人不要：行車紀錄器、GPS天眼測速');
  assert.equal(rows[1].note, '');
});

import {
  defaultTrack, stockTrack, stockStatus, statusLabel, nextStatus, isSettledStock, isFinishedStock, switchTrack, missingStockItems, statusOptions,
} from './stock.js';

test('預設分類：帆布、箱體、尾門、烤漆、H架歸外包，其他歸改裝部；也可以手動指定', () => {
  for (const name of ['三面帆布－雙廂降低版', '冷凍冷藏箱', '鋁塑箱', '升降尾門（2.5尺）', '雙折尾門（4尺）', '車身烤漆改色', 'H架（兩支一組）']) assert.equal(defaultTrack({ name }), 'vendor', name);
  for (const name of ['安卓＋四錄＆環景', '彈簧鋼板', '尿素桶防撞桿', 'LED 光環尾燈', '手機架']) assert.equal(defaultTrack({ name }), 'inhouse', name);
  assert.equal(stockTrack({ name: '帆布', track: 'inhouse' }), 'inhouse'); // 使用者指定優先
  assert.equal(stockTrack({ name: '彈簧鋼板' }), 'inhouse'); // 舊資料沒有 track 也能判斷
});

test('外包流程五步、改裝部四步，下一步按鈕依序往前；最後一步沒有下一步', () => {
  const vendor = { name: '帆布', track: 'vendor', status: 'todo' };
  assert.deepEqual(statusOptions(vendor).map(([, l]) => l), ['未聯繫廠商', '已聯繫廠商', '廠商已施作', '已確認沒問題', '已經回報客戶進度', '不需要']);
  assert.equal(statusLabel(vendor), '未聯繫廠商');
  assert.equal(nextStatus(vendor)[1], '已聯繫廠商');
  assert.equal(nextStatus({ ...vendor, status: 'checked' })[1], '已經回報客戶進度');
  assert.equal(nextStatus({ ...vendor, status: 'reported' }), null);
  const inhouse = { name: '彈簧鋼板', track: 'inhouse', status: 'todo' };
  assert.deepEqual(statusOptions(inhouse).map(([, l]) => l), ['缺貨中', '已叫貨', '已到貨', '已安裝', '不需備品']);
  assert.equal(nextStatus({ ...inhouse, status: 'ready' })[1], '已安裝');
  assert.equal(nextStatus({ ...inhouse, status: 'installed' }), null);
});

test('「不缺」的定義：改裝部要到貨；外包要廠商已施作；已聯繫／已叫貨仍算缺', () => {
  assert.equal(isSettledStock({ track: 'inhouse', status: 'inquiry' }), false);
  assert.equal(isSettledStock({ track: 'inhouse', status: 'ready' }), true);
  assert.equal(isSettledStock({ track: 'vendor', status: 'inquiry' }), false);
  assert.equal(isSettledStock({ track: 'vendor', status: 'vendor_done' }), true);
  assert.equal(isSettledStock({ track: 'vendor', status: 'checked' }), true);
  assert.equal(isSettledStock({ track: 'vendor', status: 'not_needed' }), true);
  // 做完不用再追：外包要回報客戶、改裝部要裝好
  assert.equal(isFinishedStock({ track: 'vendor', status: 'checked' }), false);
  assert.equal(isFinishedStock({ track: 'vendor', status: 'reported' }), true);
  assert.equal(isFinishedStock({ track: 'inhouse', status: 'ready' }), false);
  assert.equal(isFinishedStock({ track: 'inhouse', status: 'installed' }), true);
  assert.equal(missingStockItems({ stockItems: [{ track: 'vendor', status: 'inquiry' }, { track: 'inhouse', status: 'installed' }] }).length, 1);
});

test('舊資料相容：外包項目的舊「已備妥」視為廠商已施作、舊「已安裝」視為已確認沒問題', () => {
  assert.equal(stockStatus({ name: '三面帆布', status: 'ready' }), 'vendor_done');
  assert.equal(stockStatus({ name: '三面帆布', status: 'installed' }), 'checked');
  assert.equal(isSettledStock({ name: '三面帆布', status: 'ready' }), true);
  assert.equal(stockStatus({ name: '彈簧鋼板', status: 'ready' }), 'ready');
});

test('外包／改裝部互換：進度對應換算，不倒退也不憑空前進', () => {
  assert.deepEqual(switchTrack({ name: '帆布', track: 'vendor', status: 'vendor_done' }, 'inhouse'), { name: '帆布', track: 'inhouse', status: 'ready' });
  assert.equal(switchTrack({ name: 'X', track: 'inhouse', status: 'installed' }, 'vendor').status, 'checked');
  assert.equal(switchTrack({ name: 'X', track: 'inhouse', status: 'inquiry' }, 'vendor').status, 'inquiry');
});

test('報價帶出的核對項目自動帶 track', () => {
  const rows = stockItemsFromQuote({ items: [
    { id: 'a', kind: 'addon', name: '三面帆布－雙廂降低版', price: 13500 },
    { id: 'b', kind: 'addon', name: '彈簧鋼板', price: 5500 },
  ] });
  assert.deepEqual(rows.map((r) => r.track), ['vendor', 'inhouse']);
});

test('尚缺配件清單：外包已回報、改裝部已安裝的不再列出', () => {
  const cases = [{ id: 'c1', status: 'active' }];
  const deals = [{ id: 'd1', caseId: 'c1', quoteId: 'q1', stockItems: [
    { id: 'a', name: '三面帆布', track: 'vendor', status: 'reported' },
    { id: 'b', name: '三面帆布2', track: 'vendor', status: 'checked' },
    { id: 'c', name: '彈簧鋼板', track: 'inhouse', status: 'installed' },
    { id: 'd', name: '尿素桶防撞桿', track: 'inhouse', status: 'todo' },
  ] }];
  assert.deepEqual(summarizeStock(deals, cases).map((g) => g.name).sort(), ['三面帆布2', '尿素桶防撞桿'].sort());
});

import { stockByCase, statusPatch } from './stock.js';

test('尚缺配件依客戶：交車日近的在前、7天內標急、外包→改裝部→贈品、做完的不列', () => {
  const now = new Date('2026-11-19T10:00:00');
  const cases = [
    { id: 'c1', status: 'active', clientName: '林德旺', desiredDeliveryDate: '2026-11-25' },
    { id: 'c2', status: 'active', clientName: '方樹', desiredDeliveryDate: '2026-12-20' },
    { id: 'c3', status: 'active', clientName: '沒排交車日' },
    { id: 'c4', status: 'completed', clientName: '已交車' },
  ];
  const deals = [
    { id: 'd2', caseId: 'c2', quoteId: 'q', clientName: '方樹', stockItems: [{ id: 'x', name: '彈簧鋼板', status: 'todo' }] },
    { id: 'd1', caseId: 'c1', quoteId: 'q', clientName: '林德旺', stockItems: [
      { id: 'g', name: '皮革套', gift: true, status: 'todo' },
      { id: 'a', name: '尿素桶防撞桿', status: 'todo' },
      { id: 'b', name: '三面帆布', status: 'inquiry' },
      { id: 'z', name: '做完的', track: 'inhouse', status: 'installed' },
    ] },
    { id: 'd3', caseId: 'c3', quoteId: 'q', clientName: '沒排交車日', stockItems: [{ id: 'y', name: 'Y', status: 'todo' }] },
    { id: 'd4', caseId: 'c4', quoteId: 'q', stockItems: [{ id: 'w', name: 'W', status: 'todo' }] },
  ];
  const list = stockByCase(deals, cases, now);
  assert.deepEqual(list.map((c) => c.clientName), ['林德旺', '方樹', '沒排交車日']);
  assert.equal(list[0].urgent, true);
  assert.equal(list[1].urgent, false);
  assert.deepEqual(list[0].rows.map((r) => r.name), ['三面帆布', '尿素桶防撞桿', '皮革套']);
  assert.equal(list[0].missing, 3);
});

test('改成已聯繫廠商／已叫貨時自動排再追日，其他狀態不動日期', () => {
  assert.deepEqual(statusPatch({}, 'inquiry', '2026-11-22'), { status: 'inquiry', followUpDate: '2026-11-22' });
  assert.deepEqual(statusPatch({ followUpDate: '2026-11-20' }, 'inquiry', '2026-11-22'), { status: 'inquiry' });
  assert.deepEqual(statusPatch({}, 'ready', '2026-11-22'), { status: 'ready' });
});

test('依配件分區：外包照帆布／尾門／烤漆…分，改裝部看型錄分類；等車中不算急、不催再追日', async () => {
  const { stockByCase, stockByKind, stockKind, stockAlert } = await import('./stock.js');
  const deals = [
    { id: 'd1', caseId: 'k1', quoteId: 'q1', clientName: '楊老闆', stockItems: [
      { id: 'a', name: '五面帆160CM +蓬頂', status: 'todo', track: 'vendor' },
      { id: 'b', name: '貨斗LED定位燈', status: 'todo', catalogId: 'qa-cargo-led-marker' },
      { id: 'c', name: 'Logo(烤漆改黑)', status: 'todo', track: 'vendor' } ] },
    { id: 'd2', caseId: 'k2', quoteId: 'q2', clientName: '王小姐', stockItems: [
      { id: 'd', name: '三面帆布', status: 'inquiry', track: 'vendor' } ] },
  ];
  const cases = [
    { id: 'k1', status: 'active', awaitingCar: true, expectedCarMonth: '2026-12', desiredDeliveryDate: '2026-11-22' },
    { id: 'k2', status: 'active', desiredDeliveryDate: '2026-11-25' },
  ];
  const now = new Date('2026-11-20T08:00:00');
  const entries = stockByCase(deals, cases, now);
  assert.equal(entries.find((e) => e.caseId === 'k1').urgent, false); // 等車中就算交車日近也不標急
  assert.equal(entries.find((e) => e.caseId === 'k1').awaiting, true);
  assert.equal(entries.find((e) => e.caseId === 'k2').urgent, true);
  const groups = stockByKind(entries);
  assert.deepEqual(groups.map((g) => g.label), ['帆布', '烤漆／改色', '燈組']);
  assert.deepEqual(groups[0].rows.map((r) => r.clientName), ['王小姐', '楊老闆']); // 急的客戶排前面
  assert.equal(stockKind({ name: '一般手機架組' }).track, 'inhouse');
  assert.equal(stockAlert(deals[0], cases[0], now).deliveryRisk, false);
  assert.equal(stockAlert(deals[0], { ...cases[0], awaitingCar: false }, now).deliveryRisk, true);
});

test('「其他費用」裡自己打的外包配件（帆布、尾門…）也要列進配件核對；領牌費不要；舊成交可補列', async () => {
  const { stockItemsFromQuote, unlistedStockItems } = await import('./stock.js');
  const quote = { items: [
    { id: 'v', kind: 'vehicle', name: '車輛售價', price: 888000 },
    { id: 'c', kind: 'other', name: '五面帆160CM +蓬頂(帆布往內鎖)', price: 20000 },
    { id: 'f', kind: 'other', name: '領牌費', price: 3000 },
    { id: 'a', kind: 'addon', name: '前下巴套件', price: 9500 },
  ] };
  const items = stockItemsFromQuote(quote);
  assert.deepEqual(items.map((row) => row.id), ['c', 'f', 'a']); // 領牌費也帶進來，但當報價資訊
  assert.equal(items[0].track, 'vendor');
  assert.equal(items[0].info, undefined);
  assert.equal(items[1].info, true);
  // 舊成交：核對表只有前下巴 → 只補帆布，不碰已經有的
  const deal = { quoteId: 'q1', stockItems: [{ id: 'a', name: '前下巴套件', status: 'ready' }] };
  assert.deepEqual(unlistedStockItems(deal, quote).map((row) => row.id), ['c', 'f']);
  assert.deepEqual(unlistedStockItems({ ...deal, stockItems: [...deal.stockItems, items[0]] }, quote).map((row) => row.id), ['f']);
  // 使用者刪掉的不會再提示
  assert.deepEqual(unlistedStockItems({ ...deal, stockRemoved: ['f'] }, quote).map((row) => row.id), ['c']);
});
