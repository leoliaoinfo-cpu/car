/* 業務系統 Service Worker
 * 1. 離線快取：網路優先（更新永遠即時）、斷網時用上次的快取照常開啟
 * 2. 到期提醒通知：periodic background sync（Android 安裝後可背景檢查）
 *    ＋接收頁面訊息顯示系統通知（頁面開著時所有平台通用）
 */
const CACHE_PREFIX = 'car-sales-assistant-';
const CACHE = `${CACHE_PREFIX}v4`;
const DB_NAME = 'car_sales_assistant_v1';

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // 清掉舊版快取（更名、換圖示後不留殘影）
    const keys = await caches.keys();
    // 只清本系統自己的舊快取；不可刪同網域 /TEST/ 等其他系統的 cache。
    await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // 只接管同網域的 GET（GitHub API 等外部請求原樣放行）
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || Response.error()))
  );
});

// ── 到期提醒 ──────────────────────────────────────────────────────────────────
function countDueTimers() {
  return new Promise((resolve) => {
    let db = null;
    const done = (n) => { try { db?.close(); } catch { /* noop */ } resolve(n); };
    try {
      const open = indexedDB.open(DB_NAME);
      open.onsuccess = () => {
        db = open.result;
        try {
          const all = db.transaction('timers', 'readonly').objectStore('timers').getAll();
          all.onsuccess = () => {
            const now = Date.now();
            done((all.result || []).filter((t) => !t.confirmedAt && Date.parse(t.triggerAt) <= now).length);
          };
          all.onerror = () => done(0);
        } catch { done(0); }
      };
      open.onerror = () => done(0);
      open.onblocked = () => done(0);
    } catch { done(0); }
  });
}

// 通知只含數量、不含客戶資料（隱私）
function showReminder(count) {
  return self.registration.showNotification('業務系統', {
    body: `您有 ${count} 則提醒到期`,
    tag: 'car-sales-assistant-timer',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
  });
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag !== 'car-sales-check-reminders') return;
  e.waitUntil(countDueTimers().then((n) => (n > 0 ? showReminder(n) : undefined)));
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'show-reminder' && e.data.count > 0) {
    e.waitUntil?.(showReminder(e.data.count));
    if (!e.waitUntil) showReminder(e.data.count);
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const w = wins.find((x) => 'focus' in x);
      return w ? w.focus() : self.clients.openWindow('./');
    })
  );
});
