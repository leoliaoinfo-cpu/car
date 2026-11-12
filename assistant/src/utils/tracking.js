import dayjs from 'dayjs';
import {
  buildDayOccasionRows, buildWorkQueue, findDealForCase, getCaseLastTouchedAt, getCasePipelineStageId, STALE_CASE_DAYS,
} from './cases.js';

/** 案件列表用的白話階段（不改資料裡的階段代號）。 */
export const CASE_STAGE_PLAIN = {
  new: '洽談中',
  follow_up: '追蹤中',
  won: '已成交',
  delivery: '準備交車',
  completed: '已交車',
};

/** 案件列表的篩選：對應既有階段，不新增任何儲存欄位。 */
export const CASE_LIST_FILTERS = [
  ['all', '全部'],
  ['follow', '要追蹤'],
  ['quoted', '已報價'],
  ['won', '已成交'],
  ['delivered', '已交車'],
];

/**
 * 行事曆用：把「工作佇列」依日期排好。
 * 行事曆不自己算要做什麼，只讀 buildWorkQueue 的結果，所以工作頁知道的事行事曆一定也有。
 * 今天以外的日期另外補上當天的自建活動（佇列只放今天的）。
 */
export function buildAgendaByDate(data = {}, dates = []) {
  const queue = data.queue || buildWorkQueue(data);
  const todayString = data.today || dayjs().format('YYYY-MM-DD');
  const map = {};
  for (const row of queue) {
    if (!row.due) continue;
    (map[row.due] = map[row.due] || []).push(row);
  }
  for (const date of dates) {
    if (date === todayString) continue;
    const extra = buildDayOccasionRows(data, date);
    if (extra.length) map[date] = [...(map[date] || []), ...extra];
  }
  for (const key of Object.keys(map)) {
    map[key].sort((a, b) => Number(Boolean(a.stale)) - Number(Boolean(b.stale))
      || String(a.time || '99:99').localeCompare(String(b.time || '99:99'))
      || String(a.title).localeCompare(String(b.title)));
  }
  return map;
}

function dayDiff(from, to) {
  return dayjs(to).startOf('day').diff(dayjs(from).startOf('day'), 'day');
}

/**
 * 一筆案件的追蹤摘要：階段、幾天沒聯絡、下次追蹤、報價幾天沒回、是否太久沒追。
 * 案件列表的那一行字與排序都靠它。
 */
export function getCaseTracking(item, { deals = [], quotes = [], queue = [] } = {}, now = new Date()) {
  const stageId = getCasePipelineStageId(item, { deals, quotes });
  const deal = findDealForCase(deals, item);
  const completed = stageId === 'completed' || item?.status === 'completed';
  const contactDays = item?.lastContactAt && dayjs(item.lastContactAt).isValid() ? Math.max(0, dayDiff(item.lastContactAt, now)) : null;
  const createdDays = item?.createdAt && dayjs(item.createdAt).isValid() ? Math.max(0, dayDiff(item.createdAt, now)) : null;
  const followUpIn = item?.nextFollowUpDate && dayjs(item.nextFollowUpDate).isValid() ? dayDiff(now, item.nextFollowUpDate) : null;

  const quoteIds = new Set(item?.quoteIds || []);
  const quoteDates = quotes
    .filter((row) => !row.archivedAt && !row.caseArchivedAt && (row.caseId === item?.id || quoteIds.has(row.id)))
    .map((row) => row.createdAt || row.date || row.updatedAt)
    .filter((value) => value && dayjs(value).isValid())
    .sort((a, b) => dayjs(a).valueOf() - dayjs(b).valueOf());
  const lastQuoteAt = quoteDates.at(-1) || '';
  const quoteOutstanding = Boolean(lastQuoteAt) && !deal && !completed;
  const quoteDays = quoteOutstanding ? Math.max(0, dayDiff(lastQuoteAt, now)) : null;
  // 報價之後有沒有再聯絡過：沒有就算「未回覆」。
  const quoteUnanswered = quoteOutstanding
    && !(item?.lastContactAt && dayjs(item.lastContactAt).isAfter(dayjs(lastQuoteAt)));

  const touchedAt = getCaseLastTouchedAt(item);
  const idleDays = touchedAt ? Math.max(0, dayDiff(touchedAt, now)) : null;
  const hasDatedWork = queue.some((row) => row.caseId === item?.id && row.due && row.sourceType !== 'case-stale');
  const stale = !completed && !item?.nextFollowUpDate && !hasDatedWork && idleDays != null && idleDays >= STALE_CASE_DAYS;
  const overdueDays = !completed && followUpIn != null && followUpIn < 0 ? -followUpIn : 0;

  // 排序：逾期（越久越前）→ 太久沒追 → 今天要追 → 之後要追（近的在前）→ 沒排日期 → 已交車。
  let rank = 4;
  if (completed) rank = 5;
  else if (overdueDays) rank = 0;
  else if (stale) rank = 1;
  else if (followUpIn === 0) rank = 2;
  else if (followUpIn != null) rank = 3;

  return {
    stageId, stageLabel: CASE_STAGE_PLAIN[stageId] || '洽談中', completed, hasDeal: Boolean(deal),
    contactDays, createdDays, followUpIn, overdueDays, quoteOutstanding, quoteDays, quoteUnanswered,
    stale, idleDays, rank,
  };
}

