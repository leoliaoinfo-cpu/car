import test from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import {
  advanceCasePipeline, assignCaseNumbers, buildLegacyCaseSeeds, buildWorkQueue, getCasePipelineElapsedDays, getCasePipelineStage, getCasePipelineStageId, getCasePipelineUpdatedAt, getCaseStatusLabel, getCaseTotalElapsedDays, inferCaseType, resolveCaseFollowUpTarget,
} from './cases.js';

test('案件編號從 100 起補齊、保留既有編號並修復重複編號', () => {
  const result = assignCaseNumbers([
    { id: 'old', createdAt: '2026-01-01' },
    { id: 'kept', createdAt: '2026-01-02', caseNumber: 105 },
    { id: 'duplicate', createdAt: '2026-01-03', caseNumber: 105 },
  ]);
  assert.deepEqual(result.cases.map((row) => row.caseNumber), [100, 105, 106]);
  assert.equal(result.nextNumber, 107);
  assert.deepEqual(result.changedIds, ['old', 'duplicate']);
});

test('案件編號序號器不會因刪除舊案件而回收號碼', () => {
  const result = assignCaseNumbers([{ id: 'new' }], 123);
  assert.equal(result.cases[0].caseNumber, 123);
  assert.equal(result.nextNumber, 124);
});

test('新案件追蹤日必須由使用者選指定日期或幾天幾週後，不提供隱藏預設', () => {
  assert.equal(resolveCaseFollowUpTarget({}), '');
  assert.equal(resolveCaseFollowUpTarget({ mode: 'date', date: '2026-10-20' }), '2026-10-20');
  assert.equal(resolveCaseFollowUpTarget({ mode: 'relative', amount: 10, unit: 'days', baseDate: '2026-10-08' }), '2026-10-18');
  assert.equal(resolveCaseFollowUpTarget({ mode: 'relative', amount: 3, unit: 'weeks', baseDate: '2026-10-08' }), '2026-10-29');
  assert.equal(resolveCaseFollowUpTarget({ mode: 'relative', amount: 0, unit: 'days', baseDate: '2026-10-08' }), '');
});

test('案件可用自訂階段名稱取代固定狀態文字', () => {
  assert.equal(getCaseStatusLabel({ status: 'waiting', stageLabel: '等待料件' }), '等待料件');
  assert.equal(getCaseStatusLabel({ status: 'waiting', stageLabel: '' }), '等待中');
});

test('案件流程統一為新開發報價、有意願追蹤、成交、安排交車與完工交車', () => {
  const item = { id: 'case-1', quoteIds: [] };
  assert.equal(getCasePipelineStage(item), '新開發（報價）');
  assert.equal(getCasePipelineStage({ ...item, pipelineStage: 'follow_up' }), '有意願在追蹤');
  assert.equal(getCasePipelineStage({ ...item, quoteIds: ['quote-1'] }, { quotes: [{ id: 'quote-1' }] }), '新開發（報價）');
  assert.equal(getCasePipelineStage(item, { deals: [{ id: 'deal-1', caseId: 'case-1' }] }), '已成交');
  assert.equal(getCasePipelineStage({ ...item, pipelineStage: 'delivery' }), '安排交車事項');
  assert.equal(getCasePipelineStage({ ...item, status: 'completed' }), '已完工交車');
  assert.equal(getCasePipelineStageId({ ...item, pipelineStage: 'quoted' }), 'new');
});

test('案件狀態時間只取階段異動，不會被一般備註更新時間覆蓋', () => {
  const item = {
    id: 'case-1', pipelineStage: 'follow_up',
    pipelineStageUpdatedAt: '2026-10-02T08:00:00.000Z',
    updatedAt: '2026-10-05T08:00:00.000Z',
  };
  assert.equal(getCasePipelineUpdatedAt(item), '2026-10-02T08:00:00.000Z');
});

