// 📋 卡旺選配表：照公司紙本確認表一模一樣的格式（每台車一張）。
// 勾選與備註存在案件上（case.optionSheet），使用者自己點選；也可以「依報價帶入」當起手式，之後仍可自己改。
import { DEFAULT_QUOTE_PRESETS } from './crm.js';

// 每個框是一欄；rows 裡每一列可放 1～3 個項目（對應紙本同一行）。note:true 表示項目後面有一條可填的線。
export const SHEET_BOXES = [
  { id: 'b1', rows: [[['recorder', '前後行車紀錄器']], [['rain', '晴雨窗']], [['buzzer', '倒車蜂鳴器']], [['tint', '隔熱紙', true]], [['rubber', '橡膠墊', true]]] },
  { id: 'b2', rows: [[['led-set', 'LED燈組全套'], ['led-head', 'LED頭燈']], [['led-fog', 'LED霧燈', true]], [['led-inner', '室內燈+牌照燈']], [['led-side', '側邊照地燈']], [['led-mirror', 'LED後照鏡', true]]] },
  { id: 'b3', rows: [[['android-4rec', '安卓+四錄']], [['android-around', '安卓+環景']], [['tpms6', '6輪胎壓']], [['cruise', '定速']], [['media', '音控']]] },
  { id: 'b4', rows: [[['urea', '尿素桶防撞桿', true]], [['rear-bar', '後防撞桿']], [['step', '雙廂側踏組']], [['guard4wd', '4WD下護板']], [['rail', '貨斗延伸護欄']]] },
  { id: 'b5', rows: [[['tailgate', '尾門', true]], [['leaf', '彈簧片', true], ['remote', '尾門遙控器']], [['plate', '花板', true], ['hrack', 'H架', true]], [['canvas', '帆布', true]], [['alubox', '鋁塑箱', true]], [['wind', '順風板'], ['rack', '行李架'], ['skirt', '下護欄']]] },
  { id: 'b6', rows: [[['chin', '前下巴'], ['turnshell', '方向燈白殼']], [['mirrorcover', '後照鏡保護殼', true]], [['audio', '音響升級'], ['horn', '警示喇叭']], [['ts', 'TS避震器'], ['halo', '光環尾燈']], [['og', 'OG鋁圈']], [['fish-fog', '魚眼霧燈']], [['paint', '車身烤漆', true]], [['phone', '手機架組'], ['two', '2寶']]] },
];
// 紙本最上方 3 欄各自對應的框（左右兩欄）：b1|b2、b3|b4、b5|b6
export const SHEET_BOX_PAIRS = [['b1', 'b2'], ['b3', 'b4'], ['b5', 'b6']];

export const ALL_SHEET_ITEMS = SHEET_BOXES.flatMap((box) => box.rows.flat().map(([id, label, note]) => ({ id, label, note: !!note })));
const LABEL_OF = Object.fromEntries(ALL_SHEET_ITEMS.map((x) => [x.id, x.label]));

/** 民國日期，例如 115.11.06 */
export function rocDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear() - 1911}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

export function emptySheet(base = {}) {
  return {
    date: base.date || rocDate(), owner: base.owner || '', color: '', agent: base.agent || '', model: base.model || '',
    loan: { on: false, text: '' }, cash: { on: false, text: '' }, vin: '',
    items: {}, trade: false, plate: { on: false, text: '' }, needs: { on: false, text: '' },
  };
}

export function normalizeSheet(sheet, base = {}) {
  const e = emptySheet(base);
  const s = sheet && typeof sheet === 'object' ? sheet : {};
  const items = {};
  for (const [id, v] of Object.entries(s.items || {})) {
    if (LABEL_OF[id] && v) items[id] = { on: !!v.on, note: String(v.note || '') };
  }
  const flag = (v) => ({ on: !!v?.on, text: String(v?.text || '') });
  return {
    date: String(s.date || e.date), owner: String(s.owner ?? e.owner), color: String(s.color || ''), agent: String(s.agent ?? e.agent), model: String(s.model ?? e.model),
    loan: flag(s.loan), cash: flag(s.cash), vin: String(s.vin || ''),
    items, trade: !!s.trade, plate: flag(s.plate), needs: flag(s.needs),
  };
}

export function sheetHasContent(sheet) {
  if (!sheet) return false;
  return Object.values(sheet.items || {}).some((v) => v.on || v.note) || !!(sheet.color || sheet.vin || sheet.trade || sheet.plate?.on || sheet.needs?.on || sheet.needs?.text);
}

