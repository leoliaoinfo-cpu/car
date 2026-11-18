import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGatePin, isGateUnlocked, GATE_REMEMBER_MS } from './appGate.js';

test('入口密碼：對的通過、錯的與空白不通過', async () => {
  assert.equal(await checkGatePin('0623'), true);
  assert.equal(await checkGatePin(' 0623 '), true);
  assert.equal(await checkGatePin('0000'), false);
  assert.equal(await checkGatePin(''), false);
});

test('入口記住期限：過期或亂填都要重輸', () => {
  const now = 1_000_000;
  assert.equal(isGateUnlocked(now + 1000, now), true);
  assert.equal(isGateUnlocked(now - 1, now), false);
  assert.equal(isGateUnlocked(null, now), false);
  assert.equal(isGateUnlocked('abc', now), false);
  assert.equal(isGateUnlocked(now + GATE_REMEMBER_MS * 10, now), false);
});
