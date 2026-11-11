// Музыка на телефоне: файлы треков и обложки в IndexedDB этого браузера.
// Хранилище общее для страницы и сервис-воркера (sw.js читает ту же базу).
// IndexedDB работает и без защищённого контекста — значит, и по http://<ip>:3000:
// там нет сервис-воркера, и страница играет сохранённое сама, через blob-ссылки.
//
// Два вида записей:
//   pin  — пользователь сохранил сам («Сохранить на телефон»); удаляются только вручную;
//   auto — умный кэш: текущий и следующие треки очереди; старые вытесняются по лимиту.

const DB_NAME = 'mk-offline';
const DB_VER = 1;
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB недоступна')); return; }
      const req = indexedDB.open(DB_NAME, DB_VER);
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

function tx(store, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    // Несколько хранилищ — отдаём саму транзакцию.
    const s = Array.isArray(store) ? { transaction: t } : t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('транзакция прервана'));
  }));
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// ---- Индекс в памяти: что есть на телефоне (без самих файлов) ----
/** id → { kind: 'pin'|'auto', size, used } */
export const index = new Map();
let ready = null;

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed() {
  listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  tellSw();
}

// Сервис-воркер перехватывает только сохранённые треки — сообщаем ему, что список изменился.
let swTimer = null;
function tellSw() {
  clearTimeout(swTimer);
  swTimer = setTimeout(() => {
    try { navigator.serviceWorker?.controller?.postMessage('offline-changed'); } catch { /* нет воркера */ }
  }, 200);
}

export function init() {
  if (!ready) {
    ready = tx('audio', 'readonly', (s) => {
      const r = s.openCursor();
      r.onsuccess = () => {
        const c = r.result;
        if (!c) return;
        const { id, kind, size, used } = c.value;
        index.set(id, { kind, size, used });
        c.continue();
      };
    }).then(changed).catch((err) => console.warn('офлайн-хранилище:', err));
  }
  return ready;
}

/** 'pin' | 'auto' | null */
export function has(id) { const e = index.get(id); return e ? e.kind : null; }

export function totals() {
  let pin = 0, auto = 0, pinN = 0, autoN = 0;
  for (const e of index.values()) {
    if (e.kind === 'pin') { pin += e.size; pinN++; } else { auto += e.size; autoN++; }
  }
  return { pin, auto, pinN, autoN };
}

// ---- Загрузка в хранилище ----
const inflight = new Map();   // id → Promise
const queue = [];             // ожидают загрузки: { id, kind, thumb }
let active = 0;
const PARALLEL = 2;
export const progress = { total: 0, done: 0, failed: 0 };

