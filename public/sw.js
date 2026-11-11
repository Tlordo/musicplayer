// Сервис-воркер: интерфейс и сохранённая музыка открываются без компьютера.
//  • Оболочка (HTML/CSS/JS/шрифты) — «сначала сеть», с коротким ожиданием: если компьютер
//    не отвечает пару секунд, берём копию из кэша.
//  • /api/stream/:id, /api/thumbnail/:id, /api/peaks/:id — если трек сохранён на телефоне
//    (IndexedDB «mk-offline», её пишет public/js/offline.js), отдаём его отсюда, с поддержкой
//    Range: перемотка работает и без сети. Остальное — как есть, с компьютера.
// Регистрируется лишь в защищённом контексте (localhost или HTTPS) — так требуют браузеры;
// по http://<ip>:3000 страница справляется сама (см. offline.js и README).

const CACHE = 'mk-shell-v2';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/base.css', 'css/classic.css', 'css/cassette.css', 'fonts/fonts.css',
  'icons/icon-192.png', 'icons/favicon-32.png',
];
const NET_WAIT_MS = 3500;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // По одному: отсутствующий файл не должен сорвать установку.
    await Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await loadSaved();
    await self.clients.claim();
  })());
});

// ---- IndexedDB (та же схема, что в offline.js) ----
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('mk-offline', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('audio')) d.createObjectStore('audio', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('thumbs')) d.createObjectStore('thumbs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbp.catch(() => { dbp = null; });
  }
  return dbp;
}
async function getRecord(store, id) {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const r = d.transaction(store).objectStore(store).get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  } catch { return null; }
}

// Какие треки сохранены на телефоне. Пока список известен, запросы остальных треков
// (а это почти все обложки и потоки) идут в сеть мимо воркера — без лишнего чтения базы
// и без прокачки каждого ответа через воркер. Страница сообщает об изменениях (offline.js).
let saved = null;   // Set<id> или null — ещё не прочитан
let savedLoading = null;
function loadSaved() {
  if (!savedLoading) {
    savedLoading = db()
      .then((d) => new Promise((resolve, reject) => {
        const r = d.transaction('audio').objectStore('audio').getAllKeys();
        r.onsuccess = () => resolve(new Set(r.result));
        r.onerror = () => reject(r.error);
      }))
      .then((s) => { saved = s; }, () => { saved = null; })
      .finally(() => { savedLoading = null; });
  }
  return savedLoading;
}
self.addEventListener('message', (e) => { if (e.data === 'offline-changed') e.waitUntil(loadSaved()); });

/** Ответ из Blob с поддержкой Range (206 Partial Content). */
function blobResponse(blob, type, rangeHeader) {
  const size = blob.size;
  const base = { 'Content-Type': type || blob.type || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'X-Offline': '1' };
  const m = /^bytes=(\d*)-(\d*)$/.exec((rangeHeader || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) {
    return new Response(blob, { status: 200, headers: { ...base, 'Content-Length': String(size) } });
  }
  let start, end;
  if (m[1] === '') {            // bytes=-N — последние N байт
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
  });
}

async function offlineApi(req, kind, id) {
  if (kind === 'stream') {
    const rec = await getRecord('audio', id);
    if (rec) return blobResponse(rec.blob, rec.type, req.headers.get('Range'));
    return fetch(req);
  }
  const rec = await getRecord('thumbs', id);
  if (kind === 'thumbnail' && rec && rec.blob) return blobResponse(rec.blob, rec.type, null);
  if (kind === 'peaks' && rec && rec.peaks) {
    return new Response(JSON.stringify(rec.peaks), { headers: { 'Content-Type': 'application/json', 'X-Offline': '1' } });
  }
  return fetch(req);
}

/** Сеть, но не дольше NET_WAIT_MS, если есть копия в кэше. */
async function shell(req) {
  const cached = caches.match(req, { ignoreSearch: true });
  const net = fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NET_WAIT_MS, null));
  try {
    const first = await Promise.race([net, timeout]);
    if (first) return first;
    const hit = await cached;
    return hit || await net;
  } catch (err) {
    const hit = await cached;
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const m = /^\/api\/(stream|thumbnail|peaks)\/([^/]+)$/.exec(url.pathname);
  if (m) {
    // Сохранение на телефон само скачивает с сервера: не подменяем его ответ копией.
    if (e.request.cache === 'no-store') return;
    const id = decodeURIComponent(m[2]);
    if (saved && !saved.has(id)) return;   // на телефоне его нет — прямо в сеть
    if (!saved) loadSaved();
    e.respondWith(offlineApi(e.request, m[1], id));
    return;
  }
  // Остальные данные и musetext — всегда с сервера.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/musetext/')) return;
  e.respondWith(shell(e.request));
});
