import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLegacyCaseSeeds, buildWorkQueue, getCasePipelineStage, getCaseStatusLabel, inferCaseType, resolveCaseFollowUpTarget,
} from './cases.js';

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

test('案件流程依資料進展為新案件、報價、成交、施工與交車', () => {
  const item = { id: 'case-1', quoteIds: [] };
  assert.equal(getCasePipelineStage(item), '新案件');
  assert.equal(getCasePipelineStage({ ...item, quoteIds: ['quote-1'] }, { quotes: [{ id: 'quote-1' }] }), '報價');
  assert.equal(getCasePipelineStage(item, { deals: [{ id: 'deal-1', caseId: 'case-1' }] }), '成交');
  assert.equal(getCasePipelineStage(item, { deals: [{ id: 'deal-1', caseId: 'case-1', deliveryWorkflow: [{ id: 'work', label: '施工', status: 'doing' }] }] }), '施工');
  assert.equal(getCasePipelineStage(item, { deals: [{ id: 'deal-1', caseId: 'case-1', deliveryWorkflow: [{ id: 'delivery', label: '交車', status: 'done' }] }] }), '交車');
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
  const args = { quotes: [{ id: 'q1', customerName: '甲' }] };
  const first = buildLegacyCaseSeeds(args);
  const second = buildLegacyCaseSeeds({ ...args, existingCases: first });
  assert.equal(first[0].id, 'case:quote:q1');
  assert.deepEqual(second, []);
});

test('工作佇列會合併案件工作、中央待辦與客戶追蹤', () => {
  const rows = buildWorkQueue({
    cases: [{ id: 'case-1', clientName: '王先生', title: '購車案件' }],
    workItems: [{ id: 'w1', caseId: 'case-1', title: '確認規格', state: 'todo' }],
    tasks: [{ id: 't1', title: '回覆廠商', done: false }],
    clients: [{ id: 'c1', name: '陳先生', nextDate: '2099-01-01' }],
  });
  assert.equal(rows.length, 3);
  assert.equal(rows.find((row) => row.sourceType === 'workItem').clientName, '王先生');
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