test('報價或成交推進案件時會使用對應紀錄的最新時間', () => {
  const item = {
    id: 'case-1', quoteIds: ['quote-1'], dealId: 'deal-1',
    pipelineStageUpdatedAt: '2026-10-01T08:00:00.000Z',
  };
  assert.equal(getCasePipelineUpdatedAt(item, {
    quotes: [{ id: 'quote-1', updatedAt: '2026-10-03T08:00:00.000Z' }],
    deals: [{ id: 'deal-1', updatedAt: '2026-10-04T08:00:00.000Z' }],
  }), '2026-10-04T08:00:00.000Z');
});

test('只修改成交內容不會重設已成交階段的日期', () => {
  const item = {
    id: 'case-1', dealId: 'deal-1', pipelineStage: 'won',
    pipelineStageUpdatedAt: '2026-10-04T08:00:00.000Z',
  };
  assert.equal(getCasePipelineUpdatedAt(item, {
    deals: [{ id: 'deal-1', createdAt: '2026-10-04T08:00:00.000Z', updatedAt: '2026-10-10T08:00:00.000Z' }],
  }), '2026-10-04T08:00:00.000Z');
});

test('新階段從進入當天算第 1 天並保留階段歷史', () => {
  const created = advanceCasePipeline({}, 'new', '2026-11-05T08:00:00.000Z');
  const won = advanceCasePipeline(created, 'won', '2026-11-07T08:00:00.000Z');
  assert.equal(getCasePipelineElapsedDays(won, {}, '2026-11-07T10:00:00.000Z'), 1);
  assert.deepEqual(won.pipelineStageHistory, [
    { stageId: 'new', enteredAt: '2026-11-05T08:00:00.000Z' },
    { stageId: 'won', enteredAt: '2026-11-07T08:00:00.000Z' },
  ]);
  assert.equal(advanceCasePipeline(won, 'follow_up', '2026-11-08T08:00:00.000Z', { allowBackward: false }), won);
  assert.equal(getCaseTotalElapsedDays(won, {}, '2026-11-10T08:00:00.000Z'), 6);
});

test('已完工案件的總天數會固定在完工日', () => {
  const item = advanceCasePipeline({ createdAt: '2026-11-01T08:00:00.000Z' }, 'completed', '2026-11-05T08:00:00.000Z');
  assert.equal(getCaseTotalElapsedDays(item, {}, '2026-12-01T08:00:00.000Z'), 5);
});

test('改裝報價會建立改車案件，且已被成交引用的報價不重複建立', () => {
  const quotes = [
    { id: 'q1', clientId: 'c1', customerName: '甲', model: 'K2500', excludeVehiclePrice: true },
    { id: 'q2', clientId: 'c1', customerName: '甲', model: 'K2500' },
  ];
  const rows = buildLegacyCaseSeeds({ deals: [{ id: 'd1', clientId: 'c1', quoteId: 'q2' }], quotes });
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.id === 'case:quote:q1').type, 'modification');
  assert.equal(rows.find((row) => row.id === 'case:deal:d1').type, 'purchase');
  assert.equal(inferCaseType(quotes[0]), 'modification');
});

test('案件相容轉換使用固定 id，可安全重跑', () => {
  const args = { quotes: [{ id: 'q1', clientId: 'c1', customerName: '甲' }] };
  const first = buildLegacyCaseSeeds(args);
  const second = buildLegacyCaseSeeds({ ...args, existingCases: first });
  assert.equal(first[0].id, 'case:quote:q1');
  assert.deepEqual(second, []);
});

test('已刪除案件的舊報價不會在重新載入時自動建立案件', () => {
  const cases = buildLegacyCaseSeeds({
    quotes: [{ id: 'quote-archived', clientId: 'client-1', caseId: 'case-archived' }],
    clients: [{ id: 'client-1', name: '王先生' }],
    existingCases: [{ id: 'case-archived', deletedAt: '2026-10-09T00:00:00.000Z' }],
  });
  assert.equal(cases.length, 0);
});

test('已封存案件連結的成交不會在重新載入時建立重複案件', () => {
  const cases = buildLegacyCaseSeeds({
    deals: [{ id: 'deal-archived', clientId: 'client-1', caseId: 'case-archived' }],
    clients: [{ id: 'client-1', name: '王先生' }],
    existingCases: [{ id: 'case-archived', deletedAt: '2026-11-05T00:00:00.000Z' }],
  });
  assert.deepEqual(cases, []);
});

