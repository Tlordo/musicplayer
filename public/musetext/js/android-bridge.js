/* musetext :: android-bridge.js
   On desktop the shell injects window.museBridge from a preload script. On
   Android the WebView can only hand us a primitives-only Java object, so this
   file wraps that object in the same interface the rest of the app expects.
   Loaded first; a no-op everywhere else. */
(function () {
  'use strict';

  var N = window.museNative;
  if (!N || window.museBridge) return;

  var npHandlers = [];
  var pending = {};
  var nextId = 1;

  // Called from Kotlin on every media-session poll.
  window.__museNowPlaying = function (json) {
    var msg;
    try { msg = JSON.parse(json); } catch (e) { return; }
    npHandlers.forEach(function (fn) { fn(msg); });
  };

  // Called from Kotlin when a proxied HTTP request finishes.
  window.__museFetchDone = function (id, ok, body) {
    var p = pending[id];
    if (!p) return;
    delete pending[id];
    if (ok) p.resolve(body); else p.reject(new Error(body || 'network error'));
  };

  window.museBridge = {
    platform: 'android',

    onNowPlaying: function (cb) {
      npHandlers.push(cb);
      try { N.startNowPlaying(); } catch (e) { }
    },

    requestNowPlaying: function () {
      try { N.startNowPlaying(); } catch (e) { }
    },

    fetchText: function (url, headers) {
      return new Promise(function (resolve, reject) {
        var id = nextId++;
        pending[id] = { resolve: resolve, reject: reject };
        try {
          N.fetchText(url, JSON.stringify(headers || {}), id);
        } catch (e) {
          delete pending[id];
          reject(e);
        }
        setTimeout(function () {
          if (pending[id]) { delete pending[id]; reject(new Error('timeout')); }
        }, 20000);
      });
    },

    setSource: function (app) {
      try { N.setSource(app || ''); } catch (e) { }
    },

    mediaCommand: function (cmd) {
      try { return Promise.resolve(N.mediaCommand(cmd)); } catch (e) { return Promise.resolve(false); }
    },

    // Android gives no system-audio capture to a normal app, so beat reaction
    // stays off there and the visuals run purely off the lyric clock.
    getLoopbackStream: null,

    hasNotificationAccess: function () {
      try { return !!N.hasNotificationAccess(); } catch (e) { return false; }
    },

    openNotificationAccess: function () {
      try { N.openNotificationAccess(); } catch (e) { }
    },

    openAppSettings: function () {
      try { N.openAppSettings(); } catch (e) { }
    },

    androidVersion: function () {
      try { return N.androidVersion() | 0; } catch (e) { return 0; }
    },

    keepAwake: function (on) {
      try { N.keepAwake(!!on); } catch (e) { }
    }
  };
})();
