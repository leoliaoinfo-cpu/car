/**
 * 資料合併的純邏輯（不碰 IndexedDB、不碰網路），供 db.js / sync.js / context.jsx 共用，
 * 並可在 node 直接單元測試。
 *
 * 核心原則：資料絕不能遺失。
 * - 逐筆「新的贏」（比 _ts，沒有就退回 updatedAt / createdAt）
 * - 只有墓碑（刪除時間 ≥ 資料最後修改時間）才能刪掉一筆資料
 * - 合併結果沒有、但也沒被墓碑蓋到的本機資料一律保留
 */

export const ALL_STORES = [
  'clients', 'cats', 'stages', 'customFields',
  'deals', 'dealFields', 'pricingRecords', 'quoteDrafts', 'receptionSessions', 'suppliers', 'cases', 'workItems', 'activities', 'tasks', 'events',
  'journalEntries', 'archivedJournal',
  'salaryMonths', 'timers', 'timerHistory', 'settings',
];

// 各 store 的主鍵欄位（同步合併時逐筆比對用）
export const STORE_KEYS = {
  clients: 'id', cats: 'id', stages: 'id', customFields: 'id',
  deals: 'id', dealFields: 'id', pricingRecords: 'id', quoteDrafts: 'id', receptionSessions: 'id', suppliers: 'id', cases: 'id', workItems: 'id', activities: 'id', tasks: 'id', events: 'id', timers: 'id', timerHistory: 'id',
  settings: 'key', salaryMonths: 'key',
  journalEntries: 'date', archivedJournal: 'date',
};

/**
 * 墓碑保留期間。墓碑很小（一筆約百位元組），保留越久越不怕「久未開機的裝置把已刪資料復活」。
 * 原本 90 天太短；改為 2 年（系統要求可用 5 年，一台裝置兩年沒開的機率極低）。
 */
export const TOMBSTONE_KEEP_MS = 730 * 24 * 3600 * 1000;

export const tombstoneId = (store, key) => `${store}:${key}`;

/** 一筆資料的最後修改時間（毫秒）；_ts: 0 代表「預設值／種子」，永遠不會贏過真實資料 */
export function recTs(r) {
  return r?._ts
    || (r?.updatedAt ? Date.parse(r.updatedAt) : 0)
    || (r?.createdAt ? Date.parse(r.createdAt) : 0)
    || 0;
}

/** 墓碑合併：同一 id 取較新的；不刪除任何一方已有的墓碑（過期清除交給每日保養） */
export function mergeTombstoneLists(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const t of list || []) {
      if (!t?.id) continue;
      const prev = map.get(t.id);
      if (!prev || (t.ts || 0) > (prev.ts || 0)) map.set(t.id, t);
    }
  }
  return map;
}

/** 墓碑是否蓋過這筆資料（刪除時間 ≥ 資料最後修改時間） */
export function isCoveredByTombstone(row, tomb) {
  return !!tomb && recTs(row) <= (tomb.ts || 0);
}

/** 逐筆「新的贏」合併兩份快照，並套用雙方墓碑；回傳合併結果（同分時 a 優先） */
export function mergeSnapshots(a, b, { now = Date.now(), stores = ALL_STORES, keys = STORE_KEYS, keepMs = TOMBSTONE_KEEP_MS } = {}) {
  const out = { _v: 2, exportedAt: new Date(now).toISOString() };
  const tombMap = mergeTombstoneLists(a?.tombstones, b?.tombstones);
  const tombs = [...tombMap.values()].filter((t) => now - (t.ts || 0) < keepMs);
  out.tombstones = tombs;

  for (const store of stores) {
    const keyField = keys[store];
    const map = new Map();
    for (const r of (a?.[store] || [])) map.set(r[keyField], r);
    for (const r of (b?.[store] || [])) {
      const k = r[keyField];
      const prev = map.get(k);
      if (!prev || recTs(r) > recTs(prev)) map.set(k, r);
    }
    for (const t of tombs) {
      if (t.store !== store) continue;
      const cur = map.get(t.key);
      if (cur && isCoveredByTombstone(cur, t)) map.delete(t.key);
    }
    out[store] = [...map.values()];
  }
  return out;
}

