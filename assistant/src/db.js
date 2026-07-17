import { openDB } from 'idb';

const DB_NAME = 'business_assistant_v2';
const DB_VERSION = 3;

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
  'deals', 'dealFields', 'tasks',
  'journalEntries', 'archivedJournal',
  'salaryMonths', 'timers', 'timerHistory', 'settings',
];

export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const db = {
  async getAll(store) {
    return (await getDB()).getAll(store);
  },
  async get(store, key) {
    return (await getDB()).get(store, key);
  },
  async put(store, value) {
    return (await getDB()).put(store, value);
  },
  async delete(store, key) {
    return (await getDB()).delete(store, key);
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

  /** Full export of all stores */
  async exportAll() {
    const data = { _v: 2, exportedAt: new Date().toISOString() };
    for (const store of ALL_STORES) {
      data[store] = await db.getAll(store);
    }
    return data;
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
  },

  /** Merge import from v2 format without wiping */
  async mergeImport(data) {
    for (const store of ALL_STORES) {
      if (Array.isArray(data[store])) {
        await db.bulkPut(store, data[store]);
      }
    }
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
  },

};

export default db;
