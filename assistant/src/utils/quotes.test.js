import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeQuotes, collectReferencedCaseIds, findGhostQuoteCases, getQuoteAgeDays, getQuoteAttention, isGhostQuoteCase,
  planQuoteCaseLink, quotesForClient,
} from './quotes.js';
import { buildLegacyCaseSeeds } from './cases.js';

test('migrates embedded client quotes once and keeps canonical draft precedence', () => {
  const clients = [{ id: 'c1', name: '王老闆', quotes: [
    { id: 'q1', total: 100, date: '2026-09-01' },
    { id: 'q2', total: 200, date: '2026-09-02' },
  ] }];
  const drafts = [{ id: 'q2', clientId: 'c1', total: 250, date: '2026-09-03' }];
  const result = canonicalizeQuotes(clients, drafts);
  assert.equal(result.migrated, true);
  assert.equal(result.clients[0].quotes, undefined);
  assert.equal(result.quoteDrafts.length, 2);
  assert.equal(result.quoteDrafts.find((quote) => quote.id === 'q2').total, 250);
  assert.equal(result.quoteDrafts.find((quote) => quote.id === 'q1').clientId, 'c1');
});

test('returns only the linked client quotes in latest-first order', () => {
  const rows = quotesForClient([
    { id: 'q1', clientId: 'c1', date: '2026-09-01' },
    { id: 'q2', clientId: 'c2', date: '2026-09-03' },
    { id: 'q3', clientId: 'c1', date: '2026-09-02' },
    { id: 'q4', clientId: 'c1', date: '2026-09-04', archivedAt: '2026-10-01T00:00:00.000Z' },
  ], 'c1');
  assert.deepEqual(rows.map((row) => row.id), ['q3', 'q1']);
});

test('quote age starts at day one and never resets to updatedAt', () => {
  const quote = {
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-04-09T00:00:00.000Z',
  };
  assert.equal(getQuoteAgeDays(quote, new Date('2026-01-01T08:00:00.000Z')), 1);
  assert.equal(getQuoteAgeDays(quote, new Date('2026-01-31T00:00:00.000Z')), 31);
});

test('unassigned quotes warn after 30 days and linked quotes turn stale after 90 days', () => {
  const now = new Date('2026-04-02T00:00:00.000Z');
  const unassigned = getQuoteAttention({ createdAt: '2026-03-02T00:00:00.000Z' }, now);
  const linked = getQuoteAttention({ createdAt: '2026-01-01T00:00:00.000Z', clientId: 'client-1' }, now);
  assert.equal(unassigned.ageDays, 32);
  assert.equal(unassigned.unassignedOverdue, true);
  assert.equal(unassigned.linkedStale, false);
  assert.equal(linked.ageDays, 92);
  assert.equal(linked.unassignedOverdue, false);
  assert.equal(linked.linkedStale, true);
});

test('舊報價搬移只回報真正變動的客戶與新增的報價（其他資料不重寫）', () => {
  const untouched = { id: 'c0', name: '沒有舊報價' };
  const clients = [untouched, { id: 'c1', name: '王老闆', quotes: [{ id: 'q1', date: '2026-09-01' }, { id: 'q2' }] }];
  const existing = { id: 'q2', clientId: 'c1' };
  const result = canonicalizeQuotes(clients, [existing]);
  assert.deepEqual(result.changedClientIds, ['c1']);
  assert.deepEqual(result.addedQuoteIds, ['q1']);
  assert.equal(result.clients[0], untouched);
  assert.equal(result.quoteDrafts.find((q) => q.id === 'q2'), existing);
});

test('沒有舊報價時不回報任何變動', () => {
  const result = canonicalizeQuotes([{ id: 'c1' }], [{ id: 'q1' }]);
  assert.equal(result.migrated, false);
  assert.deepEqual(result.changedClientIds, []);
  assert.deepEqual(result.addedQuoteIds, []);
});

