import { sha256Hex } from './lock.js';

export const DEFAULT_PRESENTATION_PIN_HASH = 'c058d9a4a23e0b769f3866fe5f5b462525cdbb2c16781ca8099438c77d991761';
export const MIN_PRESENTATION_PIN_LENGTH = 4;
export const MAX_PRESENTATION_PIN_LENGTH = 12;
export const PIN_MAX_FAILURES = 5;
export const PIN_COOLDOWN_MS = 30_000;

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
