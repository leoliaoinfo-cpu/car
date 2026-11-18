// 🔐 成本保險箱：把成本、利潤、傭金、薪資在「離開這台裝置」時加密（雲端同步檔、備份檔）。
//
// 做法（瀏覽器內建 WebCrypto，不送任何資料出去）：
// - 隨機產生一把 256 位元資料金鑰（DEK），真正拿來加密資料。
// - 使用者的「成本密語」經 PBKDF2-SHA256（60 萬次）推導出包裝金鑰，把 DEK 包起來。
//   包好的 DEK（vault 紀錄）可以安全地放進同步檔：沒有密語拆不開。
// - 加密用 AES-256-GCM（每次隨機 IV，內容被竄改會解密失敗）。
// - 換密語只要重新包 DEK，資料不用重加密。
// 忘記密語＝加密的成本資料永遠解不開（沒有後門），所以介面一定要提醒使用者抄下來。

export const VAULT_KEY = 'vault';
export const VAULT_ITERATIONS = 600_000;
const ENC_PREFIX = 'v1:';

// 哪些資料要加密：整筆加密的 store、settings 裡要加密的列、deals 裡要加密的欄位
export const SECRET_STORES = ['pricingRecords', 'salaryMonths'];
export const SECRET_SETTING_KEYS = ['costCatalog', 'customPricingHistory', 'costDefaults'];
export const SECRET_DEAL_FIELDS = ['cost', 'profit', 'costItems', 'margin', 'grossProfit'];
const STORE_KEY_FIELD = { pricingRecords: 'id', salaryMonths: 'key', settings: 'key', deals: 'id' };

const subtle = () => globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

function toB64(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 0x8000) bin += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromB64(str) {
  return Uint8Array.from(atob(String(str)), (c) => c.charCodeAt(0));
}

/** 密語規則：至少 8 個字，要同時有英文字母和數字。回傳問題說明，沒問題回傳空字串。 */
export function passphraseProblem(passphrase) {
  const p = String(passphrase || '');
  if (p.length < 8) return '密語至少要 8 個字';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return '密語要同時有英文字母和數字';
  if (/^(.)\1+$/.test(p)) return '密語不能全部同一個字';
  return '';
}

async function deriveWrapKey(passphrase, salt, iterations) {
  const base = await subtle().importKey('raw', te.encode(String(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function importDek(raw) {
  // 不可匯出：就算有人拿到這個物件，也無法把金鑰本體抄走
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** 第一次設定：產生資料金鑰並用密語包起來。回傳要存進 settings 的 vault 紀錄與可用的金鑰。 */
export async function createVault(passphrase, { iterations = VAULT_ITERATIONS } = {}) {
  const problem = passphraseProblem(passphrase);
  if (problem) throw new Error(problem);
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const record = await wrapRaw(raw, passphrase, iterations);
  const dek = await importDek(raw);
  raw.fill(0);
  return { record, dek };
}

async function wrapRaw(raw, passphrase, iterations) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const kek = await deriveWrapKey(passphrase, salt, iterations);
  const wrapped = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, kek, raw));
  return { key: VAULT_KEY, v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: toB64(salt), iv: toB64(iv), wrapped: toB64(wrapped) };
}

async function unwrapRaw(record, passphrase) {
  if (!record?.wrapped) throw new Error('還沒有設定成本密語');
  const kek = await deriveWrapKey(passphrase, fromB64(record.salt), Number(record.iterations) || VAULT_ITERATIONS);
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(record.iv) }, kek, fromB64(record.wrapped)));
  } catch {
    throw new Error('成本密語不正確');
  }
}

/** 用密語打開保險箱，拿到資料金鑰；密語錯誤會丟出「成本密語不正確」。 */
export async function unlockVault(record, passphrase) {
  const raw = await unwrapRaw(record, passphrase);
  const dek = await importDek(raw);
  raw.fill(0);
  return dek;
}

/** 換密語：用舊密語拆開、用新密語重新包；資料本身不用重加密。 */
export async function changeVaultPassphrase(record, oldPassphrase, newPassphrase) {
  const problem = passphraseProblem(newPassphrase);
  if (problem) throw new Error(problem);
  const raw = await unwrapRaw(record, oldPassphrase);
  const next = await wrapRaw(raw, newPassphrase, Number(record.iterations) || VAULT_ITERATIONS);
  raw.fill(0);
  return next;
}

