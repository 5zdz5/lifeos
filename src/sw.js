/* LifeOS · 离线 Service Worker
 * 策略：页面导航(navigate)走 network-first —— 每次打开都先取服务器最新版本，
 *      断网时才回退缓存；静态资源走 cache-first，保证离线可用。
 * 下方 AUTO 区块的 CACHE 名与 ASSETS 清单由 build-standalone.js 依据源码 hash
 * 自动生成，请勿手改；源码一变版本即变，客户端会自动更新。
 */
// ===== AUTO-GENERATED-BEGIN (build-standalone.js 自动生成，请勿手改) =====
const CACHE = 'lifeos-c04360fc';
const ASSETS = [
  './',
  './index.html',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './css/app.css',
  './css/finesse.css',
  './css/style.css',
  './js/app.js',
  './js/bridge.js',
  './js/capture.js',
  './js/links.js',
  './js/mindsea.js',
  './js/modules/ai.js',
  './js/modules/calendar.js',
  './js/modules/codex.js',
  './js/modules/daily.js',
  './js/modules/graph.js',
  './js/modules/habits.js',
  './js/modules/heatmap.js',
  './js/modules/library.js',
  './js/modules/mindsea.js',
  './js/modules/notes.js',
  './js/modules/search.js',
  './js/modules/settings.js',
  './js/modules/tasks.js',
  './js/search.js',
  './js/seed-library.js',
  './js/stats.js',
  './js/storage.js',
  './js/store.js',
  './js/utils.js',
  './js/vault.js',
  './js/version.js',
  './manifest.webmanifest',
  './standalone.html',
  './version.json'
];
// ===== AUTO-GENERATED-END =====

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 允许页面通知新 SW 立即接管
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

// 走网络并回写缓存；失败时回退缓存（页面请求再兜底到 index.html）
async function fromNetwork(req, fallbackToShell) {
  try {
    const resp = await fetch(req);
    if (resp && resp.ok) {
      const cp = resp.clone();
      caches.open(CACHE).then((c) => c.put(req, cp)).catch(() => {});
      return resp;
    }
    return resp;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    if (fallbackToShell) return (await caches.match('./index.html')) || Response.error();
    return Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // 页面：始终先走网络，确保发布后打开即最新版
  if (req.mode === 'navigate') {
    e.respondWith(fromNetwork(req, true));
    return;
  }
  // 静态资源：网络优先，失败才回退缓存。
  // 配合 index.html 里的 ?v=<hash> 版本串，发布后立刻拿到新文件，
  // 即便用户浏览器里残留旧 SW，URL 变化也会让旧缓存 key 无法命中。
  e.respondWith(fromNetwork(req, false));
});
