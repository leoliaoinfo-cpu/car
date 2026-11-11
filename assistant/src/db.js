import { openDB } from 'idb';
import { CAR_DB_NAME, LEGACY_SHARED_DB_NAME, STORAGE_KEYS } from './storageKeys';
import {
  ALL_STORES, STORE_KEYS, TOMBSTONE_KEEP_MS, mergeTombstoneLists, planStoreApply, planTombstoneApply,
  planImportStore,
} from './utils/dataMerge.js';

const DB_NAME = CAR_DB_NAME;
// v12：以「客戶 → 案件 → 工作」為核心的行動工作台；舊資料不搬移、不刪除。
const DB_VERSION = 12;

let dbPromise = null;

// 開啟中被瀏覽器判定「被其他分頁的舊連線擋住」時通知上層（UI 用來顯示提示，
// 不會用來取消或重開連線——IndexedDB 的 blocked 是真實訊號，重開只會製造第二個
// 搶佔中的連線、讓情況更糟）。
let onBlocked = null;
export function setOnBlocked(cb) { onBlocked = cb; }

/**
 * 開啟資料庫。全程只維護單一 in-flight 連線（dbPromise 記憶體快取），
 * 絕不因為「等太久」就另外再開一次——真正會讓畫面卡住的情況是被其他分頁的
 * 舊版連線擋住（見 blocked 回呼），而非單純速度慢；用逾時去搶開第二條連線
 * 只會讓兩條連線互相卡住，反而製造原本沒有的當機。
 */
