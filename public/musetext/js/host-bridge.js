/* musetext :: host-bridge.js — запуск внутри плеера МК-60.
   Плеер открывает musetext двумя фреймами того же сайта: ?embed=text — только слова на
   прозрачном фоне поверх плеера, ?embed=fx — фон и вспышки без слов позади плеера. Оба фрейма
   получают всё, что обычно приходит от оболочки ОС: что играет, где мы в треке,
   звук для реакции эффектов и обложку. Ядро musetext при этом не меняется — это тот же
   интерфейс window.museBridge, что у десктопной и Android-оболочек.
   Загружается первым; вне плеера ничего не делает. */
(function () {
  'use strict';

  var host = null;
  try { host = window.parent !== window ? window.parent.mkHost : null; } catch (e) { host = null; }
  if (!host || window.museBridge) return;

  var layer = /[?&]embed=fx/.test(location.search) ? 'fx' : 'text';
  document.documentElement.classList.add('mk-embed', 'mk-embed-' + layer);

  // Слои живут внутри плеера: без своей панели, подсказок и карточек.
  var css = document.createElement('style');
  css.textContent =
    '.mk-embed #chip, .mk-embed #tools, .mk-embed #hint,' +
    '.mk-embed #status, .mk-embed #setup, .mk-embed #panel { display: none !important; }' +
    '.mk-embed-text { color-scheme: dark; }' +
    '.mk-embed-text, .mk-embed-text body, .mk-embed-text #stage { background: transparent !important; }' +
    '.mk-embed-text #bg, .mk-embed-text #grain, .mk-embed-text #scan,' +
    '.mk-embed-text #vignette, .mk-embed-text #flash { display: none !important; }' +
    '.mk-embed-text .txt { text-shadow: 0 2px 16px rgba(0, 0, 0, .8), 0 0 3px rgba(0, 0, 0, .6); }' +
    '.mk-embed-fx #lines { visibility: hidden !important; }';
  document.head.appendChild(css);

  window.museBridge = {
    platform: 'host',

    onNowPlaying: function (cb) {
      host.subscribe(function (s) {
        cb({ sessions: s ? [s] : [] });
      }, window.name);
    },

    requestNowPlaying: function () { host.request(); },

    setSource: function () { },

    mediaCommand: function (cmd) {
      host.command(cmd);
      return Promise.resolve(true);
    },

    // Звук берём прямо из плеера — никаких запросов «поделиться экраном».
    getLoopbackStream: function () {
      var s = host.stream();
      return s ? Promise.resolve(s) : Promise.reject(new Error('no stream'));
    },

    keepAwake: function () { }
  };

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !document.querySelector('#panel.open')) host.command('close');
  });

  // После того как musetext создал приложение: обложку берём у плеера, а не ищем в iTunes,
  // а короткие статусы показывает сам плеер.
  window.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      var app = window.museApp;
      if (!app) return;

      var resolve = app.resolveArtwork.bind(app);
      app.resolveArtwork = function (track) {
        var url = host.cover();
        if (url) { app.bg.setCover(url); return Promise.resolve(); }
        return resolve(track);
      };
      var url = host.cover();
      if (url) app.bg.setCover(url);

      var toast = app.ui.toast.bind(app.ui);
      app.ui.toast = function (msg, sticky) {
        if (layer === 'text') host.status(msg || '');
        return toast(msg, sticky);
      };

      // Звук плеера доступен без разрешений, поэтому реакцию на него включаем сразу,
      // если пользователь сам не выключал её в настройках musetext.
      if (!app.cfg.audioReactive && !host.audioReactOff()) app.toggleAudio(true);
    }, 0);
  });
})();