export async function encryptJson(dek, value) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, dek, te.encode(JSON.stringify(value))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return ENC_PREFIX + toB64(out);
}

export async function decryptJson(dek, text) {
  const s = String(text || '');
  if (!s.startsWith(ENC_PREFIX)) throw new Error('不是加密資料');
  const bytes = fromB64(s.slice(ENC_PREFIX.length));
  try {
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, dek, bytes.subarray(12));
    return JSON.parse(td.decode(pt));
  } catch {
    throw new Error('成本資料解不開：密語不對，或資料已損壞');
  }
}

function isSecretSetting(row) { return row && SECRET_SETTING_KEYS.includes(row.key); }

/** 資料快照裡是否有加密內容（用來判斷「這台裝置要先輸入密語才能讀」）。 */
export function snapshotHasSealed(data) {
  if (!data) return false;
  for (const store of [...SECRET_STORES, 'settings', 'deals']) {
    if ((data[store] || []).some((row) => row && (row.__enc || row.__encf))) return true;
  }
  return false;
}

/** 快照裡是否還有「沒加密的成本類資料」（剛開啟保險箱時，要強制重新上傳一次加密版）。 */
export function snapshotHasPlainSecrets(data) {
  if (!data) return false;
  for (const store of SECRET_STORES) if ((data[store] || []).some((row) => row && !row.__enc)) return true;
  if ((data.settings || []).some((row) => isSecretSetting(row) && !row.__enc)) return true;
  if ((data.deals || []).some((row) => row && !row.__encf && SECRET_DEAL_FIELDS.some((f) => f in row))) return true;
  return false;
}

/** 從快照中找 vault 紀錄（包好的金鑰）。 */
export function findVaultRecord(data) {
  return (data?.settings || []).find((row) => row?.key === VAULT_KEY && row.wrapped) || null;
}

/**
 * 封存：把快照裡的成本類資料加密。其他資料（客戶、案件、報價）原樣不動。
 * 每筆保留主鍵與 _ts，雲端同步的「新的贏」合併規則照常運作。
 */
export async function sealSnapshot(dek, data) {
  if (!data) return data;
  const out = { ...data };
  for (const store of SECRET_STORES) {
    if (!Array.isArray(data[store])) continue;
    const key = STORE_KEY_FIELD[store];
    out[store] = await Promise.all(data[store].map(async (row) => {
      if (!row || row.__enc) return row;
      return { [key]: row[key], _ts: row._ts, __enc: await encryptJson(dek, row) };
    }));
  }
  if (Array.isArray(data.settings)) {
    out.settings = await Promise.all(data.settings.map(async (row) => {
      if (!isSecretSetting(row) || row.__enc) return row;
      return { key: row.key, _ts: row._ts, __enc: await encryptJson(dek, row) };
    }));
  }
  if (Array.isArray(data.deals)) {
    out.deals = await Promise.all(data.deals.map(async (row) => {
      if (!row || row.__encf) return row;
      const secret = {};
      const rest = { ...row };
      for (const field of SECRET_DEAL_FIELDS) {
        if (field in rest) { secret[field] = rest[field]; delete rest[field]; }
      }
      if (!Object.keys(secret).length) return row;
      return { ...rest, __encf: await encryptJson(dek, secret) };
    }));
  }
  return out;
}

/** 解封：把加密的成本類資料還原。沒加密的舊資料原樣通過（相容舊版同步檔與備份）。 */
export async function openSnapshot(dek, data) {
  if (!data) return data;
  if (!snapshotHasSealed(data)) return data;
  if (!dek) throw new Error('NEED_VAULT');
  const out = { ...data };
  for (const store of SECRET_STORES) {
    if (!Array.isArray(data[store])) continue;
    out[store] = await Promise.all(data[store].map(async (row) => (row?.__enc ? decryptJson(dek, row.__enc) : row)));
  }
  if (Array.isArray(data.settings)) {
    out.settings = await Promise.all(data.settings.map(async (row) => (row?.__enc ? decryptJson(dek, row.__enc) : row)));
  }
  if (Array.isArray(data.deals)) {
    out.deals = await Promise.all(data.deals.map(async (row) => {
      if (!row?.__encf) return row;
      const secret = await decryptJson(dek, row.__encf);
      const rest = { ...row };
      delete rest.__encf;
      return { ...rest, ...secret };
    }));
  }
  return out;
}
