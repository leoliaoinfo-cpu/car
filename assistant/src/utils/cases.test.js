import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLegacyCaseSeeds, buildWorkQueue, inferCaseType } from './cases.js';

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
