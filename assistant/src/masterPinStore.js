// 統一密碼的存取：雜湊存在 settings 的 masterPin 列（隨雲端同步），沒設定過就用預設 0623。
// 全系統只有這裡決定「密碼對不對」，改密碼也只改這一處。
import { db } from './db';
import {
  MASTER_PIN_KEY, MASTER_HASH_DEFAULT, hashMasterPin, verifyMasterPin, masterPinProblem,
} from './utils/masterPin.js';

export async function getMasterHash() {
  try {
    const row = await db.get('settings', MASTER_PIN_KEY);
    return row?.hash || MASTER_HASH_DEFAULT;
  } catch { return MASTER_HASH_DEFAULT; }
}

export async function checkMasterPin(pin) {
  return verifyMasterPin(pin, await getMasterHash());
}

export async function changeMasterPin(oldPin, newPin, confirmPin) {
  if (!await checkMasterPin(oldPin)) throw new Error('目前的密碼不正確');
  const problem = masterPinProblem(newPin, confirmPin);
  if (problem) throw new Error(problem);
  await db.put('settings', { key: MASTER_PIN_KEY, hash: await hashMasterPin(newPin), changedAt: new Date().toISOString() });
}
