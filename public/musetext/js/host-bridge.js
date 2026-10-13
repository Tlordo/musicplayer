/* musetext :: host-bridge.js — запуск внутри плеера МК-60.
   Плеер открывает musetext во фрейме того же сайта (?embed=full или ?embed=inline)
   и отдаёт ему всё, что обычно приходит от оболочки ОС: что играет, где мы в треке,
   звук для реакции эффектов и обложку. Ядро musetext при этом не меняется — это тот же
   интерфейс window.museBridge, что у десктопной и Android-оболочек.
   Загружается первым; вне плеера ничего не делает. */
(function () {
  'use strict';

  var host = null;
  try { host = window.parent !== window ? window.parent.mkHost : null; } catch (e) { host = null; }
  if (!host || window.museBridge) return;

  var embed = /[?&]embed=inline/.test(location.search) ? 'inline' : 'full';
  document.documentElement.classList.add('mk-embed', 'mk-embed-' + embed);

  // Встроенный режим живёт на месте индикатора: без своей панели, подсказок и карточек.
  var css = document.createElement('style');
  css.textContent =
    '.mk-embed-inline #chip, .mk-embed-inline #tools, .mk-embed-inline #hint,' +
    '.mk-embed-inline #status, .mk-embed-inline #setup, .mk-embed-inline #panel { display: none !important; }' +
    '.mk-embed-full #hint { display: none !important; }';
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

  if (embed === 'full') {
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !document.querySelector('#panel.open')) host.command('close');
    });
  }

  // После того как musetext создал приложение: обложку берём у плеера, а не ищем в iTunes,
  // а короткие статусы во встроенном режиме показывает сам плеер.
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
        host.status(msg || '', embed);
        return toast(msg, sticky);
      };

      // Звук плеера доступен без разрешений, поэтому реакцию на него включаем сразу,
      // если пользователь сам не выключал её в настройках musetext.
      if (!app.cfg.audioReactive && !host.audioReactOff()) app.toggleAudio(true);
    }, 0);
  });
})();