test('封存案件的施工不會被錯掛到同客戶其他案件', () => {
  const rows = buildWorkQueue({
    deals: [{ id: 'deal-1', clientId: 'client-1', caseId: 'case-archived', caseArchivedAt: '2026-11-05T00:00:00.000Z', deliveryWorkflow: [{ id: 'delivery', label: '交車', status: 'todo' }] }],
    cases: [{ id: 'case-active', clientId: 'client-1', status: 'active' }],
  });
  assert.equal(rows.some((row) => row.sourceType === 'delivery'), false);
});

test('工作只使用案件自己的追蹤日，已刪案件工作不顯示', () => {
  const rows = buildWorkQueue({
    cases: [
      { id: 'case-a', clientId: 'client-1', status: 'active', nextFollowUpDate: '2099-01-01' },
      { id: 'case-b', clientId: 'client-1', status: 'active', nextFollowUpDate: '2099-01-02' },
    ],
    clients: [{ id: 'client-1', name: '展間客戶', nextDate: '2099-01-01' }],
    workItems: [{ id: 'deleted-work', caseId: 'case-deleted', title: '不應顯示', state: 'todo' }],
  });
  assert.deepEqual(rows.filter((row) => row.sourceType === 'case-follow-up').map((row) => row.caseId).sort(), ['case-a', 'case-b']);
  assert.equal(rows.some((row) => row.sourceType === 'client-next'), false);
  assert.equal(rows.some((row) => row.sourceId === 'deleted-work'), false);
});

test('工作佇列會合併案件工作、中央待辦與案件追蹤', () => {
  const rows = buildWorkQueue({
    cases: [{ id: 'case-1', clientName: '王先生', title: '買車案件', nextFollowUpDate: '2099-01-01' }],
    workItems: [{ id: 'w1', caseId: 'case-1', title: '確認規格', state: 'todo' }],
    tasks: [{ id: 't1', title: '回覆廠商', done: false }],
    clients: [{ id: 'c1', name: '陳先生', nextDate: '2099-01-01' }],
  });
  assert.equal(rows.length, 3);
  assert.equal(rows.find((row) => row.sourceType === 'workItem').clientName, '王先生');
  assert.equal(rows.find((row) => row.sourceType === 'case-follow-up').caseId, 'case-1');
});

test('已取消的工作、待辦與客戶事項不再出現在工作台', () => {
  const rows = buildWorkQueue({
    workItems: [{ id: 'w1', title: '取消工作', state: 'cancelled' }],
    tasks: [{ id: 't1', title: '取消待辦', canceled: true }],
    clients: [{ id: 'c1', name: '王先生', todos: [{ id: 'todo-1', text: '取消事項', canceled: true }] }],
  });
  assert.deepEqual(rows, []);
});

test('交車將近缺品與待廠商確認未排再追日會提醒，但不把其他報價計入', () => {
  const todayString = dayjs().format('YYYY-MM-DD');
  const rows = buildWorkQueue({
    cases: [{ id: 'case-1', clientId: 'client-1', clientName: '柳老闆', status: 'active', desiredDeliveryDate: todayString }],
    clients: [{ id: 'client-1', name: '柳老闆' }],
    deals: [{ id: 'deal-1', caseId: 'case-1', clientId: 'client-1', quoteId: 'winning-quote', stockItems: [{ id: 'mirror', name: '後照鏡', status: 'inquiry' }] }],
  });
  assert.equal(rows.filter((row) => row.sourceType === 'stock-alert').length, 2);
  assert.ok(rows.some((row) => row.title.includes('尚缺 1 項')));
});