async function fetchBlob(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

async function download(id, kind, thumb) {
  const audio = await fetchBlob(`/api/stream/${encodeURIComponent(id)}`);
  let cover = null;
  try { cover = await fetchBlob(thumb || `/api/thumbnail/${encodeURIComponent(id)}`); } catch { /* без обложки */ }
  let peaks = null;   // форма волны и громкость — для полосы перемотки и выравнивания
  try {
    const r = await fetch(`/api/peaks/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (r.ok) peaks = await r.json();
  } catch { /* без формы волны */ }
  // Пока качали, запись могла стать «своей» — вид не понижаем.
  const now = Date.now();
  const prev = index.get(id);
  const k = prev && prev.kind === 'pin' ? 'pin' : kind;
  await tx(['audio', 'thumbs'], 'readwrite', (s) => {
    const t = s.transaction;
    t.objectStore('audio').put({ id, kind: k, size: audio.size, type: audio.type || 'audio/ogg', used: now, saved: now, blob: audio });
    if (cover || peaks) t.objectStore('thumbs').put({ id, type: cover && cover.type, blob: cover, peaks });
  });
  index.set(id, { kind: k, size: audio.size, used: now });
}

function pump() {
  while (active < PARALLEL && queue.length) {
    const job = queue.shift();
    active++;
    const p = download(job.id, job.kind, job.thumb)
      .then(() => { progress.done++; })
      .catch((err) => { progress.failed++; console.warn('не сохранилось', job.id, err); throw err; })
      .finally(() => {
        active--;
        inflight.delete(job.id);
        if (!queue.length && !active) { progress.total = progress.done = progress.failed = 0; }
        changed();
        pump();
      });
    inflight.set(job.id, p);
    p.catch(() => {});
  }
}

/** Поставить трек в очередь на сохранение. Уже сохранённый «авто» трек просто становится своим. */
export async function save(track, kind = 'pin') {
  await init();
  const id = track.video_id;
  const cur = index.get(id);
  if (cur) {
    if (kind === 'pin' && cur.kind !== 'pin') await setKind(id, 'pin');
    else if (kind === 'auto') touch(id);
    return;
  }
  if (inflight.has(id) || queue.some((j) => j.id === id)) {
    if (kind === 'pin') queue.forEach((j) => { if (j.id === id) j.kind = 'pin'; });
    return;
  }
  queue.push({ id, kind, thumb: track.thumbnail_api });
  progress.total++;
  changed();
  pump();
}

/** Сохранить много треков; вернуть число новых в очереди. */
export async function saveMany(tracks) {
  await init();
  let n = 0;
  for (const t of tracks) {
    if (has(t.video_id) !== 'pin') n++;
    save(t, 'pin');
  }
  if (n) requestPersist();
  return n;
}

export function pending(id) { return inflight.has(id) || queue.some((j) => j.id === id); }

async function setKind(id, kind) {
  await tx('audio', 'readwrite', async (s) => {
    const v = await reqP(s.get(id));
    if (v) { v.kind = kind; s.put(v); }
  });
  const e = index.get(id);
  if (e) e.kind = kind;
  changed();
}

/** Отметить, что трек недавно нужен (для вытеснения старых «авто»). */
export function touch(id) {
  const e = index.get(id);
  if (!e) return;
  e.used = Date.now();
  tx('audio', 'readwrite', async (s) => {
    const v = await reqP(s.get(id));
    if (v) { v.used = e.used; s.put(v); }
  }).catch(() => {});
}

export async function remove(ids) {
  await init();
  const list = [].concat(ids);
  await tx(['audio', 'thumbs'], 'readwrite', (s) => {
    const t = s.transaction;
    for (const id of list) { t.objectStore('audio').delete(id); t.objectStore('thumbs').delete(id); }
  });
  list.forEach((id) => { index.delete(id); revoke(id); });
  changed();
}

/** «Свой» трек снова становится обычным кэшем (его вытеснит лимит). */
export async function unpin(id) {
  if (has(id) === 'pin') await setKind(id, 'auto');
}

/** Удалить «авто» записи сверх лимита, кроме нужных сейчас (keep). */
export async function trimAuto(limitBytes, keep = new Set()) {
  await init();
  const autos = [...index].filter(([, e]) => e.kind === 'auto').sort((a, b) => a[1].used - b[1].used);
  let total = autos.reduce((s, [, e]) => s + e.size, 0);
  const drop = [];
  for (const [id, e] of autos) {
    if (total <= limitBytes) break;
    if (keep.has(id)) continue;
    drop.push(id);
    total -= e.size;
  }
  if (drop.length) await remove(drop);
  return drop.length;
}

export async function clearAuto() {
  await init();
  return remove([...index].filter(([, e]) => e.kind === 'auto').map(([id]) => id));
}

export async function clearAll() {
  await init();
  queue.length = 0;
  return remove([...index.keys()]);
}

// ---- Воспроизведение без сервиса-воркера: blob-ссылки ----
const urls = new Map();   // id → objectURL
function revoke(id) {
  const u = urls.get(id);
  if (u) { URL.revokeObjectURL(u); urls.delete(id); }
}

async function blobOf(store, id) {
  try {
    const v = await tx(store, 'readonly', (s) => s.get(id));
    return v ? v.blob : null;
  } catch { return null; }
}

/** Ссылка на сохранённый файл трека (null — на телефоне его нет). */
export async function audioUrl(id) {
  if (!has(id)) return null;
  if (urls.has(id)) return urls.get(id);
  const blob = await blobOf('audio', id);
  if (!blob) return null;
  // Держим не больше нескольких ссылок: каждая держит файл в памяти вкладки.
  if (urls.size >= 4) revoke(urls.keys().next().value);
  const u = URL.createObjectURL(blob);
  urls.set(id, u);
  return u;
}

/** Форма волны сохранённого трека (null — нет). */
export async function peaksOf(id) {
  if (!has(id)) return null;
  try {
    const v = await tx('thumbs', 'readonly', (s) => s.get(id));
    return (v && v.peaks) || null;
  } catch { return null; }
}

/** Страница под сервис-воркером: тот сам отдаёт сохранённое по обычным адресам. */
export function swActive() {
  return !!(navigator.serviceWorker && navigator.serviceWorker.controller);
}

// Без сервис-воркера обложки сохранённых треков подставляем, когда сервер не отвечает.
const coverUrls = new Map();
document.addEventListener('error', async (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || img.dataset.offlineCover) return;
  const m = /\/api\/thumbnail\/([^/?#]+)/.exec(img.getAttribute('src') || '');
  if (!m) return;
  const id = decodeURIComponent(m[1]);
  img.dataset.offlineCover = '1';
  let u = coverUrls.get(id);
  if (!u) {
    const blob = await blobOf('thumbs', id);
    if (!blob) return;
    u = URL.createObjectURL(blob);
    coverUrls.set(id, u);
    // Ссылка держит картинку в памяти вкладки: храним лишь последние. Уже показанным
    // картинкам отзыв не мешает, а строка, нарисованная заново, получит ссылку снова.
    while (coverUrls.size > 120) {
      const [old, ou] = coverUrls.entries().next().value;
      URL.revokeObjectURL(ou);
      coverUrls.delete(old);
    }
  }
  img.src = u;
}, true);

// ---- Снимок библиотеки: чтобы без компьютера открыть то, что было ----
export async function putMeta(key, value) {
  try { await tx('meta', 'readwrite', (s) => s.put(value, key)); } catch { /* нет места — не страшно */ }
}
export async function getMeta(key) {
  try { return await tx('meta', 'readonly', (s) => s.get(key)); } catch { return undefined; }
}

// ---- Место ----
let persistAsked = false;
export function requestPersist() {
  if (persistAsked || !navigator.storage || !navigator.storage.persist) return;
  persistAsked = true;
  navigator.storage.persist().catch(() => {});
}

/** { usage, quota } от браузера, если он сообщает (только в защищённом контексте). */
export async function estimate() {
  try { return navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch { return null; }
}

/** Плеер открыт на том же устройстве, где лежат файлы (окно на компьютере, приложение Android):
 *  копировать музыку в браузер незачем. */
export function sameMachine() {
  const h = location.hostname;
  return h === 'localhost' || h === '[::1]' || h === '::1' || /^127\./.test(h);
}

/** Телефон в Wi‑Fi (или браузер не говорит) и не просит экономить трафик. */
export function onWifi() {
  const c = navigator.connection;
  if (!c) return true;
  if (c.saveData) return false;
  return !c.type || !['cellular'].includes(c.type);
}
