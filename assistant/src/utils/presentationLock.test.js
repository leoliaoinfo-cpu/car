import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PRESENTATION_PIN_HASH, hashPresentationPin, isValidPresentationPin, verifyPresentationPin,
} from './presentationLock.js';

test('customer presentation PIN accepts exactly four digits', () => {
  assert.equal(isValidPresentationPin('2580'), true);
  assert.equal(isValidPresentationPin('123'), false);
  assert.equal(isValidPresentationPin('12345'), false);
  assert.equal(isValidPresentationPin('12a4'), false);
});

test('customer presentation PIN is verified from a hash instead of plaintext', async () => {
  const stored = await hashPresentationPin('0623');
  assert.equal(stored, DEFAULT_PRESENTATION_PIN_HASH);
  assert.notEqual(stored, '0623');
  assert.equal(await verifyPresentationPin('0623', stored), true);
  assert.equal(await verifyPresentationPin('0624', stored), false);
});
