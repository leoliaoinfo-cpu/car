// 開啟系統的入口密碼（防外人隨手開啟，不是高強度加密）。
// 只存雜湊不存明文；通過後該裝置記住 30 天。
import { sha256Hex } from './lock.js';

export const GATE_HASH = '4dbe6922be393bbb300921031a78842f0b0476d40414e6aa9c8945dc82a11f93';
export const GATE_REMEMBER_MS = 1 * 24 * 60 * 60 * 1000;
export const GATE_MAX_TRIES = 5;
export const GATE_COOLDOWN_MS = 30 * 1000;

export async function checkGatePin(pin) {
  return (await sha256Hex('car-sales-gate:' + String(pin).trim())) === GATE_HASH;
}

export function isGateUnlocked(until, now = Date.now()) {
  const n = Number(until);
  return Number.isFinite(n) && n > now && n - now <= GATE_REMEMBER_MS + 1000;
}
