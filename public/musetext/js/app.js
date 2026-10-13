/* musetext :: app.js — wiring.
   Detect what's playing -> find the words -> build a word-level timeline ->
   stage it -> run one animation frame loop against the audio clock. */
window.MT = window.MT || {};
(function (MT) {
  'use strict';

  function App() {
    this.cfg = MT.loadSettings();
    // Decided before anything else: a render window must never touch the media
    // session or the network, or a track change could swap the lyrics out from
    // under the frames being written.
    this.renderMode = /[?&]render=1/.test(location.search);
    this.root = document.getElementById('stage');
    this.stage = new MT.Stage(this.root, this.cfg);
    this.fx = new MT.Effects(this.root, this.cfg);
    this.bg = new MT.Backdrop(this.root, this.cfg);
    this.np = new MT.NowPlaying();
    this.clock = new MT.Clock();
    this.audio = new MT.AudioReactor();
    this.ui = new MT.UI(this);
    this.soul = new MT.Soul(this);

    this.vibe = 'edit';
    this.timeline = [];
    this.lyricSource = '';
    this.rerollSalt = 0;
    this.lastFrame = performance.now();
    this.frameToken = 1;
    this._fetchToken = 0;
    this._artToken = 0;
    this.localCover = null;

    var self = this;

    this.stage.onLineStart = function (line) {
      var k = MT.clamp(line.cps / 10, 0.35, 1.2);
      self.fx.lineStart(line, k);
      self.bg.flash(k * 0.8);
    };
    this.audio.onBeat = function (s) {
      if (!self.cfg.audioReactive) return;
      self.fx.beat(s);
      self.bg.flash(s);
    };

    this.np.preferredApp = this.cfg.sourceApp;
    this.np.on('sessions', function (list, notice) {
      MT.SESSION_LIST = list;
      if (notice && notice !== self._lastNotice) self.ui.toast(notice, true);
      if (!notice && self._lastNotice) self.ui.toast('');
      self._lastNotice = notice || '';
      // Nothing detected at all is worth saying out loud — it usually means the
      // player does not register a media session rather than that we are broken.
      var any = list && list.length;
      if (!any && self._sawSessions) self.ui.toast('Windows не видит ни одного медиа-сеанса');
      self._sawSessions = !!any;
    });
    if (window.museBridge && window.museBridge.onRenderProgress) {
      window.museBridge.onRenderProgress(function (p) {
        var pct = Math.round(p.frame / p.total * 100);
        self.ui.toast('Рендер ' + pct + '% · кадр ' + p.frame + ' из ' + p.total, true);
      });
    }

    this.np.on('error', function (m) { self.ui.toast(m, true); });
    this.np.on('track', function (t) { self.onTrack(t); });
    this.np.on('state', function (s) {
      self.clock.report(s.position, s.playing, 1);
      self.ui.setProgress(s.position, s.duration);
    });

    window.addEventListener('resize', function () {
      self.stage.resize();
      self.fx.resize();
      self.bg.resize();
    });

    this.clock.offset = this.cfg.offset;
    this.start();
  }

  /* ------------------------------------------------------------ sources */

  App.prototype.start = function () {
    var self = this;

    if (this.renderMode) {
      // No sources, no loop, no watchdog. The shell asks for each frame.
      MT.probeFonts().then(function () { self.stage.setVibe(self.vibe); });
      return;
    }

    // User-supplied families may or may not be on disk; find out before the
    // first line is staged, then re-apply in case a vibe fell back too early.
    MT.probeFonts().then(function () {
      self.stage.setVibe(self.vibe);
      self.ui.buildPanel();
    });
    document.fonts.ready.then(function () { self.stage.resize(); });

    var b = window.museBridge;
    if (b && b.keepAwake) b.keepAwake(true);
    this._shape = [this.cfg.mode, this.cfg.split, this.cfg.timing, this.cfg.parens].join('/');
    this.pushVlc();

    // On Android the bridge exists but stays silent until the user grants
    // notification access, so ask for it explicitly rather than showing a
    // stage that will never fill.
    var needsGrant = !!(b && b.hasNotificationAccess && !b.hasNotificationAccess());

    if (!needsGrant && this.np.useBridge()) {
      this.ui.toast('Слушаю системный плеер…');
      this.ui.showSetup(false);
    } else if (needsGrant) {
      this.np.useBridge();
      this.ui.showSetup(true, {
        note: 'Чтобы видеть, что играет, Android просит доступ к уведомлениям — ' +
              'только через него система отдаёт список активных плееров. ' +
              'Содержимое уведомлений приложение не читает. ' +
              'Без доступа можно открыть аудиофайл или ввести трек вручную.'
      });
      this.ui.toast('Нужен доступ к уведомлениям, чтобы видеть, что играет', true);
    } else {
      this.ui.showSetup(true);
      this.ui.toast('Нет системного плеера — открой файл или введи трек вручную', true);
    }
    this.bindSetup();

    if (this.cfg.audioReactive) this.toggleAudio(true);

    var token = this.frameToken;
    requestAnimationFrame(function (n) { self.frame(n, token); });
    this.watchdog();
  };

  App.prototype.bindSetup = function () {
    var self = this;
    var file = document.getElementById('setup-file');

    var b = window.museBridge;
    var grant = document.getElementById('setup-grant');
    var appinfo = document.getElementById('setup-appinfo');

    if (b && b.openNotificationAccess && b.hasNotificationAccess && !b.hasNotificationAccess()) {
      grant.hidden = false;
      grant.addEventListener('click', function () {
        self._askedAccess = true;
        b.openNotificationAccess();
      });
      if (appinfo && b.openAppSettings) {
        appinfo.addEventListener('click', function () { b.openAppSettings(); });
      }

      // Returning from settings fires visibilitychange; re-check then.
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) return;
        if (b.hasNotificationAccess()) {
          grant.hidden = true;
          if (appinfo) appinfo.hidden = true;
          self.ui.showSetup(false);
          b.requestNowPlaying();
          return;
        }
        // Came back still without it. On Android 13+ a sideloaded app has this
        // switch locked as a "restricted setting", and nothing in the app can
        // unlock it — so say exactly where the unlock lives.
        if (self._askedAccess) self.explainRestricted();
      });
    }
    document.getElementById('setup-pick').addEventListener('click', function () { file.click(); });
    file.addEventListener('change', function () {
      if (file.files[0]) self.handleFile(file.files[0]);
    });
    document.getElementById('setup-manual').addEventListener('submit', function (e) {
      e.preventDefault();
      var a = document.getElementById('setup-artist').value.trim();
      var t = document.getElementById('setup-title').value.trim();
      if (!t) return;
      self.ui.showSetup(false);
      if (self.ui.setupMode === 'search' && self.np.track) {
        // Something is already playing; these names are only for the lookup.
        self.searchOverride = { artist: a, title: t };
        self.reloadLyrics(true);
      } else {
        self.searchOverride = null;
        self.np.useManual({ artist: a, title: t }, 0);
      }
    });
  };

  /**
   * Android 13 and later mark notification access as a restricted setting for
   * anything installed outside an app store: the switch is there but greyed
   * out, with no hint about why. There is no API to lift that, so point at the
   * one place it can be lifted and make sure the offline path stays visible.
   */
  App.prototype.explainRestricted = function () {
    var b = window.museBridge;
    var appinfo = document.getElementById('setup-appinfo');
    if (appinfo && b && b.openAppSettings) appinfo.hidden = false;

    this.ui.showSetup(true, {
      note: 'Переключатель заблокирован? Android так делает с приложениями, ' +
            'установленными не из магазина. Открой настройки приложения, нажми ⋮ ' +
            'в правом верхнем углу и выбери «Разрешить ограниченные настройки». ' +
            'После этого доступ к уведомлениям включится. Либо просто открой ' +
            'аудиофайл — для него никаких разрешений не нужно.'
    });
  };

  App.prototype.handleFile = function (f) {
    var self = this;
    var name = f.name.toLowerCase();
    if (/\.(lrc|txt)$/.test(name)) {
      var r = new FileReader();
      r.onload = function () {
        var text = String(r.result || '');
        if (self.np.track) MT.pinLyrics(self.np.track, text, 'Файл');
        self.useLyrics({ source: 'Файл ' + f.name, synced: text, plain: null });
        self.ui.toast('Текст из файла подключён');
      };
      r.readAsText(f, 'utf-8');
      return;
    }
    if (/\.(mp3|m4a|flac|ogg|opus|wav|aac|webm)$/.test(name)) {
      // Start inside the drop/pick gesture, or the browser refuses to play.
      // Tags are read after, and applied to the track once they arrive.
      this.np.useLocalFile(f);
      this.ui.showSetup(false);
      this.ui.toast('Читаю теги…', true);

      MT.readTags(f).then(function (tags) {
        var artist = tags.artist || tags.albumArtist || '';
        self.localCover = tags.cover ? MT.coverUrl(tags.cover) : null;
        if (self.localCover) self.bg.setCover(self.localCover);
        if (tags.title || artist) {
          self.np.setLocalMeta({ artist: artist, title: tags.title || '' });
          self.ui.toast('Теги: ' + (artist ? artist + ' — ' : '') + (tags.title || f.name));
        } else {
          self.ui.toast('Тегов нет, беру имя файла');
        }
      });
      return;
    }
    this.ui.toast('Не понимаю этот файл');
  };

  /* ------------------------------------------------------------- lyrics */

  App.prototype.onTrack = function (track) {
    this.timeline = [];
    this.baseTimeline = null;
    this.searchOverride = null;      // typed names belong to the previous track
    this.stage.clear();
    this.ui.showSetup(false);        // a card from the last track must not linger
    this.ui.setTrack(track, this.vibe);

    var b = window.museBridge;
    if (b && b.setSource) b.setSource(this.np.currentApp || '');

    // A picture embedded in the file beats anything we could look up.
    if (this.np.source !== 'local') this.localCover = null;
    this.bg.setCover(this.localCover || null);
    if (track && !this.localCover) this.resolveArtwork(track);

    if (!track) { this.ui.toast('Ничего не играет'); return; }
    this.reloadLyrics(false);
  };

  App.prototype.reloadLyrics = async function (force) {
    var track = this.np.track;
    if (!track) { this.ui.toast('Сначала нужен трек'); return; }
    var self = this;
    var token = ++this._fetchToken;

    // A manual retry searches under the names the user typed, while playback
    // keeps running against the real track.
    var q = this.searchOverride
      ? {
          artist: this.searchOverride.artist,
          title: this.searchOverride.title,
          album: '',
          duration: this.np.state.duration || track.duration || 0
        }
      : track;

    this.ui.toast('Ищу текст…', true);
    var res = null;
    try {
      res = await MT.findLyrics(q, {
        force: force,
        onStatus: function (m) { if (token === self._fetchToken) self.ui.toast(m, true); }
      });
    } catch (e) { /* reported below */ }
    if (token !== this._fetchToken) return;

    if (!res) {
      this.timeline = [];
      this.stage.clear();
      this.ui.toast('Текст не найден', true);
      this.ui.showSetup(true, {
        mode: 'search',
        note: 'Текст не нашёлся. Проверь исполнителя и название — по ним идёт поиск. ' +
              'Или просто перетащи в окно .lrc либо файл со строками вида «00:07.17 - текст».',
        artist: q.artist,
        title: q.title,
        submit: 'Искать'
      });
      return;
    }

    // Remember the hit against the real track, so the retry is needed only once.
    if (this.searchOverride && res.synced) MT.pinLyrics(track, res.synced, res.source);
    this.useLyrics(res);
  };

  App.prototype.useLyrics = function (res) {
    var track = this.np.track || { title: 'unknown', artist: '', duration: 0 };
    var dur = this.np.state.duration || track.duration || 0;
    var lines;

    if (res.synced) {
      var parsed = MT.parseLRC(res.synced);
      lines = parsed.lines;
      if (!lines.length && res.plain) lines = MT.spreadPlain(res.plain, dur);
    } else {
      lines = MT.spreadPlain(res.plain, dur);
    }

    if (!lines.length) {
      this.ui.toast('Текст пустой');
      return;
    }

    this.rawLines = lines;
    this.rawDuration = dur;
    this.rebuildTimeline();
    this.lyricSource = res.source;
    this.ui.showSetup(false);        // nothing may sit in front of a running stage
    this.pickVibe();

    var seed = MT.trackId(track) + '#' + this.rerollSalt;
    this.stage.setTrack(seed, this.timeline, this.vibe);
    this.fx.setPalette(this.stage.palette);
    this.bg.setPalette(this.stage.palette);
    this.ui.setTrack(track, this.vibe);
    var frag = this.timeline.length > this.baseTimeline.length
      ? ' · ' + this.timeline.length + ' кусков' : '';
    this.ui.toast(res.source + ' · ' + this.baseTimeline.length + ' строк' + frag +
      ' · ' + (MT.VIBES[this.vibe] || {}).label + (res.synced ? '' : ' · без тайминга'));
  };

  /**
   * Flyby scatters a line into fragments; classic mode stages it whole.
   * 'auto' means "let the mode decide", and an explicit choice wins in both.
   */
  /* -------------------------------------------------------------- render */

  App.prototype.action = function (what) {
    if (what === 'renderGo') this.startRender();
  };

  /**
   * Hand the whole job to the shell: it reopens this page hidden, transparent
   * and at the target resolution, and steps it frame by frame. Nothing is
   * captured from the window you are looking at, so the render is unaffected by
   * what the visible app is doing.
   */
  App.prototype.startRender = async function () {
    var b = window.museBridge;
    if (!b || !b.render) {
      this.ui.toast('Рендер есть только в десктопной версии');
      return;
    }
    if (!this.rawLines || !this.rawLines.length || !this.timeline.length) {
      this.ui.toast('Сначала нужен текст трека');
      return;
    }
    if (this._rendering) { this.ui.toast('Рендер уже идёт'); return; }

    var cfg = this.cfg;
    var last = this.timeline[this.timeline.length - 1].end;
    var from = Math.max(0, cfg.renderFrom || 0);
    var to = cfg.renderTo > 0 ? cfg.renderTo : Math.min(last + 1.5, this.rawDuration || last + 1.5);
    if (to <= from) { this.ui.toast('Конец раньше начала'); return; }

    var track = this.np.track || { artist: '', title: 'musetext' };
    var fps = parseInt(cfg.renderFps, 10) || 30;
    var frames = Math.round((to - from) * fps);

    this._rendering = true;
    this.ui.setRenderBusy(true);
    this.ui.toast('Рендер: ' + frames + ' кадров, ' + cfg.renderW + '×' + cfg.renderH, true);

    var res;
    try {
      res = await b.render({
        width: cfg.renderW, height: cfg.renderH, fps: fps,
        from: from, to: to,
        format: cfg.renderFormat,
        name: (track.artist ? track.artist + ' - ' : '') + track.title,
        payload: {
          cfg: cfg,
          plain: !!cfg.renderPlain,
          lines: this.rawLines,
          duration: this.rawDuration,
          seed: MT.trackId(track) + '#' + this.rerollSalt
        }
      });
    } catch (e) {
      res = { ok: false, error: e.message || String(e) };
    }

    this._rendering = false;
    this.ui.setRenderBusy(false);

    if (!res || res.cancelled) { this.ui.toast(''); return; }
    if (!res.ok) { this.ui.toast('Рендер не удался: ' + res.error, true); return; }

    this.ui.toast('Готово: ' + res.result.frames + ' кадров', true);
    if (b.reveal) b.reveal(res.result.out);
  };

  App.prototype.resolveArtwork = async function (track) {
    var token = ++this._artToken;
    var url = null;
    try { url = await MT.findArtwork(track); } catch (e) { }
    if (token !== this._artToken) return;      // the track moved on
    if (url) this.bg.setCover(url);
  };

  App.prototype.applySplit = function (tl) {
    var want = this.cfg.split;
    if (want === 'auto') {
      // Both of the newer modes are built around short pieces; classic is not.
      want = (this.cfg.mode === 'flyby' || this.cfg.mode === 'stair') ? 'auto' : 'off';
    }
    return MT.chunkTimeline(tl, want, this.cfg.parens);
  };

  /** Re-cut the timeline from the parsed lines under the current settings. */
  App.prototype.rebuildTimeline = function () {
    if (!this.rawLines) return false;
    this.baseTimeline = MT.buildTimeline(this.rawLines, this.rawDuration, {
      timing: this.cfg.timing
    });
    this.timeline = this.applySplit(this.baseTimeline);
    return true;
  };

  App.prototype.pickVibe = function () {
    if (this.cfg.vibeMode !== 'auto' && MT.VIBES[this.cfg.vibeMode]) {
      this.vibe = this.cfg.vibeMode;
    } else {
      // Judge the song by whole lines — fragments would skew the density.
      var stats = MT.timelineStats(this.baseTimeline || this.timeline);
      if (this.cfg.audioReactive && this.audio.running) stats.energy = this.audio.energy;
      this.vibe = MT.autoVibe(stats);
    }
    MT.applyVibeFx(this.cfg, this.vibe);
  };

  /* ------------------------------------------------------------- config */

  App.prototype.applyConfig = function (rebuild) {
    // A resolution preset fills in the two numbers, but only when the preset
    // itself changed — otherwise it would overwrite a hand-typed size.
    if (this.cfg.renderSize !== this._lastPreset) {
      this._lastPreset = this.cfg.renderSize;
      var preset = /^(\d+)x(\d+)$/.exec(this.cfg.renderSize || '');
      if (preset) {
        this.cfg.renderW = parseInt(preset[1], 10);
        this.cfg.renderH = parseInt(preset[2], 10);
        if (this.ui) this.ui.buildPanel();
      }
    }
    this.clock.offset = this.cfg.offset;
    this.np.preferredApp = this.cfg.sourceApp;
    this.pushVlc();
    MT.saveSettings(this.cfg);

    // Mode, split, timing and bracket handling all change what a staged element
    // even is, so the timeline has to be cut again before anything is re-staged.
    var shape = [this.cfg.mode, this.cfg.split, this.cfg.timing, this.cfg.parens].join('/');
    if (shape !== this._shape && this.rawLines) {
      this._shape = shape;
      this.rebuildTimeline();
      this.pickVibe();
      this.stage.setTrack(this.stage.seed, this.timeline, this.vibe);
      this.fx.setPalette(this.stage.palette);
      this.bg.setPalette(this.stage.palette);
      return;
    }
    this._shape = shape;

    if (rebuild) {
      this.pickVibe();
      this.stage.setVibe(this.vibe);
      this.fx.setPalette(this.stage.palette);
      this.bg.setPalette(this.stage.palette);
      this.stage.resize();
    }
  };

  App.prototype.pushVlc = function () {
    var b = window.museBridge;
    if (!b || !b.setVlc) return;
    b.setVlc({
      enabled: !!this.cfg.vlcEnabled,
      port: this.cfg.vlcPort || 8080,
      password: this.cfg.vlcPassword || ''
    });
  };

  App.prototype.reroll = function () {
    if (!this.timeline.length) return;
    this.rerollSalt++;
    var seed = MT.trackId(this.np.track || {}) + '#' + this.rerollSalt;
    this.stage.setTrack(seed, this.timeline, this.vibe);
    this.fx.setPalette(this.stage.palette);
    this.bg.setPalette(this.stage.palette);
    this.ui.toast('Другая раскадровка');
  };

  App.prototype.toggleAudio = async function (on) {
    if (on) {
      var getter = (window.museBridge && window.museBridge.getLoopbackStream) || null;
      var ok = await this.audio.start(getter);
      this.cfg.audioReactive = ok;
      this.ui.toast(ok ? 'Реакция на звук включена' : 'Не удалось получить звук системы');
      if (!ok) this.ui.buildPanel();
    } else {
      this.audio.stop();
      this.ui.toast('Реакция на звук выключена');
    }
    MT.saveSettings(this.cfg);
  };

  App.prototype.toggleFullscreen = function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(function () { });
  };

  /* -------------------------------------------------------------- frame */

  /**
   * Restart the loop if frames stop arriving.
   *
   * A backgrounded, occluded or minimised window can have requestAnimationFrame
   * suspended indefinitely. Because each frame schedules the next one, a single
   * suspension would otherwise kill the animation for good and it would never
   * come back when the window returned. The token invalidates any older chain
   * so a late callback cannot leave two loops running at once.
   */
  App.prototype.watchdog = function () {
    var self = this;
    setInterval(function () {
      if (self.renderMode) return;       // offline rendering drives its own frames
      if (performance.now() - self.lastFrame < 1200) return;
      self.frameToken++;
      self.lastFrame = performance.now();
      var token = self.frameToken;
      requestAnimationFrame(function (n) { self.frame(n, token); });
    }, 1000);
  };

  App.prototype.frame = function (now, token) {
    if (token !== this.frameToken) return;      // a superseded chain
    var dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (this.cfg.audioReactive) this.audio.tick(dt);

    var t = this.clock.now(dt);
    if (this.timeline.length) this.stage.render(t, dt, this.audio);
    var level = this.cfg.audioReactive ? this.audio.level : 0;
    this.fx.render(dt, level);
    this.bg.render(dt, level);
    this.soul.tick(dt);

    var self = this;
    requestAnimationFrame(function (n) { self.frame(n, token); });
  };

  /* ------------------------------------------------------------- offline */

  /**
   * Render mode. The desktop shell opens this page in a hidden transparent
   * window and drives it one frame at a time, so nothing here may depend on
   * wall-clock time: no animation loop, no clock, no network. The frame the
   * shell asks for is the frame it gets.
   */
  function setupRenderMode(app) {
    document.documentElement.classList.add('render');
    document.body.classList.add('render');

    window.__museRenderInit = function (payload) {
      Object.assign(app.cfg, payload.cfg || {});
      app.cfg.bgMode = 'off';            // a backdrop would fill the alpha
      app.cfg.perf = 'full';             // an export is never cut down for a phone
      app.cfg.audioReactive = false;
      // Overlays that cover the whole frame have no meaning against alpha, so
      // they go regardless. "Plain" additionally drops the ones that move the
      // text, leaving nothing but the typography.
      app.cfg.fxAuto = false;
      app.cfg.fx.flash = 0;
      app.cfg.fx.grain = 0;
      app.cfg.fx.scan = 0;
      app.cfg.fx.vignette = 0;
      if (payload.plain) {
        app.cfg.fx.shake = 0;
        app.cfg.fx.zoom = 0;
        app.cfg.fx.chroma = 0;
        app.cfg.fx.invert = 0;
      }

      app.rawLines = payload.lines || [];
      app.rawDuration = payload.duration || 0;
      app.rebuildTimeline();
      app.pickVibe();
      app.stage.measure();
      app.stage.setTrack(payload.seed || 'render', app.timeline, app.vibe);
      app.fx.setPalette(app.stage.palette);
      app.bg.setCover(null);

      return {
        lines: app.baseTimeline ? app.baseTimeline.length : 0,
        frags: app.timeline.length,
        vibe: app.vibe,
        font: app.stage.fontKey,
        last: app.timeline.length ? app.timeline[app.timeline.length - 1].end : 0
      };
    };

    /** Draws one frame and reports how many words are actually visible, which
        the shell uses to tell a genuinely empty frame from a missed capture. */
    window.__museFrame = function (t, dt) {
      app.stage.render(t, dt);
      app.fx.render(dt, 0);
      // Count only what actually lands inside the frame: a word can be fully
      // opaque and still be nowhere near the picture.
      var visible = 0, W = innerWidth, H = innerHeight;
      app.stage.active.forEach(function (v) {
        var so = parseFloat(v.slot.style.opacity || '1');
        if (so <= 0.02) return;
        for (var i = 0; i < v.words.length; i++) {
          var el = v.words[i].el;
          if (so * parseFloat(el.style.opacity || '1') <= 0.03) continue;
          var q = el.getBoundingClientRect();
          if (q.right > 0 && q.left < W && q.bottom > 0 && q.top < H) visible++;
        }
      });
      return visible;
    };

    window.__museReady = true;
  }

  window.addEventListener('DOMContentLoaded', function () {
    var app = new App();
    window.museApp = app;
    if (/[?&]render=1/.test(location.search)) setupRenderMode(app);
  });
})(window.MT);
