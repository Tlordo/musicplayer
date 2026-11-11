// Жесты как в приложении на телефоне — одинаково для обоих дизайнов, пальцем и мышью:
//  • свайп по обложке ([data-swipe-stage]) влево/вправо — следующий/предыдущий трек,
//    соседняя обложка едет за пальцем, короткий свайп пружинит обратно;
//  • мини-плеер ([data-mini]) — свайп вверх открывает плеер, свайп вниз по плееру закрывает;
//    переход между вкладками «плеер ↔ библиотека» на телефоне — выезжающий лист с пружиной;
//  • свайп строки в библиотеке: влево — «В очередь», вправо — «В любимое», с «Отменить»;
//  • вибро-отклик там, где он есть (Android): лайк, срабатывание свайпа.
// Вкладки — те же, что у кнопок (setTab из ui.js); перемотка [data-seek] и прокрутка не трогаются.

import * as core from './core.js';
import { state } from './core.js';
import { settings } from './store.js';
import { isDesktop, setTab } from './ui.js';

const html = document.documentElement;
const $ = (sel, root = document) => root.querySelector(sel);

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const still = () => reduced.matches;

/** Короткий щелчок вибромотора (где поддерживается). */
export function haptic(ms = 10) {
  // До первого касания страницы Chrome всё равно не даст вибрировать (и ругается в консоль).
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try { navigator.vibrate?.(ms); } catch { /* нет вибро */ }
}

// ============ Анимация ============
// Пружина: недодемпфированный осциллятор, ~3% перелёта — «живое» прилипание на место.
const SPRING = (() => {
  const z = 0.72, w = 8.4, wd = w * Math.sqrt(1 - z * z);
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const x = 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
    pts.push(+x.toFixed(4));
  }
  pts[pts.length - 1] = 1;
  const css = `linear(${pts.join(', ')})`;
  return CSS.supports('animation-timing-function', css) ? css : 'cubic-bezier(0.2, 1.2, 0.4, 1)';
})();
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_AWAY = 'cubic-bezier(0.4, 0, 0.8, 0.6)';

const tx = (x) => `translate3d(${x}px, 0, 0)`;
const ty = (y) => `translate3d(0, ${y}px, 0)`;

/** Довести transform элемента до `to`. Итог сразу пишется в style, поэтому в конце нет скачка. */
function go(el, to, ms, easing) {
  const from = el.style.transform || 'none';
  el.getAnimations().forEach((a) => a.cancel());
  el.style.transform = to;
  if (still() || !ms || from === to) return Promise.resolve();
  return el.animate([{ transform: from }, { transform: to }], { duration: ms, easing }).finished.catch(() => {});
}
/** Сколько ехать оставшийся путь со скоростью пальца (px/мс), в разумных пределах. */
const flingMs = (dist, v, min = 170, max = 340) => Math.round(Math.min(max, Math.max(min, Math.abs(dist) / Math.max(Math.abs(v), 1.4))));

// ============ Распознавание ============
// Палец — touch-события (только они позволяют отменить прокрутку уже после начала касания),
// мышь — pointer-события. Направление решается после сдвига на SLOP пикселей.
const SLOP = 10;
const BLOCK = '[data-seek], input, textarea, select, .menu, [contenteditable], dialog, .swipe-ghost';
let g = null;
let swallowClick = false;

function candidates(target) {
  if (!(target instanceof Element) || target.closest(BLOCK)) return null;
  const c = {};
  const row = target.closest('[data-list] [data-id], [data-album-list] [data-id]');
  if (row) c.x = () => rowSwipe(row);
  const stage = target.closest('[data-swipe-stage]');
  if (stage && state.current) c.x = () => coverSwipe(stage);
  if (!isDesktop() && !html.classList.contains('lyrics-open')) {
    const mini = target.closest('[data-mini]');
    if (mini && state.current && html.dataset.tab !== 'player') c.up = () => sheetOpen();
    const player = target.closest('.player');
    if (player && html.dataset.tab === 'player') c.down = () => (player.scrollTop <= 0 ? sheetClose(player) : null);
  }
  return Object.keys(c).length ? c : null;
}

function begin(x, y, target, touch) {
  if (g?.h) return;
  const c = candidates(target);
  g = c ? { c, x0: x, y0: y, x, y, t: performance.now(), vx: 0, vy: 0, h: null, touch } : null;
}

