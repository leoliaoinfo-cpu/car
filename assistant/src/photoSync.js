import { db } from './db.js';
import { STORAGE_KEYS } from './storageKeys.js';

const LS_ENDPOINT = STORAGE_KEYS.photoSyncEndpoint;
const LS_KEY = STORAGE_KEYS.photoSyncKey;

function storage() {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function normalizeEndpoint(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function getPhotoSyncConfig() {
  return {
    endpoint: storage()?.getItem(LS_ENDPOINT) || '',
    key: storage()?.getItem(LS_KEY) || '',
  };
}

export function isPhotoSyncEnabled() {
  const { endpoint, key } = getPhotoSyncConfig();
  return Boolean(endpoint && key);
}

function requireConfig() {
  const config = getPhotoSyncConfig();
  if (!config.endpoint || !config.key) throw new Error('尚未設定照片雲端');
  return config;
}

function photoUrl(endpoint, photo) {
  return `${endpoint}/v1/photos/${encodeURIComponent(photo.clientId)}/${encodeURIComponent(photo.id)}`;
}

async function cloudFetch(url, key, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${key}`, ...(options.headers || {}) },
  });
  if (response.status === 401) throw new Error('照片雲端金鑰無效');
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json())?.error || ''; } catch { /* 非 JSON 回應 */ }
    throw new Error(detail || `照片雲端失敗（HTTP ${response.status}）`);
  }
  return response;
}

export async function connectPhotoSync(endpointValue, keyValue) {
  const endpoint = normalizeEndpoint(endpointValue);
  const key = String(keyValue || '').trim();
  if (!/^https:\/\//i.test(endpoint) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(endpoint)) {
    throw new Error('照片雲端網址必須使用 HTTPS');
  }
  if (key.length < 24) throw new Error('請輸入至少 24 個字元的照片同步金鑰');
  await cloudFetch(`${endpoint}/v1/health`, key, { cache: 'no-store' });
  storage()?.setItem(LS_ENDPOINT, endpoint);
  storage()?.setItem(LS_KEY, key);
  return endpoint;
}

export function disconnectPhotoSync() {
  storage()?.removeItem(LS_ENDPOINT);
  storage()?.removeItem(LS_KEY);
}

export function toPhotoMeta(photo) {
  return {
    id: photo.id,
    clientId: photo.clientId,
    kind: photo.kind || 'photo',
    size: photo.size || photo.blob?.size || 0,
    w: photo.w || 0,
    h: photo.h || 0,
    name: photo.name || '',
    createdAt: photo.createdAt || new Date().toISOString(),
    cloud: 'r2',
  };
}

export async function uploadCloudPhoto(photo) {
  const { endpoint, key } = requireConfig();
  if (!(photo.blob instanceof Blob)) throw new Error('找不到可上傳的照片內容');
  await cloudFetch(photoUrl(endpoint, photo), key, {
    method: 'PUT',
    headers: { 'Content-Type': photo.blob.type || 'image/jpeg' },
    body: photo.blob,
  });
  const meta = toPhotoMeta(photo);
  await db.put('photoMeta', meta);
  return meta;
}

export async function downloadCloudPhoto(meta) {
  const { endpoint, key } = requireConfig();
  const response = await cloudFetch(photoUrl(endpoint, meta), key, { cache: 'no-store' });
  const blob = await response.blob();
  const local = { ...toPhotoMeta(meta), blob, size: meta.size || blob.size };
  await db.putPhoto(local);
  return local;
}

async function deleteCloudPhoto(meta) {
  const { endpoint, key } = requireConfig();
  await cloudFetch(photoUrl(endpoint, meta), key, { method: 'DELETE' });
}

export async function queuePhotoDelete(meta) {
  await db.put('photoDeletes', {
    id: meta.id,
    clientId: meta.clientId,
    createdAt: new Date().toISOString(),
  });
  await db.delete('photoMeta', meta.id);
  await db.deletePhoto(meta.id);
  processPendingPhotoDeletes().catch(() => {});
}

export async function deleteClientPhotoData(clientId) {
  const metas = await db.getPhotoMeta(clientId);
  for (const meta of metas) {
    await db.put('photoDeletes', {
      id: meta.id,
      clientId: meta.clientId,
      createdAt: new Date().toISOString(),
    });
    await db.delete('photoMeta', meta.id);
  }
  await db.deletePhotosByClient(clientId);
  processPendingPhotoDeletes().catch(() => {});
}

let processingDeletes = false;
export async function processPendingPhotoDeletes() {
  if (processingDeletes || !isPhotoSyncEnabled()) return;
  processingDeletes = true;
  try {
    const pending = await db.getAll('photoDeletes');
    for (const row of pending) {
      try {
        await deleteCloudPhoto(row);
        await db.delete('photoDeletes', row.id);
      } catch {
        // 保留佇列；網路恢復或下次 GitHub 同步成功時會自動再試。
      }
    }
  } finally {
    processingDeletes = false;
  }
}

let uploadAllPromise = null;
export async function uploadAllLocalPhotos(onProgress) {
  if (!isPhotoSyncEnabled()) throw new Error('請先啟用照片雲端');
  if (uploadAllPromise) return uploadAllPromise;
  uploadAllPromise = (async () => {
    const [local, metas] = await Promise.all([db.getAllPhotos(), db.getAll('photoMeta')]);
    const uploadedIds = new Set(metas.map((meta) => meta.id));
    const pending = local.filter((photo) => !uploadedIds.has(photo.id));
    let done = 0;
    for (const photo of pending) {
      await uploadCloudPhoto(photo);
      done += 1;
      onProgress?.({ done, total: pending.length });
    }
    await processPendingPhotoDeletes();
    return { uploaded: done, total: local.length };
  })();
  try {
    return await uploadAllPromise;
  } finally {
    uploadAllPromise = null;
  }
}
