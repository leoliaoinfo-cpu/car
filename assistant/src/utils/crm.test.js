import test from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import { clientMatchesFilter, getClientStatus } from './crm.js';

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