function move(x, y, e) {
  if (!g) return;
  const now = performance.now();
  const dt = Math.max(1, now - g.t);
  // скорость — со сглаживанием, чтобы один дёрганый кадр не решал судьбу броска
  g.vx = g.vx * 0.3 + ((x - g.x) / dt) * 0.7;
  g.vy = g.vy * 0.3 + ((y - g.y) / dt) * 0.7;
  g.x = x; g.y = y; g.t = now;
  const dx = x - g.x0, dy = y - g.y0;
  if (!g.h) {
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < SLOP) return;
    let h = null;
    if (ax > ay * 1.2) h = g.c.x?.();
    else if (ay > ax) h = dy < 0 ? g.c.up?.() : g.c.down?.();
    if (!h) { g = null; return; }   // не наш жест — пусть страница прокручивается как обычно
    g.h = h;
    html.classList.add('gesturing');
  }
  if (e.cancelable) e.preventDefault();
  g.h.move(dx, dy);
}

function end(cancel) {
  if (!g) return;
  const cur = g;
  g = null;
  if (!cur.h) return;
  html.classList.remove('gesturing');
  // Отпускание после перетаскивания — не нажатие: строка не включится, обложка не откроется.
  swallowClick = true;
  setTimeout(() => { swallowClick = false; }, 60);
  if (cancel) cur.h.end(0, 0, 0, 0);
  else cur.h.end(cur.x - cur.x0, cur.y - cur.y0, cur.vx, cur.vy);
}

document.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) { end(true); return; }
  const p = e.touches[0];
  begin(p.clientX, p.clientY, e.target, true);
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!g || !g.touch) return;
  const p = e.touches[0];
  if (p) move(p.clientX, p.clientY, e);
}, { passive: false });
document.addEventListener('touchend', () => { if (g?.touch) end(false); });
document.addEventListener('touchcancel', () => { if (g?.touch) end(true); });

