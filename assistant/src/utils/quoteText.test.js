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

test('LINE 報價分區：車輛本體、車斗、底盤、外觀燈光、車內、贈品與優惠', () => {
  const message = buildQuoteMessage({
    customerName: '王老闆',
    model: '雙廂6人座 5速手自排',
    modelYear: 2027,
    items: [
      { id: 'v', kind: 'vehicle', name: '車輛售價', price: 1038000 },
      { id: 'safety', kind: 'addon', catalogId: 'qa-pkg2', name: '安全科技版（安卓四錄+360環景+六輪胎壓）', price: 40000 },
      { id: 'pkg', kind: 'addon', catalogId: 'qa-pkg1', name: '特仕版套件（行車紀錄器/GPS/踏墊/晴雨窗/隔熱紙…）', price: 25000,
        deductions: [{ id: 'd1', name: '電子式前後行車紀錄器', amount: 3000 }, { id: 'd2', name: 'GPS 天眼測速', amount: 2000 }] },
      { id: 'gate', kind: 'addon', catalogId: 'qa-tailgate-25', name: '升降尾門（2.5尺）', price: 37000 },
      { id: 'urea', kind: 'addon', name: '尿素桶防撞桿', catalogId: 'qa-urea', price: 5500, note: '黑色' },
      { id: 'leaf', kind: 'addon', catalogId: 'qa-leaf', name: '彈簧鋼板', price: 5500 },
      { id: 'brake', kind: 'addon', catalogId: 'qa-brake-kit', name: '煞車劃線碟＋競技來令片', price: 15000 },
      { id: 'mirror', kind: 'addon', catalogId: 'qa-mirror1', name: 'LED 韓版後照鏡', price: 8500 },
      { id: 'media', kind: 'addon', catalogId: 'qa-media-controls', name: '多媒體音控', price: 12000 },
      { id: 'shade', kind: 'addon', catalogId: 'qa-k2500-sunshade', name: '卡旺專用遮陽簾', price: 1280 },
      { id: 'cruise', kind: 'addon', catalogId: 'qa-cruise', name: '定速巡航', price: 8000, gift: true },
      { id: 'cover', kind: 'addon', name: '卡旺方向盤皮革套', price: 499, gift: true },
    ],
    generalDiscounts: [{ id: 'g', name: '專案優惠', amount: 57000 }],
  });
  const at = (text) => message.indexOf(text);
  assert.ok(at('🚚 車輛本體') < at('📦 車斗配備'));
  assert.ok(at('📦 車斗配備') < at('🔧 底盤懸吊・煞車'));
  assert.ok(at('🔧 底盤懸吊・煞車') < at('✨ 外觀燈光'));
  assert.ok(at('✨ 外觀燈光') < at('🪑 車內配備'));
  assert.ok(at('🪑 車內配備') < at('🎁 贈品'));
  assert.ok(message.startsWith('王老闆您好，目前方案整理如下：\n\n2027 年式 KIA 卡旺 K2500\n雙廂 6 人座｜5 速手自排\n\n━━━━━━━━━━\n🚚 車輛本體\n━━━━━━━━━━\n・車輛售價：103.8 萬\n・安全科技版：+4 萬\n・特仕版套件：+2.5 萬\n　不含：電子式前後行車紀錄器＋GPS 天眼測速（已扣 0.5 萬）\n'));
  assert.match(message, /📦 車斗配備\n━+\n・2\.5呎升降尾門：\+3\.7 萬\n・尿素桶防撞桿：\+0\.55 萬\n　備註：黑色/);
  assert.match(message, /🔧 底盤懸吊・煞車\n━+\n・彈簧鋼板：\+0\.55 萬\n・煞車劃線碟＋競技來令片：\+1\.5 萬/);
  assert.match(message, /・LED 韓版後照鏡：\+0\.85 萬/);
  assert.match(message, /・多媒體音控：\+1\.2 萬\n・卡旺專用遮陽簾：\+0\.13 萬/);
  assert.match(message, /・定速巡航（價值 8,000 元，4 年保固）\n・卡旺方向盤皮革套（價值 499 元）/);
  // 原價含贈品價值，再以贈品優惠扣回，成交價不含贈品。
  assert.match(message, /原價總計：119\.63 萬/);
  assert.match(message, /專案優惠：-5\.7 萬\n贈品優惠：-0\.85 萬\n專案優惠加上贈品優惠，總優惠 65,499 元\n----------\n✅ 最終優惠成交價：113\.08 萬元$/);
});

