import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVault, unlockVault, changeVaultPassphrase, passphraseProblem,
  encryptJson, decryptJson, sealSnapshot, openSnapshot, snapshotHasSealed, findVaultRecord,
} from './vault.js';

const FAST = { iterations: 1000 };

test('密語規則：至少 8 字且英數混合', () => {
  assert.ok(passphraseProblem('1234'));
  assert.ok(passphraseProblem('12345678'));
  assert.ok(passphraseProblem('abcdefgh'));
  assert.equal(passphraseProblem('kia2500leo'), '');
});

test('建立保險箱後，正確密語打得開、錯誤密語打不開', async () => {
  const { record, dek } = await createVault('kia2500leo', FAST);
  assert.ok(record.wrapped && record.salt && record.iv);
  assert.doesNotMatch(JSON.stringify(record), /kia2500leo/);
  const enc = await encryptJson(dek, { cost: 29000 });
  const dek2 = await unlockVault(record, 'kia2500leo');
  assert.deepEqual(await decryptJson(dek2, enc), { cost: 29000 });
  await assert.rejects(() => unlockVault(record, 'wrong1234'), /成本密語不正確/);
});

test('換密語後舊資料仍能用新密語解開，舊密語失效', async () => {
  const { record, dek } = await createVault('kia2500leo', FAST);
  const enc = await encryptJson(dek, { profit: 8000 });
  const next = await changeVaultPassphrase(record, 'kia2500leo', 'newpass99');
  const dek2 = await unlockVault(next, 'newpass99');
  assert.deepEqual(await decryptJson(dek2, enc), { profit: 8000 });
  await assert.rejects(() => unlockVault(next, 'kia2500leo'));
});

test('封存快照：成本類加密、客戶資料不動、主鍵與時間保留；解封完全還原', async () => {
  const { record, dek } = await createVault('kia2500leo', FAST);
  const data = {
    clients: [{ id: 'c1', name: '王老闆', phone: '0912', _ts: 1 }],
    pricingRecords: [{ id: 'quote:q1', profit: 12345, lines: [{ cost: 29000 }], _ts: 5 }],
    salaryMonths: [{ key: '2026-11', total: 88000, _ts: 6 }],
    settings: [{ key: 'costCatalog', addons: { a: { cost: 4000 } }, _ts: 7 }, { key: 'quotePresets', x: 1, _ts: 8 }, record],
    deals: [{ id: 'd1', amount: 900000, cost: 845000, profit: 55000, _ts: 9 }, { id: 'd2', amount: 1, _ts: 3 }],
    tombstones: [{ id: 'clients:x', ts: 2 }],
  };
  const sealed = await sealSnapshot(dek, data);
  const text = JSON.stringify(sealed);
  for (const secret of ['12345', '29000', '88000', '4000', '845000', '55000']) assert.ok(!text.includes(secret), `不應看到 ${secret}`);
  assert.ok(text.includes('王老闆') && text.includes('900000'));
  assert.equal(sealed.pricingRecords[0].id, 'quote:q1');
  assert.equal(sealed.pricingRecords[0]._ts, 5);
  assert.equal(sealed.deals[1], data.deals[1]);
  assert.ok(snapshotHasSealed(sealed));
  assert.ok(findVaultRecord(sealed));
  assert.deepEqual(await openSnapshot(dek, sealed), data);
  await assert.rejects(() => openSnapshot(null, sealed), /NEED_VAULT/);
});

test('舊版未加密的資料可直接通過（相容）', async () => {
  const data = { pricingRecords: [{ id: 'a', profit: 1, _ts: 1 }] };
  assert.equal(snapshotHasSealed(data), false);
  assert.deepEqual(await openSnapshot(null, data), data);
});

test('偵測雲端還有沒加密的成本資料', async () => {
  const { snapshotHasPlainSecrets } = await import('./vault.js');
  const { dek } = await createVault('kia2500leo', FAST);
  const plain = { pricingRecords: [{ id: 'a', profit: 1, _ts: 1 }], deals: [{ id: 'd', cost: 1, _ts: 1 }] };
  assert.equal(snapshotHasPlainSecrets(plain), true);
  assert.equal(snapshotHasPlainSecrets(await sealSnapshot(dek, plain)), false);
  assert.equal(snapshotHasPlainSecrets({ clients: [{ id: 'c' }] }), false);
});