document.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || e.button !== 0) return;
  begin(e.clientX, e.clientY, e.target, false);
});
document.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' && g && !g.touch) move(e.clientX, e.clientY, e);
});
document.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse' && g && !g.touch) end(false); });
document.addEventListener('pointercancel', (e) => { if (e.pointerType === 'mouse' && g && !g.touch) end(true); });
// Картинки и кнопки не должны «перетаскиваться» браузером вместо свайпа.
document.addEventListener('dragstart', (e) => {
  if (e.target instanceof Element && e.target.closest('[data-swipe-stage], [data-mini], [data-list], [data-album-list]')) e.preventDefault();
});
window.addEventListener('click', (e) => {
  if (!swallowClick) return;
  swallowClick = false;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);

// ============ Свайп по обложке: следующий / предыдущий ============
const STRIP = ['id', 'data-bind', 'data-cover', 'data-cover-bg', 'data-seek', 'data-seek-view', 'data-act', 'data-cassette',
  'data-hub', 'data-pack', 'data-tape', 'data-wheels', 'data-needs-track', 'data-swipe-stage', 'tabindex', 'role', 'aria-label'];

/** Копия сцены с обложкой соседнего трека — едет рядом с настоящей. */
function makeGhost(stage, t) {
  const el = stage.cloneNode(true);
  const titles = [...el.querySelectorAll('[data-bind="title"]')];
  const artists = [...el.querySelectorAll('[data-bind="artist"]')];
  const imgs = [...el.querySelectorAll('img[data-cover]')];
  for (const n of [el, ...el.querySelectorAll('*')]) STRIP.forEach((a) => n.removeAttribute(a));
  el.classList.remove('insert');
  el.classList.add('swipe-ghost');
  el.inert = true;
  el.setAttribute('aria-hidden', 'true');
  titles.forEach((n) => { n.textContent = t ? t.title : ''; });
  artists.forEach((n) => { n.textContent = t ? (t.artist || '—') : ''; });
  imgs.forEach((img) => {
    img.onload = null;
    if (!t) { img.remove(); return; }
    img.classList.remove('loaded');
    img.onload = () => img.classList.add('loaded');
    img.src = t.thumbnail_api;
    if (img.complete && img.naturalWidth) img.classList.add('loaded');
  });
  Object.assign(el.style, {
    position: 'absolute', margin: '0', left: `${stage.offsetLeft}px`, top: `${stage.offsetTop}px`,
    width: `${stage.offsetWidth}px`, height: `${stage.offsetHeight}px`, pointerEvents: 'none',
  });
  stage.after(el);
  return el;
}

function coverSwipe(stage) {
  const w = stage.offsetWidth;
  const span = w + Math.max(24, w * 0.1);
  const nextT = core.peek(1), prevT = core.peek(-1);
  const can = { [-1]: !!nextT || settings.shuffle, [1]: !!prevT || settings.shuffle };
  const ghosts = { [-1]: makeGhost(stage, nextT), [1]: makeGhost(stage, prevT) };
  const TH = Math.min(140, w * 0.3);
  let x = 0, armed = 0;
  const place = (v) => {
    x = v;
    stage.style.transform = tx(v);
    ghosts[-1].style.transform = tx(v + span);
    ghosts[1].style.transform = tx(v - span);
  };
  stage.getAnimations().forEach((a) => a.cancel());
  place(0);
  const cleanup = () => {
    Object.values(ghosts).forEach((n) => n.remove());
    stage.style.transform = '';
  };
  return {
    move(dx) {
      const dir = Math.sign(dx);
      // некуда листать — резинка
      place(can[dir] ? dx : dx * 0.22);
      const a = can[dir] && Math.abs(dx) >= TH ? dir : 0;
      if (a !== armed) { armed = a; if (a) haptic(8); }
    },
    async end(dx, _dy, vx) {
      const dir = Math.sign(dx);
      const fling = Math.abs(vx) > 0.45 && Math.sign(vx) === dir && Math.abs(dx) > 30;
      if (!dir || !can[dir] || (!armed && !fling)) {
        await Promise.all([go(stage, tx(0), 460, SPRING), go(ghosts[-1], tx(span), 460, SPRING), go(ghosts[1], tx(-span), 460, SPRING)]);
        cleanup();
        return;
      }
      if (!armed) haptic(8);
      const to = -dir * span;
      const ms = flingMs(to - x, vx);
      const incoming = ghosts[-dir];
      await Promise.all([go(stage, tx(to), ms, EASE_OUT), go(incoming, tx(0), ms, EASE_OUT), go(ghosts[dir], tx(to - dir * span), ms, EASE_OUT)]);
      ghosts[dir].remove();
      // Трек меняется, настоящая сцена встаёт на место под копией; копия уходит, когда загрузится обложка.
      html.classList.add('swipe-commit');
      if (dir < 0) core.next(); else core.prev(true);
      stage.style.transform = '';
      const img = stage.querySelector('img[data-cover]');
      const drop = () => {
        incoming.animate([{ opacity: 1 }, { opacity: 0 }], { duration: still() ? 0 : 140 }).finished.catch(() => {}).then(() => incoming.remove());
        html.classList.remove('swipe-commit');
      };
      if (!img || img.classList.contains('loaded') || !img.getAttribute('src')) drop();
      else {
        const timer = setTimeout(drop, 700);
        img.addEventListener('load', () => { clearTimeout(timer); requestAnimationFrame(drop); }, { once: true });
      }
    },
  };
}

// ============ Мини-плеер и лист плеера ============
const playerEl = () => $('.player');
let quietTab = false;
let sheetGen = 0;

function sheetLive(on) { html.classList.toggle('sheet-live', on); }
function sheetDone(p, gen) {
  if (gen !== sheetGen) return;
  p.style.transform = '';
  sheetLive(false);
}
function tabQuiet(tab) { quietTab = true; try { setTab(tab); } finally { quietTab = false; } }

function sheetClose(player) {
  const gen = ++sheetGen;
  sheetLive(true);
  const h = player.offsetHeight;
  return {
    move(_dx, dy) { player.style.transform = ty(dy > 0 ? dy : dy * 0.1); },
    async end(_dx, dy, _vx, vy) {
      if (dy > h * 0.22 || (vy > 0.5 && dy > 24)) {
        await go(player, ty(h), flingMs(h - dy, vy, 160, 300), EASE_AWAY);
        tabQuiet('library');
      } else {
        await go(player, ty(0), 480, SPRING);
      }
      sheetDone(player, gen);
    },
  };
}

function sheetOpen() {
  const p = playerEl();
  if (!p) return null;
  const gen = ++sheetGen;
  sheetLive(true);
  const h = p.offsetHeight;
  p.style.transform = ty(h);
  return {
    move(_dx, dy) { p.style.transform = ty(Math.max(0, h + Math.min(0, dy))); },
    async end(_dx, dy, _vx, vy) {
      if (-dy > h * 0.18 || (vy < -0.5 && dy < -24)) {
        await go(p, ty(0), 520, SPRING);
        tabQuiet('player');
      } else {
        await go(p, ty(h), 240, EASE_OUT);
      }
      sheetDone(p, gen);
    },
  };
}

// Кнопки, тап по мини-плееру, клавиша B: тот же лист, но без пальца.
core.on('tab', (tab) => {
  if (quietTab || isDesktop() || still()) return;
  const p = playerEl();
  if (!p) return;
  const gen = ++sheetGen;
  sheetLive(true);
  const h = p.offsetHeight;
  if (tab === 'player') {
    p.style.transform = ty(h);
    go(p, ty(0), 520, SPRING).then(() => sheetDone(p, gen));
  } else {
    p.style.transform = ty(0);
    go(p, ty(h), 280, EASE_AWAY).then(() => sheetDone(p, gen));
  }
});

// ============ Свайп строки: «В очередь» / «В любимое» ============
/** Прозрачность вычисленного цвета: rgb(), rgba(), color(… / a), oklab(… / a). */
function alpha(c) {
  if (!c || c === 'transparent') return 0;
  const slash = c.match(/\/\s*([\d.]+)(%?)\s*\)/);
  if (slash) return slash[2] ? slash[1] / 100 : +slash[1];
  const m = c.match(/^rgba\(([^)]+)\)/);
  return m ? +m[1].split(',')[3] : 1;
}

