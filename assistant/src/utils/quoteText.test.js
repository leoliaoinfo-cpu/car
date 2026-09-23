import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuoteMessage, compactQuoteItemName, formatWan } from './quoteText.js';

test('formats quote money in ten-thousand units without trailing zeroes', () => {
  assert.equal(formatWan(858000), '85.8萬');
  assert.equal(formatWan(30000), '3萬');
  assert.equal(formatWan(5000), '0.5萬');
});

test('shortens catalog names for a conversational LINE quote', () => {
  assert.equal(compactQuoteItemName('特仕版套件（行車紀錄器/GPS/踏墊/晴雨窗/隔熱紙…）'), '特仕版套件');
  assert.equal(compactQuoteItemName('升降尾門（2.5尺）'), '2.5呎升降尾門');
  assert.equal(compactQuoteItemName('H架（兩支一組）'), 'H架兩隻');
});

test('builds the requested LINE-ready quote including named discounts', () => {
  const message = buildQuoteMessage({
    customerName: '李老闆',
    model: '單廃3人座 5速手自排',
    modelYear: 2027,
    items: [
      { id: 'v', kind: 'vehicle', name: '車輛售價', price: 858000 },
      { id: 'a', kind: 'addon', name: '特仕版套件（行車紀錄器/GPS/踏墊/晴雨窗/隔熱紙…）', price: 30000 },
      { id: 'b', kind: 'addon', name: '6輪胎壓偵測器', price: 5000 },
      { id: 'c', kind: 'addon', name: '升降尾門（2.5尺）', price: 37000 },
      { id: 'd', kind: 'addon', name: '尿素桶防撞桿', price: 5000 },
      { id: 'e', kind: 'addon', name: 'H架（兩支一組）', price: 9000 },
    ],
    generalDiscounts: [
      { id: 'g1', name: '專案折扣', amount: 22000 },
      { id: 'g2', name: '預購折扣', amount: 20000 },
    ],
  });
  assert.equal(message, `李老闆您好，目前方案整理如下：

2027年式 單廃3人座 5速手自排　85.8萬
特仕版套件　+3萬
6輪胎壓偵測器　+0.5萬
2.5呎升降尾門　+3.7萬
尿素桶防撞桿　+0.5萬
H架兩隻　+0.9萬
----------

原價總計：94.4萬
專案折扣-2.2萬
預購折扣-2萬
-------

優惠合計：4.2萬
專案成交價：90.2萬`);
});