// ── 報價 ↔ 案件歸屬（未命名客戶空殼案件 bug）──────────────────────────────
const NOW = '2026-11-11T00:00:00.000Z';
const ghostOf = (quoteId, extra = {}) => ({
  id: `case:quote:${quoteId}`, clientId: null, clientName: '未命名客戶', type: 'purchase', title: '購車報價',
  status: 'active', dealId: null, quoteIds: [quoteId], source: 'legacy-quote', createdAt: NOW, updatedAt: NOW, ...extra,
});

test('沒有客戶的報價重新載入時不會長出「未命名客戶」案件', () => {
  const seeds = buildLegacyCaseSeeds({ quotes: [{ id: 'q-anon', customerName: '' }, { id: 'q-title', customerName: '某公司' }] });
  assert.deepEqual(seeds, []);
});

test('只做報價儲存時不建立案件', () => {
  const plan = planQuoteCaseLink({ quote: { id: 'q1', clientId: null, customerName: '某公司' }, cases: [], now: NOW });
  assert.equal(plan.caseRow, null);
  assert.equal(plan.quote.caseId, null);
  assert.deepEqual(plan.deleteCaseIds, []);
});

test('歸入有案件的客戶：報價併入既有案件、不改案件標題，舊空殼案件被移除', () => {
  const quote = { id: 'q1', clientId: 'c1', caseId: 'case-1', customerName: '王大明', model: '雙廂4WD' };
  const realCase = { id: 'case-1', clientId: 'c1', clientName: '王大明', type: 'purchase', title: '單廂貨車', status: 'active', quoteIds: [], source: 'manual' };
  const plan = planQuoteCaseLink({ quote, cases: [realCase, ghostOf('q1')], quotes: [{ id: 'q1' }], now: NOW });
  assert.equal(plan.caseRow.id, 'case-1');
  assert.equal(plan.caseRow.title, '單廂貨車');
  assert.equal(plan.caseRow.clientName, '王大明');
  assert.deepEqual(plan.caseRow.quoteIds, ['q1']);
  assert.equal(plan.quote.caseId, 'case-1');
  assert.deepEqual(plan.deleteCaseIds, ['case:quote:q1']);
  assert.equal(plan.previousCase, null);
});

test('歸入沒有案件的客戶：認領空殼案件改成該客戶案件，不留下第二筆', () => {
  const quote = { id: 'q1', clientId: 'c9', caseId: null, customerName: '陳先生', model: '單廂' };
  const plan = planQuoteCaseLink({ quote, cases: [ghostOf('q1', { caseNumber: 105 })], now: NOW });
  assert.equal(plan.caseRow.id, 'case:quote:q1');
  assert.equal(plan.caseRow.clientId, 'c9');
  assert.equal(plan.caseRow.clientName, '陳先生');
  assert.equal(plan.caseRow.caseNumber, 105);
  assert.deepEqual(plan.deleteCaseIds, []);
});

test('指定的案件屬於別的客戶時不會被改成這位客戶', () => {
  const other = { id: 'case-x', clientId: 'c2', clientName: '林', type: 'purchase', title: 'A', status: 'active', quoteIds: [] };
  const plan = planQuoteCaseLink({ quote: { id: 'q1', clientId: 'c1', caseId: 'case-x' }, cases: [other], now: NOW });
  assert.notEqual(plan.caseRow.id, 'case-x');
  assert.equal(plan.caseRow.clientId, 'c1');
});