function openRaw() {
  return openDB(DB_NAME, DB_VERSION, {
      blocked() {
        console.warn('IndexedDB 升級被其他分頁擋住——請關閉其他開啟本系統（或舊版系統）的分頁');
        onBlocked?.();
      },
      terminated() {
        dbPromise = null; // 連線被瀏覽器強制中斷時，下次呼叫重新開啟
      },
      upgrade(database) {
        if (!database.objectStoreNames.contains('clients')) {
          const s = database.createObjectStore('clients', { keyPath: 'id' });
          s.createIndex('catId', 'catId');
          s.createIndex('stageId', 'stageId');
          s.createIndex('nextDate', 'nextDate');
          s.createIndex('lastContact', 'lastContact');
        }
        if (!database.objectStoreNames.contains('cats'))
          database.createObjectStore('cats', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('stages'))
          database.createObjectStore('stages', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('customFields'))
          database.createObjectStore('customFields', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('journalEntries'))
          database.createObjectStore('journalEntries', { keyPath: 'date' });
        if (!database.objectStoreNames.contains('archivedJournal'))
          database.createObjectStore('archivedJournal', { keyPath: 'date' });
        if (!database.objectStoreNames.contains('salaryMonths'))
          database.createObjectStore('salaryMonths', { keyPath: 'key' });
        if (!database.objectStoreNames.contains('timers'))
          database.createObjectStore('timers', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('timerHistory'))
          database.createObjectStore('timerHistory', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('settings'))
          database.createObjectStore('settings', { keyPath: 'key' });
        // v2：成交歸檔（業績表）
        if (!database.objectStoreNames.contains('deals')) {
          const d = database.createObjectStore('deals', { keyPath: 'id' });
          d.createIndex('clientId', 'clientId');
          d.createIndex('date', 'date');
        }
        if (!database.objectStoreNames.contains('dealFields'))
          database.createObjectStore('dealFields', { keyPath: 'id' });
        // v3：中央待辦（雜事）
        if (!database.objectStoreNames.contains('tasks'))
          database.createObjectStore('tasks', { keyPath: 'id' });
        // v4：刪除墓碑（雲端同步用——記住「這筆已刪」，合併時才不會被別台裝置的舊資料復活）
        if (!database.objectStoreNames.contains('tombstones'))
          database.createObjectStore('tombstones', { keyPath: 'id' });
        // v5：行事曆活動（生日、紀念日、重要日子；可每年重複、可關聯客戶）
        if (!database.objectStoreNames.contains('events')) {
          const ev = database.createObjectStore('events', { keyPath: 'id' });
          ev.createIndex('date', 'date');
          ev.createIndex('clientId', 'clientId');
        }
        // v6：客戶照片 / 名片（存壓縮後的 Blob，僅存本機、不進雲端同步與備份，
        // 避免同步檔爆量；刪客戶時一併刪除對應照片）
        if (!database.objectStoreNames.contains('photos')) {
          const ph = database.createObjectStore('photos', { keyPath: 'id' });
          ph.createIndex('clientId', 'clientId');
        }
        // v7：內部成本／利潤快照。和客戶報價物件分開，僅在密碼保護的成本中心顯示。
        if (!database.objectStoreNames.contains('pricingRecords')) {
          const pr = database.createObjectStore('pricingRecords', { keyPath: 'id' });
          pr.createIndex('clientId', 'clientId');
          pr.createIndex('quoteId', 'quoteId');
          pr.createIndex('dealId', 'dealId');
        }
        // v9：主導覽的報價管理工作區。可在尚未建立客戶檔時先逐步完成報價。
        if (!database.objectStoreNames.contains('quoteDrafts')) {
          const qd = database.createObjectStore('quoteDrafts', { keyPath: 'id' });
          qd.createIndex('clientId', 'clientId');
          qd.createIndex('date', 'date');
        }
        if (!database.objectStoreNames.contains('receptionSessions')) {
          const rs = database.createObjectStore('receptionSessions', { keyPath: 'id' });
          rs.createIndex('status', 'status');
          rs.createIndex('clientId', 'clientId');
          rs.createIndex('updatedAt', 'updatedAt');
        }
        if (!database.objectStoreNames.contains('suppliers')) {
          const supplier = database.createObjectStore('suppliers', { keyPath: 'id' });
          supplier.createIndex('name', 'name');
          supplier.createIndex('active', 'active');
        }
        if (!database.objectStoreNames.contains('cases')) {
          const cases = database.createObjectStore('cases', { keyPath: 'id' });
          cases.createIndex('clientId', 'clientId');
          cases.createIndex('status', 'status');
          cases.createIndex('updatedAt', 'updatedAt');
        }
        if (!database.objectStoreNames.contains('workItems')) {
          const workItems = database.createObjectStore('workItems', { keyPath: 'id' });
          workItems.createIndex('caseId', 'caseId');
          workItems.createIndex('clientId', 'clientId');
          workItems.createIndex('state', 'state');
          workItems.createIndex('due', 'due');
        }
        if (!database.objectStoreNames.contains('activities')) {
          const activities = database.createObjectStore('activities', { keyPath: 'id' });
          activities.createIndex('caseId', 'caseId');
          activities.createIndex('clientId', 'clientId');
          activities.createIndex('date', 'date');
        }
      },
  });
}