/** Строка при свайпе должна закрывать подложку: её фон поверх непрозрачного фона списка. */
function solidBg(row) {
  const own = getComputedStyle(row).backgroundColor;
  let base = '';
  for (let n = row.parentElement; n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor;
    if (alpha(c) >= 1) { base = c; break; }
  }
  base ||= getComputedStyle(document.body).backgroundColor;
  return alpha(own) > 0 ? `linear-gradient(${own}, ${own}), ${base}` : base;
}

function rowSwipe(row) {
  const t = core.find(row.dataset.id);
  const li = row.parentElement;
  if (!t || !li) return null;
  const w = row.offsetWidth;
  const TH = Math.min(110, w * 0.3);
  const under = document.createElement('div');
  under.className = 'swipe-under';
  under.setAttribute('aria-hidden', 'true');
  under.innerHTML = `<span class="su su-like"><svg><use href="#${t.liked ? 'i-heart-line' : 'i-heart'}"/></svg><span></span></span>`
    + '<span class="su su-queue"><span>В очередь</span><svg><use href="#i-queue"/></svg></span>';
  under.querySelector('.su-like span').textContent = t.liked ? 'Убрать из любимого' : 'В любимое';
  li.classList.add('swiping');
  if (getComputedStyle(li).position === 'static') li.style.position = 'relative';
  li.prepend(under);
  row.style.background = solidBg(row);
  row.getAnimations().forEach((a) => a.cancel());
  let armed = 0;
  const cleanup = () => {
    under.remove();
    li.classList.remove('swiping');
    li.style.position = '';
    row.style.background = '';
    row.style.transform = '';
  };
  return {
    move(dx) {
      const lim = TH * 1.5;
      const a = Math.abs(dx);
      const x = Math.sign(dx) * (a > lim ? lim + (a - lim) * 0.25 : a);
      row.style.transform = tx(x);
      under.dataset.dir = dx > 0 ? 'like' : 'queue';
      const on = a >= TH ? Math.sign(dx) : 0;
      if (on !== armed) {
        armed = on;
        under.classList.toggle('armed', !!on);
        if (on) haptic(10);
      }
    },
    async end(dx, _dy, vx) {
      const dir = Math.sign(dx);
      const fling = Math.abs(vx) > 0.6 && Math.sign(vx) === dir && Math.abs(dx) > 40;
      const commit = dir && (armed === dir || fling);
      if (commit && !armed) haptic(10);
      if (commit) (dir > 0 ? swipeLike : swipeQueue)(t);
      await go(row, tx(0), commit ? 300 : 420, commit ? EASE_OUT : SPRING);
      cleanup();
    },
  };
}

function swipeLike(t) {
  const was = !!t.liked;
  core.toggleLike(t, { quiet: true });
  undoToast(was ? `«${t.title}» убран из любимого` : `«${t.title}» — в любимом`, () => core.toggleLike(t, { quiet: true }));
}

function swipeQueue(t) {
  if (state.upNext.includes(t.video_id)) { undoToast(`«${t.title}» уже в очереди`); return; }
  core.enqueue(t);
  undoToast(`«${t.title}» — в очереди`, () => {
    const i = state.upNext.lastIndexOf(t.video_id);
    if (i >= 0) core.dequeue(i);
  });
}

/** Уведомление с кнопкой «Отменить». */
function undoToast(text, undo) {
  const box = $('#toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast ${undo ? 'ok has-undo' : 'info'}`;
  const span = document.createElement('span');
  span.textContent = text;
  el.append(span);
  let timer;
  const close = () => { clearTimeout(timer); el.classList.add('out'); setTimeout(() => el.remove(), 320); };
  if (undo) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-undo';
    b.textContent = 'Отменить';
    b.addEventListener('click', () => { undo(); haptic(6); close(); }, { once: true });
    el.append(b);
  }
  box.append(el);
  timer = setTimeout(close, undo ? 4500 : 2200);
}

// ============ Вибро на лайк ============
document.addEventListener('click', (e) => {
  if (e.target instanceof Element && e.target.closest('[data-act="like"]:not(:disabled), [data-ts="like"]')) haptic(10);
}, true);