test('有使用者資料的舊案件絕不當成空殼刪除', () => {
  const quotes = [{ id: 'q1' }];
  assert.equal(isGhostQuoteCase(ghostOf('q1'), { quotes }), true);
  assert.equal(isGhostQuoteCase(ghostOf('q1', { nextFollowUpDate: '2026-12-01' }), { quotes }), false);
  assert.equal(isGhostQuoteCase(ghostOf('q1', { note: '客戶說下月再談' }), { quotes }), false);
  assert.equal(isGhostQuoteCase(ghostOf('q1', { urgent: true }), { quotes }), false);
  assert.equal(isGhostQuoteCase(ghostOf('q1', { clientId: 'c1' }), { quotes }), false);
  assert.equal(isGhostQuoteCase(ghostOf('q1', { dealId: 'd1' }), { quotes }), false);
  assert.equal(isGhostQuoteCase(ghostOf('q1', { status: 'completed' }), { quotes }), false);
  assert.equal(isGhostQuoteCase({ ...ghostOf('q1'), id: 'case-manual', source: 'manual' }, { quotes }), false);
  assert.equal(isGhostQuoteCase(ghostOf('q1'), { quotes, referencedCaseIds: collectReferencedCaseIds([{ caseId: 'case:quote:q1' }]) }), false);
  // 裡面的報價已有客戶且仍指向此案件 → 不是空殼
  assert.equal(isGhostQuoteCase(ghostOf('q1'), { quotes: [{ id: 'q1', clientId: 'c1', caseId: 'case:quote:q1' }] }), false);
});

test('報價離開有使用者資料的舊案件時，舊案件保留只移除報價連結', () => {
  const kept = ghostOf('q1', { nextFollowUpDate: '2026-12-01' });
  const realCase = { id: 'case-1', clientId: 'c1', clientName: '王', type: 'purchase', title: 'T', status: 'active', quoteIds: [] };
  const plan = planQuoteCaseLink({ quote: { id: 'q1', clientId: 'c1', caseId: 'case-1' }, cases: [realCase, kept], now: NOW });
  assert.deepEqual(plan.deleteCaseIds, []);
  assert.equal(plan.previousCase.id, kept.id);
  assert.deepEqual(plan.previousCase.quoteIds, []);
  assert.equal(plan.previousCase.nextFollowUpDate, '2026-12-01');
});

test('啟動整理只挑出真正的空殼案件', () => {
  const cases = [
    ghostOf('q1'),
    ghostOf('q2', { nextFollowUpDate: '2026-12-01' }),
    { id: 'case-real', clientId: 'c1', source: 'manual', quoteIds: [] },
    ghostOf('q3'),
  ];
  const quotes = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3', clientId: 'c1', caseId: 'case:quote:q3' }];
  assert.deepEqual(findGhostQuoteCases({ cases, quotes }), ['case:quote:q1']);
});

test('編輯既有客戶案件內的報價：不改標題、不另建案件', () => {
  const realCase = { id: 'case-1', clientId: 'c1', clientName: '王', type: 'purchase', title: '單廂貨車', status: 'active', quoteIds: ['q1'] };
  const plan = planQuoteCaseLink({ quote: { id: 'q1', clientId: 'c1', caseId: 'case-1', model: '雙廂' }, cases: [realCase], now: NOW });
  assert.equal(plan.caseRow.id, 'case-1');
  assert.equal(plan.caseRow.title, '單廂貨車');
  assert.equal(plan.previousCase, null);
  assert.deepEqual(plan.deleteCaseIds, []);
});

test('已存在的報價重新儲存時，客戶只剩已完成案件也不會長出新案件', () => {
  const done = { id: 'k1', clientId: 'c1', clientName: '邱老闆', type: 'modification', title: '改車案件', status: 'completed', quoteIds: [] };
  const quote = { id: 'q9', clientId: 'c1', customerName: '邱老闆', items: [{ kind: 'addon', name: '尾門', price: 1 }] };
  const again = planQuoteCaseLink({ quote, cases: [done], quotes: [quote], isExisting: true, now: NOW });
  assert.equal(again.caseRow, null);
  const fresh = planQuoteCaseLink({ quote, cases: [done], quotes: [], isExisting: false, now: NOW });
  assert.equal(fresh.caseRow.type, 'modification'); // 沒有車輛品項 → 改裝，不是買車
});
