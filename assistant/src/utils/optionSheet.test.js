import test from 'node:test';
import assert from 'node:assert/strict';
import { prefillFromQuote, emptySheet, normalizeSheet, rocDate, matchSheetIds, ALL_SHEET_ITEMS, sheetHasContent } from './optionSheet.js';

test('民國日期格式', () => {
  assert.equal(rocDate(new Date(2026, 10, 6)), '115.11.06');
});

test('紙本上的每個勾選項都存在（共 45 項不重複）', () => {
  const ids = ALL_SHEET_ITEMS.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const label of ['前後行車紀錄器', '晴雨窗', '倒車蜂鳴器', '隔熱紙', '橡膠墊', 'LED燈組全套', 'LED頭燈', 'LED霧燈', '室內燈+牌照燈', '側邊照地燈', 'LED後照鏡',
    '安卓+四錄', '安卓+環景', '6輪胎壓', '定速', '音控', '後防撞桿', '雙廂側踏組', '4WD下護板', '貨斗延伸護欄', '尾門', '彈簧片', '尾門遙控器', '花板', 'H架', '帆布', '鋁塑箱', '順風板', '行李架', '下護欄',
    '前下巴', '方向燈白殼', '後照鏡保護殼', '音響升級', '警示喇叭', 'TS避震器', '光環尾燈', 'OG鋁圈', '魚眼霧燈', '車身烤漆', '手機架組', '2寶']) {
    assert.ok(ids.length && ALL_SHEET_ITEMS.some((x) => x.label === label), label);
  }
});

test('特仕版帶入 5 項，客人不要的扣項不勾', () => {
  const { sheet } = prefillFromQuote(emptySheet(), { items: [
    { id: 'a', kind: 'addon', catalogId: 'qa-pkg1', name: '特仕版套件（行車紀錄器/GPS/踏墊/晴雨窗/隔熱紙…）', price: 27000, deductions: [{ name: '電子式前後行車紀錄器', amount: 3000 }] },
  ] });
  assert.equal(sheet.items.recorder?.on, undefined);
  for (const id of ['rain', 'buzzer', 'tint', 'rubber']) assert.equal(sheet.items[id].on, true, id);
});

test('安全科技版、帆布顏色備註、烤漆顏色、車型帶入', () => {
  const { sheet } = prefillFromQuote(emptySheet(), { model: '雙廂6人座 5速手自排', items: [
    { id: 's', kind: 'addon', name: '安全科技版（安卓四錄+360環景+六輪胎壓）', price: 40000 },
    { id: 'c', kind: 'addon', name: '三面帆布－雙廂降低版', price: 13500, note: '黑色' },
    { id: 'p', kind: 'addon', name: '車身烤漆改色', price: 39000, optionValue: '冰川水泥灰' },
  ] });
  assert.equal(sheet.items['android-4rec'].on, true);
  assert.equal(sheet.items.tpms6.on, true);
  assert.equal(sheet.items.canvas.on, true);
  assert.match(sheet.items.canvas.note, /黑色/);
  assert.equal(sheet.items.paint.note, '冰川水泥灰');
  assert.match(sheet.model, /雙廂/);
});

test('比對不到的品名寫進客戶需求，不會默默消失；已勾的不會被取消', () => {
  let sheet = emptySheet();
  sheet.items.canvas = { on: true, note: '手動' };
  const r = prefillFromQuote(sheet, { items: [
    { id: 'g', kind: 'addon', name: 'GTR-plus 魚眼大燈', price: 28900 },
    { id: 'f', kind: 'other', name: '領牌費', price: 3000 },
  ] });
  assert.deepEqual(r.unmatched, ['GTR-plus 魚眼大燈']);
  assert.match(r.sheet.needs.text, /GTR-plus 魚眼大燈/);
  assert.equal(r.sheet.needs.on, true);
  assert.equal(r.sheet.items.canvas.on, true);
  const again = prefillFromQuote(r.sheet, { items: [{ id: 'g', kind: 'addon', name: 'GTR-plus 魚眼大燈', price: 1 }] });
  assert.equal(again.sheet.needs.text.split('GTR-plus').length - 1, 1);
});

test('LED 霧燈與魚眼霧燈不混淆', () => {
  assert.deepEqual(matchSheetIds({ name: 'LED 霧燈' }), ['led-fog']);
  assert.deepEqual(matchSheetIds({ name: '魚眼霧燈升級' }), ['fish-fog']);
});

test('整理舊資料與空表判斷', () => {
  assert.equal(sheetHasContent(emptySheet()), false);
  const s = normalizeSheet({ color: '白', items: { rain: { on: true }, bogus: { on: true } } });
  assert.equal(s.items.bogus, undefined);
  assert.equal(sheetHasContent(s), true);
});
