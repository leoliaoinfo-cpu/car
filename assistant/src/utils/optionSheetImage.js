// 選配表輸出圖片：直接用 Canvas 依座標畫（不用 html2canvas 拍畫面）。
// 原因：html2canvas 在不同瀏覽器／字型下，文字與勾選框的相對位置會偏掉（格子跑版）。
// 這裡所有位置都由數字決定，文字一律垂直置中，所以每台裝置畫出來都一樣整齊。
import { sheetBoxes } from './optionSheet.js';

const INK = '#1b1b1b';
const BLUE = '#1d3fa8';
const FONT = '-apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';
const W = 760;
const PAD = 14;
const ROW_H = 28;
const ROW_GAP = 6;
const BOX_PAD_X = 12;
const BOX_PAD_Y = 10;
const COL_GAP = 12;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function text(ctx, str, x, y, { size = 14, weight = 700, color = INK, align = 'left', maxWidth } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (maxWidth) ctx.fillText(str, x, y, maxWidth); else ctx.fillText(str, x, y);
}
function width(ctx, str, size, weight = 700) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  return ctx.measureText(String(str)).width;
}

function checkbox(ctx, x, cy, on, size = 20) {
  const y = cy - size / 2;
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#fff';
  roundRect(ctx, x + 1, y + 1, size - 2, size - 2, 4);
  ctx.fill();
  ctx.stroke();
  if (on) {
    const k = size / 20;
    ctx.lineWidth = 3 * k;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 4.5 * k, y + 10.5 * k);
    ctx.lineTo(x + 8.5 * k, y + 14.5 * k);
    ctx.lineTo(x + 16 * k, y + 5 * k);
    ctx.stroke();
  }
}

/** 一條手寫底線，線上寫字（寫在線的上方）。 */
function fillLine(ctx, x1, x2, cy, value, size = 14) {
  const y = cy + 9; // 線的位置
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  if (value) text(ctx, value, x1 + 2, y - 8, { size, weight: 600, color: BLUE, maxWidth: Math.max(10, x2 - x1 - 4) });
}

function wrapLines(ctx, str, maxW, size) {
  const out = [];
  for (const para of String(str || '').split('\n')) {
    let line = '';
    for (const ch of para) {
      if (width(ctx, line + ch, size, 600) > maxW && line) { out.push(line); line = ch; } else line += ch;
    }
    out.push(line);
  }
  return out;
}

function rowsHeight(n) { return n * ROW_H + Math.max(0, n - 1) * ROW_GAP; }

