import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyMasterPin, hashMasterPin, isValidMasterPin, masterPinProblem, MASTER_HASH_DEFAULT } from './masterPin.js';
import { GATE_HASH } from './appGate.js';

test('預設密碼 0623，和原本入口密碼的雜湊一致', async () => {
  assert.equal(MASTER_HASH_DEFAULT, GATE_HASH);
  assert.equal(await verifyMasterPin('0623', null), true);
  assert.equal(await verifyMasterPin(' 0623 ', ''), true);
  assert.equal(await verifyMasterPin('0000', null), false);
  assert.equal(await verifyMasterPin('', null), false);
});

test('改密碼後：新的通過、舊的（0623）失效', async () => {
  const hash = await hashMasterPin('8899');
  assert.equal(await verifyMasterPin('8899', hash), true);
  assert.equal(await verifyMasterPin('0623', hash), false);
});

test('新密碼規則：4～12 位數字、兩次一致', () => {
  assert.equal(isValidMasterPin('123'), false);
  assert.equal(isValidMasterPin('12345678901234'), false);
  assert.equal(isValidMasterPin('12ab'), false);
  assert.equal(isValidMasterPin('0623'), true);
  assert.ok(masterPinProblem('1234', '1235'));
  assert.equal(masterPinProblem('1234', '1234'), '');
});
