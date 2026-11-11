import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_STORES, STORE_KEYS, TOMBSTONE_KEEP_MS, changedPatch, mergeSnapshots, mergeTombstoneLists,
  planImportStore, planStoreApply, planTombstoneApply, pricingRecordsToDropForClients, recTs,
} from './dataMerge.js';

const DAY = 24 * 3600 * 1000;

test('recTs：_ts 為 0 的預設值退回 updatedAt／createdAt，皆無則為 0', () => {
  assert.equal(recTs({ _ts: 5 }), 5);
  assert.equal(recTs({ _ts: 0 }), 0);
  assert.equal(recTs({ _ts: 0, updatedAt: '2026-01-01T00:00:00.000Z' }), Date.parse('2026-01-01T00:00:00.000Z'));
  assert.equal(recTs(null), 0);
});

test('每個同步 store 都有主鍵', () => {
  for (const store of ALL_STORES) assert.ok(STORE_KEYS[store], store);
});

test('套用同步結果：拉資料期間本機新寫的資料不被舊合併結果蓋掉', () => {
  const current = [{ id: 'c1', name: '剛剛改的', _ts: 300 }];
  const merged = [{ id: 'c1', name: '拉資料前的舊版', _ts: 100 }];
  const plan = planStoreApply('clients', 'id', current, merged, new Map());
  assert.deepEqual(plan, { puts: [], deletes: [] });
});

test('套用同步結果：遠端較新才寫入，本機沒有的補上', () => {
  const current = [{ id: 'c1', _ts: 100 }];
  const merged = [{ id: 'c1', _ts: 200 }, { id: 'c2', _ts: 50 }];
  const plan = planStoreApply('clients', 'id', current, merged, new Map());
  assert.deepEqual(plan.puts.map((r) => r.id), ['c1', 'c2']);
  assert.deepEqual(plan.deletes, []);
});

test('套用同步結果：合併結果沒有、也沒被墓碑蓋到的本機資料保留（拉資料期間新增的）', () => {
  const current = [{ id: 'new-during-pull', _ts: 999 }];
  const plan = planStoreApply('clients', 'id', current, [], new Map());
  assert.deepEqual(plan.deletes, []);
});

test('套用同步結果：只有墓碑（刪除時間 ≥ 資料時間）才刪本機資料；刪除後又改過的保留', () => {
  const tombs = mergeTombstoneLists([
    { id: 'clients:gone', store: 'clients', key: 'gone', ts: 500 },
    { id: 'clients:revived', store: 'clients', key: 'revived', ts: 500 },
  ]);
  const current = [{ id: 'gone', _ts: 400 }, { id: 'revived', _ts: 600 }];
  const plan = planStoreApply('clients', 'id', current, [], tombs);
  assert.deepEqual(plan.deletes, ['gone']);
});

test('套用同步結果：被墓碑蓋到的合併資料不會寫入（拉資料期間剛刪的不復活）', () => {
  const tombs = mergeTombstoneLists([{ id: 'deals:d1', store: 'deals', key: 'd1', ts: 900 }]);
  const plan = planStoreApply('deals', 'id', [], [{ id: 'd1', _ts: 100 }], tombs);
  assert.deepEqual(plan.puts, []);
});

test('墓碑只增不減：同 id 取較新、本機獨有的保留', () => {
  const current = [{ id: 'a', ts: 10 }, { id: 'b', ts: 50 }];
  const incoming = [{ id: 'a', ts: 20 }, { id: 'b', ts: 40 }, { id: 'c', ts: 5 }];
  assert.deepEqual(planTombstoneApply(current, incoming).map((t) => t.id), ['a', 'c']);
  const map = mergeTombstoneLists(current, incoming);
  assert.equal(map.get('a').ts, 20);
  assert.equal(map.get('b').ts, 50);
});

test('合併快照：墓碑保留期間至少一年（久未開的裝置不讓已刪資料復活）', () => {
  assert.ok(TOMBSTONE_KEEP_MS >= 365 * DAY);
  const now = Date.parse('2026-11-11T00:00:00.000Z');
  const tombTs = now - 200 * DAY; // 舊版 90 天就會被丟掉
  const staleDevice = { clients: [{ id: 'x', _ts: tombTs - DAY }], tombstones: [] };
  const remote = { clients: [], tombstones: [{ id: 'clients:x', store: 'clients', key: 'x', ts: tombTs }] };
  const merged = mergeSnapshots(staleDevice, remote, { now });
  assert.deepEqual(merged.clients, []);
  assert.equal(merged.tombstones.length, 1);
});

