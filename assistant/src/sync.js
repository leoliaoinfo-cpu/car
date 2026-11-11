import { db, STORE_KEYS, SYNCED_STORES, setMutationListener } from './db';
import { mergeSnapshots } from './utils/dataMerge.js';
import { STORAGE_KEYS } from './storageKeys';

/**
 * ☁️ 雲端同步引擎 —— 用使用者自己的 GitHub 私人 repo 當免費雲端資料庫。
 *
 * 原理：
 * - 全部資料存成私人 repo 裡的一個 data.json
 * - 本機有變動 → 防抖數秒後自動上傳；開啟/切回頁面/每 60 秒 → 自動下載
 * - 兩台裝置同時改 → 逐筆比 _ts「新的贏」合併；刪除靠墓碑（tombstones）不會復活
 * - 上傳用 GitHub 的 sha 樂觀鎖（CAS）：對方剛好也傳了 → 自動重拉合併重傳
 *
 * token 只存在本機 localStorage，不會進入同步資料。
 */

const LS_TOKEN = STORAGE_KEYS.syncToken;
const LS_REPO = STORAGE_KEYS.syncRepo;       // "owner/repo"
const LS_LAST = STORAGE_KEYS.syncLastAt;     // ISO 時間，僅顯示用
const FILE_PATH = 'data.json';
const API = 'https://api.github.com';
const PULL_INTERVAL_MS = 60_000;
const PUSH_DEBOUNCE_MS = 4_000;

// ── 狀態（UI 訂閱顯示）────────────────────────────────────────────────────────
let status = { state: 'off', lastSyncAt: localStorage.getItem(LS_LAST) || null, error: null };
const listeners = new Set();
function setStatus(patch) {
  status = { ...status, ...patch };
  for (const cb of listeners) { try { cb(status); } catch { /* UI 壞了不影響同步 */ } }
}
export function getSyncStatus() { return status; }
export function subscribeSyncStatus(cb) { listeners.add(cb); return () => listeners.delete(cb); }
export function isSyncEnabled() { return !!(localStorage.getItem(LS_TOKEN) && localStorage.getItem(LS_REPO)); }
export function getSyncRepo() { return localStorage.getItem(LS_REPO); }

// 遠端資料合併進本機後通知 App 重新載入畫面
let onRemoteApplied = null;
export function setOnRemoteApplied(cb) { onRemoteApplied = cb; }

// ── GitHub API ────────────────────────────────────────────────────────────────
function headers() {
  return {
    Authorization: `Bearer ${localStorage.getItem(LS_TOKEN)}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function b64decodeUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const AUTH_ERROR = '同步金鑰無效或已過期——請到「設定 → ☁️ 雲端同步」重新連線';

/** 讀遠端 data.json；不存在回 { data: null, sha: null }。
 *  Contents API 超過 1MB 不回傳內容（encoding: none），需改用 raw 讀取——
 *  資料累積數年後必然超過 1MB，沒有這個 fallback 同步會永久壞死。 */
async function pullRemote() {
  const repo = localStorage.getItem(LS_REPO);
  const url = `${API}/repos/${repo}/contents/${FILE_PATH}?t=${Date.now()}`;
  const res = await fetch(url, {
    headers: { ...headers(), Accept: 'application/vnd.github.object+json' },
    cache: 'no-store',
  });
  if (res.status === 404) return { data: null, sha: null };
  if (res.status === 401) throw new Error(AUTH_ERROR);
  if (!res.ok) throw new Error(`讀取雲端失敗（HTTP ${res.status}）`);
  const body = await res.json();
  if (body.content && body.encoding === 'base64') {
    return { data: JSON.parse(b64decodeUtf8(body.content)), sha: body.sha };
  }
  // 檔案超過 1MB：用 raw 媒體類型直接拿原文（支援到 100MB）
  const raw = await fetch(url, {
    headers: { ...headers(), Accept: 'application/vnd.github.raw+json' },
    cache: 'no-store',
  });
  if (!raw.ok) throw new Error(`讀取雲端失敗（HTTP ${raw.status}）`);
  return { data: JSON.parse(await raw.text()), sha: body.sha };
}

/** 寫遠端（sha 樂觀鎖）；衝突丟 'CONFLICT' 讓呼叫端重拉合併 */
async function pushRemote(data, sha) {
  const repo = localStorage.getItem(LS_REPO);
  const res = await fetch(`${API}/repos/${repo}/contents/${FILE_PATH}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({
      message: `sync ${new Date().toISOString()}`,
      content: b64encodeUtf8(JSON.stringify(data)),
      ...(sha ? { sha } : {}),
    }),
  });
  // 409：sha 不符＝對方剛上傳過 → 重拉合併重傳。
  // 422 且這次沒帶 sha：讀取時雲端還沒有檔案、上傳前別台剛建立 → 同樣是衝突，重拉即可。
  if (res.status === 409 || (res.status === 422 && !sha)) throw new Error('CONFLICT');
  if (res.status === 401) throw new Error(AUTH_ERROR);
  if (res.status === 422) {
    let detail = '';
    try { detail = (await res.json())?.message || ''; } catch { /* 無內容 */ }
    throw new Error(`GitHub 拒絕這次上傳（HTTP 422${detail ? `：${detail}` : ''}）。可能是雲端資料檔太大或儲存庫設定不符；本機資料都還在，請稍後再試，持續發生請找人協助檢查。`);
  }
  if (!res.ok) throw new Error(`上傳雲端失敗（HTTP ${res.status}）`);
  return (await res.json()).content.sha;
}

