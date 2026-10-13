// Запуск: движок, дизайн, тема, текст песни, настройки.

import * as core from './core.js';
import { settings, save, local } from './store.js';
import { registerDesigns, applyTheme, currentDesign } from './themes.js';
import { mountDesign, registerActions, renderState } from './ui.js';
import { openFull, closeFull, syncInline } from './lyrics.js';
import { initSettings, openSettings } from './settings.js';
import { renderAlbums, renderJobs } from './albums.js';
import classic from './designs/classic.js';
import cassette from './designs/cassette.js';

const DESIGNS = { classic, cassette };
registerDesigns(DESIGNS);

/** Переключить дизайн: стиль подменяется, разметка перерисовывается, звук не прерывается. */
function switchDesign(id, force) {
  if (!DESIGNS[id]) id = 'classic';
  if (id === settings.design && !force) return;
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
    syncInline();
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

registerActions({
  settings: () => openSettings(),
  lyrics: () => openFull(),
  'lyrics-close': () => closeFull(),
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
  syncInline();
  core.loadAlbums();
  core.pollJobs();
}

boot();
