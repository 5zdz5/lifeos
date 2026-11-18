/* LifeOS · GitHub Pages Service Worker
 * 单文件 PWA 的离线缓存。网络优先，失败回退缓存，避免发布后看不到新版。
 */
const CACHE = 'lifeos-pages-49957779';

// 以 SW 的 scope 为根，兼容 /lifeos/ 这类子路径部署
self.addEventListener('install', (e) => {
  const root = new URL('./', self.registration.scope).href;
  const shell = [root, root + 'index.html'];
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(shell).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 网络优先：在线永远拿最新；离线回退缓存
  e.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return resp;
      })
      .catch(() =>
        caches.match(req).then((hit) => {
          if (hit) return hit;
          if (req.mode === 'navigate') {
            return caches.match(new URL('./index.html', self.registration.scope).href);
          }
          return Response.error();
        })
      )
  );
});
