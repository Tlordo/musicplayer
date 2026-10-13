// Движок плеера: библиотека, воспроизведение, звук. Ничего не знает о разметке —
// дизайны и интерфейс подписываются на его события.

import { settings, save, local } from './store.js';
import { parseDuration } from './format.js';

const listeners = new Map();
export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}
function emit(type, detail) {
  (listeners.get(type) || []).forEach((fn) => {
    try { fn(detail); } catch (err) { console.error(err); }
  });
}

export const audio = document.getElementById('audio');

export const state = {
  library: [],       // как пришло с сервера
  view: [],          // после поиска и сортировки
  query: '',
  current: null,     // трек в плеере
  loadError: null,
  played: local.played(),
  dragging: false,   // пользователь тянет перемотку
  dragP: 0,
};

// ============ Библиотека ============
const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });
const SORTS = {
  added: (a, b) => (b.added || 0) - (a.added || 0),
  artist: (a, b) => collator.compare(a.artist || '', b.artist || '') || collator.compare(a.title || '', b.title || ''),
  title: (a, b) => collator.compare(a.title || '', b.title || ''),
  album: (a, b) => collator.compare(a.album || '', b.album || '') || collator.compare(a.title || '', b.title || ''),
};

export async function loadLibrary() {
  try {
    const res = await fetch('/api/library');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    list.forEach((t) => { t._sec = parseDuration(t.duration); });
    state.library = list;
    state.loadError = null;
    if (state.current) {
      state.current = list.find((t) => t.video_id === state.current.video_id) || state.current;
    }
  } catch (err) {
    state.library = [];
    state.loadError = err;
  }
  applyFilters();
}

export function setQuery(q) {
  state.query = q;
  applyFilters();
}

export function setSort(mode) {
  if (!SORTS[mode]) return;
  settings.sort = mode;
  save();
  applyFilters();
}

export function applyFilters() {
  const q = state.query.trim().toLowerCase();
  state.view = state.library.filter((t) => !q || [t.title, t.artist, t.album].some((v) => (v || '').toLowerCase().includes(q)));
  state.view.sort(SORTS[settings.sort] || SORTS.added);
  emit('library', state);
}

export function totalSeconds() {
  return state.library.reduce((s, t) => s + (t._sec || 0), 0);
}

export function find(id) {
  return state.library.find((t) => t.video_id === id) || null;
}

// ============ Звук и анализ ============
let ctx = null;
let analysers = null;   // [левый, правый, моно-спектр]
let streamDest = null;
const timeBuf = new Float32Array(1024);

function initAudioGraph() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaElementSource(audio);
    const splitter = ctx.createChannelSplitter(2);
    const l = ctx.createAnalyser();
    const r = ctx.createAnalyser();
    const spec = ctx.createAnalyser();
    l.fftSize = r.fftSize = 1024;
    spec.fftSize = 512;
    spec.smoothingTimeConstant = 0.72;
    src.connect(ctx.destination);
    src.connect(splitter);
    splitter.connect(l, 0);
    splitter.connect(r, 1);
    src.connect(spec);
    streamDest = ctx.createMediaStreamDestination();
    src.connect(streamDest);
    analysers = [l, r, spec];
  } catch (err) {
    console.warn('Web Audio недоступен:', err);
    analysers = null;
  }
}

/** Уровни левого и правого канала, 0…~1.1 (−40…−4 дБ). */
export function levels() {
  if (!analysers || audio.paused) return [0, 0];
  return [analysers[0], analysers[1]].map((a) => {
    a.getFloatTimeDomainData(timeBuf);
    let sum = 0;
    for (let i = 0; i < timeBuf.length; i++) sum += timeBuf[i] * timeBuf[i];
    const db = 20 * Math.log10(Math.sqrt(sum / timeBuf.length) || 1e-6);
    return Math.min(1.1, Math.max(0, (db + 40) / 36));
  });
}

