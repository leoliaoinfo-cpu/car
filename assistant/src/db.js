import { openDB } from 'idb';
import { CAR_DB_NAME, LEGACY_SHARED_DB_NAME } from './storageKeys.js';

const DB_NAME = CAR_DB_NAME;
const DB_VERSION = 8;

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
        // v8：照片本體仍只放本機 photos；photoMeta 是可同步的小型 R2 索引，
        // photoDeletes 是離線刪除佇列，讓其他已連上照片雲端的裝置也能代為清理。
        if (!database.objectStoreNames.contains('photoMeta')) {
          const pm = database.createObjectStore('photoMeta', { keyPath: 'id' });
          pm.createIndex('clientId', 'clientId');
        }
        if (!database.objectStoreNames.contains('photoDeletes'))
          database.createObjectStore('photoDeletes', { keyPath: 'id' });
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

const ALL_STORES = [
  'clients', 'cats', 'stages', 'customFields',
  'deals', 'dealFields', 'pricingRecords', 'tasks', 'events',
  'photoMeta', 'photoDeletes',
  'journalEntries', 'archivedJournal',
  'salaryMonths', 'timers', 'timerHistory', 'settings',
];

// 各 store 的主鍵欄位（同步合併時逐筆比對用）
export const STORE_KEYS = {
  clients: 'id', cats: 'id', stages: 'id', customFields: 'id',
  deals: 'id', dealFields: 'id', pricingRecords: 'id', tasks: 'id', events: 'id', timers: 'id', timerHistory: 'id',
  photoMeta: 'id', photoDeletes: 'id',
  settings: 'key', salaryMonths: 'key',
  journalEntries: 'date', archivedJournal: 'date',
};
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
  async getAllPhotos() {
    return (await getDB()).getAll('photos');
  },
  async getPhotoMeta(clientId) {
    const database = await getDB();
    return database.getAllFromIndex('photoMeta', 'clientId', clientId);
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
  /** 走標準 delete 留墓碑，防止其他裝置把已刪照片索引復活。 */
  async deletePhotoMetaByClient(clientId) {
    const rows = await db.getPhotoMeta(clientId);
    for (const row of rows) await db.delete('photoMeta', row.id);
    return rows;
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
    const TOMBSTONE_KEEP_MS = 90 * 24 * 3600 * 1000;
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
    // 清孤兒照片（對應客戶已不存在，例如還原舊備份後）——釋放其佔用的空間
    const clientIds = new Set((await db.getAll('clients')).map((c) => c.id));
    const database = await getDB();
    const tx = database.transaction('photos', 'readwrite');
    let cur = await tx.store.openCursor();
    while (cur) {
      if (!clientIds.has(cur.value.clientId)) await cur.delete();
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

  /** 雲端同步用：把合併後的結果原樣寫回——不蓋 _ts、不寫墓碑、不觸發變動通知 */
  async applySyncedSnapshot(data) {
    const database = await getDB();
    for (const store of [...ALL_STORES, 'tombstones']) {
      if (!Array.isArray(data[store])) continue;
      const tx = database.transaction(store, 'readwrite');
      tx.store.clear();
      for (const item of data[store]) tx.store.put(item);
      await tx.done;
    }
  },

  /** 匯出並下載備份，同時記錄最後備份時間（供備份提醒使用） */
  async exportAndDownload() {
    const data = await db.exportAll();
    downloadJSON(data, `auto-sales-backup-${new Date().toISOString().slice(0, 10)}.json`);
    await db.put('settings', { key: 'lastBackupAt', value: new Date().toISOString() }).catch(() => {});
    return data;
  },

  /** 最後備份時間（ISO 字串），從未備份回傳 null */
  async getLastBackupAt() {
    const row = await db.get('settings', 'lastBackupAt').catch(() => null);
    return row?.value ?? null;
  },

  /** Full import — wipes existing data */
  async importAll(data) {
    for (const store of ALL_STORES) {
      if (Array.isArray(data[store])) {
        await db.clear(store);
        await db.bulkPut(store, data[store]);
      }
    }
    setMutationListenerNotify();
  },

  /** Merge import from v2 format without wiping */
  async mergeImport(data) {
    for (const store of ALL_STORES) {
      if (Array.isArray(data[store])) {
        await db.bulkPut(store, data[store]);
      }
    }
    setMutationListenerNotify();
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
