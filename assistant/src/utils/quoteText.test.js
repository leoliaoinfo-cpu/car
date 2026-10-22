import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuoteMessage, compactQuoteItemName, formatVehicleSpec, formatWan } from './quoteText.js';

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

test('formats the vehicle model as a readable two-line heading', () => {
  assert.equal(formatVehicleSpec('大單廂3人座 5速手自排'), '大單廂 3 人座｜5 速手自排');
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

2027 年式 KIA 卡旺 K2500
單廃3人座｜5 速手自排

車輛售價：85.8 萬
特仕版套件：+3 萬
6輪胎壓偵測器：+0.5 萬
2.5呎升降尾門：+3.7 萬
尿素桶防撞桿：+0.5 萬
H架兩隻：+0.9 萬
----------
原價總計：94.4 萬
----------
專案折扣：-2.2 萬
預購折扣：-2 萬

✅ 最終優惠成交價：90.2 萬元`);
});

test('shows gifts clearly in the LINE quote and excludes them from the payable total', () => {
  const message = buildQuoteMessage({
    customerName: '王老闆',
    items: [
      { id: 'a', kind: 'addon', name: '手機架', price: 3000, gift: true },
      { id: 'b', kind: 'addon', name: '清潔組', price: 0, gift: true },
      { id: 'c', kind: 'addon', name: '尾門遙控', price: 2000 },
    ],
  });
  assert.match(message, /🎁 手機架（價值 3,000 元）/);
  assert.match(message, /🎁 清潔組/);
  assert.match(message, /原價總計：0\.2 萬/);
  assert.match(message, /最終優惠成交價：0\.2 萬元/);
  assert.match(message, /車價折扣加上贈品，總優惠 3,000 元/);
  assert.doesNotMatch(message, /手機架優惠/);
});

test('builds the exact K2500 proposal math without adding gift value into the sale total', () => {
  const message = buildQuoteMessage({
    customerName: '柳老闆',
    model: '大單廂3人座 5速手自排',
    modelYear: 2027,
    items: [
      { id: 'v', kind: 'vehicle', name: '車輛售價', price: 888000 },
      { id: 'pkg', kind: 'addon', name: '特仕版套件', price: 30000 },
      { id: 'safety', kind: 'addon', name: '安全科技版', price: 40000 },
      { id: 'gate', kind: 'addon', name: '升降尾門（2.5尺）', price: 37000 },
      { id: 'remote', kind: 'addon', name: '尾門遙控', price: 2000 },
      { id: 'step', kind: 'addon', name: '尾門腳踏', price: 1000 },
      { id: 'leaf', kind: 'addon', name: '彈簧鋼板', price: 5500 },
      { id: 'gift', kind: 'addon', name: '抗震優力膠', price: 7800, gift: true,
        description: '搭配彈簧鋼板，進一步強化懸吊緩衝配置，讓工作用車的底盤配置更完整' },
    ],
    generalDiscounts: [
      { name: '10 月訂車預購優惠', amount: 20000 },
      { name: '公司優惠折扣', amount: 30000 },
      { name: '另外再幫您去尾數', amount: 3500 },
    ],
  });
  assert.match(message, /原價總計：100\.35 萬/);
  assert.match(message, /10 月訂車預購優惠：-2 萬/);
  assert.match(message, /公司優惠折扣：-3 萬/);
  assert.match(message, /另外再幫您去尾數：-0\.35 萬/);
  assert.match(message, /✅ 最終優惠成交價：95 萬元/);
  assert.match(message, /🎁 抗震優力膠（價值 7,800 元）/);
  assert.match(message, /車價折扣加上贈品，總優惠 61,300 元/);
});
