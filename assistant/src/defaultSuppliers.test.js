import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDefaultSuppliers } from './defaultSuppliers.js';

function fakeDb() {
  const rows = new Map();
  return {
    rows,
    async get(store, key) { return rows.get(`${store}:${key}`) ?? null; },
    async put(store, row) { rows.set(`${store}:${row.id ?? row.key}`, row); },
  };
}

test('預設廠商：信順與炬方鐵架帆布各加一次，不重複加', async () => {
  const db = fakeDb();
  const first = await seedDefaultSuppliers(db, []);
  assert.deepEqual(first.map((r) => r.name).sort(), ['信順汽車配件', '炬方鐵架帆布']);
  const huoju = first.find((r) => r.name === '炬方鐵架帆布');
  assert.deepEqual(huoju.services, ['升降帆布']);
  assert.match(huoju.note, /120,000/);
  const second = await seedDefaultSuppliers(db, first);
  assert.equal(second.length, 2);
});
