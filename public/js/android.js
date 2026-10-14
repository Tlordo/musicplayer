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

  // Страница лежит под прозрачными часами и полосой жестов: отступы для кнопок — из приложения.
  window.__mkInsets = (top, bottom) => {
    html.style.setProperty('--safe-t', `${top}px`);
    html.style.setProperty('--safe-b', `${bottom}px`);
  };
  send(() => { const [t, b] = String(host.insets()).split(',').map(Number); window.__mkInsets(t || 0, b || 0); });

  // Значки часов и навигации — светлые на тёмном фоне под ними, тёмные на светлом.
  const colorAt = (y) => {
    for (let el = document.elementFromPoint(innerWidth / 2, y); el; el = el.parentElement) {
      const c = getComputedStyle(el).backgroundColor;
      const alpha = c.startsWith('rgba') ? Number(c.split(',')[3]?.replace(')', '')) : 1;
      if (c && c !== 'transparent' && alpha >= 0.5) return c;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  let lastBars = '';
  let barsQueued = false;
  const sendBars = () => {
    barsQueued = false;
    const top = colorAt(2);
    const bottom = colorAt(innerHeight - 2);
    if (`${top}|${bottom}` === lastBars) return;
    lastBars = `${top}|${bottom}`;
    send(() => host.setBars(top, bottom));
  };
  const queueBars = () => {
    if (!barsQueued) { barsQueued = true; requestAnimationFrame(sendBars); }
  };
  new MutationObserver(queueBars).observe(html, { attributes: true, attributeFilter: ['style', 'data-design', 'data-tab', 'data-libview', 'class'] });
  core.on('tab', queueBars);
  core.on('track', () => setTimeout(queueBars, 300));
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
