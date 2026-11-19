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

// ── 可自訂的表單格式（layout）：使用者可新增／刪除／改名項目、決定哪些有填寫線、調整順序 ──────────
// layout = { boxes: [{ id, items: [{ id, label, note, sameRow }] }] }；sameRow=接在上一項同一行（一行最多 3 個）。
function boxesToLayout(boxes) {
  return {
    boxes: boxes.map((b) => ({
      id: b.id,
      items: b.rows.flatMap((row) => row.map(([id, label, note], i) => ({ id, label, note: !!note, sameRow: i > 0 }))),
    })),
  };
}
export const DEFAULT_LAYOUT = boxesToLayout(SHEET_BOXES);
const DEFAULT_IDS = new Set(SHEET_BOXES.flatMap((b) => b.rows.flat().map(([id]) => id)));

export function newItemId() { return `u-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; }

/** 整理自訂格式；沒有或壞掉就用預設。空白名稱的項目會被丟掉；每個項目 id 不重複。 */
export function normalizeLayout(layout) {
  const src = Array.isArray(layout?.boxes) ? layout : null;
  if (!src) return DEFAULT_LAYOUT;
  const seen = new Set();
  const boxes = [];
  src.boxes.forEach((b, bi) => {
    const items = [];
    for (const it of Array.isArray(b?.items) ? b.items : []) {
      const label = String(it?.label || '').trim();
      let id = String(it?.id || '');
      if (!label) continue;
      if (!id || seen.has(id)) id = newItemId();
      seen.add(id);
      items.push({ id, label: label.slice(0, 40), note: !!it.note, sameRow: !!it.sameRow && items.length > 0 });
    }
    boxes.push({ id: String(b?.id || `box${bi}`), items });
  });
  return { boxes };
}

/** layout → 畫面用的框（每框多列、每列 1～3 項） */
export function layoutToBoxes(layout) {
  return normalizeLayout(layout).boxes.map((b) => {
    const rows = [];
    for (const it of b.items) {
      const last = rows[rows.length - 1];
      if (it.sameRow && last && last.length < 3) last.push([it.id, it.label, it.note]);
      else rows.push([[it.id, it.label, it.note]]);
    }
    return { id: b.id, rows };
  });
}

/** 畫面／圖片用的框：項目有寫備註時，即使格式沒開「後面有填寫線」也自動加一條線，備註寫在旁邊。 */
export function sheetBoxes(layout, sheet) {
  const items = sheet?.items || {};
  return layoutToBoxes(layout).map((b) => ({
    ...b,
    rows: b.rows.map((row) => row.map(([id, label, note]) => [id, label, !!note || !!String(items[id]?.note || '').trim()])),
  }));
}

export function layoutItems(layout) { return normalizeLayout(layout).boxes.flatMap((b) => b.items); }

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
    if (v && typeof v === 'object') items[id] = { on: !!v.on, note: String(v.note || '') };
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
  ['canvas', /帆布|[二三四五]面帆|篷頂|蓬頂/], ['alubox', /鋁塑箱|冷凍冷藏箱|箱體/], ['wind', /順風板|導流板/], ['rack', /行李架|行李籃|橫桿/], ['skirt', /下護欄/],
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

/** 備註拆成一點一點：換行或「1. 2. 3.」分段，去掉前面的編號（12.3吋這種小數不會被拆）。 */
export function splitNoteSegments(note) {
  return String(note || '')
    .split(/\n|(?<!\d)(?=\d{1,2}[.、．](?!\d))/)
    .map((seg) => seg.replace(/^\s*(?:\d{1,2}[.、．]|[①-⑳])\s*/, '').replace(/[，,;；\s]+$/, '').trim())
    .filter(Boolean);
}

function findNoteTarget(seg, pkgIds, shown, visible, items) {
  const pick = (ids) => {
    const uniq = [...new Set(ids)];
    if (uniq.length === 1) return uniq[0];
    const on = uniq.filter((id) => items[id]?.on);
    return on.length === 1 ? on[0] : null;
  };
  const byLabel = shown.filter((x) => x.label && x.label.length >= 2 && seg.includes(x.label)).map((x) => x.id);
  if (byLabel.length) return pick(byLabel);
  const byRule = matchSheetIds({ name: seg }).filter((id) => visible.has(id));
  if (byRule.length) return pick(byRule);
  // 套裝自己的項目：名稱的片段（例「安卓+四錄」的「安卓」）出現在這一點裡
  const labelOf = new Map(shown.map((x) => [x.id, x.label]));
  const byPart = pkgIds.filter((id) => String(labelOf.get(id) || '').split(/[+＋/／、\s]/).some((part) => part.length >= 2 && seg.includes(part)));
  return byPart.length ? pick(byPart) : null;
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
function circledNumber(n) { return CIRCLED[n - 1] || `${n}.`; }

function compactName(name) {
  return String(name || '').replace(/[（(][^）)]*[）)]/g, '').trim() || String(name || '').trim();
}

function noteOf(item) {
  const parts = [item.optionValue, item.note].map((x) => String(x || '').trim()).filter(Boolean);
  return parts.join('，');
}

export function matchSheetIds(item) {
  const name = String(item?.name || '');
  const catalogName = DEFAULT_QUOTE_PRESETS.addons?.find((a) => a.id === item?.catalogId)?.name || '';
  const text = `${name} ${catalogName}`;
  // 9吋安卓機（四錄／環景擇一）：依客人選的是四錄還是環景，只勾對應那一格
  if (item?.catalogId === 'qa-android-surround' || /擇一.*專用底座/.test(name)) {
    if (/環景/.test(item?.optionValue || '')) return ['android-around'];
    if (/四錄/.test(item?.optionValue || '')) return ['android-4rec'];
    if (/擇一/.test(name)) return [];
  }
  // 安全科技版：四錄／環景擇一，其餘（胎壓）照給
  if (/安全科技版/.test(name)) {
    if (/環景/.test(item?.optionValue || '')) return ['android-around', 'tpms6'];
    if (/四錄/.test(item?.optionValue || '')) return ['android-4rec', 'tpms6'];
  }
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
export function prefillFromQuote(sheet, quote, layout = null) {
  const next = normalizeSheet(sheet);
  const items = { ...next.items };
  const shown = layoutItems(layout);
  const visible = new Set(shown.map((x) => x.id));
  const defaultNote = new Map(shown.map((x) => [x.id, x.note]));
  const unmatched = [];
  const noteLines = []; // 配件備註寫不進項目後面的線時，改寫進客戶需求（絕不默默丟掉）
  const pending = []; // 等全部勾完再分配的備註
  for (const item of quote?.items || []) {
    const name = String(item?.name || '').trim();
    const ownNote = String(item?.note || '').trim();
    if (!name || item.pending) continue;
    // 車價、領牌費等不是選配，只帶備註；但「其他費用」裡自己打的客製品項（例：五面帆160CM＋蓬頂）比對得到就照樣勾
    const otherMatched = item.kind === 'other' && matchSheetIds(item).some((id) => visible.has(id));
    if (item.kind === 'vehicle' || (item.kind === 'other' && !otherMatched)) {
      if (ownNote) pending.push({ label: compactName(name), note: ownNote, pkgIds: [] });
      continue;
    }
    // 內建關鍵字 + 使用者自己新增的項目（品名含有該項目名稱就算）
    const ids = matchSheetIds(item).filter((id) => visible.has(id));
    for (const x of shown) if (!DEFAULT_IDS.has(x.id) && x.label && name.includes(x.label) && !ids.includes(x.id)) ids.push(x.id);
    if (!ids.length) {
      unmatched.push(name);
      noteLines.push({ key: name, text: ownNote ? `${name}：${ownNote}` : name });
      continue;
    }
    const cut = deductedIds(item);
    const note = noteOf(item);
    const isPkg = ids.length > 1 || PACKAGES.some(([re]) => re.test(name));
    let placed = false;
    for (const id of ids) {
      if (cut.has(id)) continue;
      const cur = items[id] || { on: false, note: '' };
      // 單一項目：備註直接寫在該項旁邊（沒有線的項目會自動加線）；套裝拆成好幾格，備註改寫客戶需求
      const fallback = defaultNote.get(id) && ['tailgate', 'canvas', 'alubox', 'hrack', 'plate', 'leaf'].includes(id) ? name : '';
      items[id] = { on: true, note: cur.note || (isPkg ? '' : (note || fallback)) };
      if (ownNote && items[id].note.includes(ownNote)) placed = true;
    }
    if (ownNote && !placed) pending.push({ label: compactName(name), note: ownNote, pkgIds: ids.filter((id) => !cut.has(id)) });
  }
  const centralNote = String(quote?.note || '').trim();
  if (centralNote) pending.push({ label: '備註', note: centralNote, pkgIds: [] });
  // 套裝、車價、中央備註的備註：拆成一點一點（1. 2. 3. 或換行），提到哪一項就寫在那一項旁邊
  // （例：「橡膠墊全封，底板用矽利康封起來」→ 橡膠墊），對不到任何一項的才寫進客戶需求
  for (const { label, note, pkgIds } of pending) {
    const rest = [];
    for (const seg of splitNoteSegments(note)) {
      const target = findNoteTarget(seg, pkgIds, shown, visible, items);
      if (!target) { rest.push(seg); continue; }
      const cur = items[target] || { on: false, note: '' };
      if (!cur.note.includes(seg)) items[target] = { ...cur, note: cur.note ? `${cur.note}，${seg}` : seg };
    }
    if (rest.length) { const t = `${label}：${rest.join('；')}`; noteLines.push({ key: t, text: t }); }
  }
  next.items = items;
  if (quote?.model && !next.model) next.model = String(quote.model).replace(/^2027\s*年式\s*/, '').trim();
  // 選牌號碼（品名「選牌(7275)」或任何備註寫「選牌7275」）→ 填進紙本的「選牌」欄，不另寫進客戶需求
  if (!next.plate.text) {
    const sources = [quote?.note, ...(quote?.items || []).flatMap((it) => [it?.name, it?.note])];
    for (const src of sources) {
      const m = String(src || '').match(/選牌\s*[（(:：]?\s*([0-9A-Za-z][0-9A-Za-z-]{1,9})/);
      if (m) { next.plate = { on: true, text: m[1] }; break; }
    }
  }
  // 客戶需求照紙本寫法：①②③ 一行一項；已經寫過的（不論有沒有編號）不重複加
  const lines = String(next.needs.text || '').split('\n').filter((l) => l.trim());
  let added = false;
  for (const { key, text } of noteLines) {
    if (lines.some((l) => l.includes(key))) continue;
    lines.push(`${circledNumber(lines.length + 1)}${text}`);
    added = true;
  }
  if (added) next.needs = { on: true, text: lines.join('\n') };
  return { sheet: next, unmatched };
}

export function itemLabel(id, layout = null) { return layoutItems(layout).find((x) => x.id === id)?.label || LABEL_OF[id] || id; }
