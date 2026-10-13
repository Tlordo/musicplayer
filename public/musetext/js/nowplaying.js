/* musetext :: nowplaying.js — what is playing, and where in it we are.
   Three sources, same shape:
     bridge  — the OS media session (Windows SMTC / Android MediaSession) via the shell
     local   — an audio file opened inside the app
     manual  — typed metadata driven by an internal stopwatch
   Emits: 'track' when the song changes, 'state' on every position report. */
window.MT = window.MT || {};
(function (MT) {
  'use strict';

  function idOf(t) {
    if (!t || !t.title) return '';
    return (MT.cleanArtist(t.artist) + '|' + MT.cleanTitle(t.title) + '|' + Math.round(t.duration || 0))
      .toLowerCase();
  }
  MT.trackId = idOf;

  MT.NowPlaying = function () {
    this.source = 'none';
    this.track = null;
    this.trackId = '';
    this.state = { position: 0, playing: false, duration: 0 };
    this.handlers = {};
    this._audio = null;
    this._manual = null;
    this._raf = null;
    this.sessions = [];      // every media session the shell can see
    this.preferredApp = '';  // user override, '' or 'auto' means pick for me
    this.currentApp = '';    // app we are following right now
    this._posId = '';        // track the position anchor belongs to
    this._posAnchor = 0;     // wall clock when the anchor was set
    this._posBase = 0;       // position at the anchor
    this._posRaw = null;     // last raw position the source reported
    this._posPlaying = false;
  };

  MT.NowPlaying.prototype.on = function (ev, fn) {
    (this.handlers[ev] = this.handlers[ev] || []).push(fn);
    return this;
  };
  MT.NowPlaying.prototype.emit = function (ev, a, b) {
    (this.handlers[ev] || []).forEach(function (f) { f(a, b); });
  };

  MT.NowPlaying.prototype._push = function (track, state) {
    var id = idOf(track);
    if (id && id !== this.trackId) {
      this.trackId = id;
      this.track = track;
      this.emit('track', track);
    } else if (track) {
      this.track = track;
    }
    this.state = state;
    this.emit('state', state, track);
  };

  /* ------------------------------------------------------------- bridge */

  // A position stamp older than this is treated as stale rather than as
  // something to extrapolate from. Real players refresh well inside it; a
  // session left over from an hour ago does not.
  var STAMP_FRESH = 5;

  /**
   * Turn one OS report into a position we can trust.
   *
   * Windows and Android both hand out a position plus the moment it was
   * measured. Well-behaved players refresh that pair constantly, so we take it
   * as gospel. Others publish it once and then repeat it forever — extrapolating
   * from that stamp runs the clock away until it pins to the end of the track,
   * which is why such a source used to look like it only worked while paused.
   * When the stamp is stale we anchor once and run our own stopwatch instead.
   */
  MT.NowPlaying.prototype._position = function (msg, id) {
    var now = Date.now();
    var raw = msg.position || 0;
    var playing = !!msg.playing;

    if (id !== this._posId) {
      this._posId = id;
      this._posRaw = null;
      this._posBase = raw;
      this._posAnchor = now;
      this._posPlaying = playing;
    }

    var age = msg.reportedAt ? (now - msg.reportedAt) / 1000 : Infinity;
    var fresh = age >= -1 && age < STAMP_FRESH;

    // Re-anchor whenever the player actually says something new: the position
    // moved, playback started or stopped, or this is the first report.
    var moved = this._posRaw === null ||
      Math.abs(raw - this._posRaw) > 0.05 ||
      playing !== this._posPlaying;

    if (moved) {
      this._posRaw = raw;
      this._posPlaying = playing;
      this._posBase = raw + (fresh && playing ? Math.max(0, age) : 0);
      this._posAnchor = now;
    }

    var pos = this._posBase + (playing ? (now - this._posAnchor) / 1000 : 0);
    if (msg.duration > 0) pos = Math.min(pos, msg.duration);
    return Math.max(0, pos);
  };

  /**
   * Choose which media session to follow.
   *
   * Windows keeps handing "current session" to whichever app touched it last,
   * so a finished browser tab can sit in front of the player that is genuinely
   * playing. Score instead: playing beats not playing, a published duration and
   * a fresh stamp break ties, and the session we are already following gets a
   * bonus so the view does not flip between two open players.
   */
  MT.pickSession = function (list, preferred, lastApp) {
    if (!list || !list.length) return null;
    if (preferred && preferred !== 'auto') {
      for (var i = 0; i < list.length; i++) if (list[i].app === preferred) return list[i];
    }
    var now = Date.now();
    var best = null, bestScore = -1;
    for (var j = 0; j < list.length; j++) {
      var s = list[j];
      var age = s.reportedAt ? (now - s.reportedAt) / 1000 : 1e9;
      var score = 0;
      if (s.playing) score += 100;
      if (s.duration > 0) score += 25;
      // A stamp refreshed seconds ago is strong evidence the session is alive;
      // an old one decays away. This is what keeps a zombie session that still
      // claims to be playing from blocking the player you can actually hear.
      score += age < STAMP_FRESH ? 25 : MT.clamp(1 - age / 120, 0, 1) * 12;
      if (s.app === lastApp) score += 8;   // enough to break ties, not to override health
      if (s.isCurrent) score += 3;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  };

  MT.NowPlaying.prototype.useBridge = function () {
    var b = window.museBridge;
    if (!b || !b.onNowPlaying) return false;
    this.stop();
    this.source = 'bridge';
    var self = this;
    b.onNowPlaying(function (msg) {
      // The shells report every media session; picking one happens here so the
      // user can override it from the settings panel.
      var list = (msg && msg.sessions) ? msg.sessions : (msg && msg.title ? [msg] : []);
      self.sessions = list;
      self.notice = (msg && msg.vlcError) || '';
      self.emit('sessions', list, self.notice);

      var s = MT.pickSession(list, self.preferredApp, self.currentApp);
      if (!s || !s.title) {
        self.currentApp = '';
        if (self.trackId) { self.trackId = ''; self.track = null; self.emit('track', null); }
        self.state = { position: 0, playing: false, duration: 0 };
        self.emit('state', self.state, null);
        return;
      }
      self.currentApp = s.app || '';

      var track = {
        artist: s.artist || '', title: s.title, album: s.album || '',
        duration: s.duration || 0, app: s.app || ''
      };
      self._push(track, {
        position: self._position(s, idOf(track) + '@' + track.app),
        playing: !!s.playing,
        duration: s.duration || 0
      });
    });
    if (b.requestNowPlaying) b.requestNowPlaying();
    return true;
  };

  /* -------------------------------------------------------------- local */

  MT.NowPlaying.prototype.useLocalFile = function (file, meta) {
    this.stop();
    this.source = 'local';
    var self = this;
    var audio = new Audio(URL.createObjectURL(file));
    audio.preload = 'auto';
    this._audio = audio;

    var name = file.name.replace(/\.[a-z0-9]+$/i, '');
    var parts = name.split(/\s+-\s+/);
    var track = {
      artist: (meta && meta.artist) || (parts.length > 1 ? parts[0] : ''),
      title: (meta && meta.title) || (parts.length > 1 ? parts.slice(1).join(' - ') : name),
      album: '', duration: 0, app: 'musetext'
    };

    function report() {
      track.duration = audio.duration || 0;
      self._push(track, { position: audio.currentTime, playing: !audio.paused, duration: audio.duration || 0 });
    }
    audio.addEventListener('loadedmetadata', report);
    audio.addEventListener('play', report);
    audio.addEventListener('pause', report);
    audio.addEventListener('seeked', report);
    audio.addEventListener('timeupdate', report);

    this._localTrack = track;
    this._localReport = report;

    // Autoplay is only granted inside the gesture that opened the file, so this
    // has to happen now — never after an await.
    audio.play().catch(function (err) {
      self.emit('error', 'Браузер не дал запустить звук: ' + (err && err.name || 'ошибка') +
        '. Нажми на окно и пробел.');
    });
    return audio;
  };

  /** Apply tags read from the file after playback has already started. */
  MT.NowPlaying.prototype.setLocalMeta = function (meta) {
    if (this.source !== 'local' || !this._localTrack || !meta) return;
    if (meta.artist) this._localTrack.artist = meta.artist;
    if (meta.title) this._localTrack.title = meta.title;
    if (this._localReport) this._localReport();   // new identity, so lyrics refetch
  };

  /* ------------------------------------------------------------- manual */

  MT.NowPlaying.prototype.useManual = function (track, duration) {
    this.stop();
    this.source = 'manual';
    var self = this;
    var st = { t0: performance.now(), base: 0, playing: true };
    this._manual = st;
    var tr = {
      artist: track.artist || '', title: track.title || 'Без названия',
      album: '', duration: duration || 0, app: 'manual'
    };
    function loop() {
      if (self._manual !== st) return;
      var pos = st.base + (st.playing ? (performance.now() - st.t0) / 1000 : 0);
      self._push(tr, { position: pos, playing: st.playing, duration: tr.duration });
      self._raf = setTimeout(loop, 200);
    }
    loop();
    return {
      toggle: function () {
        if (st.playing) { st.base += (performance.now() - st.t0) / 1000; st.playing = false; }
        else { st.t0 = performance.now(); st.playing = true; }
      },
      seek: function (s) { st.base = s; st.t0 = performance.now(); }
    };
  };

  MT.NowPlaying.prototype.seek = function (sec) {
    if (this.source === 'local' && this._audio) this._audio.currentTime = sec;
    else if (this.source === 'manual' && this._manual) {
      this._manual.base = sec; this._manual.t0 = performance.now();
    }
  };

  MT.NowPlaying.prototype.togglePlay = function () {
    if (this.source === 'local' && this._audio) {
      if (this._audio.paused) this._audio.play(); else this._audio.pause();
    } else if (this.source === 'manual' && this._manual) {
      var st = this._manual;
      if (st.playing) { st.base += (performance.now() - st.t0) / 1000; st.playing = false; }
      else { st.t0 = performance.now(); st.playing = true; }
    } else if (window.museBridge && window.museBridge.mediaCommand) {
      window.museBridge.mediaCommand('playpause');
    }
  };

  MT.NowPlaying.prototype.stop = function () {
    if (this._audio) { this._audio.pause(); this._audio.src = ''; this._audio = null; }
    if (this._raf) { clearTimeout(this._raf); this._raf = null; }
    this._manual = null;
    this._localTrack = null;
    this._localReport = null;
  };
})(window.MT);
