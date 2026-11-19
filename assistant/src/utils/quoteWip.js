import { STORAGE_KEYS } from '../storageKeys.js';

// 報價單編輯到一半就自動存在這台裝置（localStorage）：重新整理、App 被系統關掉都不會不見。
// 只有「儲存成功」或「確認關閉」才清掉。超過 7 天的草稿視為過期。
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

function store(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function saveQuoteWip(wip, storage) {
  try { store(storage)?.setItem(STORAGE_KEYS.quoteWip, JSON.stringify({ ...wip, savedAt: Date.now() })); } catch { /* 空間不足或無痕模式：略過 */ }
}

export function loadQuoteWip(storage, now = Date.now()) {
  try {
    const raw = store(storage)?.getItem(STORAGE_KEYS.quoteWip);
    if (!raw) return null;
    const wip = JSON.parse(raw);
    if (!wip || typeof wip !== 'object' || !wip.payload || !wip.payload.id) return null;
    if (now - (wip.savedAt || 0) > MAX_AGE_MS) return null;
    return wip;
  } catch { return null; }
}

export function clearQuoteWip(storage) {
  try { store(storage)?.removeItem(STORAGE_KEYS.quoteWip); } catch { /* ignore */ }
}