test('合併快照：逐筆新的贏，同分時第一份優先', () => {
  const merged = mergeSnapshots(
    { clients: [{ id: 'a', v: 'local', _ts: 5 }, { id: 'b', v: 'local', _ts: 9 }] },
    { clients: [{ id: 'a', v: 'remote', _ts: 5 }, { id: 'b', v: 'remote', _ts: 10 }] },
  );
  const byId = Object.fromEntries(merged.clients.map((r) => [r.id, r.v]));
  assert.deepEqual(byId, { a: 'local', b: 'remote' });
});

test('合併快照：_ts 0 的預設值永遠輸給使用者自訂過的同 id 資料', () => {
  const fresh = { cats: [{ id: 'cat-1', name: '一般客戶', _ts: 0 }] };
  const real = { cats: [{ id: 'cat-1', name: '車隊客戶', _ts: 123 }] };
  assert.equal(mergeSnapshots(fresh, real).cats[0].name, '車隊客戶');
  assert.equal(mergeSnapshots(real, fresh).cats[0].name, '車隊客戶');
});

test('安全合併還原：本機較新的保留、備份較新的採用、本機沒有的補回', () => {
  const local = [{ id: 'a', v: 'local-new', _ts: 200 }, { id: 'b', v: 'local-old', _ts: 100 }];
  const imported = [{ id: 'a', v: 'backup-old', _ts: 100 }, { id: 'b', v: 'backup-new', _ts: 200 }, { id: 'c', v: 'backup', _ts: 50 }];
  const plan = planImportStore('clients', 'id', local, imported, new Map(), { mode: 'merge', now: 1000 });
  assert.deepEqual(plan.puts.map((r) => `${r.id}:${r.v}`), ['b:backup-new', 'c:backup']);
  assert.deepEqual(plan.dropTombstones, []);
  assert.equal(plan.puts[1]._ts, 50); // 沒被刪過的保留原本時間，不蓋掉別台較新的
});

test('還原備份：已被刪除（有墓碑）的資料會被救回——重蓋時間並移除墓碑', () => {
  const tombs = mergeTombstoneLists([{ id: 'clients:a', store: 'clients', key: 'a', ts: 500 }]);
  for (const mode of ['merge', 'replace']) {
    const plan = planImportStore('clients', 'id', [], [{ id: 'a', _ts: 100 }], tombs, { mode, now: 1000 });
    assert.equal(plan.puts.length, 1, mode);
    assert.ok(recTs(plan.puts[0]) > 500, mode);
    assert.deepEqual(plan.dropTombstones, ['clients:a'], mode);
    // 套用：墓碑移除後，合併時不會再被刪掉
    const merged = mergeSnapshots({ clients: plan.puts, tombstones: [] }, { clients: [], tombstones: [{ id: 'clients:a', store: 'clients', key: 'a', ts: 500 }] });
    assert.equal(merged.clients.length, 1, mode);
  }
});

test('還原備份：略過沒有主鍵的壞資料', () => {
  const plan = planImportStore('clients', 'id', [], [{ name: '沒有 id' }, null], new Map(), { mode: 'replace' });
  assert.deepEqual(plan.puts, []);
});

test('changedPatch：欄位都一樣回傳 null，否則只回傳不同的欄位', () => {
  assert.equal(changedPatch({ clientId: 'c1', clientName: '王' }, { clientId: 'c1', clientName: '王' }), null);
  assert.deepEqual(changedPatch({ clientId: 'c1', clientName: '王' }, { clientId: 'c1', clientName: '王老闆' }), { clientName: '王老闆' });
  assert.deepEqual(changedPatch({ clientId: 'tmp' }, { clientId: 'c1' }), { clientId: 'c1' });
});

test('刪客戶：綁著仍存在的成交或報價的成本紀錄保留，其餘才刪', () => {
  const records = [
    { id: 'deal:d1', clientId: 'c1', dealId: 'd1' },
    { id: 'deal:dGone', clientId: 'c1' },
    { id: 'quote:q1', clientId: 'c1', quoteId: 'q1' },
    { id: 'quote:qGone', clientId: 'c1' },
    { id: 'deal:d9', clientId: 'other' },
  ];
  const drop = pricingRecordsToDropForClients(records, ['c1'], { dealIds: new Set(['d1']), quoteIds: new Set(['q1']) });
  assert.deepEqual(drop.map((r) => r.id), ['deal:dGone', 'quote:qGone']);
});