/** 畫出整張選配表，回傳 canvas（寬 760 × scale）。 */
export function renderSheetCanvas({ sheet, layout, scale = 2 }) {
  const boxes = sheetBoxes(layout, sheet);
  const pairs = [];
  for (let i = 0; i < boxes.length; i += 2) pairs.push(boxes.slice(i, i + 2));

  const colW = (W - PAD * 2 - COL_GAP) / 2;
  const innerW = W - PAD * 2;

  // 需求欄要先量測行數，才知道整張圖多高
  const probe = document.createElement('canvas').getContext('2d');
  const needLines = wrapLines(probe, sheet.needs.text, innerW - 40, 15);
  const needRows = Math.max(3, needLines.length);

  const HEADER_H = 52;
  const INFO_H = 3 * 34 + 20;
  const boxesH = pairs.reduce((sum, pair) => sum + Math.max(...pair.map((b) => rowsHeight(b.rows.length))) + BOX_PAD_Y * 2 + 12, 0);
  const FOOT_H = 46 + 40 + needRows * 28 + 10;
  const H = PAD + HEADER_H + 10 + INFO_H + 12 + boxesH + FOOT_H + PAD;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  let y = PAD;

  // ── 標題列 ──
  text(ctx, 'KIA', PAD, y + 18, { size: 18, weight: 900 });
  text(ctx, 'Movement that inspires', PAD, y + 36, { size: 8, weight: 500 });
  const tx = PAD + 112;
  ctx.lineWidth = 2.5; ctx.strokeStyle = INK;
  roundRect(ctx, tx, y, W - PAD - tx, HEADER_H - 6, 16); ctx.stroke();
  text(ctx, '卡旺選配表', tx + 18, y + (HEADER_H - 6) / 2, { size: 26, weight: 900 });
  const dateX = W - PAD - 150;
  text(ctx, '日期', dateX, y + (HEADER_H - 6) / 2, { size: 15, weight: 800 });
  fillLine(ctx, dateX + 40, W - PAD - 16, y + (HEADER_H - 6) / 2, sheet.date, 15);
  y += HEADER_H + 10;

  // ── 基本資料框 ──
  ctx.lineWidth = 2.5; ctx.strokeStyle = INK;
  roundRect(ctx, PAD, y, innerW, INFO_H, 16); ctx.stroke();
  const leftX = PAD + 14;
  const rightX = PAD + innerW * 0.54;
  const leftEnd = rightX - 16;
  const rightEnd = W - PAD - 14;
  const field = (label, value, x1, x2, cy) => {
    const lw = width(ctx, label, 17, 800);
    text(ctx, label, x1, cy, { size: 17, weight: 800 });
    fillLine(ctx, x1 + lw + 6, x2, cy, value, 15);
  };
  const flag = (label, obj, x1, x2, cy) => {
    checkbox(ctx, x1, cy, obj.on, 20);
    const lw = width(ctx, label, 16, 800);
    text(ctx, label, x1 + 28, cy, { size: 16, weight: 800 });
    fillLine(ctx, x1 + 28 + lw + 6, x2, cy, obj.text, 15);
  };
  const r1 = y + 28; const r2 = y + 28 + 34; const r3 = y + 28 + 68;
  field('車主', sheet.owner, leftX, leftEnd, r1);
  field('車型', sheet.model, leftX, leftEnd, r2);
  field('車身號碼', sheet.vin, leftX, leftEnd, r3);
  const half = (rightEnd - rightX - 12) / 2;
  field('車色', sheet.color, rightX, rightX + half, r1);
  field('業代', sheet.agent, rightX + half + 12, rightEnd, r1);
  flag('貸款銀行', sheet.loan, rightX, rightEnd, r2);
  flag('現金購車', sheet.cash, rightX, rightEnd, r3);
  y += INFO_H + 12;

  // ── 6 個勾選框 ──
  for (const pair of pairs) {
    const h = Math.max(...pair.map((b) => rowsHeight(b.rows.length))) + BOX_PAD_Y * 2;
    pair.forEach((b, col) => {
      const bx = PAD + col * (colW + COL_GAP);
      ctx.lineWidth = 2.5; ctx.strokeStyle = INK;
      roundRect(ctx, bx, y, colW, h, 16); ctx.stroke();
      let ry = y + BOX_PAD_Y; // 靠上排列（左右兩框列數不同時，不會出現上方空白）
      for (const row of b.rows) {
        const cy = ry + ROW_H / 2;
        const gap = 10;
        const naturals = row.map(([, label, note]) => 20 + 6 + width(ctx, label, 14) + (note ? 0 : 0));
        const noteCount = row.filter(([, , note]) => note).length;
        const fixed = naturals.reduce((a, b2) => a + b2, 0) + gap * (row.length - 1);
        const avail = colW - BOX_PAD_X * 2;
        const noteW = noteCount ? Math.max(36, (avail - fixed) / noteCount) : 0;
        let x = bx + BOX_PAD_X;
        row.forEach(([id, label, note], i) => {
          const it = sheet.items[id] || { on: false, note: '' };
          checkbox(ctx, x, cy, it.on, 20);
          text(ctx, label, x + 26, cy, { size: 14 });
          let w = naturals[i];
          if (note) {
            const lx = x + naturals[i] + 6;
            fillLine(ctx, lx, lx + noteW - 6, cy, it.note, 13);
            w = naturals[i] + noteW;
          }
          x += w + gap;
        });
        ry += ROW_H + ROW_GAP;
      }
    });
    y += h + 12;
  }

  // ── 舊換新／選牌／客戶需求 ──
  y += 6;
  const cy1 = y + 18;
  checkbox(ctx, PAD, cy1, sheet.trade, 26);
  text(ctx, '舊換新', PAD + 34, cy1, { size: 22, weight: 800 });
  const px = PAD + 34 + width(ctx, '舊換新', 22, 800) + 30;
  checkbox(ctx, px, cy1, sheet.plate.on, 26);
  text(ctx, '選牌', px + 34, cy1, { size: 22, weight: 800 });
  fillLine(ctx, px + 34 + width(ctx, '選牌', 22, 800) + 10, W - PAD, cy1, sheet.plate.text, 18);
  y += 46;

  const cy2 = y + 16;
  checkbox(ctx, PAD, cy2, sheet.needs.on, 26);
  text(ctx, '客戶需求', PAD + 34, cy2, { size: 22, weight: 800 });
  let ny = y + 44;
  for (let i = 0; i < needRows; i++) {
    const ly = ny + i * 28;
    ctx.lineWidth = 1.5; ctx.strokeStyle = INK;
    ctx.beginPath(); ctx.moveTo(PAD + 34, ly + 14); ctx.lineTo(W - PAD, ly + 14); ctx.stroke();
    if (needLines[i]) text(ctx, needLines[i], PAD + 36, ly + 4, { size: 15, weight: 600, color: BLUE });
  }
  return canvas;
}
