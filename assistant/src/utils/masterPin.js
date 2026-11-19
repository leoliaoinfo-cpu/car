// 🔑 統一密碼（全系統共用一組）：入口、報價選單價格、業績與成本、修改／刪除成交報價…都用這一組。
// 預設 0623；使用者在「設定 → 密碼」改一次，所有地方、所有裝置（經雲端同步）一起生效。
// 只存雜湊（含固定前綴），不存明文。這是擋外人隨手開啟的門鎖，不是高強度加密。
import { sha256Hex } from './lock.js';

export const MASTER_PIN_KEY = 'masterPin';
export const MASTER_MIN = 4;
export const MASTER_MAX = 12;
export const MASTER_HASH_DEFAULT = '4dbe6922be393bbb300921031a78842f0b0476d40414e6aa9c8945dc82a11f93'; // 0623
export const MASTER_MAX_FAILS = 5;
export const MASTER_COOLDOWN_MS = 30_000;

export function isValidMasterPin(pin) {
  return new RegExp(`^\\d{${MASTER_MIN},${MASTER_MAX}}$`).test(String(pin || ''));
}

export async function hashMasterPin(pin) {
  return sha256Hex('car-sales-gate:' + String(pin).trim());
}

export async function verifyMasterPin(pin, storedHash) {
  if (!String(pin || '').trim()) return false;
  return (await hashMasterPin(pin)) === (storedHash || MASTER_HASH_DEFAULT);
}

/** 換密碼前的檢查；沒問題回傳空字串。 */
export function masterPinProblem(next, confirm) {
  if (!isValidMasterPin(next)) return `新密碼要是 ${MASTER_MIN}～${MASTER_MAX} 位數字`;
  if (next !== confirm) return '兩次輸入的新密碼不一樣';
  return '';
}
