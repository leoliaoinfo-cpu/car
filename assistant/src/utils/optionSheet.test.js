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
  assert.equal(s.items.bogus.on, true); // 保留所有 id（使用者可能刪過格式，舊資料不能丟）
  assert.equal(sheetHasContent(s), true);
});

import { DEFAULT_LAYOUT, normalizeLayout, layoutToBoxes, layoutItems } from './optionSheet.js';

test('預設格式轉成畫面用的框，和紙本一致（6 框 43 項，帆布框 6 列）', () => {
  const boxes = layoutToBoxes(DEFAULT_LAYOUT);
  assert.equal(boxes.length, 6);
  assert.equal(layoutItems(DEFAULT_LAYOUT).length, 43);
  assert.equal(boxes[4].rows.length, 6);
  assert.deepEqual(boxes[4].rows[1].map((x) => x[1]), ['彈簧片', '尾門遙控器']);
});

test('自訂格式：改名、新增有填寫線的項目、刪除；空白名稱會被丟掉', () => {
  const layout = normalizeLayout({ boxes: [
    { id: 'x', items: [{ id: 'a', label: '  行車紀錄器  ', note: false, sameRow: true }, { id: 'b', label: '', note: true }, { id: 'c', label: '遮陽簾', note: true, sameRow: true }] },
  ] });
  const items = layoutItems(layout);
  assert.deepEqual(items.map((x) => x.label), ['行車紀錄器', '遮陽簾']);
  assert.equal(items[0].sameRow, false); // 第一項不能「接上一項」
  assert.equal(items[1].note, true);
  assert.deepEqual(layoutToBoxes(layout)[0].rows.map((r) => r.length), [2]);
});

test('壞掉或沒有設定就用預設；重複 id 會自動換新', () => {
  assert.equal(normalizeLayout(null), DEFAULT_LAYOUT);
  assert.equal(normalizeLayout({ boxes: 'x' }), DEFAULT_LAYOUT);
  const l = normalizeLayout({ boxes: [{ id: 'a', items: [{ id: 'same', label: 'A' }, { id: 'same', label: 'B' }] }] });
  const ids = layoutItems(l).map((x) => x.id);
  assert.equal(new Set(ids).size, 2);
});

test('刪掉項目後，舊案件已勾的資料仍保留；帶入時自訂項目用名稱比對，預設項被刪就改寫進客戶需求', () => {
  const sheet = normalizeSheet({ items: { rain: { on: true, note: '' } } });
  assert.equal(sheet.items.rain.on, true); // 即使目前格式沒有這項也不丟
  const layout = normalizeLayout({ boxes: [{ id: 'a', items: [{ id: 'u1', label: '底盤除鏽', note: true }, { id: 'tint', label: '隔熱紙', note: true }] }] });
  const r = prefillFromQuote(emptySheet(), { items: [
    { id: '1', kind: 'addon', name: '底盤除鏽處理', price: 8000, note: '全車' },
    { id: '2', kind: 'addon', name: '尿素桶防撞桿', price: 5500 }, // 預設有規則，但格式裡已刪掉
  ] }, layout);
  assert.equal(r.sheet.items.u1.on, true);
  assert.deepEqual(r.unmatched, ['尿素桶防撞桿']);
  assert.match(r.sheet.needs.text, /尿素桶防撞桿/);
});

test('9吋安卓機（四錄／環景擇一）：依選擇只勾對應那一格', async () => {
  const { matchSheetIds } = await import('./optionSheet.js');
  const base = { catalogId: 'qa-android-surround', name: '9吋安卓機＋四錄／環景（擇一）＋專用底座' };
  assert.deepEqual(matchSheetIds({ ...base, optionValue: '四錄' }), ['android-4rec']);
  assert.deepEqual(matchSheetIds({ ...base, optionValue: '環景' }), ['android-around']);
  // 舊報價（舊名稱、沒選規格）維持原本的比對
  const old = matchSheetIds({ catalogId: 'qa-android-surround', name: '安卓＋四錄＆環景＋專用底座' });
  assert.ok(old.includes('android-4rec') && old.includes('android-around'));
});

test('安全科技版：四錄／環景擇一，只勾對應那一格並加胎壓；舊報價維持原樣', async () => {
  const { matchSheetIds } = await import('./optionSheet.js');
  const base = { catalogId: 'qa-pkg2', name: '安全科技版（9吋安卓機 四錄／環景擇一＋6輪胎壓）' };
  assert.deepEqual(matchSheetIds({ ...base, optionValue: '四錄' }), ['android-4rec', 'tpms6']);
  assert.deepEqual(matchSheetIds({ ...base, optionValue: '環景' }), ['android-around', 'tpms6']);
  const old = matchSheetIds({ catalogId: 'qa-pkg2', name: '安全科技版（安卓四錄+360環景+六輪胎壓）' });
  assert.deepEqual(old.sort(), ['android-4rec', 'android-around', 'tpms6'].sort());
});

