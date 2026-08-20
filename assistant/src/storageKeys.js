// GitHub Pages 的 /car/ 與 /TEST/ 雖然路徑不同，瀏覽器仍視為同一個 origin。
// 所有 IndexedDB、localStorage、CacheStorage 名稱都必須帶本系統專屬前綴，
// 否則不同產業的兩套系統會互相讀到資料與設定。
export const STORAGE_PREFIX = 'car-sales.';

export const STORAGE_KEYS = {
  theme: `${STORAGE_PREFIX}theme`,
  crmView: `${STORAGE_PREFIX}crmView`,
  housekeepAt: `${STORAGE_PREFIX}housekeepAt`,
  isolationNoticeDismissed: `${STORAGE_PREFIX}isolationNoticeDismissed`,
  syncToken: `${STORAGE_PREFIX}sync.token`,
  syncRepo: `${STORAGE_PREFIX}sync.repo`,
  syncLastAt: `${STORAGE_PREFIX}sync.lastSyncAt`,
  photoSyncEndpoint: `${STORAGE_PREFIX}photoSync.endpoint`,
  photoSyncKey: `${STORAGE_PREFIX}photoSync.key`,
  icsExportedAt: `${STORAGE_PREFIX}ics.exportedAt`,
  icsSnoozeAt: `${STORAGE_PREFIX}ics.remindSnoozeAt`,
};

export const CAR_DB_NAME = 'car_sales_assistant_v1';
export const LEGACY_SHARED_DB_NAME = 'business_assistant_v2';
