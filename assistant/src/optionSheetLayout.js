// 選配表的「表單格式」（哪些勾選項、哪些有填寫線）：存在 settings 的 optionSheetLayout 列，隨雲端同步。
// 預設格式只留在記憶體，使用者真的改過才寫進資料庫（避免新裝置的預設值蓋掉大家的設定）。
import { db } from './db';
import { DEFAULT_LAYOUT, normalizeLayout } from './utils/optionSheet.js';

const KEY = 'optionSheetLayout';

export async function loadOptionSheetLayout() {
  const row = await db.get('settings', KEY).catch(() => null);
  return row?.boxes ? normalizeLayout(row) : DEFAULT_LAYOUT;
}

export async function saveOptionSheetLayout(layout) {
  const clean = normalizeLayout(layout);
  await db.put('settings', { key: KEY, boxes: clean.boxes, updatedAt: new Date().toISOString() });
  return clean;
}

export async function resetOptionSheetLayout() {
  // 還原成預設：寫入預設內容（不刪除，避免同步時被別台的舊設定蓋回來）
  return saveOptionSheetLayout(DEFAULT_LAYOUT);
}