test('配件備註與中央備註都會帶進選配表：寫得進項目後面的線就寫線上，寫不進的放客戶需求，不重複', () => {
  const quote = { note: '交車前全部裝好', items: [
    { id: 'v', kind: 'vehicle', name: '車輛售價', price: 888000, note: '領牌人 莊天旗' },
    { id: 'c', kind: 'addon', name: '三面帆布－雙廂降低版', price: 13500, note: '黑色' },
    { id: 's', kind: 'addon', name: '安全科技版', price: 48800, optionValue: '四錄', note: '升級12.3吋安卓旗艦機' },
    { id: 'g', kind: 'addon', name: 'GTR-plus 魚眼大燈（黑化）', price: 28900, note: '要黑化' },
  ] };
  const { sheet } = prefillFromQuote(emptySheet(), quote);
  assert.match(sheet.items.canvas.note, /黑色/);
  assert.doesNotMatch(sheet.needs.text, /帆布.*黑色/);
  assert.match(sheet.needs.text, /車輛售價：領牌人 莊天旗/);
  assert.equal(sheet.items['android-4rec'].note, '升級12.3吋安卓旗艦機');
  assert.match(sheet.needs.text, /GTR-plus 魚眼大燈（黑化）：要黑化/);
  assert.match(sheet.needs.text, /^①/);
  assert.match(sheet.needs.text, /\n②/);
  assert.match(sheet.needs.text, /備註：交車前全部裝好/);
  const again = prefillFromQuote(sheet, quote).sheet;
  assert.equal(again.needs.text, sheet.needs.text);
});

test('選牌號碼從品名或備註帶進「選牌」欄；已填的不覆蓋', () => {
  assert.equal(prefillFromQuote(emptySheet(), { items: [{ id: 'p', kind: 'other', name: '選牌(7275)', price: 2000 }] }).sheet.plate.text, '7275');
  const r = prefillFromQuote(emptySheet(), { note: '選牌7275，交車時與領牌費一起處理', items: [] }).sheet;
  assert.deepEqual(r.plate, { on: true, text: '7275' });
  const kept = normalizeSheet({ plate: { on: true, text: '6655' } });
  assert.equal(prefillFromQuote(kept, { note: '選牌7275', items: [] }).sheet.plate.text, '6655');
});

test('沒有填寫線的項目，備註直接寫在旁邊（自動加線），不再擠進客戶需求', async () => {
  const { sheetBoxes } = await import('./optionSheet.js');
  const { sheet } = prefillFromQuote(emptySheet(), { items: [
    { id: 'h', kind: 'addon', name: 'HALO 光環尾燈組（卡旺專用原車直上）', price: 11800, note: '燻黑' },
    { id: 'm', kind: 'addon', name: '一般手機架組', price: 1300 },
  ] });
  assert.equal(sheet.items['halo'].note, '燻黑');
  assert.doesNotMatch(sheet.needs.text, /燻黑/);
  const rows = sheetBoxes(null, sheet).flatMap((b) => b.rows.flat());
  assert.equal(rows.find(([id]) => id === 'halo')[2], true);
  assert.equal(rows.find(([id]) => id === 'phone')[2], false);
});

test('套裝備註拆成一點一點，提到哪一項就寫在那一項旁邊（楊老闆：橡膠墊、行車紀錄器、安卓）', async () => {
  const { splitNoteSegments } = await import('./optionSheet.js');
  assert.deepEqual(splitNoteSegments('1.九吋安卓機升級成12.3吋安卓旗艦機\n2.橡膠墊全封，底板用矽利康封起來\n3.刪掉前後行車紀錄器換成中央置物盒'),
    ['九吋安卓機升級成12.3吋安卓旗艦機', '橡膠墊全封，底板用矽利康封起來', '刪掉前後行車紀錄器換成中央置物盒']);
  assert.deepEqual(splitNoteSegments('1.A 2.B'), ['A', 'B']);
  const quote = { note: '選牌7275，交車時與領牌費一起處理', items: [
    { id: 'p1', kind: 'addon', name: '特仕版套件', price: 30000 },
    { id: 's', kind: 'addon', name: '安全科技版', price: 48800, optionValue: '四錄',
      note: '1.九吋安卓機升級成12.3吋安卓旗艦機\n2.橡膠墊全封，底板用矽利康封起來\n3.刪掉前後行車紀錄器換成中央置物盒' },
  ] };
  const { sheet } = prefillFromQuote(emptySheet(), quote);
  assert.equal(sheet.items.rubber.note, '橡膠墊全封，底板用矽利康封起來');
  assert.equal(sheet.items.recorder.note, '刪掉前後行車紀錄器換成中央置物盒');
  assert.equal(sheet.items['android-4rec'].note, '九吋安卓機升級成12.3吋安卓旗艦機');
  assert.doesNotMatch(sheet.needs.text, /矽利康|行車紀錄器|旗艦機/);
  assert.match(sheet.needs.text, /備註：選牌7275/);
  const again = prefillFromQuote(sheet, quote).sheet;
  assert.equal(again.items.rubber.note, sheet.items.rubber.note);
  assert.equal(again.needs.text, sheet.needs.text);
});

test('其他費用裡的客製帆布也會勾帆布並寫完整品名；領牌費照舊不進', () => {
  const { sheet, unmatched } = prefillFromQuote(emptySheet(), { items: [
    { id: 'c', kind: 'other', name: '五面帆160CM +蓬頂(帆布往內鎖)', price: 20000 },
    { id: 'f', kind: 'other', name: '領牌費', price: 3000 },
  ] });
  assert.equal(sheet.items.canvas.on, true);
  assert.equal(sheet.items.canvas.note, '五面帆160CM +蓬頂(帆布往內鎖)');
  assert.deepEqual(unmatched, []);
  assert.equal(sheet.needs.text, '');
});
