import { openDB } from 'idb';

const DB_NAME = 'business_assistant_v2';
const DB_VERSION = 3;

let dbPromise = null;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 開啟資料庫，含卡死防護：
 * - iOS/macOS Safari 首次 open 偶發完全無回應（WebKit bug）→ 先輕觸 databases() 喚醒＋超時重試
 * - 同網域其他分頁（如舊版系統）佔用舊版本連線時，升級會被 blocked 無限等待 → 超時放棄並回報
 * 全部嘗試失敗會 throw，讓上層進入記憶體模式顯示警告，而不是永遠轉圈。
 */
async function openWithRecovery() {
  if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
    try { await Promise.race([indexedDB.databases(), delay(500)]); } catch { /* 忽略 */ }
  }
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const TIMEOUT = Symbol('timeout');
      const result = await Promise.race([openRaw(), delay(2500 * (attempt + 1)).then(() => TIMEOUT)]);
      if (result === TIMEOUT) throw new Error('IndexedDB 開啟逾時（可能被其他分頁佔用，或瀏覽器暫時無回應）');
      return result;
    } catch (err) {
      lastErr = err;
      await delay(300);
    }
  }
  throw lastErr;
}

function openRaw() {
  return openDB(DB_NAME, DB_VERSION, {
      blocked() {
        console.warn('IndexedDB 升級被其他分頁擋住——請關閉其他開啟本系統（或舊版系統）的分頁');
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
    dbPromise = openWithRecovery();
    // 開啟失敗時清掉快取的 rejected promise，重新整理或下次操作可再試
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