const specBuf = new Uint8Array(256);
/** Спектр (256 полос, 0…255) или null, если звук не анализируется. */
export function spectrum() {
  if (!analysers || audio.paused) return null;
  analysers[2].getByteFrequencyData(specBuf);
  return specBuf;
}

/** Поток звука плеера — для musetext. */
export function audioStream() {
  initAudioGraph();
  return streamDest ? streamDest.stream : null;
}

// ============ Воспроизведение ============
let restoreTimer = null;

export function progress() {
  return audio.duration ? Math.min(1, audio.currentTime / audio.duration) : 0;
}

export function load(track, autoplay) {
  clearTimeout(restoreTimer);
  state.current = track;
  initAudioGraph();
  audio.src = `/api/stream/${encodeURIComponent(track.video_id)}`;
  audio.load();
  local.saveLast(track.video_id);
  emit('track', track);
  if (autoplay) play();
}

/** Вставить трек без воспроизведения (при запуске). */
export function cue(track) {
  state.current = track;
  emit('track', track);
}

export async function play() {
  if (!state.current) {
    if (state.view.length) load(state.view[0], true);
    return;
  }
  if (!audio.getAttribute('src')) { load(state.current, true); return; }
  initAudioGraph();
  try {
    if (ctx && ctx.state === 'suspended') await ctx.resume();
    await audio.play();
  } catch (err) {
    if (err.name !== 'AbortError' && err.name !== 'NotAllowedError') console.warn(err);
  }
}

export function pause() { audio.pause(); }
export function toggle() { if (audio.paused) play(); else pause(); }

function neighbour(step) {
  const list = state.view.length ? state.view : state.library;
  if (!list.length) return null;
  if (settings.shuffle && list.length > 1) {
    let t;
    do { t = list[Math.floor(Math.random() * list.length)]; } while (state.current && t.video_id === state.current.video_id);
    return t;
  }
  const idx = state.current ? list.findIndex((t) => t.video_id === state.current.video_id) : -1;
  let i = idx + step;
  if (i >= list.length) { if (settings.repeat === 'all' || idx === -1) i = 0; else return null; }
  if (i < 0) i = settings.repeat === 'all' ? list.length - 1 : 0;
  return list[i];
}

export function next() {
  const t = neighbour(1);
  if (t) load(t, true);
}

export function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  const t = neighbour(-1);
  if (t) load(t, true);
}

export function seek(sec) {
  if (!audio.duration) return;
  audio.currentTime = Math.min(audio.duration, Math.max(0, sec));
  emit('time');
}

export function seekP(p) { seek(p * (audio.duration || 0)); }

export function setVolume(v, persist = true) {
  audio.volume = Math.min(1, Math.max(0, v));
  if (persist) { settings.volume = audio.volume; save(); }
  emit('state');
}

export function toggleMute() {
  audio.muted = !audio.muted;
  emit('state');
}

export function toggleShuffle() {
  settings.shuffle = !settings.shuffle;
  save();
  emit('state');
}

export function cycleRepeat() {
  settings.repeat = { off: 'all', all: 'one', one: 'off' }[settings.repeat];
  save();
  emit('state');
}

audio.addEventListener('play', () => emit('state'));
audio.addEventListener('pause', () => emit('state'));
audio.addEventListener('loadedmetadata', () => emit('time'));
audio.addEventListener('seeked', () => emit('time'));
audio.addEventListener('playing', () => {
  const t = state.current;
  if (t && !state.played.has(t.video_id)) {
    state.played.add(t.video_id);
    local.savePlayed(state.played);
    emit('played', t);
  }
});
audio.addEventListener('ended', () => {
  if (settings.repeat === 'one') { audio.currentTime = 0; play(); return; }
  if (settings.autoNext) next();
});
audio.addEventListener('error', onAudioError);

