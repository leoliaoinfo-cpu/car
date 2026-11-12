import test from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import { buildWorkQueue } from './cases.js';
import { buildAgendaByDate, caseTrackingParts, compareCaseTracking, getCaseTracking, matchesCaseListFilter } from './tracking.js';

const day = (offset) => dayjs().add(offset, 'day').format('YYYY-MM-DD');
const iso = (offset) => dayjs().add(offset, 'day').toISOString();

test('明天的案件追蹤日會出現在行事曆的明天，內容與工作佇列相同', () => {
  const data = {
    cases: [{ id: 'case-1', clientId: 'c1', clientName: '王先生', title: 'K2500 購車', status: 'active', nextFollowUpDate: day(1), createdAt: iso(0) }],
    clients: [{ id: 'c1', name: '王先生', todos: [{ id: 'todo-1', text: '補身分證影本', due: day(1) }] }],
    workItems: [{ id: 'w1', caseId: 'case-1', title: '回報尾門價格', due: day(1), state: 'todo' }],
    tasks: [{ id: 't1', text: '繳停車費', due: day(1), done: false }],
  };
  const queue = buildWorkQueue(data);
  const agenda = buildAgendaByDate(data, [day(0), day(1), day(2)]);
  const tomorrow = agenda[day(1)] || [];
  assert.deepEqual(tomorrow.map((row) => row.id).sort(), queue.filter((row) => row.due === day(1)).map((row) => row.id).sort());
  assert.deepEqual(tomorrow.map((row) => row.sourceType).sort(), ['case-follow-up', 'client-todo', 'task', 'workItem']);
  assert.equal(agenda[day(0)], undefined);
});

test('行事曆每一天的事項都來自工作佇列：配件再追日、預計交車日、客戶追蹤日（沒案件的舊客戶）', () => {
  const data = {
    cases: [{ id: 'case-1', clientId: 'c1', status: 'active', nextFollowUpDate: day(5), createdAt: iso(0) }],
    clients: [{ id: 'c1', name: '柳老闆', deliveryDate: day(4) }, { id: 'c2', name: '售後客戶', nextDate: day(2) }],
    deals: [{ id: 'd1', caseId: 'case-1', clientId: 'c1', quoteId: 'q1', stockItems: [{ id: 's1', name: '帆布', status: 'inquiry', followUpDate: day(3) }] }],
  };
  const agenda = buildAgendaByDate(data, []);
  assert.equal(agenda[day(2)][0].sourceType, 'client-follow');
  assert.ok(agenda[day(3)].some((row) => row.sourceType === 'stock-alert' && row.title.includes('帆布')));
  assert.equal(agenda[day(4)][0].sourceType, 'client-delivery');
  assert.equal(agenda[day(5)][0].sourceType, 'case-follow-up');
});

test('每年重複的自建活動：今天的進工作佇列，其他日子由行事曆用同一個函式補上', () => {
  const data = {
    events: [
      { id: 'e1', title: '陳頭家生日', date: `2020-${day(0).slice(5)}`, repeat: 'yearly' },
      { id: 'e2', title: '開工日', date: day(2), repeat: 'none' },
    ],
    clients: [{ id: 'c1', name: '林小姐', customFieldValues: { birthday: `1990-${day(1).slice(5)}` } }],
    customFields: [{ id: 'birthday', name: '生日', type: 'date', recur: 'yearly' }], // 紀念日已不進行事曆
  };
  const queue = buildWorkQueue(data);
  assert.deepEqual(queue.map((row) => row.sourceType), ['event']);
  assert.equal(queue[0].group, 'today');
  const agenda = buildAgendaByDate(data, [day(0), day(1), day(2)]);
  assert.equal(agenda[day(0)].length, 1);
  assert.equal(agenda[day(1)], undefined);
  assert.equal(agenda[day(2)][0].title, '開工日');
});

test('同一天已有案件追蹤時，客戶自己的追蹤日不重複出現', () => {
  const rows = buildWorkQueue({
    cases: [{ id: 'case-1', clientId: 'c1', status: 'active', nextFollowUpDate: day(1), createdAt: iso(0) }],
    clients: [{ id: 'c1', name: '王先生', nextDate: day(1) }],
  });
  assert.deepEqual(rows.map((row) => row.sourceType), ['case-follow-up']);
});

test('沒排追蹤日又 14 天以上沒動靜的案件標成太久沒追，並進工作佇列的今天', () => {
  const stale = { id: 'stale', clientName: '久未追', status: 'active', createdAt: iso(-20), updatedAt: iso(-15) };
  const fresh = { id: 'fresh', clientName: '剛建立', status: 'active', createdAt: iso(-13), updatedAt: iso(-13) };
  const done = { id: 'done', clientName: '已交車', status: 'completed', createdAt: iso(-90), updatedAt: iso(-60) };
  const dated = { id: 'dated', clientName: '有排工作', status: 'active', createdAt: iso(-40), updatedAt: iso(-40) };
  const data = { cases: [stale, fresh, done, dated], workItems: [{ id: 'w1', caseId: 'dated', title: '等牌照', due: day(3), state: 'todo' }] };
  const queue = buildWorkQueue(data);
  const staleRows = queue.filter((row) => row.sourceType === 'case-stale');
  assert.deepEqual(staleRows.map((row) => row.caseId), ['stale']);
  assert.equal(staleRows[0].group, 'today');
  assert.equal(staleRows[0].staleDays, 15);
  assert.equal(getCaseTracking(stale, { queue }).stale, true);
  assert.equal(getCaseTracking(fresh, { queue }).stale, false);
  assert.equal(getCaseTracking(done, { queue }).stale, false);
  assert.equal(getCaseTracking(dated, { queue }).stale, false);
  assert.ok(buildAgendaByDate(data, [])[day(0)].some((row) => row.id === 'case-stale:stale'));
});

