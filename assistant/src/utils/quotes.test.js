import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeQuotes, getQuoteAgeDays, getQuoteAttention, quotesForClient } from './quotes.js';

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
