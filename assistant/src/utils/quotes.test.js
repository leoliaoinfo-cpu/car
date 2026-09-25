import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeQuotes, quotesForClient } from './quotes.js';

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
  ], 'c1');
  assert.deepEqual(rows.map((row) => row.id), ['q3', 'q1']);
});
