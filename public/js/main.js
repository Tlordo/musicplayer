// Запуск: движок, дизайн, тема, текст песни, настройки.

import * as core from './core.js';
import { settings, save, local } from './store.js';
import { registerDesigns, applyTheme, currentDesign } from './themes.js';
import { mountDesign, registerActions, renderState, handleSharedLink } from './ui.js';
import { closeFull, toggleLyrics } from './lyrics.js';
import { initSettings, openSettings } from './settings.js';
import { renderAlbums, renderJobs } from './albums.js';
import './extras.js';
import './android.js';
import './preview.js';
import classic from './designs/classic.js';
import cassette from './designs/cassette.js';

const DESIGNS = { classic, cassette };
registerDesigns(DESIGNS);

/** Переключить дизайн: стиль подменяется, разметка перерисовывается, звук не прерывается. */
function switchDesign(id, force) {
  if (!DESIGNS[id]) id = 'classic';
  if (id === settings.design && !force) return;
  closeFull();
  settings.design = id;
  save();
  const link = document.getElementById('design-css');
  const href = DESIGNS[id].css;
  const done = () => {
    document.documentElement.dataset.design = id;
    applyTheme();
    mountDesign();
    renderAlbums();
    renderJobs();
  };
  if (link.getAttribute('href') === href) { done(); return; }
  // Новая таблица стилей грузится рядом со старой, чтобы не было кадра без оформления.
  const next = link.cloneNode();
  next.removeAttribute('id');
  next.href = href;
  next.onload = () => { link.remove(); next.id = 'design-css'; done(); };
  next.onerror = () => { next.remove(); done(); };
  link.after(next);
}

// Обучение грузится только по требованию — в обычной работе оно не занимает память.
const tour = () => import('./tour.js');
function tourSeen() {
  try { return localStorage.getItem('mk.tour.v1') === '1'; } catch { return true; }
}

registerActions({
  settings: () => openSettings(),
  lyrics: () => toggleLyrics(),
  tour: () => tour().then((m) => m.startTour()),
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'F1' && !document.documentElement.classList.contains('touring')) {
    e.preventDefault();
    tour().then((m) => m.startTour());
  }
});

initSettings(DESIGNS, switchDesign);

async function boot() {
  document.documentElement.dataset.design = currentDesign().id;
  document.documentElement.dataset.tab = 'library';
  applyTheme();
  core.start();
  mountDesign();
  await core.loadLibrary();
  if (settings.resumeLast) {
    const t = core.find(local.last());
    if (t) core.cue(t);
  }
  renderState();
  core.loadAlbums();
  core.pollJobs();
  // Пришли через «Поделиться» — человеку сейчас не до обучения.
  const shared = location.search.length > 1;
  handleSharedLink();
  if (!tourSeen() && !shared) tour().then((m) => m.maybeStartTour());
}

boot();

// Оболочка интерфейса — офлайн (только там, где браузер разрешает сервис-воркеры).
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
