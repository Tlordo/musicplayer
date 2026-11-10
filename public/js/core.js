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

// Две деки ради плавного перехода: на одной играет текущий трек, на второй заранее готовится
// следующий. `audio` — всегда дека текущего трека; при переходе они меняются местами.
function makeDeck() {
  const el = document.createElement('audio');
  el.preload = 'auto';
  el.crossOrigin = 'anonymous';
  return el;
}
const decks = [document.getElementById('audio'), makeDeck()];
export let audio = decks[0];

/** Подписка на события текущей деки: готовящаяся и затихающая молчат. */
export function onAudio(type, fn) {
  for (const el of decks) el.addEventListener(type, (e) => { if (el === audio) fn(e); });
}

export const state = {
  library: [],       // как пришло с сервера
  view: [],          // после поиска и сортировки
  query: '',
  current: null,     // трек в плеере
  loadError: null,
  played: local.played(),
  dragging: false,   // пользователь тянет перемотку
  dragP: 0,
  queue: null,       // { key, ids } — играем альбом; null — библиотеку в текущем порядке
  upNext: local.upNext(),  // id треков, которые пользователь поставил в очередь («следующим», «в очередь»)
  back: [],          // что играло раньше — для «предыдущего» (в том числе в режиме «вперемешку»)
  shuffleSeen: new Set(),  // уже сыгранные в этом круге «вперемешку» — без повторов, пока не кончится список
  sleep: null,       // таймер сна: { at: мс } или { endOfTrack: true }
};

// ============ Библиотека ============
const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });
const SORTS = {
  added: (a, b) => (b.added || 0) - (a.added || 0),
  artist: (a, b) => collator.compare(a.artist || '', b.artist || '') || collator.compare(a.title || '', b.title || ''),
  title: (a, b) => collator.compare(a.title || '', b.title || ''),
  album: (a, b) => collator.compare(a.album || '', b.album || '') || collator.compare(a.title || '', b.title || ''),
  plays: (a, b) => (b.plays || 0) - (a.plays || 0) || (b.last_played || 0) - (a.last_played || 0),
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
// Цепочка: дека → выравнивание громкости → переход → эквалайзер → ограничитель → затухание (таймер сна) → выход.
// Индикаторы и musetext слушают уже обработанный звук.
let ctx = null;
let analysers = null;   // [левый, правый, моно-спектр]
let streamDest = null;
const graph = new Map();   // дека → { norm, mix }
let eqNodes = [];
let fadeGain = null;
const timeBuf = new Float32Array(1024);

/** Полосы эквалайзера, Гц. */
export const EQ_BANDS = [60, 230, 910, 3600, 14000];
export const EQ_PRESETS = {
  flat: { name: 'Ровно', gains: [0, 0, 0, 0, 0] },
  bass: { name: 'Больше баса', gains: [6, 3, 0, 0, 0] },
  treble: { name: 'Яркий', gains: [0, 0, 0, 3, 5] },
  vocal: { name: 'Голос', gains: [-2, -1, 3, 3, 0] },
  rock: { name: 'Рок', gains: [4, 1, -1, 2, 4] },
  electronic: { name: 'Электроника', gains: [5, 2, 0, 1, 4] },
  acoustic: { name: 'Акустика', gains: [2, 1, 1, 2, 2] },
  night: { name: 'Тихо ночью', gains: [-3, -1, 1, 0, -3] },
};

function initAudioGraph() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    eqNodes = EQ_BANDS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f;
      b.Q.value = 1;
      return b;
    });
    // Подъём громкости и баса не должен хрипеть: мягкий ограничитель у самого потолка.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    fadeGain = ctx.createGain();
    let node = eqNodes[0];
    for (const n of [...eqNodes.slice(1), limiter, fadeGain]) { node.connect(n); node = n; }
    for (const el of decks) {
      const norm = ctx.createGain();
      const mix = ctx.createGain();
      ctx.createMediaElementSource(el).connect(norm);
      norm.connect(mix);
      mix.connect(eqNodes[0]);
      graph.set(el, { norm, mix });
    }

    const splitter = ctx.createChannelSplitter(2);
    const l = ctx.createAnalyser();
    const r = ctx.createAnalyser();
    const spec = ctx.createAnalyser();
    l.fftSize = r.fftSize = 1024;
    spec.fftSize = 512;
    spec.smoothingTimeConstant = 0.72;
    fadeGain.connect(ctx.destination);
    fadeGain.connect(splitter);
    splitter.connect(l, 0);
    splitter.connect(r, 1);
    fadeGain.connect(spec);
    streamDest = ctx.createMediaStreamDestination();
    fadeGain.connect(streamDest);
    analysers = [l, r, spec];
    applyEq();
    applyNormalize();
  } catch (err) {
    console.warn('Web Audio недоступен:', err);
    analysers = null;
  }
}

