// Мост к Android-приложению. В обычном браузере ничего не делает.
// Приложение показывает уведомление плеера и экран блокировки (у WebView своего нет),
// а кнопки оттуда и системная «назад» приходят сюда через window.__mkMedia / window.__mkBack.

import * as core from './core.js';
import { state, audio } from './core.js';
import { albumOf } from './format.js';
import { closeFull } from './lyrics.js';
import { setTab, runAction, isDesktop } from './ui.js';

const host = window.MkAndroid;

if (host) {
  const html = document.documentElement;
  html.classList.add('in-android');

  const send = (fn) => { try { fn(); } catch { /* приложение старой версии */ } };

  const sendTrack = () => {
    const t = state.current;
    send(() => {
      if (!t) host.clear();
      else host.setMedia(t.title || '', t.artist || '', albumOf(t) || '',
        new URL(t.thumbnail_api, location.href).href, Math.round((audio.duration || t._sec || 0) * 1000));
    });
  };
  const sendState = () => send(() => host.setPlaying(!audio.paused, Math.round(audio.currentTime * 1000)));

  // Полосы системы (часы, кнопки навигации) — в цвет фона текущей темы.
  let lastBars = '';
  let barsQueued = false;
  const sendBars = () => {
    barsQueued = false;
    const bg = getComputedStyle(document.body).backgroundColor;
    if (bg && bg !== lastBars) { lastBars = bg; send(() => host.setBars(bg)); }
  };
  new MutationObserver(() => {
    if (!barsQueued) { barsQueued = true; requestAnimationFrame(sendBars); }
  }).observe(html, { attributes: true, attributeFilter: ['style', 'data-design', 'class'] });
  requestAnimationFrame(sendBars);

  core.on('track', sendTrack);
  core.on('state', sendState);
  audio.addEventListener('loadedmetadata', sendTrack);
  audio.addEventListener('seeked', sendState);

  window.__mkMedia = (cmd) => {
    if (cmd === 'play') core.play();
    else if (cmd === 'pause') core.pause();
    else if (cmd === 'toggle') core.toggle();
    else if (cmd === 'next') core.next();
    else if (cmd === 'prev') core.prev();
    else if (cmd === 'stop') core.pause();
    else if (cmd.startsWith('seek:')) core.seek(Number(cmd.slice(5)) / 1000);
  };

  // true — шаг назад сделан внутри интерфейса, false — пусть приложение уходит в фон.
  window.__mkBack = () => {
    const dlg = document.querySelector('dialog[open]');
    if (dlg) { dlg.close(); return true; }
    const menu = document.querySelector('.menu:not([hidden])');
    if (menu) { menu.hidden = true; menu.previousElementSibling?.setAttribute('aria-expanded', 'false'); return true; }
    if (!document.getElementById('lyrics-full').hidden) { closeFull(); return true; }
    if (html.dataset.tab === 'player' && !isDesktop()) { setTab('library'); return true; }
    if (html.dataset.libview === 'album') { runAction('album-back'); return true; }
    return false;
  };
}