test('建案時寫的提示只在第一次聯繫前當作待辦標題，而且只有一筆', () => {
  const base = { id: 'case-1', clientName: '王先生', status: 'active', nextFollowUpDate: day(3), followUpNote: '確認要單廂還是雙廂', createdAt: iso(0) };
  const first = buildWorkQueue({ cases: [base] });
  assert.equal(first.length, 1);
  assert.equal(first[0].title, '確認要單廂還是雙廂');
  assert.equal(buildWorkQueue({ cases: [{ ...base, lastContactAt: iso(0) }] })[0].title, '聯繫客戶');
});

test('案件追蹤摘要：幾天沒聯絡、逾期、已報價幾天未回覆', () => {
  const item = { id: 'case-1', status: 'active', pipelineStage: 'follow_up', lastContactAt: iso(-6), nextFollowUpDate: day(-2), quoteIds: ['q1'], createdAt: iso(-10) };
  const quotes = [{ id: 'q1', createdAt: iso(-4) }];
  const tracking = getCaseTracking(item, { quotes });
  assert.equal(tracking.contactDays, 6);
  assert.equal(tracking.overdueDays, 2);
  assert.equal(tracking.quoteDays, 4);
  assert.equal(tracking.quoteUnanswered, true);
  assert.deepEqual(caseTrackingParts(item, tracking).map((part) => part.text), ['追蹤中', '6 天沒聯絡', '該追了（逾期 2 天）', '已報價 4 天未回覆']);
  const answered = getCaseTracking({ ...item, lastContactAt: iso(-1) }, { quotes });
  assert.equal(answered.quoteUnanswered, false);
});

test('舊資料只有 case.dealId 也算已成交，不再顯示報價未回覆', () => {
  const item = { id: 'case-1', status: 'active', dealId: 'd1', quoteIds: ['q1'], createdAt: iso(-10) };
  const tracking = getCaseTracking(item, { deals: [{ id: 'd1' }], quotes: [{ id: 'q1', createdAt: iso(-9) }] });
  assert.equal(tracking.stageId, 'won');
  assert.equal(tracking.quoteOutstanding, false);
  assert.equal(matchesCaseListFilter('won', tracking), true);
  assert.equal(matchesCaseListFilter('quoted', tracking), false);
});

test('案件列表排序：逾期最前、太久沒追其次、已交車最後', () => {
  const cases = [
    { id: 'later', status: 'active', nextFollowUpDate: day(5), createdAt: iso(-1), updatedAt: iso(-1) },
    { id: 'done', status: 'completed', createdAt: iso(-50), updatedAt: iso(0) },
    { id: 'stale', status: 'active', createdAt: iso(-30), updatedAt: iso(-30) },
    { id: 'today', status: 'active', nextFollowUpDate: day(0), createdAt: iso(-1), updatedAt: iso(-1) },
    { id: 'overdue', status: 'active', nextFollowUpDate: day(-3), createdAt: iso(-9), updatedAt: iso(-9) },
  ];
  const queue = buildWorkQueue({ cases });
  const sorted = cases.map((item) => ({ item, tracking: getCaseTracking(item, { queue }) })).sort(compareCaseTracking);
  assert.deepEqual(sorted.map((row) => row.item.id), ['overdue', 'stale', 'today', 'later', 'done']);
});

test('把「今天」調到任一天：清單的今天項目與月曆該日項目完全相同（含 15 天沒動靜的案件）', () => {
  const data = {
    cases: [
      { id: 'a', clientName: '甲', status: 'active', nextFollowUpDate: '2026-12-05', createdAt: '2026-11-01T00:00:00.000Z' },
      { id: 'b', clientName: '乙', status: 'active', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z' },
    ],
    clients: [{ id: 'c9', name: '舊客戶', nextDate: '2026-12-07' }],
    workItems: [{ id: 'w1', caseId: 'a', title: '報價', due: '2026-12-07', state: 'todo' }],
    tasks: [{ id: 't1', text: '繳費', due: '2026-12-05', done: false }],
    events: [{ id: 'e1', title: '開工', date: '2026-12-07', repeat: 'none' }, { id: 'e2', title: '生日', date: '2000-12-05', repeat: 'yearly' }],
  };
  for (const day of ['2026-11-12', '2026-11-24', '2026-12-05', '2026-12-07']) {
    const queue = buildWorkQueue({ ...data, today: day });
    const agenda = buildAgendaByDate({ ...data, queue, today: day }, [day]);
    const listToday = queue.filter((row) => row.group === 'today' && row.due === day).map((row) => row.id).sort();
    const calendarDay = (agenda[day] || []).map((row) => row.id).sort();
    assert.deepEqual(calendarDay, listToday, day);
  }
  // 11/24：案件 b 已 14 天沒動靜 → 出現；11/23 還不會
  assert.ok(buildWorkQueue({ ...data, today: '2026-11-24' }).some((row) => row.sourceType === 'case-stale' && row.caseId === 'b'));
  assert.ok(!buildWorkQueue({ ...data, today: '2026-11-23' }).some((row) => row.sourceType === 'case-stale' && row.caseId === 'b'));
  // 有進行中案件的客戶，舊的客戶層追蹤日不入列；沒案件的舊客戶 12/07 入列
  const q = buildWorkQueue({ ...data, today: '2026-12-07' });
  assert.ok(q.some((row) => row.sourceType === 'client-follow' && row.clientId === 'c9'));
});
