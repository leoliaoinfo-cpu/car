import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKEND_SESSION_TTL_MS, createBackendSessionDeadline, DEFAULT_PRESENTATION_PIN_HASH,
  hashPresentationPin, isBackendSessionUnlocked, isValidPresentationPin, registerPinFailure, verifyPresentationPin,
} from './presentationLock.js';

test('backend PIN accepts four through twelve digits', () => {
  assert.equal(isValidPresentationPin('2580'), true);
  assert.equal(isValidPresentationPin('12345678'), true);
  assert.equal(isValidPresentationPin('123456789012'), true);
  assert.equal(isValidPresentationPin('123'), false);
  assert.equal(isValidPresentationPin('1234567890123'), false);
  assert.equal(isValidPresentationPin('12a4'), false);
});

test('customer presentation PIN is verified from a hash instead of plaintext', async () => {
  const stored = await hashPresentationPin('0623');
  assert.equal(stored, DEFAULT_PRESENTATION_PIN_HASH);
  assert.notEqual(stored, '0623');
  assert.equal(await verifyPresentationPin('0623', stored), true);
  assert.equal(await verifyPresentationPin('0624', stored), false);
});

test('backend PIN pauses after five failed attempts', () => {
  let state = { failureCount: 0, lockedUntil: 0 };
  for (let index = 0; index < 4; index += 1) state = registerPinFailure(state.failureCount, 1_000);
  assert.deepEqual(state, { failureCount: 4, lockedUntil: 0 });
  state = registerPinFailure(state.failureCount, 1_000);
  assert.deepEqual(state, { failureCount: 0, lockedUntil: 31_000 });
});

test('backend unlock stays in the current session for thirty minutes only', () => {
  const now = 1_000;
  const deadline = createBackendSessionDeadline(now);
  assert.equal(deadline, now + BACKEND_SESSION_TTL_MS);
  assert.equal(isBackendSessionUnlocked(deadline, now + 1), true);
  assert.equal(isBackendSessionUnlocked(deadline, deadline), false);
  assert.equal(isBackendSessionUnlocked(deadline + 1, now), false);
});
