import test from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import { clientMatchesFilter, getClientCustomerKind, getClientStatus } from './crm.js';

const thresholds = { coldDays: 180, deadDays: 365 };

function neverContacted(daysAgo) {
  return { createdAt: dayjs().subtract(daysAgo, 'day').toISOString(), lastContact: '', nextDate: '' };
}

test('never-contacted clients progress from active to overdue and then long-term inactive', () => {
  assert.equal(getClientStatus(neverContacted(30), thresholds), 'ok');
  assert.equal(getClientStatus(neverContacted(200), thresholds), 'hot');
  assert.equal(getClientStatus(neverContacted(400), thresholds), 'cold');
});

test('the stale-client quick filter includes both warning levels', () => {
  assert.equal(clientMatchesFilter(neverContacted(200), 'cold', thresholds), true);
  assert.equal(clientMatchesFilter(neverContacted(400), 'cold', thresholds), true);
  assert.equal(clientMatchesFilter(neverContacted(30), 'cold', thresholds), false);
});

test('customer kind uses an explicit board classification before linked cases', () => {
  const client = { id: 'client-1', customerKind: 'modification' };
  const cases = [{ id: 'case-1', clientId: 'client-1', type: 'purchase' }];
  assert.equal(getClientCustomerKind(client, cases), 'modification');
});

test('legacy customers are classified from purchase and modification cases', () => {
  const client = { id: 'client-1' };
  assert.equal(getClientCustomerKind(client, []), 'unclassified');
  assert.equal(getClientCustomerKind(client, [{ id: 'p', clientId: 'client-1', type: 'purchase' }]), 'purchase');
  assert.equal(getClientCustomerKind(client, [{ id: 'm', clientId: 'client-1', type: 'modification' }]), 'modification');
  assert.equal(getClientCustomerKind(client, [
    { id: 'p', clientId: 'client-1', type: 'purchase' },
    { id: 'm', clientId: 'client-1', type: 'modification' },
  ]), 'both');
});

test('重疊規則：特仕版鎖橡膠底板、LED韓版後照鏡鎖鏡蓋與空力套裝，舊設定升級後也帶入', async () => {
  const { DEFAULT_QUOTE_PRESETS, resolveQuotePresets } = await import('./crm.js');
  const by = (presets, id) => presets.addons.find((a) => a.id === id);
  assert.deepEqual(by(DEFAULT_QUOTE_PRESETS, 'qa-pkg1').locks, ['qa-floor-rubber-full-s', 'qa-floor-rubber-full-l', 'qa-floor-rubber-full-d', 'qa-floor-rubber-only-s', 'qa-floor-rubber-only-l', 'qa-floor-rubber-only-d']);
  assert.deepEqual(by(DEFAULT_QUOTE_PRESETS, 'qa-mirror1').locks, ['qa-mcover', 'qa-aero']);
  // 使用者之前存過的設定（沒有 locks）升級後要補上
  const old = { _catalog: 'kavan-2026-v29', addonCategories: ['配備版本'], addons: DEFAULT_QUOTE_PRESETS.addons.map(({ locks, ...rest }) => rest) };
  const resolved = resolveQuotePresets(old);
  assert.deepEqual(by(resolved, 'qa-pkg1').locks, ['qa-floor-rubber-full-s', 'qa-floor-rubber-full-l', 'qa-floor-rubber-full-d', 'qa-floor-rubber-only-s', 'qa-floor-rubber-only-l', 'qa-floor-rubber-only-d']);
  assert.deepEqual(by(resolved, 'qa-mcover').locks, ['qa-mirror1']);
});
