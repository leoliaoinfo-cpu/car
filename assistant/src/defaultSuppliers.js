// 預設廠商（使用者告知的合作廠商）：第一次載入時加進「廠商名冊」一次，之後刪掉不會再加回來。
// 已做過的記在 settings 的 `seedSuppliers` 列（隨雲端同步），所以換裝置也不會重複加。
export const DEFAULT_SUPPLIERS = [
  {
    seedKey: 'xinshun', id: 'supplier-seed-xinshun', name: '信順汽車配件', contact: '陳泰元', services: ['橡膠墊'],
    note: '老闆：陳泰元。貨斗橡膠墊（全封／只鋪底面）外包廠商。', active: true,
  },
  {
    seedKey: 'huoju-canvas', id: 'supplier-seed-huoju-canvas', name: '炬方鐵架帆布', contact: '蕭小姐', services: ['升降帆布'],
    note: [
      '【參考報價，2026-10-27，廠商回覆】特殊規格，僅供參考，不作為報價表價格（報價表的升降帆布仍為「待報價」）。',
      '卡旺 單廂：共用尾門馬達（3尺）；帆布墨綠；後掀門；側邊安裝單折鐵架（單截拚）；特殊電動升降（上可掀下可放）$120,000。',
      '高度：降低（平車頭）195cm、升 80cm；斗內高預估 110–195cm。若要更高可再做：降低 235cm、升 90cm、斗內高 150–240cm（但旁邊單折鐵架與尾門 3 尺的空洞會變大）。',
      '加價：帆布換色（黑／灰）+$4,000；室內燈（1組4盞含手動開關）+$5,000；鍊目 +$50／顆。',
      '以上價格未稅；代辦變更 +$2,500（含政府基本規費，不含其他未繳及違規費用）。',
      '【2026-10-28 補充】卡旺單廂硬頂帆布、車底起 170cm 的五面帆：廠商不建議做到五面；廠商沒有做傳統五面掀，只做氣壓掀。',
    ].join('\n'),
    active: true,
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
    // 名冊裡已經有同名的廠商就不重複加
    if (existing.some((row) => String(row?.name || '').trim() === def.name)) continue;
    const now = new Date().toISOString();
    const row = { createdAt: now, updatedAt: now, ...def };
    try { await db.put('suppliers', row); added.push(row); } catch { done.delete(seedKey); }
  }
  if (done.size !== before) { try { await db.put('settings', { key: 'seedSuppliers', done: [...done] }); } catch { /* 下次再試 */ } }
  return added.length ? [...existing, ...added] : existing;
}