test('廠商再追日期進工作台，急件在同日一般案件之前', () => {
  const due = dayjs().add(2, 'day').format('YYYY-MM-DD');
  const rows = buildWorkQueue({
    cases: [{ id: 'ordinary', status: 'active' }, { id: 'urgent', status: 'active', urgent: true }],
    deals: [
      { id: 'd1', caseId: 'ordinary', quoteId: 'q1', stockItems: [{ name: '帆布', status: 'inquiry', followUpDate: due }] },
      { id: 'd2', caseId: 'urgent', quoteId: 'q2', stockItems: [{ name: '尾門', status: 'inquiry', followUpDate: due }] },
    ],
  });
  assert.deepEqual(rows.map((row) => row.caseId), ['urgent', 'ordinary']);
  assert.equal(rows[0].due, due);
});

test('施工階段依分配天數產生催辦期限，未解鎖階段維持等待', () => {
  const rows = buildWorkQueue({
    deals: [{ id: 'd1', clientId: 'c1', caseId: 'case-1', deliveryWorkflow: [
      { id: 'a', label: '目前施工', status: 'doing', plannedDays: 2, activatedAt: '2026-10-01T01:00:00.000Z' },
      { id: 'b', label: '後續施工', status: 'todo', plannedDays: 1, dependsOn: 'a' },
    ] }],
    cases: [{ id: 'case-1', clientId: 'c1', dealId: 'd1', status: 'active' }],
    clients: [{ id: 'c1', name: '測試客戶' }],
  });
  const active = rows.find((row) => row.sourceId === 'a');
  const waiting = rows.find((row) => row.sourceId === 'b');
  assert.equal(active.due, '2026-10-02');
  assert.equal(waiting.state, 'waiting');
  assert.equal(waiting.waitingOn, '目前施工');
});

test('卡住的施工階段依再追日期回到今天工作並保留原因', () => {
  const followUpDate = dayjs().format('YYYY-MM-DD');
  const rows = buildWorkQueue({
    deals: [{ id: 'd1', clientId: 'c1', caseId: 'case-1', deliveryWorkflow: [{
      id: 'canvas', label: '聯繫帆布廠商', status: 'blocked', plannedDays: 2,
      blockedReason: '等待確認施工日期', blockedOwner: '力新帆布', blockedFollowUpDate: followUpDate,
    }] }],
    cases: [{ id: 'case-1', caseNumber: 105, clientId: 'c1', dealId: 'd1', status: 'active' }],
    clients: [{ id: 'c1', name: '測試客戶' }],
  });
  const reminder = rows.find((row) => row.sourceId === 'canvas');
  assert.equal(reminder.group, 'today');
  assert.equal(reminder.followUpReminder, true);
  assert.equal(reminder.waitingOn, '等待確認施工日期・等待 力新帆布');
  assert.equal(reminder.caseNumber, 105);
});

test('findDealForCase finds legacy deals linked only by case.dealId and ignores archived ones', async () => {
  const { findDealForCase } = await import('./cases.js');
  const legacy = { id: 'd-old', amount: 900000 };
  assert.equal(findDealForCase([legacy], { id: 'c1', dealId: 'd-old' }), legacy);
  assert.equal(findDealForCase([{ id: 'd2', caseId: 'c1' }], { id: 'c1' }).id, 'd2');
  assert.equal(findDealForCase([{ id: 'd-old', caseArchivedAt: 'x' }], { id: 'c1', dealId: 'd-old' }), null);
  assert.equal(findDealForCase([legacy], { id: 'c9' }), null);
});

test('舊成交只靠 case.dealId 關聯時不重複建立案件', () => {
  const seeds = buildLegacyCaseSeeds({
    deals: [{ id: 'dOld', clientId: 'c2', quoteId: 'qB' }],
    quotes: [{ id: 'qB', clientId: 'c2' }],
    existingCases: [{ id: 'cB', clientId: 'c2', dealId: 'dOld', quoteIds: ['qB'] }],
  });
  assert.deepEqual(seeds, []);
});

test('報價只記在既有案件的 quoteIds 時不重複建立案件', () => {
  const seeds = buildLegacyCaseSeeds({
    quotes: [{ id: 'q9', clientId: 'c1' }],
    existingCases: [{ id: 'case-x', clientId: 'c1', quoteIds: ['q9'] }],
  });
  assert.deepEqual(seeds, []);
});