test('沒有贈品也沒有優惠時，原價後直接接最終成交價', () => {
  const message = buildQuoteMessage({
    customerName: '李老闆',
    model: '單廂3人座 5速手自排',
    items: [
      { id: 'v', kind: 'vehicle', name: '車輛售價', price: 858000 },
      { id: 'b', kind: 'addon', catalogId: 'qa-tpms-6', name: '6輪胎壓偵測器', price: 5000 },
      { id: 'f', kind: 'other', name: '領牌費', price: 3000 },
    ],
  });
  assert.match(message, /🪑 車內配備\n━+\n・6輪胎壓偵測器：\+0\.5 萬/);
  assert.match(message, /📄 其他費用\n━+\n・領牌費：\+0\.3 萬/);
  assert.match(message, /原價總計：86\.6 萬\n----------\n✅ 最終優惠成交價：86\.6 萬元$/);
  assert.doesNotMatch(message, /🎁/);
});

test('只有贈品沒有其他優惠：列贈品優惠，不出現加總句', () => {
  const message = buildQuoteMessage({
    customerName: '王老闆',
    items: [
      { id: 'a', kind: 'addon', name: '手機架', price: 3000, gift: true },
      { id: 'b', kind: 'addon', name: '清潔組', price: 0, gift: true },
      { id: 'c', kind: 'addon', catalogId: 'qa-tailgate-remote', name: '尾門遙控', price: 2000 },
    ],
  });
  assert.match(message, /・手機架（價值 3,000 元）\n・清潔組\n/);
  assert.match(message, /原價總計：0\.5 萬/);
  assert.match(message, /贈品優惠：-0\.3 萬/);
  assert.match(message, /最終優惠成交價：0\.2 萬元/);
  assert.doesNotMatch(message, /專案優惠加上贈品優惠/);
});

test('includes the selected LED fog-light color in the customer message', () => {
  const message = buildQuoteMessage({
    items: [{ id: 'fog', kind: 'addon', name: 'LED 霧燈', price: 1800, optionValue: '黃金光' }],
  });
  assert.match(message, /LED 霧燈（黃金光）：\+0\.18 萬/);
});

test('項目備註會放在該項目下一行', () => {
  const message = buildQuoteMessage({
    items: [{ id: 'custom', kind: 'addon', backendCustom: true, name: '客製工具箱', price: 20000, note: '左側開門、霧黑色、長 120 cm' }],
  });
  assert.match(message, /・客製工具箱：\+2 萬\n　備註：左側開門、霧黑色、長 120 cm/);
});

test('套裝扣項合併成一行並顯示扣款合計', () => {
  const message = buildQuoteMessage({
    customerName: '王先生',
    model: '單廂3人座 6速手排',
    items: [
      { id: 'v', kind: 'vehicle', name: '車輛售價', price: 858000 },
      { id: 'a', kind: 'addon', catalogId: 'qa-pkg1', name: '特仕版套件（行車紀錄器/GPS/踏墊/晴雨窗/隔熱紙…）', price: 27000,
        deductions: [{ id: 'd1', name: '行車紀錄器', amount: 3000 }] },
    ],
  });
  assert.match(message, /・特仕版套件：\+2\.7 萬\n　不含：行車紀錄器（已扣 0\.3 萬）/);
});

test('LINE 報價有報價名稱時，放在問候語下面第一行；沒有就不出現', () => {
  const withPlan = buildQuoteMessage({ customerName: '王老闆', planName: 'A方案 (實用路線)', model: '雙廂6人座 5速手自排', items: [{ id: 'v', kind: 'vehicle', name: '車輛售價', price: 1038000 }] });
  assert.match(withPlan, /^王老闆您好，目前方案整理如下：\n\n【A方案 \(實用路線\)】\n2027 年式 KIA 卡旺 K2500/);
  const without = buildQuoteMessage({ customerName: '王老闆', model: '雙廂6人座 5速手自排', items: [{ id: 'v', kind: 'vehicle', name: '車輛售價', price: 1038000 }] });
  assert.doesNotMatch(without, /【/);
});