function getDB() {
  if (!dbPromise) {
    dbPromise = openRaw();
    // 開啟失敗（真正的錯誤，例如私密瀏覽拒絕存取）時清掉快取，讓下次操作可重試
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

export { STORE_KEYS };
export const SYNCED_STORES = ALL_STORES;

// 資料變動通知（雲端同步引擎訂閱後，變動會排程自動上傳）
let mutationListener = null;
export function setMutationListener(cb) { mutationListener = cb; }
function notifyMutation() { try { mutationListener?.(); } catch { /* 同步失敗不影響本機操作 */ } }
const setMutationListenerNotify = notifyMutation;

export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 唯讀匯出事故前的共用資料庫，供人工拆分與救援。
 * 絕不把內容自動搬進汽車系統，因為舊庫可能混有 /TEST/ 的不同產業資料。
 * photos 的 Blob 另留在舊庫，不塞進 JSON；這裡只輸出照片 metadata 方便盤點。
 */
export async function downloadLegacySharedRescue() {
  if (typeof indexedDB === 'undefined') throw new Error('瀏覽器不支援 IndexedDB');
  if (typeof indexedDB.databases === 'function') {
    const databases = await indexedDB.databases();
    if (!databases.some((item) => item.name === LEGACY_SHARED_DB_NAME)) {
      throw new Error('這台裝置沒有舊共用資料庫');
    }
  }

  const legacy = await openDB(LEGACY_SHARED_DB_NAME);
  try {
    const stores = [...legacy.objectStoreNames];
    const data = {
      _v: 'shared-rescue-1',
      exportedAt: new Date().toISOString(),
      warning: '此檔可能混有 /car/ 與 /TEST/ 兩套系統資料，請勿直接整份匯入；需先人工拆分。',
      sourceDatabase: LEGACY_SHARED_DB_NAME,
      stores: {},
    };
    for (const store of stores) {
      const rows = await legacy.getAll(store);
      data.stores[store] = store === 'photos'
        ? rows.map(({ blob, ...meta }) => ({ ...meta, blobOmitted: !!blob }))
        : rows;
    }
    downloadJSON(data, `shared-data-rescue-${new Date().toISOString().slice(0, 10)}.json`);
    return data;
  } finally {
    legacy.close();
  }
}

export const db = {
  async getAll(store) {
    return (await getDB()).getAll(store);
  },
  async get(store, key) {
    return (await getDB()).get(store, key);
  },
  async put(store, value) {
    // _ts＝這筆資料最後修改時間，雲端同步逐筆合併時「新的贏」的依據
    const stamped = { ...value, _ts: Date.now() };
    const res = await (await getDB()).put(store, stamped);
    notifyMutation();
    return res;
  },
  /** 原樣寫入、不重蓋 _ts（搬移舊資料等「內容沒實質改變」的情境用，避免舊裝置的整理動作蓋掉別台的新修改） */
  async putRaw(store, value) {
    const res = await (await getDB()).put(store, value);
    notifyMutation();
    return res;
  },
  async delete(store, key) {
    const database = await getDB();
    await database.delete(store, key);
    if (store !== 'tombstones') {
      await database.put('tombstones', { id: `${store}:${key}`, store, key, ts: Date.now() })
        .catch(() => {});
    }
    notifyMutation();
    return undefined;
  },
  async clear(store) {
    return (await getDB()).clear(store);
  },
  async count(store) {
    return (await getDB()).count(store);
  },

  async bulkPut(store, items) {
    if (!items || items.length === 0) return;
    const database = await getDB();
    const tx = database.transaction(store, 'readwrite');
    await Promise.all([...items.map((item) => tx.store.put(item)), tx.done]);
  },

  // ── 客戶照片 / 名片（本機專屬，不同步、不寫墓碑、不觸發上傳）──────────────
  async getPhotos(clientId) {
    const database = await getDB();
    return database.getAllFromIndex('photos', 'clientId', clientId);
  },
  async putPhoto(photo) {
    await (await getDB()).put('photos', photo);
    return photo;
  },
  async deletePhoto(id) {
    await (await getDB()).delete('photos', id);
  },
  /** 刪某客戶的所有照片（刪客戶時呼叫，釋放其佔用的空間） */
  async deletePhotosByClient(clientId) {
    const database = await getDB();
    const tx = database.transaction('photos', 'readwrite');
    let cursor = await tx.store.index('clientId').openCursor(clientId);
    while (cursor) { await cursor.delete(); cursor = await cursor.continue(); }
    await tx.done;
  },
  /** 客戶合併時把照片改掛到正式客戶（照片只存本機，刪了就永久消失） */
  async reassignPhotos(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return 0;
    const database = await getDB();
    const tx = database.transaction('photos', 'readwrite');
    let moved = 0;
    let cursor = await tx.store.index('clientId').openCursor(sourceId);
    while (cursor) {
      await cursor.update({ ...cursor.value, clientId: targetId });
      moved += 1;
      cursor = await cursor.continue();
    }
    await tx.done;
    return moved;
  },
  /** 目前所有照片佔用的位元組數（供設定頁顯示已用空間） */
  async photosUsage() {
    const all = await (await getDB()).getAll('photos');
    return all.reduce((sum, p) => sum + (p.size || p.blob?.size || 0), 0);
  },

  /**
   * 每日資料保養（防止資料檔經年累月無限膨脹拖垮同步）：
   * - 清過期墓碑（同步合併時也會清，這裡涵蓋「沒開同步」的情況）
   * - 刪 30 天前已完成的待辦、30 天前已確認的計時提醒
   *   （UI 早就不顯示它們了；走 db.delete 會留墓碑，其他裝置同步後一併刪除）
   */
  async housekeep() {
    const now = Date.now();
    const DONE_KEEP_MS = 30 * 24 * 3600 * 1000;

    const tombs = await db.getAll('tombstones');
    for (const t of tombs) {
      if (now - (t.ts || 0) >= TOMBSTONE_KEEP_MS) await db.delete('tombstones', t.id);
    }
    const timers = await db.getAll('timers');
    for (const t of timers) {
      const ts = t.confirmedAt ? Date.parse(t.confirmedAt) : NaN;
      if (!Number.isNaN(ts) && now - ts >= DONE_KEEP_MS) await db.delete('timers', t.id);
    }
    const tasks = await db.getAll('tasks');
    for (const t of tasks) {
      const ts = t.done && t.doneAt ? Date.parse(t.doneAt) : NaN;
      if (!Number.isNaN(ts) && now - ts >= DONE_KEEP_MS) await db.delete('tasks', t.id);
    }
    // 清孤兒照片：只刪「客戶確實已被刪除（有墓碑）」的照片。
    // 客戶暫時不在本機（例如剛還原備份、雲端還沒同步回來）時照片必須留著——照片只存本機，刪了救不回。
    const clientIds = new Set((await db.getAll('clients')).map((c) => c.id));
    const deletedClientIds = new Set((await db.getAll('tombstones'))
      .filter((t) => t.store === 'clients').map((t) => t.key));
    const database = await getDB();
    const tx = database.transaction('photos', 'readwrite');
    let cur = await tx.store.openCursor();
    while (cur) {
      const cid = cur.value.clientId;
      if (!clientIds.has(cid) && deletedClientIds.has(cid)) await cur.delete();
      cur = await cur.continue();
    }
    await tx.done;
  },

  /** Full export of all stores */
  async exportAll() {
    const data = { _v: 2, exportedAt: new Date().toISOString() };
    for (const store of ALL_STORES) {
      data[store] = await db.getAll(store);
    }
    return data;
  },

  /** 雲端同步用：完整快照（含刪除墓碑） */
  async exportForSync() {
    const data = await db.exportAll();
    data.tombstones = await db.getAll('tombstones');
    return data;
  },

  /**
   * 雲端同步用：把合併結果「逐筆」套進本機——絕不清空 store。
   * 在單一 readwrite 交易內讀取「當下」的本機資料再比對，所以同步拉資料期間剛做的修改不會被蓋掉：
   * - 合併結果比本機新（或本機沒有）才寫入
   * - 只有墓碑蓋到的本機資料才刪除；合併結果沒有但也沒被刪的本機資料保留
   * - 墓碑只增不減（同 id 取較新的）
   * 不蓋 _ts、不寫墓碑、不觸發變動通知。回傳實際寫入／刪除的筆數。
   */
  async applySyncedSnapshot(data) {
    const database = await getDB();
    const stores = [...ALL_STORES, 'tombstones'];
    const tx = database.transaction(stores, 'readwrite');
    let changed = 0;
    const tombStore = tx.objectStore('tombstones');
    const currentTombs = await tombStore.getAll();
    const tombMap = mergeTombstoneLists(currentTombs, data.tombstones);
    for (const t of planTombstoneApply(currentTombs, data.tombstones || [])) { tombStore.put(t); changed += 1; }
    for (const store of ALL_STORES) {
      const os = tx.objectStore(store);
      const current = await os.getAll();
      const { puts, deletes } = planStoreApply(store, STORE_KEYS[store], current,
        Array.isArray(data[store]) ? data[store] : [], tombMap);
      for (const row of puts) os.put(row);
      for (const key of deletes) os.delete(key);
      changed += puts.length + deletes.length;
    }
    await tx.done;
    return { changed };
  },

  /** 匯出並下載備份，同時記錄最後備份時間（供備份提醒使用；只記在這台裝置，不同步） */
  async exportAndDownload() {
    const data = await db.exportAll();
    downloadJSON(data, `auto-sales-backup-${new Date().toISOString().slice(0, 10)}.json`);
    try { localStorage.setItem(STORAGE_KEYS.lastBackupAt, new Date().toISOString()); } catch { /* 無法記錄不影響備份 */ }
    return data;
  },

  /** 這台裝置最後備份時間（ISO 字串），從未備份回傳 null；舊版存在同步設定裡的值當備援 */
  async getLastBackupAt() {
    try {
      const local = localStorage.getItem(STORAGE_KEYS.lastBackupAt);
      if (local) return local;
    } catch { /* noop */ }
    const row = await db.get('settings', 'lastBackupAt').catch(() => null);
    return row?.value ?? null;
  },

  /**
   * 還原備份（共用）：單一交易內完成，任何一筆失敗整批不生效。
   * replace：清空後寫入備份；merge：逐筆保留較新的一方。
   * 備份裡已被刪除（墓碑）的資料會被救回：重蓋時間並移除墓碑，同步時才不會再被刪掉。
   */
  async _restore(data, mode) {
    const database = await getDB();
    const stores = ALL_STORES.filter((store) => Array.isArray(data?.[store]));
    if (stores.length === 0) return;
    const tx = database.transaction([...stores, 'tombstones'], 'readwrite');
    const tombStore = tx.objectStore('tombstones');
    const tombMap = mergeTombstoneLists(await tombStore.getAll());
    const now = Date.now();
    const done = tx.done;
    try {
      for (const store of stores) {
        const os = tx.objectStore(store);
        const local = mode === 'merge' ? await os.getAll() : [];
        const { puts, dropTombstones } = planImportStore(store, STORE_KEYS[store], local, data[store], tombMap, { mode, now });
        if (mode === 'replace') await os.clear();
        for (const row of puts) os.put(row);
        for (const id of dropTombstones) tombStore.delete(id);
      }
    } catch (err) {
      try { tx.abort(); } catch { /* 已中止 */ }
      await done.catch(() => {});
      throw err;
    }
    await done;
    notifyMutation();
  },

  /** 完整還原——清掉現有資料改用備份（單一交易，失敗不會只還原一半） */
  async importAll(data) {
    await db._restore(data, 'replace');
  },

  /** 安全合併：不清除現有資料，逐筆保留較新的版本 */
  async mergeImport(data) {
    await db._restore(data, 'merge');
  },

  /** Import from legacy v1 format: { _v:1, crm, jnl, sal } */
  async importLegacy(legacyData) {
    const { crm, jnl, sal } = legacyData;

    if (crm) {
      if (Array.isArray(crm.clients)) await db.bulkPut('clients', crm.clients);
      if (Array.isArray(crm.cats)) await db.bulkPut('cats', crm.cats);
      if (Array.isArray(crm.stages)) await db.bulkPut('stages', crm.stages);
      if (Array.isArray(crm.customFields)) await db.bulkPut('customFields', crm.customFields);
    }

    if (jnl) {
      const entries = Array.isArray(jnl)
        ? jnl
        : Object.entries(jnl).map(([date, data]) => ({ date, ...data }));
      await db.bulkPut('journalEntries', entries);
    }

    if (sal) {
      const months = Array.isArray(sal)
        ? sal
        : Object.entries(sal).map(([key, data]) => ({ key, ...data }));
      await db.bulkPut('salaryMonths', months);
    }
    setMutationListenerNotify();
  },

};

export default db;
