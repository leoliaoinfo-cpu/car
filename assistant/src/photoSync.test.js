import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectPhotoSync, disconnectPhotoSync, getPhotoSyncConfig, toPhotoMeta,
} from './photoSync.js';
import { STORAGE_KEYS } from './storageKeys.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test('photo cloud settings use the car-specific namespace', async () => {
  const originalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  const local = memoryStorage();
  globalThis.localStorage = local;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  try {
    await connectPhotoSync('https://photos.example.workers.dev/', '123456789012345678901234');
    assert.deepEqual(getPhotoSyncConfig(), {
      endpoint: 'https://photos.example.workers.dev',
      key: '123456789012345678901234',
    });
    assert.equal(local.values.has(STORAGE_KEYS.photoSyncEndpoint), true);
    assert.equal(local.values.has(STORAGE_KEYS.photoSyncKey), true);
    assert.equal([...local.values.keys()].every((key) => key.startsWith('car-sales.')), true);
    disconnectPhotoSync();
    assert.deepEqual(getPhotoSyncConfig(), { endpoint: '', key: '' });
  } finally {
    globalThis.localStorage = originalStorage;
    globalThis.fetch = originalFetch;
  }
});

test('photo metadata excludes the Blob body', () => {
  const meta = toPhotoMeta({
    id: 'photo-1', clientId: 'client-1', kind: 'card',
    blob: new Blob(['image'], { type: 'image/jpeg' }),
    w: 1200, h: 800, name: 'card.jpg', createdAt: '2026-08-20T00:00:00.000Z',
  });
  assert.equal(meta.cloud, 'r2');
  assert.equal(meta.size, 5);
  assert.equal('blob' in meta, false);
});
