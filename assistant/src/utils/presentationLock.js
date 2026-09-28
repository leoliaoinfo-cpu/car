import { sha256Hex } from './lock.js';

export const DEFAULT_PRESENTATION_PIN_HASH = 'c058d9a4a23e0b769f3866fe5f5b462525cdbb2c16781ca8099438c77d991761';

export function isValidPresentationPin(pin) {
  return /^\d{4}$/.test(String(pin || ''));
}

export async function hashPresentationPin(pin) {
  if (!isValidPresentationPin(pin)) throw new Error('PIN 必須是 4 位數字');
  return sha256Hex(`car-sales.presentation:${pin}`);
}

export async function verifyPresentationPin(pin, storedHash) {
  if (!isValidPresentationPin(pin) || !storedHash) return false;
  return (await hashPresentationPin(pin)) === storedHash;
}
