// 預設廠商（使用者告知的合作廠商）：第一次載入時加進「廠商名冊」一次，之後刪掉不會再加回來。
// 已做過的記在 settings 的 `seedSuppliers` 列（隨雲端同步），所以換裝置也不會重複加。
export const DEFAULT_SUPPLIERS = [
  {
    seedKey: 'xinshun', id: 'supplier-seed-xinshun', name: '信順汽車配件', contact: '陳泰元', services: ['橡膠墊'],
    note: '老闆：陳泰元。貨斗橡膠墊（全封／只鋪底面）外包廠商。', active: true,
  },
];

export async function seedDefaultSuppliers(db, existing = []) {
  let flagRow = null;
  try { flagRow = await db.get('settings', 'seedSuppliers'); } catch { flagRow = null; }
  const done = new Set(Array.isArray(flagRow?.done) ? flagRow.done : []);
  const before = done.size;
  const added = [];
  for (const { seedKey, ...def } of DEFAULT_SUPPLIERS) {
    if (done.has(seedKey)) continue;
    done.add(seedKey);
    // 名冊裡已經有同名（或名稱含「信順」）的廠商就不重複加
    if (existing.some((row) => String(row?.name || '').includes(def.name.slice(0, 2)) && String(row?.name || '').includes('信順'))) continue;
    const now = new Date().toISOString();
    const row = { createdAt: now, updatedAt: now, ...def };
    try { await db.put('suppliers', row); added.push(row); } catch { done.delete(seedKey); }
  }
  if (done.size !== before) { try { await db.put('settings', { key: 'seedSuppliers', done: [...done] }); } catch { /* 下次再試 */ } }
  return added.length ? [...existing, ...added] : existing;
}
