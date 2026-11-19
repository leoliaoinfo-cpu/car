import test from 'node:test';
import assert from 'node:assert/strict';
import { saveQuoteWip, loadQuoteWip, clearQuoteWip } from './quoteWip.js';

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test('存了就讀得回來，清掉後讀不到', () => {
  const st = fakeStorage();
  saveQuoteWip({ isNew: true, payload: { id: 'quote:1', customerName: '王' } }, st);
  assert.equal(loadQuoteWip(st).payload.customerName, '王');
  clearQuoteWip(st);
  assert.equal(loadQuoteWip(st), null);
});

test('超過 7 天或壞掉的草稿不還原', () => {
  const st = fakeStorage();
  saveQuoteWip({ payload: { id: 'q' } }, st);
  assert.equal(loadQuoteWip(st, Date.now() + 8 * 24 * 3600 * 1000), null);
  st.setItem('car-sales.quote.wip', '{壞掉');
  assert.equal(loadQuoteWip(st), null);
  st.setItem('car-sales.quote.wip', JSON.stringify({ savedAt: Date.now(), payload: {} }));
  assert.equal(loadQuoteWip(st), null);
});
