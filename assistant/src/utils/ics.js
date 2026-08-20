import { STORAGE_KEYS } from '../storageKeys';

/**
 * 產生 .ics（iCalendar）檔，匯入 iPhone / Google 等系統行事曆後，
 * 靠手機原生的提醒準時通知——繞過網頁 App 無法背景推播的限制。
 * 納入：行事曆活動（生日 / 紀念日 / 重要日子，每年重複用 RRULE）＋未完成的計時提醒。
 */

function pad(n) { return String(n).padStart(2, '0'); }

function escapeText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** YYYY-MM-DD → YYYYMMDD（整天事件用） */
function dateOnly(dateStr) { return dateStr.replace(/-/g, ''); }

/** YYYY-MM-DD + HH:mm → 當地浮動時間 YYYYMMDDT HHmm00（不帶時區，由裝置在地判讀） */
function localDateTime(dateStr, time) {
  const [h, m] = time.split(':');
  return `${dateOnly(dateStr)}T${pad(h)}${pad(m)}00`;
}

/** ISO 字串 → 當地浮動時間 */
function localFromISO(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

/** ISO → UTC 時間戳（DTSTAMP 用） */
function utcStamp(iso) {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** RFC5545：單行 ≤75 octets，超過以 CRLF + 空白折行（中文以 UTF-8 位元組計） */
function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > 73) { out.push(cur); cur = ' ' + ch; bytes = 1 + n; }
    else { cur += ch; bytes += n; }
  }
  if (cur) out.push(cur);
  return out.join('\r\n');
}

export function buildICS({ events = [], timers = [], clients = [] }) {
  const nameOf = (id) => clients.find((c) => c.id === id)?.name || '';
  const stamp = utcStamp(new Date().toISOString());
  const L = [];
  const push = (s) => L.push(foldLine(s));

  push('BEGIN:VCALENDAR');
  push('VERSION:2.0');
  push('PRODID:-//業務系統//行事曆//ZH-TW');
  push('CALSCALE:GREGORIAN');
  push('METHOD:PUBLISH');

  for (const e of events) {
    const cname = e.clientId ? nameOf(e.clientId) : '';
    const summary = e.title + (cname ? `（${cname}）` : '');
    push('BEGIN:VEVENT');
    push(`UID:event-${e.id}@yewu`);
    push(`DTSTAMP:${stamp}`);
    if (e.time) push(`DTSTART:${localDateTime(e.date, e.time)}`);
    else push(`DTSTART;VALUE=DATE:${dateOnly(e.date)}`);
    if (e.repeat === 'yearly') push('RRULE:FREQ=YEARLY');
    push(`SUMMARY:${escapeText(summary)}`);
    if (e.note) push(`DESCRIPTION:${escapeText(e.note)}`);
    // 提醒：定時→前 30 分；整天→當天早上 9:00（TRIGGER 相對 00:00 起算 +9h）
    push('BEGIN:VALARM');
    push('ACTION:DISPLAY');
    push(`DESCRIPTION:${escapeText(summary)}`);
    push(e.time ? 'TRIGGER:-PT30M' : 'TRIGGER:PT9H');
    push('END:VALARM');
    push('END:VEVENT');
  }

  for (const t of timers) {
    if (t.confirmedAt || !t.triggerAt) continue;
    const cname = t.clientName || (t.clientId ? nameOf(t.clientId) : '');
    const summary = (t.note || '提醒') + (cname ? `（${cname}）` : '');
    push('BEGIN:VEVENT');
    push(`UID:timer-${t.id}@yewu`);
    push(`DTSTAMP:${stamp}`);
    push(`DTSTART:${localFromISO(t.triggerAt)}`);
    push('DURATION:PT30M');
    push(`SUMMARY:${escapeText(summary)}`);
    push('BEGIN:VALARM');
    push('ACTION:DISPLAY');
    push(`DESCRIPTION:${escapeText(summary)}`);
    push('TRIGGER:-PT10M');
    push('END:VALARM');
    push('END:VEVENT');
  }

  push('END:VCALENDAR');
  return L.join('\r\n');
}

const LS_EXPORTED_AT = STORAGE_KEYS.icsExportedAt;
const LS_SNOOZE_AT = STORAGE_KEYS.icsSnoozeAt;

/** 產生並下載 .ics 檔；記錄匯出時間供「久沒匯出」提醒判斷。回傳事件筆數 */
export function downloadICS({ events = [], timers = [], clients = [] }) {
  const pending = timers.filter((t) => !t.confirmedAt && t.triggerAt);
  const count = events.length + pending.length;
  if (count === 0) return 0;
  const ics = buildICS({ events, timers, clients });
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `業務系統-行事曆-${new Date().toISOString().slice(0, 10)}.ics`;
  a.click();
  URL.revokeObjectURL(url);
  try { localStorage.setItem(LS_EXPORTED_AT, String(Date.now())); } catch { /* 隱私模式忽略 */ }
  return count;
}

/** 記錄最後修改時間（_ts，退回 createdAt） */
function itemTs(x) { return x?._ts || Date.parse(x?.createdAt || 0) || 0; }

/** 暫時關閉提醒（使用者按 ✕）：等到有更新的活動 / 提醒才會再出現 */
export function snoozeIcsReminder() {
  try { localStorage.setItem(LS_SNOOZE_AT, String(Date.now())); } catch { /* noop */ }
}

/**
 * 是否該提醒匯出——有「上次匯出之後才新增 / 修改」的活動或提醒時才提醒，
 * 沒有新東西不會一直吵。此提醒是本機（本裝置對應本手機行事曆），故用 localStorage。
 */
export function needsIcsExport(events = [], timers = []) {
  const items = [...events, ...timers.filter((t) => !t.confirmedAt && t.triggerAt)];
  if (items.length === 0) return false;
  let baseline = 0;
  try {
    baseline = Math.max(
      Number(localStorage.getItem(LS_EXPORTED_AT)) || 0,
      Number(localStorage.getItem(LS_SNOOZE_AT)) || 0,
    );
  } catch { /* noop */ }
  return items.some((x) => itemTs(x) > baseline);
}