/**
 * 把合併結果套用到「目前」的本機資料（不清空 store）。
 * @param currentRows 套用當下 store 內的資料（可能含同步拉資料期間剛寫入的新資料）
 * @param mergedRows  合併結果
 * @param tombMap     合併後的全部墓碑（Map id → tomb）
 * @returns {{ puts: object[], deletes: any[] }}
 */
export function planStoreApply(store, keyField, currentRows = [], mergedRows = [], tombMap = new Map()) {
  const current = new Map(currentRows.map((r) => [r[keyField], r]));
  const puts = [];
  const deletes = [];
  const putKeys = new Set();
  for (const row of mergedRows) {
    const key = row[keyField];
    const cur = current.get(key);
    if (isCoveredByTombstone(row, tombMap.get(tombstoneId(store, key)))) continue;
    if (!cur || recTs(row) > recTs(cur)) { puts.push(row); putKeys.add(key); }
  }
  for (const [key, cur] of current) {
    if (putKeys.has(key)) continue;
    if (isCoveredByTombstone(cur, tombMap.get(tombstoneId(store, key)))) deletes.push(key);
  }
  return { puts, deletes };
}

/** 本機墓碑需要新增／更新的那些（合併後比本機新或本機沒有） */
export function planTombstoneApply(currentTombs = [], incomingTombs = []) {
  const current = new Map(currentTombs.map((t) => [t.id, t]));
  return incomingTombs.filter((t) => t?.id && (!current.has(t.id) || (t.ts || 0) > (current.get(t.id).ts || 0)));
}

/**
 * 還原備份的計畫（純邏輯）。
 * - merge：本機與備份逐筆取較新的；本機沒有的直接補回。
 * - replace：整份用備份內容。
 * 兩種模式下，備份裡「已被刪除（有墓碑）」的資料都視為使用者要救回：重新蓋上現在時間並移除墓碑，
 * 否則開著雲端同步時，墓碑會在下一次同步又把它刪掉。
 * @returns {{ puts: object[], dropTombstones: string[] }}
 */
export function planImportStore(store, keyField, localRows = [], importedRows = [], tombMap = new Map(), { mode = 'merge', now = Date.now() } = {}) {
  const local = new Map(localRows.map((r) => [r[keyField], r]));
  const puts = [];
  const dropTombstones = [];
  for (const row of importedRows) {
    if (!row || row[keyField] == null) continue;
    const key = row[keyField];
    const tid = tombstoneId(store, key);
    const tomb = tombMap.get(tid);
    const cur = local.get(key);
    if (mode === 'merge' && cur && recTs(cur) >= recTs(row)) continue; // 本機較新（或一樣）→ 保留本機
    if (isCoveredByTombstone(row, tomb) && (mode === 'replace' || !cur)) {
      puts.push({ ...row, _ts: Math.max(now, (tomb.ts || 0) + 1) });
      dropTombstones.push(tid);
    } else {
      puts.push(row);
    }
  }
  return { puts, dropTombstones };
}

/** 找出「欄位值確實不同」的部分；全部相同回傳 null（避免無意義重寫蓋新 _ts） */
export function changedPatch(row, patch) {
  const diff = {};
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (row?.[k] !== v) { diff[k] = v; changed = true; }
  }
  return changed ? diff : null;
}

/**
 * 刪除客戶時哪些內部成本紀錄可以跟著刪：
 * 綁著仍存在的成交（deal:*／dealId）或仍存在的報價（quote:*／quoteId）一律保留，
 * 否則成交還在、營收照算，成本利潤卻不見了。
 */
export function pricingRecordsToDropForClients(records = [], clientIds, { dealIds = new Set(), quoteIds = new Set() } = {}) {
  const set = clientIds instanceof Set ? clientIds : new Set(clientIds);
  return records.filter((record) => {
    if (!record?.clientId || !set.has(record.clientId)) return false;
    const id = String(record.id || '');
    const dealId = record.dealId || (id.startsWith('deal:') ? id.slice(5) : null);
    const quoteId = record.quoteId || (id.startsWith('quote:') ? id.slice(6) : null);
    if (dealId && dealIds.has(dealId)) return false;
    if (quoteId && quoteIds.has(quoteId)) return false;
    return true;
  });
}
