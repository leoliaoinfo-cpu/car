import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';

class MemoryBucket {
  constructor() { this.items = new Map(); }

  async put(key, value, options) {
    const bytes = new Uint8Array(value);
    this.items.set(key, { bytes, httpMetadata: options?.httpMetadata || {} });
    return { etag: 'test-etag' };
  }

  async get(key) {
    const item = this.items.get(key);
    if (!item) return null;
    return {
      body: item.bytes,
      httpMetadata: item.httpMetadata,
      httpEtag: '"test-etag"',
      writeHttpMetadata(headers) {
        if (item.httpMetadata.contentType) headers.set('Content-Type', item.httpMetadata.contentType);
      },
    };
  }

  async delete(key) { this.items.delete(key); }
}

const env = {
  PHOTO_SYNC_KEY: 'a-very-long-test-key-1234',
  ALLOWED_ORIGINS: 'https://leoliaoinfo-cpu.github.io,http://localhost:5173',
  PHOTOS: new MemoryBucket(),
};
const auth = { Authorization: 'Bearer a-very-long-test-key-1234' };

test('health requires the shared secret', async () => {
  const denied = await worker.fetch(new Request('https://worker.test/v1/health'), env);
  assert.equal(denied.status, 401);
  const ok = await worker.fetch(new Request('https://worker.test/v1/health', { headers: auth }), env);
  assert.equal(ok.status, 200);
});

test('photo PUT, GET and DELETE lifecycle', async () => {
  const url = 'https://worker.test/v1/photos/client-1/photo-1';
  const put = await worker.fetch(new Request(url, {
    method: 'PUT', headers: { ...auth, 'Content-Type': 'image/jpeg' }, body: new Uint8Array([1, 2, 3]),
  }), env);
  assert.equal(put.status, 200);

  const get = await worker.fetch(new Request(url, { headers: auth }), env);
  assert.equal(get.status, 200);
  assert.deepEqual(new Uint8Array(await get.arrayBuffer()), new Uint8Array([1, 2, 3]));

  const del = await worker.fetch(new Request(url, { method: 'DELETE', headers: auth }), env);
  assert.equal(del.status, 200);
  const missing = await worker.fetch(new Request(url, { headers: auth }), env);
  assert.equal(missing.status, 404);
});

test('rejects non-image uploads and unsafe IDs', async () => {
  const badType = await worker.fetch(new Request('https://worker.test/v1/photos/client-1/photo-2', {
    method: 'PUT', headers: { ...auth, 'Content-Type': 'text/plain' }, body: 'nope',
  }), env);
  assert.equal(badType.status, 415);
  const badPath = await worker.fetch(new Request('https://worker.test/v1/photos/client-1/bad.id', { headers: auth }), env);
  assert.equal(badPath.status, 404);
});

test('CORS preflight only permits configured origins', async () => {
  const allowed = await worker.fetch(new Request('https://worker.test/v1/health', {
    method: 'OPTIONS', headers: { Origin: 'https://leoliaoinfo-cpu.github.io' },
  }), env);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://leoliaoinfo-cpu.github.io');

  const denied = await worker.fetch(new Request('https://worker.test/v1/health', {
    method: 'OPTIONS', headers: { Origin: 'https://example.com' },
  }), env);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
});