// Файла нет — сервер начинает восстановление; ждём, пока он появится.
async function onAudioError() {
  const track = state.current;
  if (!track || !audio.getAttribute('src')) return;
  let data = null;
  try {
    const res = await fetch(`/api/stream/${encodeURIComponent(track.video_id)}`, { headers: { Range: 'bytes=0-0' } });
    if (res.ok) { load(track, true); return; }
    data = await res.json().catch(() => null);
  } catch { /* сеть */ }

  if (data && data.restoring) {
    track.file_exists = false;
    emit('library', state);
    emit('toast', { text: 'Файла нет — скачиваю трек заново…', type: 'info', ms: 5000 });
    pollRestore(track, 0);
  } else {
    emit('toast', { text: data && data.error ? `Не воспроизводится: ${data.error}` : 'Не удалось воспроизвести трек', type: 'error' });
  }
}

function pollRestore(track, attempt) {
  clearTimeout(restoreTimer);
  if (attempt > 40 || state.current !== track) return;
  restoreTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/stream/${encodeURIComponent(track.video_id)}`, { headers: { Range: 'bytes=0-0' } });
      if (res.ok) {
        track.file_exists = true;
        emit('library', state);
        emit('toast', { text: 'Трек восстановлен', type: 'ok' });
        if (state.current === track) load(track, true);
        return;
      }
    } catch { /* ещё качается */ }
    pollRestore(track, attempt + 1);
  }, 4000);
}

// ============ Изменение библиотеки ============
export async function addTrack(url) {
  const res = await fetch('/api/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
  await loadLibrary();
  return data.track;
}

export async function removeTrack(track) {
  const res = await fetch(`/api/track/${encodeURIComponent(track.video_id)}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

  const wasCurrent = state.current && state.current.video_id === track.video_id;
  const nextTrack = wasCurrent ? neighbour(1) : null;
  state.library = state.library.filter((t) => t.video_id !== track.video_id);
  state.played.delete(track.video_id);
  local.savePlayed(state.played);
  if (wasCurrent) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    state.current = null;
    applyFilters();
    if (nextTrack && nextTrack.video_id !== track.video_id) cue(nextTrack);
    else emit('track', null);
  } else {
    applyFilters();
  }
}

export function clearPlayed() {
  state.played.clear();
  local.savePlayed(state.played);
  emit('library', state);
}

// ============ Рекомендации ============
export const recs = { items: [], seeds: [], loading: false, error: null, adding: new Set(), loadedFor: null };
let recsToken = 0;

/** Микс YouTube по текущему треку (или по последним добавленным, если ничего не играет). */
export async function loadRecs({ fresh = false } = {}) {
  const seed = state.current ? state.current.video_id : '';
  const token = ++recsToken;
  recs.loading = true;
  recs.error = null;
  recs.loadedFor = seed;
  emit('recs');
  try {
    const res = await fetch(`/api/recommendations?seed=${encodeURIComponent(seed)}${fresh ? '&fresh=1' : ''}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (token !== recsToken) return;
    recs.items = data.items || [];
    recs.seeds = data.seeds || [];
  } catch (err) {
    if (token !== recsToken) return;
    recs.error = err.message;
  }
  recs.loading = false;
  emit('recs');
}

export async function addRec(id) {
  const item = recs.items.find((r) => r.id === id);
  if (!item || recs.adding.has(id)) return;
  recs.adding.add(id);
  emit('recs');
  try {
    const t = await addTrack(item.url);
    recs.items = recs.items.filter((r) => r.id !== id);
    emit('toast', { text: `Добавлен «${(t && t.title) || item.title}»`, type: 'ok' });
  } catch (err) {
    emit('toast', { text: `Не удалось добавить: ${err.message}`, type: 'error', ms: 5000 });
  } finally {
    recs.adding.delete(id);
    emit('recs');
  }
}

// ============ Кадровый цикл ============
// Один requestAnimationFrame на всё приложение: дизайны рисуют свои индикаторы в 'frame'.
let last = 0;
function frame(t) {
  const dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
  last = t;
  emit('frame', { t, dt, p: state.dragging ? state.dragP : progress(), playing: !audio.paused });
  requestAnimationFrame(frame);
}

export function start() {
  setVolume(settings.volume, false);
  requestAnimationFrame(frame);
}

export { emit };