/** Есть ли обработка звука (эквалайзер, выравнивание, плавный таймер). */
export function hasAudioFx() {
  initAudioGraph();
  return !!fadeGain;
}

export function eqGains() {
  return settings.eq.preset === 'custom' ? settings.eq.gains : (EQ_PRESETS[settings.eq.preset] || EQ_PRESETS.flat).gains;
}

export function applyEq() {
  if (!eqNodes.length) return;
  const gains = settings.eq.on ? eqGains() : EQ_BANDS.map(() => 0);
  eqNodes.forEach((n, i) => n.gain.setTargetAtTime(gains[i] || 0, ctx.currentTime, 0.04));
}

export function setEq(patch) {
  Object.assign(settings.eq, patch);
  save();
  applyEq();
  emit('eq');
}

// ---- Выравнивание громкости ----
// Сервер меряет громкость трека по EBU R128 вместе с формой волны; приводим всё к −14 LUFS,
// как стриминговые сервисы. Тише −14 поднимаем не больше чем на 6 дБ.
const TARGET_LUFS = -14;
const analysis = new Map();   // id → Promise<{ peaks, loudness }>

/** Форма волны и громкость трека (одна загрузка на трек, общая для всех). */
export function trackAnalysis(id) {
  if (!analysis.has(id)) {
    const p = fetch(`/api/peaks/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch((err) => { analysis.delete(id); throw err; });
    analysis.set(id, p);
  }
  return analysis.get(id);
}

let normToken = 0;
export async function applyNormalize() {
  const deck = graph.get(audio);
  if (!deck) return;
  const t = state.current;
  const token = ++normToken;
  let db = 0;
  if (settings.normalize && t) {
    try {
      const a = await trackAnalysis(t.video_id);
      if (token !== normToken) return;
      if (typeof a.loudness === 'number') db = Math.max(-12, Math.min(6, TARGET_LUFS - a.loudness));
    } catch { /* нет файла — оставляем как есть */ }
  }
  deck.norm.gain.setTargetAtTime(10 ** (db / 20), ctx.currentTime, 0.05);
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

/** Играть из библиотеки (очередь — весь список) или из альбома (очередь — его треки). */
export function playFrom(track, queue = null) {
  state.queue = queue;
  load(track, true);
}

/** goingBack — шаг «назад» по истории: тогда текущий трек в историю не кладём. */
export function load(track, autoplay, goingBack = false) {
  clearTimeout(restoreTimer);
  flushListen();
  stopTail();
  dropPrepared();
  setCurrent(track, goingBack);
  initAudioGraph();
  restoreFade();
  audio.src = `/api/stream/${encodeURIComponent(track.video_id)}`;
  audio.load();
  applyNormalize();
  emit('track', track);
  if (autoplay) play();
}

function setCurrent(track, goingBack) {
  const prevId = state.current && state.current.video_id;
  if (!goingBack && prevId && prevId !== track.video_id) {
    state.back.push(prevId);
    if (state.back.length > 200) state.back.shift();
  }
  state.current = track;
  state.shuffleSeen.add(track.video_id);
  listen.id = track.video_id;
  local.saveLast(track.video_id);
}

/** Вставить трек без воспроизведения (при запуске). */
export function cue(track) {
  state.current = track;
  state.shuffleSeen.add(track.video_id);
  listen.id = track.video_id;
  applyNormalize();
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

function queueList() {
  if (state.queue) {
    const list = state.queue.ids.map(find).filter(Boolean);
    if (list.length) return list;
  }
  return state.view.length ? state.view : state.library;
}

function neighbour(step) {
  const list = queueList();
  if (!list.length) return null;
  if (settings.shuffle && list.length > 1) {
    // «Вперемешку» без повторов: каждый трек по разу, потом новый круг.
    const cur = state.current && state.current.video_id;
    let pool = list.filter((t) => t.video_id !== cur && !state.shuffleSeen.has(t.video_id));
    if (!pool.length) {
      state.shuffleSeen.clear();
      if (cur) state.shuffleSeen.add(cur);
      pool = list.filter((t) => t.video_id !== cur);
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const idx = state.current ? list.findIndex((t) => t.video_id === state.current.video_id) : -1;
  let i = idx + step;
  if (i >= list.length) { if (settings.repeat === 'all' || idx === -1) i = 0; else return null; }
  if (i < 0) i = settings.repeat === 'all' ? list.length - 1 : 0;
  return list[i];
}

export function next() {
  const t = takeUpNext() || neighbour(1);
  if (t) load(t, true);
}

/** skipRestart — сразу к предыдущему треку (свайп), не перематывая текущий в начало. */
export function prev(skipRestart = false) {
  if (!skipRestart && audio.currentTime > 3) { audio.currentTime = 0; return; }
  while (state.back.length) {
    const t = find(state.back.pop());
    if (t) { load(t, true, true); return; }
  }
  const t = neighbour(-1);
  if (t) load(t, true, true);
}

/** Какой трек будет следующим (step = 1) или предыдущим (−1) — без побочных эффектов.
 *  null — неизвестно заранее («вперемешку») или списка дальше нет. Для свайпа по обложке. */
export function peek(step) {
  if (step > 0) {
    const q = state.upNext.map(find).find(Boolean);
    if (q) return q;
    return settings.shuffle ? null : neighbour(1);
  }
  for (let i = state.back.length - 1; i >= 0; i--) {
    const t = find(state.back[i]);
    if (t) return t;
  }
  if (settings.shuffle) return null;
  const t = neighbour(-1);
  return t && state.current && t.video_id === state.current.video_id ? null : t;
}

// ============ Очередь ============
function saveUpNext() {
  local.saveUpNext(state.upNext);
  emit('queue');
}

function takeUpNext() {
  while (state.upNext.length) {
    const t = find(state.upNext.shift());
    if (t) { saveUpNext(); return t; }
  }
  return null;
}

/** Поставить трек сразу после текущего. */
export function playNext(track) {
  state.upNext = [track.video_id, ...state.upNext.filter((id) => id !== track.video_id)];
  saveUpNext();
}

/** Добавить трек в конец очереди. */
export function enqueue(track) {
  if (!state.upNext.includes(track.video_id)) state.upNext.push(track.video_id);
  saveUpNext();
}

export function dequeue(index) {
  state.upNext.splice(index, 1);
  saveUpNext();
}

export function moveInQueue(from, to) {
  if (to < 0 || to >= state.upNext.length) return;
  const [id] = state.upNext.splice(from, 1);
  state.upNext.splice(to, 0, id);
  saveUpNext();
}

export function clearUpNext() {
  state.upNext = [];
  saveUpNext();
}

/** Что прозвучит дальше: очередь пользователя и следующие треки из списка/альбома. */
export function upcoming(limit = 25) {
  const queued = state.upNext.map(find).filter(Boolean);
  if (settings.shuffle) return { queued, then: [], shuffled: true };
  const list = queueList();
  const idx = state.current ? list.findIndex((t) => t.video_id === state.current.video_id) : -1;
  let then = list.slice(idx + 1, idx + 1 + limit);
  if (settings.repeat === 'all' && then.length < limit) then = then.concat(list.slice(0, Math.min(idx + 1, limit - then.length)));
  return { queued, then, shuffled: false };
}

/** Где сейчас играем: «Библиотека» или имя альбома. */
export function contextName() {
  if (state.queue) {
    const a = findAlbum(state.queue.key);
    if (a) return a.name;
  }
  return 'Библиотека';
}

// ============ Плавный переход ============
const PREPARE_SEC = 10;   // за сколько до начала перехода подгружать следующий трек
let prepared = null;      // { track, el } — следующий трек на свободной деке
let tail = null;          // { el, timer } — затихающий трек

function resetMix(el) {
  const deck = graph.get(el);
  if (!deck) return;
  deck.mix.gain.cancelScheduledValues(ctx.currentTime);
  deck.mix.gain.setValueAtTime(1, ctx.currentTime);
}

function clearDeck(el) {
  el.pause();
  el.removeAttribute('src');
  el.load();
  resetMix(el);
}

function dropPrepared() {
  if (!prepared) return;
  const { el } = prepared;
  prepared = null;
  clearDeck(el);
}

/** Закончить переход сразу: затихающий трек умолкает, текущий звучит в полную силу. */
function stopTail() {
  if (!tail) return;
  clearTimeout(tail.timer);
  clearDeck(tail.el);
  tail = null;
  resetMix(audio);
}

/** Что заиграет после текущего, если переход сейчас уместен. */
function fadeTarget() {
  if (!fadeGain || !settings.autoNext || settings.repeat === 'one' || (state.sleep && state.sleep.endOfTrack)) return null;
  const t = state.upNext.length ? find(state.upNext[0]) : neighbour(1);
  return t && t.file_exists !== false && t.video_id !== state.current?.video_id ? t : null;
}

function prepareNext() {
  const track = fadeTarget();
  if (!track) return;
  const el = decks.find((d) => d !== audio);
  el.src = `/api/stream/${encodeURIComponent(track.video_id)}`;
  el.load();
  prepared = { track, el };
}

/** Кривые равной мощности: на середине перехода общая громкость не проседает. */
function fadeCurve(rising) {
  return Float32Array.from({ length: 32 }, (_, i) => {
    const x = (i / 31) * (Math.PI / 2);
    return rising ? Math.sin(x) : Math.cos(x);
  });
}

function startFade(sec) {
  const p = prepared;
  // Очередь могла измениться, пока трек готовился: тогда обычная смена трека.
  const head = state.upNext[0];
  if (p.starting) return;
  if ((head && head !== p.track.video_id) || !fadeGainReady()) { dropPrepared(); return; }
  p.starting = true;
  const { el, track } = p;
  el.volume = audio.volume;
  el.muted = audio.muted;
  const incoming = graph.get(el).mix.gain;
  incoming.cancelScheduledValues(ctx.currentTime);
  incoming.setValueAtTime(0, ctx.currentTime);
  // Браузер может запретить второй звук без нажатия: тогда трек просто доиграет и сменится как обычно.
  el.play().then(() => {
    if (prepared !== p) return;
    prepared = null;
    if (head) { state.upNext.shift(); saveUpNext(); }
    const old = audio;
    flushListen();
    setCurrent(track, false);
    audio = el;
    listen.lastT = null;
    applyNormalize();
    const now = ctx.currentTime;
    incoming.cancelScheduledValues(now);
    incoming.setValueCurveAtTime(fadeCurve(true), now, sec);
    const outgoing = graph.get(old).mix.gain;
    outgoing.cancelScheduledValues(now);
    outgoing.setValueCurveAtTime(fadeCurve(false), now, sec);
    tail = { el: old, timer: setTimeout(stopTail, sec * 1000 + 100) };
    emit('track', track);
    emit('state');
    emit('time');
  }).catch((err) => {
    console.warn('плавный переход:', err);
    if (prepared === p) dropPrepared();
  });
}

function fadeGainReady() {
  return !!fadeGain && ctx.state === 'running';
}

// Не в кадровом цикле: при выключенном экране кадры не рисуются, а музыка идёт.
setInterval(() => {
  const sec = settings.crossfade;
  if (!sec || tail || audio.paused || !audio.duration || state.dragging) return;
  // В коротком треке переход съел бы слишком много.
  if (audio.duration < sec * 2 + 5) return;
  const left = audio.duration - audio.currentTime;
  if (left > sec + PREPARE_SEC) { if (prepared) dropPrepared(); return; }
  if (!prepared) prepareNext();
  if (prepared && left <= sec) startFade(Math.max(0.5, left));
}, 200);

for (const el of decks) el.addEventListener('error', () => { if (prepared && prepared.el === el) prepared = null; });

// ============ Таймер сна ============
const FADE_SEC = 20;

/** minutes > 0 — остановить через столько минут; 'track' — после текущего трека; 0 — выключить. */
export function setSleep(minutes) {
  restoreFade();
  if (minutes === 'track') state.sleep = { endOfTrack: true };
  else if (minutes > 0) state.sleep = { at: Date.now() + minutes * 60000 };
  else state.sleep = null;
  emit('sleep');
}

/** Сколько секунд осталось до сна (null — таймер выключен или ждёт конца трека). */
export function sleepLeft() {
  return state.sleep && state.sleep.at ? Math.max(0, (state.sleep.at - Date.now()) / 1000) : null;
}

function restoreFade() {
  if (!fadeGain) return;
  fadeGain.gain.cancelScheduledValues(ctx.currentTime);
  fadeGain.gain.setValueAtTime(1, ctx.currentTime);
}

function sleepNow() {
  state.sleep = null;
  pause();
  // Громкость возвращаем чуть позже, чтобы пауза не щёлкнула полной громкостью.
  setTimeout(restoreFade, 300);
  emit('sleep');
  emit('toast', { text: 'Таймер сна: музыка остановлена. Спокойной ночи', type: 'info', ms: 6000 });
}

// Не в кадровом цикле: при выключенном экране кадры не рисуются, а таймер должен сработать.
setInterval(() => {
  const left = sleepLeft();
  if (left === null) return;
  if (left <= 0) { sleepNow(); return; }
  if (fadeGain && left < FADE_SEC && !audio.paused) fadeGain.gain.setTargetAtTime(left / FADE_SEC, ctx.currentTime, 0.3);
  emit('sleep-tick');
}, 500);

// ============ Прослушивания ============
// Трек считается прослушанным, если звучал хотя бы половину длины или 30 секунд (как у Last.fm).
const listen = { id: null, sec: 0, lastT: null };

onAudio('timeupdate', () => {
  const t = audio.currentTime;
  if (!audio.paused && listen.lastT !== null) {
    const d = t - listen.lastT;
    if (d > 0 && d < 2) listen.sec += d;
  }
  listen.lastT = t;
});
onAudio('seeking', () => { listen.lastT = null; });

function flushListen(beacon = false) {
  const { id, sec } = listen;
  listen.sec = 0;
  listen.lastT = null;
  const t = id && find(id);
  if (!t) return;
  const dur = t._sec || audio.duration || 0;
  if (sec < Math.min(30, dur ? dur / 2 : 30)) return;
  t.plays = (t.plays || 0) + 1;
  t.last_played = Math.floor(Date.now() / 1000);
  const url = `/api/track/${encodeURIComponent(id)}/play`;
  const body = JSON.stringify({ seconds: Math.round(sec) });
  if (beacon && navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    return;
  }
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
    .catch(() => { /* сервер недоступен — не страшно */ });
  emit('stats', t);
}
addEventListener('pagehide', () => flushListen(true));

// ============ Избранное ============
/** quiet — без уведомления: вызывающий покажет своё (например, с «Отменить»). */
export async function toggleLike(track, { quiet = false } = {}) {
  if (!track) return;
  const liked = !track.liked;
  track.liked = liked;
  track.liked_at = liked ? Math.floor(Date.now() / 1000) : null;
  emit('like', track);
  try {
    await api('POST', `/api/track/${encodeURIComponent(track.video_id)}/like`, { liked });
    if (!quiet) emit('toast', { text: liked ? 'Добавлено в «Любимое»' : 'Убрано из «Любимого»', type: liked ? 'ok' : 'info', ms: 2200 });
  } catch (err) {
    track.liked = !liked;
    emit('like', track);
    emit('toast', { text: `Не получилось: ${err.message}`, type: 'error' });
  }
}

/** Статистика прослушиваний за days дней (без days — за всё время). */
export function loadStats(days) {
  const tz = -new Date().getTimezoneOffset();
  return api('GET', `/api/stats?tz=${tz}${days ? `&days=${days}` : ''}`);
}

export function seek(sec) {
  if (!audio.duration) return;
  audio.currentTime = Math.min(audio.duration, Math.max(0, sec));
  emit('time');
}

export function seekP(p) { seek(p * (audio.duration || 0)); }

export function setVolume(v, persist = true) {
  const vol = Math.min(1, Math.max(0, v));
  for (const el of decks) el.volume = vol;
  if (persist) { settings.volume = audio.volume; save(); }
  emit('state');
}

export function setMuted(on) {
  for (const el of decks) el.muted = on;
  emit('state');
}

export function toggleMute() { setMuted(!audio.muted); }

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

onAudio('play', () => emit('state'));
onAudio('pause', () => { stopTail(); emit('state'); });
onAudio('loadedmetadata', () => emit('time'));
onAudio('seeked', () => emit('time'));
onAudio('playing', () => {
  const t = state.current;
  if (t && !state.played.has(t.video_id)) {
    state.played.add(t.video_id);
    local.savePlayed(state.played);
    emit('played', t);
  }
});
onAudio('ended', () => {
  flushListen();
  if (state.sleep && state.sleep.endOfTrack) { sleepNow(); return; }
  if (settings.repeat === 'one') { audio.currentTime = 0; play(); return; }
  if (settings.autoNext) next();
});
onAudio('error', onAudioError);

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

/** Поиск трека на YouTube по названию: [{ id, title, artist, duration, url, thumb, in_library }]. */
export async function searchTracks(q) {
  const data = await api('GET', `/api/search?q=${encodeURIComponent(q)}`);
  return data.items || [];
}

export async function removeTrack(track) {
  const res = await fetch(`/api/track/${encodeURIComponent(track.video_id)}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

  const wasCurrent = state.current && state.current.video_id === track.video_id;
  if (wasCurrent) { listen.id = null; listen.sec = 0; stopTail(); }
  dropPrepared();
  const nextTrack = wasCurrent ? neighbour(1) : null;
  state.library = state.library.filter((t) => t.video_id !== track.video_id);
  if (state.upNext.includes(track.video_id)) { state.upNext = state.upNext.filter((id) => id !== track.video_id); saveUpNext(); }
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

// ============ Альбомы ============
export const albums = { user: [], loaded: false, open: null };

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function loadAlbums() {
  try {
    albums.user = await api('GET', '/api/albums');
    albums.loaded = true;
  } catch (err) {
    console.warn('альбомы:', err);
  }
  emit('albums');
}

/** Альбомы из метаданных YouTube: треки с одинаковым полем «альбом», от двух треков. */
export function metaAlbums() {
  const groups = new Map();
  for (const t of state.library) {
    const name = (t.album || '').trim();
    if (!name || name === 'Single' || name === 'Unknown') continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(t);
  }
  return [...groups]
    .filter(([, list]) => list.length >= 2)
    .map(([name, list]) => {
      const artists = new Map();
      list.forEach((t) => artists.set(t.artist, (artists.get(t.artist) || 0) + 1));
      const artist = [...artists].sort((a, b) => b[1] - a[1])[0][0];
      return { key: 'm:' + name, kind: 'meta', name, artist, tracks: list.sort((a, b) => (a.added || 0) - (b.added || 0)).map((t) => t.video_id) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function userAlbums() {
  return albums.user.map((a) => ({ key: 'u:' + a.id, kind: 'user', id: a.id, name: a.name, tracks: a.tracks.filter((id) => find(id)) }));
}

/** Подборки, которые плеер собирает сам по прослушиваниям и избранному. */
export function smartAlbums() {
  const lib = state.library;
  const now = Date.now() / 1000;
  const ids = (list) => list.map((t) => t.video_id);
  const byPlays = (a, b) => (b.plays || 0) - (a.plays || 0) || (b.last_played || 0) - (a.last_played || 0);
  const liked = lib.filter((t) => t.liked).sort((a, b) => (b.liked_at || 0) - (a.liked_at || 0));
  const top = lib.filter((t) => (t.plays || 0) >= 2).sort(byPlays).slice(0, 25);
  const forgotten = lib.filter((t) => (t.plays || 0) >= 3 && t.last_played && now - t.last_played > 30 * 86400).sort(byPlays).slice(0, 25);
  const unheard = lib.filter((t) => !t.plays && !state.played.has(t.video_id)).sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 50);
  const smart = (key, name, artist, list, always) => (always || list.length ? [{ key: 's:' + key, kind: 'smart', name, artist, tracks: ids(list) }] : []);
  return [
    ...smart('liked', 'Любимое', 'отмеченные сердцем', liked, true),
    ...smart('top', 'Чаще всего', 'по числу прослушиваний', top),
    ...smart('forgotten', 'Давно не слушал', 'любимые, но забытые', forgotten),
    ...smart('unheard', 'Ещё не слушал', 'новое в библиотеке', unheard),
  ];
}

export function findAlbum(key) {
  return [...smartAlbums(), ...userAlbums(), ...metaAlbums()].find((a) => a.key === key) || null;
}

export function playAlbum(album, startId) {
  const list = album.tracks.map(find).filter(Boolean);
  if (!list.length) return;
  const first = (startId && find(startId)) || (settings.shuffle ? list[Math.floor(Math.random() * list.length)] : list[0]);
  playFrom(first, { key: album.key, ids: album.tracks });
}

export async function createAlbum(name, tracks = []) {
  const a = await api('POST', '/api/albums', { name, tracks });
  await loadAlbums();
  return a;
}
export async function renameAlbum(id, name) { await api('PATCH', `/api/albums/${id}`, { name }); await loadAlbums(); }
export async function deleteAlbum(id) { await api('DELETE', `/api/albums/${id}`); await loadAlbums(); }
export async function setAlbumTracks(id, tracks) { await api('PATCH', `/api/albums/${id}`, { tracks }); await loadAlbums(); }
export async function addToAlbum(id, videoId) { await api('POST', `/api/albums/${id}/tracks`, { video_id: videoId }); await loadAlbums(); }
export async function removeFromAlbum(id, videoId) {
  await api('DELETE', `/api/albums/${id}/tracks/${encodeURIComponent(videoId)}`);
  await loadAlbums();
}

/** Ссылка на архив альбома: свой альбом — по id, альбом из метаданных — по списку треков. */
export function exportUrl(album) {
  if (album.kind === 'user') return `/api/albums/${album.id}/export`;
  return `/api/export?name=${encodeURIComponent(album.name)}&ids=${album.tracks.join(',')}`;
}

/** Импорт архива альбома; onProgress(0…1) — отправка файла. */
export function importAlbum(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/import');
    xhr.setRequestHeader('Content-Type', 'application/zip');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* не JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('нет связи с сервером'));
    xhr.send(file);
  });
}

// ============ Фоновые задачи (загрузка альбома с YouTube) ============
export const jobs = { list: [], local: [] };
let jobsTimer = null;
let lastDone = -1;

export async function pollJobs() {
  clearTimeout(jobsTimer);
  try {
    jobs.list = await api('GET', '/api/jobs');
  } catch { /* сервер перезапускается */ }
  const done = jobs.list.reduce((s, j) => s + j.done, 0);
  if (done !== lastDone) {
    // Появились новые треки — подтягиваем их в библиотеку и альбомы.
    if (lastDone !== -1) { await loadLibrary(); await loadAlbums(); }
    lastDone = done;
  }
  emit('jobs');
  if (jobs.list.some((j) => j.state === 'running')) jobsTimer = setTimeout(pollJobs, 2000);
}

export async function addPlaylist(url) {
  const data = await api('POST', '/api/add-playlist', { url });
  await loadAlbums();
  pollJobs();
  return data.job;
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
