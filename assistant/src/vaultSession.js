// 這台裝置的「成本保險箱」狀態：資料金鑰放記憶體，並記在本機專用的小資料庫（不可匯出的金鑰物件），
// 所以每台裝置只要輸入一次成本密語。金鑰本體無法被讀出來抄走；資料庫名稱帶本系統專屬前綴。
import { db } from './db';
import { VAULT_KEY, createVault, unlockVault, changeVaultPassphrase } from './utils/vault.js';

const KEY_DB = 'car_sales_vault_v1';
const KEY_STORE = 'keys';
const KEY_ID = 'dek';

let memoryKey = null;
let loaded = false;
const listeners = new Set();
function emit() { for (const cb of listeners) { try { cb(); } catch { /* UI 錯不影響 */ } } }
export function subscribeVault(cb) { listeners.add(cb); return () => listeners.delete(cb); }

function openKeyDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(KEY_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function keyDbOp(mode, fn) {
  const kdb = await openKeyDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = kdb.transaction(KEY_STORE, mode);
      const req = fn(tx.objectStore(KEY_STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { kdb.close(); }
}

/** 取得這台裝置的資料金鑰；還沒解鎖回傳 null。 */
export async function getDek() {
  if (memoryKey) return memoryKey;
  if (!loaded) {
    loaded = true;
    try { memoryKey = (await keyDbOp('readonly', (s) => s.get(KEY_ID))) || null; } catch { memoryKey = null; }
  }
  return memoryKey;
}

async function remember(dek) {
  memoryKey = dek;
  loaded = true;
  try { await keyDbOp('readwrite', (s) => s.put(dek, KEY_ID)); } catch { /* 存不進去就只在這次開啟有效 */ }
  emit();
}

/** 這台裝置上鎖：忘記金鑰（下次要重新輸入成本密語）。資料不會被刪。 */
export async function forgetDek() {
  memoryKey = null;
  loaded = true;
  try { await keyDbOp('readwrite', (s) => s.delete(KEY_ID)); } catch { /* noop */ }
  emit();
}

export async function getLocalVaultRecord() {
  const row = await db.get('settings', VAULT_KEY).catch(() => null);
  return row?.wrapped ? row : null;
}

/** 第一次設定成本密語（只能在還沒有任何 vault 時用）。 */
export async function setupVault(passphrase, { remoteRecord = null } = {}) {
  if (remoteRecord || await getLocalVaultRecord()) throw new Error('已經設定過成本密語，請用那組密語解鎖');
  const { record, dek } = await createVault(passphrase);
  await db.put('settings', record);
  await remember(dek);
  return record;
}

/** 用成本密語解鎖這台裝置；record 可由雲端提供（新裝置本機還沒有 vault 紀錄時）。 */
export async function unlockThisDevice(passphrase, record = null) {
  const rec = record || await getLocalVaultRecord();
  if (!rec) throw new Error('還沒有設定成本密語');
  const dek = await unlockVault(rec, passphrase);
  await remember(dek);
  return dek;
}

export async function changePassphrase(oldPassphrase, newPassphrase) {
  const rec = await getLocalVaultRecord();
  if (!rec) throw new Error('還沒有設定成本密語');
  const next = await changeVaultPassphrase(rec, oldPassphrase, newPassphrase);
  await db.put('settings', next);
  return next;
}