// ── 合併（純邏輯在 utils/dataMerge.js，可單元測試）────────────────────────────
export { mergeSnapshots };

/** 穩定序列化（各 store 依主鍵排序），內容沒變就不用上傳 */
function canonical(data) {
  const obj = { tombstones: [...(data.tombstones || [])].sort((x, y) => x.id.localeCompare(y.id)) };
  for (const store of SYNCED_STORES) {
    const keyField = STORE_KEYS[store];
    obj[store] = [...(data[store] || [])].sort((x, y) => String(x[keyField]).localeCompare(String(y[keyField])));
  }
  return JSON.stringify(obj);
}

// ── 同步主流程 ────────────────────────────────────────────────────────────────
let syncing = false;
let queued = false;

export async function syncNow() {
  if (!isSyncEnabled()) return;
  if (syncing) { queued = true; return; } // 進行中就排隊，結束後再跑一輪
  syncing = true;
  setStatus({ state: 'syncing', error: null });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const [{ data: remote, sha }, local] = await Promise.all([pullRemote(), db.exportForSync()]);
      let toPush = mergeSnapshots(local, remote);
      // 遠端有本機沒有的內容 → 逐筆套進本機（不清空；拉資料期間的新修改會保留）
      if (remote && canonical(mergeSnapshots(local, null)) !== canonical(toPush)) {
        const { changed } = await db.applySyncedSnapshot(toPush);
        if (changed > 0) {
          // 重新匯出本機：拉資料期間寫入的新資料（含新墓碑）也要一起上傳
          toPush = mergeSnapshots(await db.exportForSync(), remote);
          try { onRemoteApplied?.(); } catch { /* 重載失敗不影響資料 */ }
        }
      }
      // 本機有遠端沒有的內容 → 上傳（sha 不符表示對方剛傳過，重拉再合併）
      if (!remote || canonical(remote) !== canonical(toPush)) {
        try {
          await pushRemote(toPush, sha);
        } catch (e) {
          if (e.message === 'CONFLICT' && attempt < 2) continue;
          throw e;
        }
      }
      const at = new Date().toISOString();
      localStorage.setItem(LS_LAST, at);
      setStatus({ state: 'ok', lastSyncAt: at });
      break;
    }
  } catch (err) {
    setStatus({ state: 'error', error: err.message || String(err) });
  } finally {
    syncing = false;
    if (queued) { queued = false; syncNow(); }
  }
}

// ── 自動觸發 ──────────────────────────────────────────────────────────────────
let pushTimer = null;
let pullTimer = null;

function schedulePush() {
  if (!isSyncEnabled()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncNow, PUSH_DEBOUNCE_MS);
}

export function startSync() {
  if (!isSyncEnabled()) return;
  setMutationListener(schedulePush);
  clearInterval(pullTimer);
  pullTimer = setInterval(syncNow, PULL_INTERVAL_MS);
  document.addEventListener('visibilitychange', onVisible);
  setStatus({ state: 'idle' });
  syncNow(); // 啟動先同步一次
}

function onVisible() {
  if (document.visibilityState === 'visible') syncNow();
}

export function stopSync() {
  setMutationListener(null);
  clearTimeout(pushTimer);
  clearInterval(pullTimer);
  document.removeEventListener('visibilitychange', onVisible);
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_REPO);
  setStatus({ state: 'off', error: null });
}

// ── 啟用連線（設定頁呼叫）────────────────────────────────────────────────────
/**
 * 驗證 token、找到 repo、啟動同步。
 * @param {string} token GitHub fine-grained token（Contents 讀寫）
 * @param {string} repoName repo 名稱（不含帳號），預設汽車系統專用 car-sales-data
 */
export async function connectSync(token, repoName) {
  const name = (repoName || 'car-sales-data').trim();
  const h = {
    Authorization: `Bearer ${token.trim()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const userRes = await fetch(`${API}/user`, { headers: h });
  if (userRes.status === 401) throw new Error('金鑰無效——請確認複製完整（ github_pat_ 開頭）');
  if (!userRes.ok) throw new Error(`無法驗證金鑰（HTTP ${userRes.status}）`);
  const { login } = await userRes.json();

  const repoRes = await fetch(`${API}/repos/${login}/${name}`, { headers: h });
  if (repoRes.status === 404) {
    throw new Error(`找不到儲存庫 ${login}/${name}——請先到 GitHub 建立這個「私人」儲存庫，且金鑰要勾選它的存取權`);
  }
  if (!repoRes.ok) throw new Error(`無法讀取儲存庫（HTTP ${repoRes.status}）`);
  const repoInfo = await repoRes.json();
  if (!repoInfo.private) throw new Error(`儲存庫 ${login}/${name} 是公開的！客戶資料會被任何人看到，請改用「私人」儲存庫`);
  if (!repoInfo.permissions?.push) throw new Error('金鑰沒有這個儲存庫的寫入權限——建立金鑰時 Contents 要選「Read and write」');

  localStorage.setItem(LS_TOKEN, token.trim());
  localStorage.setItem(LS_REPO, `${login}/${name}`);
  startSync();
  return `${login}/${name}`;
}
