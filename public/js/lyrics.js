// Текст песни: musetext во фрейме того же сайта, которому плеер отдаёт трек, позицию и звук
// через window.mkHost (см. public/musetext/js/host-bridge.js).
// Сцена делится на два фрейма: слова на прозрачном фоне лежат поверх плеера, а фон и вспышки —
// позади него, так что обложка и кнопки остаются на виду. Оба фрейма не перехватывают нажатия.

import * as core from './core.js';
import { state, audio } from './core.js';
import { settings } from './store.js';
import { albumOf } from './format.js';

const subs = new Map();   // имя фрейма → обработчики
const streams = new Set(); // копии звукового потока, выданные фреймам — гасим при закрытии
let frameSeq = 0;
let view = null;          // открытый текст: { frame, fx, status, wait, notFound }
const overlay = document.getElementById('lyrics-full');
const html = document.documentElement;

function session() {
  const t = state.current;
  if (!t) return null;
  return {
    app: 'mk-player',
    title: t.title || '',
    artist: t.artist || '',
    album: albumOf(t),
    duration: audio.duration || t._sec || 0,
    position: audio.currentTime || 0,
    playing: !audio.paused,
    reportedAt: Date.now(),
    isCurrent: true,
  };
}

function push() {
  const s = session();
  for (const [name, fns] of subs) {
    for (const fn of fns) {
      try { fn(s); } catch { fns.delete(fn); }
    }
    if (!fns.size) subs.delete(name);
  }
}

window.mkHost = {
  subscribe(fn, name = '') {
    if (!subs.has(name)) subs.set(name, new Set());
    subs.get(name).add(fn);
    setTimeout(() => { try { fn(session()); } catch { /* фрейм уже закрыт */ } }, 0);
  },
  request() { setTimeout(push, 0); },
  command(cmd) {
    if (cmd === 'playpause' || cmd === 'toggle') core.toggle();
    else if (cmd === 'next') core.next();
    else if (cmd === 'previous' || cmd === 'prev') core.prev();
    else if (cmd === 'close') closeFull();
  },
  // Каждому фрейму — своя копия потока: закрываясь, он гасит её, а не общий поток плеера.
  stream() {
    const s = core.audioStream();
    if (!s) return null;
    const copy = s.clone();
    streams.add(copy);
    return copy;
  },
  cover() {
    const t = state.current;
    return t ? new URL(t.thumbnail_api, location.href).href : null;
  },
  status(msg) { setStatus(msg); },
  audioReactOff() { return !settings.lyricsReact; },
};

// Во вступлении musetext показывает пустую сцену — подписываем, что это не поломка.
setInterval(() => {
  if (!view) return;
  const w = view.wait;
  let first = null;
  try {
    const app = view.frame.contentWindow.museApp;
    if (app && app.timeline && app.timeline.length) first = app.timeline[0].start;
  } catch { /* фрейм ещё грузится */ }
  const t = state.current;
  const left = first != null ? first - audio.currentTime : null;
  const searching = first == null && !view.notFound;
  const show = !!t && (searching || (left != null && left > 1));
  if (show) {
    if (searching) {
      w.querySelector('span').textContent = 'ищу текст песни…';
    } else {
      const s = Math.ceil(left);
      w.querySelector('span').textContent = `вступление · текст через ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
  }
  w.hidden = !show;
}, 500);

function makeFrame(layer) {
  const f = document.createElement('iframe');
  f.name = `mk-lyrics-${++frameSeq}`;
  f.src = `musetext/index.html?embed=${layer}`;
  f.title = layer === 'text' ? 'Текст песни' : '';
  f.tabIndex = -1;
  f.allow = 'autoplay';
  f.className = `lyrics-frame lyrics-${layer}`;
  if (layer === 'fx') f.setAttribute('aria-hidden', 'true');
  return f;
}

let statusTimer = null;
function setStatus(msg) {
  if (!view) return;
  clearTimeout(statusTimer);
  view.status.textContent = msg;
  view.status.hidden = !msg;
  if (/не найден|пуст/i.test(msg)) view.notFound = true;
  // Итоговые сообщения («LRCLIB · 34 строк…») прячем, «не найден» оставляем на виду.
  if (msg && !/не найден|пуст/i.test(msg)) {
    statusTimer = setTimeout(() => { if (view) view.status.hidden = true; }, /строк/.test(msg) ? 2500 : 6000);
  }
}

// ============ Слой поверх плеера ============
/** Нижний край слоя — верх кнопок управления, их дизайн отмечает data-lyrics-floor. */
function place() {
  const player = document.querySelector('.player');
  if (!view || !player) return;
  player.scrollTop = 0;
  const floor = player.querySelector('[data-lyrics-floor]');
  const h = floor ? player.getBoundingClientRect().bottom - floor.getBoundingClientRect().top : 0;
  overlay.style.setProperty('--lyrics-floor', `${Math.max(0, Math.round(h))}px`);
}

export function openFull() {
  if (!state.current) {
    core.emit('toast', { text: 'Сначала включите трек', type: 'info' });
    return;
  }
  const player = document.querySelector('.player');
  if (view || !player) return;
  const frame = makeFrame('text');
  const fx = makeFrame('fx');
  const status = document.createElement('p');
  status.className = 'lyrics-status';
  status.hidden = true;
  const wait = document.createElement('div');
  wait.className = 'lyrics-wait';
  wait.hidden = true;
  wait.innerHTML = '<span></span>';
  overlay.prepend(frame, wait, status);
  view = { frame, fx, status, wait, notFound: false };
  player.append(fx, overlay);
  html.classList.add('lyrics-open');
  overlay.hidden = false;
  place();
  renderButtons();
}

export function closeFull() {
  if (!view) return;
  subs.delete(view.frame.name);
  subs.delete(view.fx.name);
  clearTimeout(statusTimer);
  // Фрейм разбираем полностью: гасим его звук (AudioContext musetext), выгружаем документ
  // и только потом убираем из DOM — иначе движок и его анализатор живут до сборки мусора.
  for (const f of [view.frame, view.fx]) {
    try { f.contentWindow?.museApp?.audio?.stop?.(); } catch { /* фрейм ещё не загрузился */ }
    try { f.src = 'about:blank'; } catch { /* уже выгружен */ }
    f.remove();
  }
  streams.forEach((s) => s.getTracks().forEach((tr) => tr.stop()));
  streams.clear();
  core.releaseAudioStream();
  view.status.remove();
  view.wait.remove();
  view = null;
  overlay.hidden = true;
  html.classList.remove('lyrics-open');
  // Разметка плеера пересоздаётся при смене дизайна, а слой должен пережить её.
  document.body.append(overlay);
  renderButtons();
}

function renderButtons() {
  document.querySelectorAll('[data-act="lyrics"]').forEach((b) => b.setAttribute('aria-pressed', String(!!view)));
}

export function toggleLyrics() {
  if (view) closeFull(); else openFull();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && view && !document.querySelector('dialog[open]')) closeFull();
});

// Плеер рассказывает musetext обо всём, что меняется, и раз в секунду подтверждает позицию.
core.on('track', (t) => { push(); if (!t) closeFull(); else requestAnimationFrame(place); });
core.on('state', push);
core.on('time', push);
core.on('tab', () => requestAnimationFrame(place));
setInterval(() => { if (subs.size && !audio.paused) push(); }, 1000);
window.addEventListener('resize', () => requestAnimationFrame(place));
