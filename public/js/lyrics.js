// Текст песни: musetext во фрейме того же сайта, которому плеер отдаёт трек, позицию и звук
// через window.mkHost (см. public/musetext/js/host-bridge.js).
// Два режима: встроенный — на месте индикатора дизайна, и полноэкранный — поверх всего.

import * as core from './core.js';
import { state, audio } from './core.js';
import { settings } from './store.js';
import { albumOf } from './format.js';

const subs = new Map();   // имя фрейма → обработчики
let frameSeq = 0;
let inline = null;        // { frame, slot, status }
let full = null;          // фрейм полноэкранного режима
const overlay = document.getElementById('lyrics-full');

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
  stream() { return core.audioStream(); },
  cover() {
    const t = state.current;
    return t ? new URL(t.thumbnail_api, location.href).href : null;
  },
  status(msg, mode) { if (mode === 'inline') setInlineStatus(msg); },
  audioReactOff() { return !settings.lyricsReact; },
};

// Во вступлении musetext показывает пустую сцену — подписываем, что это не поломка.
const waitEl = () => inline && inline.wait;
setInterval(() => {
  const w = waitEl();
  if (!w) return;
  let first = null;
  try {
    const app = inline.frame.contentWindow.museApp;
    if (app && app.timeline && app.timeline.length) first = app.timeline[0].start;
  } catch { /* фрейм ещё грузится */ }
  const t = state.current;
  const left = first != null ? first - audio.currentTime : null;
  const searching = first == null && !inline.notFound;
  const show = !!t && (searching || (left != null && left > 1));
  if (show) {
    w.querySelector('b').textContent = t.title;
    if (searching) {
      w.querySelector('span').textContent = 'ищу текст песни…';
    } else {
      const s = Math.ceil(left);
      w.querySelector('span').textContent = `вступление · текст через ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
  }
  w.hidden = !show;
}, 500);

function makeFrame(mode) {
  const f = document.createElement('iframe');
  f.name = `mk-lyrics-${++frameSeq}`;
  f.src = `musetext/index.html?embed=${mode}`;
  f.title = 'Текст песни';
  f.allow = 'fullscreen; autoplay';
  f.className = `lyrics-frame lyrics-frame-${mode}`;
  return f;
}

function dropFrame(f) {
  if (!f) return;
  subs.delete(f.name);
  f.remove();
}

// ============ Встроенный режим ============
let statusTimer = null;
function setInlineStatus(msg) {
  if (!inline) return;
  clearTimeout(statusTimer);
  inline.status.textContent = msg;
  inline.status.hidden = !msg;
  if (/не найден|пуст/i.test(msg)) inline.notFound = true;
  // Итоговые сообщения («LRCLIB · 34 строк…») прячем, «не найден» оставляем на виду.
  if (msg && !/не найден|пуст/i.test(msg)) {
    statusTimer = setTimeout(() => { if (inline) inline.status.hidden = true; }, /строк/.test(msg) ? 2500 : 6000);
  }
}

function visible(el) {
  return !!(el && el.offsetParent !== null && el.getClientRects().length);
}

/** Привести встроенный фрейм в соответствие с настройками и разметкой. */
export function syncInline() {
  const slot = document.querySelector('[data-lyrics-slot]');
  const want = settings.meter === 'lyrics' && state.current && !full && visible(slot);
  if (!want) {
    if (inline) { dropFrame(inline.frame); inline.status.remove(); inline.wait.remove(); inline = null; }
    return;
  }
  if (inline && inline.slot === slot && slot.contains(inline.frame)) return;
  if (inline) { dropFrame(inline.frame); inline.status.remove(); inline.wait.remove(); }
  const frame = makeFrame('inline');
  const status = document.createElement('p');
  status.className = 'lyrics-status';
  status.hidden = true;
  const wait = document.createElement('div');
  wait.className = 'lyrics-wait';
  wait.hidden = true;
  wait.innerHTML = '<b></b><span></span>';
  slot.append(frame, wait, status);
  inline = { frame, slot, status, wait };
}

// ============ Полноэкранный режим ============
export function openFull() {
  if (!state.current) {
    core.emit('toast', { text: 'Сначала включите трек', type: 'info' });
    return;
  }
  if (full) return;
  full = makeFrame('full');
  overlay.append(full);
  overlay.hidden = false;
  document.documentElement.classList.add('lyrics-open');
  syncInline();
  overlay.querySelector('.lyrics-close').focus();
}

export function closeFull() {
  if (!full) return;
  dropFrame(full);
  full = null;
  overlay.hidden = true;
  document.documentElement.classList.remove('lyrics-open');
  syncInline();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && full) closeFull();
});
// Кнопка «Закрыть» работает сама по себе, независимо от общего обработчика действий.
overlay.querySelector('.lyrics-close').addEventListener('click', () => closeFull());

// Плеер рассказывает musetext обо всём, что меняется, и раз в секунду подтверждает позицию.
core.on('track', () => { push(); syncInline(); });
core.on('state', push);
core.on('time', push);
core.on('meter', syncInline);
// Встроенный текст живёт только в видимом плеере: на телефоне — после перехода на вкладку плеера.
core.on('tab', () => requestAnimationFrame(syncInline));
setInterval(() => { if (subs.size && !audio.paused) push(); }, 1000);
window.addEventListener('resize', () => requestAnimationFrame(syncInline));