/** 案件列表那一行追蹤文字的各段（畫面自己決定顏色）。 */
export function caseTrackingParts(item, tracking) {
  const parts = [{ key: 'stage', text: tracking.stageLabel }];
  if (tracking.completed) return parts;
  if (tracking.contactDays != null) parts.push({ key: 'contact', text: tracking.contactDays === 0 ? '今天聯絡過' : `${tracking.contactDays} 天沒聯絡` });
  else parts.push({ key: 'contact', text: tracking.createdDays ? `建立 ${tracking.createdDays} 天還沒聯絡` : '還沒聯絡' });
  if (tracking.overdueDays) parts.push({ key: 'follow', tone: 'danger', text: `該追了（逾期 ${tracking.overdueDays} 天）` });
  else if (tracking.followUpIn === 0) parts.push({ key: 'follow', tone: 'warn', text: '今天要追' });
  else if (tracking.followUpIn != null) parts.push({ key: 'follow', text: `下次 ${dayjs(item.nextFollowUpDate).format('M/D')}` });
  else if (tracking.stale) parts.push({ key: 'follow', tone: 'danger', text: '太久沒追' });
  else parts.push({ key: 'follow', tone: 'warn', text: '沒排追蹤日' });
  if (tracking.quoteOutstanding) parts.push({ key: 'quote', tone: tracking.quoteUnanswered && tracking.quoteDays >= 3 ? 'warn' : '', text: `已報價 ${tracking.quoteDays} 天${tracking.quoteUnanswered ? '未回覆' : ''}` });
  return parts;
}

export function matchesCaseListFilter(filter, tracking) {
  if (filter === 'follow') return ['new', 'follow_up'].includes(tracking.stageId);
  if (filter === 'quoted') return tracking.quoteOutstanding;
  if (filter === 'won') return ['won', 'delivery'].includes(tracking.stageId);
  if (filter === 'delivered') return tracking.completed;
  return true;
}

export function compareCaseTracking(a, b) {
  if (a.tracking.rank !== b.tracking.rank) return a.tracking.rank - b.tracking.rank;
  if (a.tracking.rank === 0) return b.tracking.overdueDays - a.tracking.overdueDays;
  if (a.tracking.rank === 1) return (b.tracking.idleDays || 0) - (a.tracking.idleDays || 0);
  if (a.tracking.rank === 3) return String(a.item.nextFollowUpDate).localeCompare(String(b.item.nextFollowUpDate));
  return String(b.item.updatedAt || '').localeCompare(String(a.item.updatedAt || ''));
}