// ── 依報價帶入：用品名關鍵字比對（比對不到的放進「客戶需求」，絕不默默丟掉）──────────────
const RULES = [
  ['recorder', /行車紀錄/], ['rain', /晴雨窗/], ['buzzer', /蜂鳴/], ['tint', /隔熱紙/], ['rubber', /橡膠墊|橡膠底板/],
  ['led-set', /LED\s*燈組全套|全車\s*LED/i], ['led-head', /LED\s*頭燈/i], ['led-fog', /LED\s*霧燈/i], ['led-inner', /室內燈|牌照燈/], ['led-side', /照地燈/], ['led-mirror', /LED.*後照鏡|韓版後照鏡/i],
  ['android-4rec', /安卓.*四錄|四錄/], ['android-around', /環景/], ['tpms6', /胎壓/], ['cruise', /定速/], ['media', /音控/],
  ['urea', /尿素/], ['rear-bar', /後防撞|車尾防撞|防撞鋼樑/], ['step', /側踏/], ['guard4wd', /4WD.*護板|下護板/i], ['rail', /延伸護欄|貨斗護欄/],
  ['remote', /尾門遙控/], ['tailgate', /升降尾門|雙折尾門|尾門（|尾門\(/], ['leaf', /彈簧鋼板|彈簧片|支撐彈簧/], ['plate', /花板|錏花/], ['hrack', /H\s*架/i],
  ['canvas', /帆布/], ['alubox', /鋁塑箱|冷凍冷藏箱|箱體/], ['wind', /順風板|導流板/], ['rack', /行李架|行李籃|橫桿/], ['skirt', /下護欄/],
  ['chin', /前下巴/], ['turnshell', /方向燈殼|方向燈白殼/], ['mirrorcover', /鏡蓋|後照鏡飾蓋|保護殼/], ['audio', /音響|高音喇叭|喇叭改裝/], ['horn', /警示喇叭/],
  ['ts', /\bTS\b|避震/i], ['halo', /光環尾燈|LED\s*尾燈|HALO/i], ['og', /鋁圈|OMEGA|\bOG\b/i], ['fish-fog', /魚眼霧燈/], ['paint', /烤漆|改色|車身顏色/], ['phone', /手機架/],
];
// 套裝名稱 → 展開成選配表上的項目
const PACKAGES = [
  [/特仕版/, ['recorder', 'rain', 'buzzer', 'tint', 'rubber']],
  [/安全科技版/, ['android-4rec', 'android-around', 'tpms6']],
  [/原裝多功能方向盤/, ['cruise', 'media']],
  [/NLD空力套裝|空力套裝/, ['chin', 'turnshell', 'mirrorcover']],
];
// 扣項名稱（客人不要的）→ 對應的選配表項目
function deductedIds(item) {
  const out = new Set();
  for (const row of item.deductions || []) {
    const name = String(row?.name || '');
    for (const [id, re] of RULES) if (re.test(name)) out.add(id);
    if (/GPS|踏墊/.test(name)) continue;
  }
  return out;
}

function noteOf(item) {
  const parts = [item.optionValue, item.note].map((x) => String(x || '').trim()).filter(Boolean);
  return parts.join('，');
}

export function matchSheetIds(item) {
  const name = String(item?.name || '');
  const catalogName = DEFAULT_QUOTE_PRESETS.addons?.find((a) => a.id === item?.catalogId)?.name || '';
  const text = `${name} ${catalogName}`;
  const pkg = PACKAGES.find(([re]) => re.test(text));
  if (pkg) return pkg[1];
  const hit = RULES.filter(([, re]) => re.test(text)).map(([id]) => id);
  // 「魚眼霧燈」會同時符合「LED 霧燈」之外的規則，這裡以較具體的為準
  if (hit.includes('led-fog') && hit.includes('fish-fog')) return hit.filter((id) => id !== 'led-fog');
  // 後照鏡保護殼 與 LED 後照鏡 不重複
  if (hit.includes('led-mirror') && hit.includes('mirrorcover')) return hit.filter((id) => id !== 'mirrorcover');
  return hit;
}

/**
 * 由報價帶入勾選。只「補勾、補備註」，不會把你已經勾好的取消；比對不到的品名放進客戶需求。
 * 回傳新的 sheet 與比對不到的品名清單。
 */
export function prefillFromQuote(sheet, quote) {
  const next = normalizeSheet(sheet);
  const items = { ...next.items };
  const unmatched = [];
  for (const item of quote?.items || []) {
    if (!String(item?.name || '').trim() || item.kind === 'vehicle' || item.pending) continue;
    if (item.kind === 'other') continue; // 領牌費、保險等不是選配
    const ids = matchSheetIds(item);
    if (!ids.length) { unmatched.push(String(item.name).trim()); continue; }
    const cut = deductedIds(item);
    const note = noteOf(item);
    const isPkg = ids.length > 1 || PACKAGES.some(([re]) => re.test(String(item.name)));
    for (const id of ids) {
      if (cut.has(id)) continue;
      const cur = items[id] || { on: false, note: '' };
      const def = ALL_SHEET_ITEMS.find((x) => x.id === id);
      items[id] = { on: true, note: cur.note || (def?.note && !isPkg ? (note || (['tailgate', 'canvas', 'alubox', 'hrack', 'plate', 'leaf'].includes(id) ? String(item.name).trim() : '')) : '') };
    }
  }
  next.items = items;
  if (quote?.model && !next.model) next.model = String(quote.model).replace(/^2027\s*年式\s*/, '').trim();
  if (unmatched.length) {
    const line = `其他：${unmatched.join('、')}`;
    if (!next.needs.text.includes(line)) next.needs = { on: true, text: [next.needs.text, line].filter(Boolean).join('\n') };
  }
  return { sheet: next, unmatched };
}

export function itemLabel(id) { return LABEL_OF[id] || id; }
