const MAX_BYTES = 15 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || 'https://leoliaoinfo-cpu.github.io')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function cors(request, env) {
  const origin = request.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowedOrigins(env).includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(request, env), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function authorized(request, secret) {
  const supplied = request.headers.get('Authorization') || '';
  const expected = `Bearer ${secret || ''}`;
  if (!secret || supplied.length !== expected.length) return false;
  let different = 0;
  for (let index = 0; index < expected.length; index += 1) {
    different |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return different === 0;
}

function parsePhotoPath(pathname) {
  const match = pathname.match(/^\/v1\/photos\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  let clientId;
  let photoId;
  try {
    clientId = decodeURIComponent(match[1]);
    photoId = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  if (!ID_RE.test(clientId) || !ID_RE.test(photoId)) return null;
  return { clientId, photoId, key: `clients/${clientId}/${photoId}.jpg` };
}

async function handlePhoto(request, env, route) {
  if (request.method === 'PUT') {
    const type = request.headers.get('Content-Type') || '';
    if (!type.startsWith('image/')) return json(request, env, { error: '只接受圖片格式' }, 415);
    const declared = Number(request.headers.get('Content-Length') || 0);
    if (declared > MAX_BYTES) return json(request, env, { error: '單張照片不可超過 15 MB' }, 413);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) return json(request, env, { error: '單張照片不可超過 15 MB' }, 413);
    const result = await env.PHOTOS.put(route.key, bytes, {
      httpMetadata: { contentType: type, cacheControl: 'private, max-age=31536000' },
    });
    return json(request, env, { ok: true, size: bytes.byteLength, etag: result?.etag || null });
  }

  if (request.method === 'GET') {
    const object = await env.PHOTOS.get(route.key);
    if (!object) return json(request, env, { error: '找不到照片' }, 404);
    const headers = new Headers(cors(request, env));
    object.writeHttpMetadata?.(headers);
    headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
    headers.set('Cache-Control', 'private, max-age=31536000');
    if (object.httpEtag) headers.set('ETag', object.httpEtag);
    return new Response(object.body, { headers });
  }

  if (request.method === 'DELETE') {
    await env.PHOTOS.delete(route.key);
    return json(request, env, { ok: true });
  }

  return json(request, env, { error: '不支援此操作' }, 405);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') {
      if (!origin || !allowedOrigins(env).includes(origin)) {
        return json(request, env, { error: '不允許的來源' }, 403);
      }
      return new Response(null, { status: 204, headers: cors(request, env) });
    }
    if (!authorized(request, env.PHOTO_SYNC_KEY)) return json(request, env, { error: '未授權' }, 401);

    const { pathname } = new URL(request.url);
    if (pathname === '/v1/health' && request.method === 'GET') {
      if (!env.PHOTOS) return json(request, env, { error: 'R2 binding PHOTOS 尚未設定' }, 503);
      return json(request, env, { ok: true });
    }

    const route = parsePhotoPath(pathname);
    if (!route) return json(request, env, { error: '路徑或 ID 不合法' }, 404);
    return handlePhoto(request, env, route);
  },
};
