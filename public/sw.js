// Сервис-воркер: оболочка интерфейса открывается и без сети (сама музыка — с сервера).
// Стратегия «сначала сеть»: интерфейс всегда свежий, кэш — только запасной вариант.
// Регистрируется лишь в защищённом контексте (localhost или HTTPS) — так требуют браузеры.

const CACHE = 'mk-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Данные, музыка и обложки не кэшируем — они живут на сервере.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/musetext/')) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await caches.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
