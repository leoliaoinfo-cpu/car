import { sha256Hex } from './lock.js';
import { STORAGE_KEYS } from '../storageKeys.js';

export const DEFAULT_PRESENTATION_PIN_HASH = 'c058d9a4a23e0b769f3866fe5f5b462525cdbb2c16781ca8099438c77d991761';
export const MIN_PRESENTATION_PIN_LENGTH = 4;
export const MAX_PRESENTATION_PIN_LENGTH = 12;
export const PIN_MAX_FAILURES = 5;
export const PIN_COOLDOWN_MS = 30_000;
export const BACKEND_SESSION_TTL_MS = 30 * 60 * 1000;

export function isValidPresentationPin(pin) {
  return new RegExp(`^\\d{${MIN_PRESENTATION_PIN_LENGTH},${MAX_PRESENTATION_PIN_LENGTH}}$`).test(String(pin || ''));
}

export async function hashPresentationPin(pin) {
  if (!isValidPresentationPin(pin)) throw new Error(`密碼必須是 ${MIN_PRESENTATION_PIN_LENGTH}～${MAX_PRESENTATION_PIN_LENGTH} 位數字`);
  return sha256Hex(`car-sales.presentation:${pin}`);
}

export async function verifyPresentationPin(pin, storedHash) {
  if (!isValidPresentationPin(pin) || !storedHash) return false;
  return (await hashPresentationPin(pin)) === storedHash;
}

export function registerPinFailure(failureCount, now = Date.now()) {
  const failures = Math.max(0, Number(failureCount) || 0) + 1;
  if (failures >= PIN_MAX_FAILURES) {
    return { failureCount: 0, lockedUntil: now + PIN_COOLDOWN_MS };
  }
  return { failureCount: failures, lockedUntil: 0 };
}

export function createBackendSessionDeadline(now = Date.now()) {
  return now + BACKEND_SESSION_TTL_MS;
}

export function isBackendSessionUnlocked(unlockUntil, now = Date.now()) {
  const deadline = Number(unlockUntil) || 0;
  return deadline > now && deadline - now <= BACKEND_SESSION_TTL_MS;
}

/** 設定新密碼時的檢查（輸入兩次）。沒問題回傳空字串。 */
export function validateNewPin(pin, confirmPin) {
  if (!isValidPresentationPin(pin)) return `請設定 ${MIN_PRESENTATION_PIN_LENGTH}～${MAX_PRESENTATION_PIN_LENGTH} 位數字密碼`;
  if (pin !== confirmPin) return '兩次輸入的密碼不一樣，請再確認';
  return '';
}

/** 這台裝置有沒有設定過密碼（密碼雜湊只存在這台裝置的 localStorage）。 */
export function readStoredPinHash() {
  try { return localStorage.getItem(STORAGE_KEYS.presentationPinHash) || ''; } catch { return ''; }
}

export async function storePin(pin) {
  const hash = await hashPresentationPin(pin);
  localStorage.setItem(STORAGE_KEYS.presentationPinHash, hash);
  return hash;
}

export function clearStoredPin() {
  try { localStorage.removeItem(STORAGE_KEYS.presentationPinHash); } catch { /* 無法清除時維持原密碼 */ }
}
