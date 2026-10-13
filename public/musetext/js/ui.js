/* musetext :: ui.js — the small chip at the top and the settings panel.
   Deliberately tiny and monochrome so it never competes with the stage. */
window.MT = window.MT || {};
(function (MT) {
  'use strict';

  MT.UI = function (app) {
    this.app = app;
    this.cfg = app.cfg;
    this.chip = document.getElementById('chip');
    this.chipTitle = document.getElementById('chip-title');
    this.chipBar = document.getElementById('chip-bar');
    this.chipDot = document.getElementById('chip-dot');
    this.panel = document.getElementById('panel');
    this.body = document.getElementById('panel-body');
    this.status = document.getElementById('status');
    this.setup = document.getElementById('setup');
    this.hidden = false;
    this._statusTimer = null;
    this.build();
  };

  MT.UI.prototype.build = function () {
    var self = this;

    document.getElementById('gear').addEventListener('click', function () { self.togglePanel(); });
    document.getElementById('panel-close').addEventListener('click', function () { self.togglePanel(false); });

    this.buildPanel();

    document.getElementById('btn-refetch').addEventListener('click', function () {
      self.app.reloadLyrics(true);
    });
    document.getElementById('btn-reroll').addEventListener('click', function () {
      self.app.reroll();
    });
    document.getElementById('btn-reset').addEventListener('click', function () {
      Object.assign(self.cfg, MT.defaults());
      MT.saveSettings(self.cfg);
      self.buildPanel();
      self.app.applyConfig(true);
      self.toast('Настройки сброшены');
    });

    // Drag an .lrc (or a whole audio file) onto the window.
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) self.app.handleFile(f);
    });

    // Tap controls, so a phone can reach everything the keyboard can.
    var tools = document.getElementById('tools');
    tools.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button') : null;
      if (btn) self.action(btn.getAttribute('data-act'));
    });

    // With the interface hidden there is no button left to bring it back, so a
    // short tap on the stage does it. A long press is the easter egg, not this.
    var stage = document.getElementById('stage');
    var pressAt = 0;
    stage.addEventListener('pointerdown', function () { pressAt = Date.now(); });
    stage.addEventListener('pointerup', function () {
      if (self.hidden && Date.now() - pressAt < 400) self.toggleChrome();
    });

    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      document.getElementById('hint').innerHTML =
        'кнопки сверху — интерфейс, раскадровка, сдвиг текста, пауза<br>' +
        'тап по экрану возвращает спрятанный интерфейс';
    }

    window.addEventListener('keydown', function (e) {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      // While the soul is out, the keyboard belongs to it: S and W are movement,
      // not shortcuts. It handles Escape itself.
      if (self.app.soul && self.app.soul.active) return;
      var map = {
        h: 'hide', s: 'settings', f: 'full', r: 'reroll',
        '[': 'minus', ']': 'plus', ' ': 'play', escape: 'close'
      };
      var act = map[e.key.toLowerCase()];
      if (!act) return;
      if (e.key === ' ') e.preventDefault();
      self.action(act);
    });
  };

  /** Every control the app has, reachable from a key or from a button. */
  MT.UI.prototype.action = function (act) {
    switch (act) {
      case 'hide': this.toggleChrome(); break;
      case 'settings': this.togglePanel(); break;
      case 'full': this.app.toggleFullscreen(); break;
      case 'reroll': this.app.reroll(); break;
      case 'play': this.app.np.togglePlay(); break;
      case 'close': this.showSetup(false); this.togglePanel(false); break;
      case 'minus':
      case 'plus':
        this.cfg.offset += (act === 'plus' ? 0.1 : -0.1);
        this.cfg.offset = Math.round(this.cfg.offset * 100) / 100;
        this.app.applyConfig();
        this.toast('Сдвиг ' + this.cfg.offset.toFixed(2) + ' с');
        break;
    }
  };

  MT.UI.prototype.buildPanel = function () {
    var self = this, cfg = this.cfg;
    this.body.innerHTML = '';

    MT.SCHEMA.forEach(function (sec) {
      var g = MT.el('div', 'grp');
      g.appendChild(MT.el('h3', null, sec.title));
      sec.rows.forEach(function (row) {
        var r = MT.el('label', 'row');
        r.appendChild(MT.el('span', 'lbl', row.label));
        var val = MT.getPath(cfg, row.k);
        var input;

        if (row.type === 'range') {
          input = MT.el('input');
          input.type = 'range';
          input.min = row.min; input.max = row.max; input.step = row.step;
          input.value = val;
          var out = MT.el('span', 'val', row.int ? String(val) : Number(val).toFixed(2));
          input.addEventListener('input', function () {
            var v = row.int ? parseInt(input.value, 10) : parseFloat(input.value);
            MT.setPath(cfg, row.k, v);
            out.textContent = row.int ? String(v) : v.toFixed(2);
            if (row.k.indexOf('fx.') === 0) cfg.fxAuto = false;
            // These change where a line is placed, so staged ones must be rebuilt.
            var replace = row.k === 'maxLines' || row.k === 'scale' ||
              row.k === 'safeArea' || row.k === 'cameraSpeed' || row.k === 'extrude';
            self.app.applyConfig(replace);
          });
          r.appendChild(input); r.appendChild(out);
        } else if (row.type === 'bool') {
          input = MT.el('input');
          input.type = 'checkbox';
          input.checked = !!val;
          input.addEventListener('change', function () {
            MT.setPath(cfg, row.k, input.checked);
            self.app.applyConfig(true);
            if (row.k === 'fxAuto' && input.checked) self.buildPanel();
            if (row.k === 'audioReactive') self.app.toggleAudio(input.checked);
          });
          r.appendChild(input);
        } else if (row.type === 'button') {
          input = MT.el('button', 'wide act', row.text || row.label);
          input.type = 'button';
          input.addEventListener('click', function () { self.app.action(row.k); });
          r.appendChild(input);
        } else if (row.type === 'number' || row.type === 'text') {
          input = MT.el('input');
          input.type = row.password ? 'password' : row.type;
          if (row.type === 'number') {
            input.min = row.min; input.max = row.max; input.step = row.step;
          }
          input.value = val == null ? '' : val;
          input.className = 'wide';
          input.addEventListener('change', function () {
            var v = row.type === 'number' ? Number(input.value) : input.value;
            MT.setPath(cfg, row.k, v);
            // Typing a size by hand means the preset no longer describes it.
            if (row.k === 'renderW' || row.k === 'renderH') cfg.renderSize = 'custom';
            self.app.applyConfig(true);
          });
          r.appendChild(input);
        } else if (row.type === 'select') {
          input = MT.el('select');
          var opts = typeof row.options === 'function' ? row.options() : row.options;
          opts.forEach(function (o) {
            var op = MT.el('option', null, o[1]);
            op.value = o[0];
            input.appendChild(op);
          });
          input.value = val;
          input.addEventListener('change', function () {
            MT.setPath(cfg, row.k, input.value);
            self.app.applyConfig(true);
          });
          r.appendChild(input);
        }
        g.appendChild(r);
      });
      self.body.appendChild(g);
    });
  };

  MT.UI.prototype.togglePanel = function (force) {
    var on = force == null ? !this.panel.classList.contains('open') : force;
    this.panel.classList.toggle('open', on);
    if (on) this.buildPanel();
  };

  MT.UI.prototype.toggleChrome = function () {
    this.hidden = !this.hidden;
    document.body.classList.toggle('bare', this.hidden);
  };

  MT.UI.prototype.setTrack = function (track, vibe) {
    if (!track) {
      this.chipTitle.textContent = 'Ничего не играет';
      return;
    }
    var name = (track.artist ? track.artist + ' - ' : '') + track.title;
    this.chipTitle.textContent = name;
    // The tooltip names the player, which is the first thing to check when the
    // wrong track shows up.
    this.chip.title = name +
      (track.app ? '  ·  ' + track.app.replace(/\.exe$/i, '') : '') +
      (vibe ? '  ·  ' + (MT.VIBES[vibe] || {}).label : '');
  };

  MT.UI.prototype.setProgress = function (pos, dur) {
    var p = dur > 0 ? MT.clamp(pos / dur, 0, 1) : 0;
    this.chipDot.style.left = (p * 100).toFixed(2) + '%';
  };

  MT.UI.prototype.toast = function (msg, sticky) {
    this.status.textContent = msg || '';
    this.status.classList.toggle('on', !!msg);
    if (this._statusTimer) clearTimeout(this._statusTimer);
    if (msg && !sticky) {
      var self = this;
      this._statusTimer = setTimeout(function () { self.status.classList.remove('on'); }, 2600);
    }
  };

  /**
   * The same card serves two jobs: getting started when there is no player,
   * and asking for better names when a lookup came back empty.
   * opts: { note, artist, title, submit, mode }
   */
  /** A render takes minutes; the button must not look clickable while it runs. */
  MT.UI.prototype.setRenderBusy = function (busy) {
    this.renderBusy = busy;
    var btn = this.body.querySelector('button.act');
    if (btn) {
      btn.disabled = !!busy;
      btn.textContent = busy ? 'Идёт рендер…' : 'Рендерить';
    }
  };

  MT.UI.prototype.showSetup = function (show, opts) {
    this.setup.classList.toggle('on', !!show);
    if (!show) { this.setup.classList.remove('compact'); return; }
    opts = opts || {};
    this.setupMode = opts.mode || 'start';
    this.setup.classList.toggle('compact', this.setupMode === 'search');

    var note = document.getElementById('setup-note');
    note.textContent = opts.note ||
      'Системный плеер не найден. Открой аудиофайл или введи трек вручную — ' +
      'текст подтянется из LRCLIB.';

    if (opts.artist != null) document.getElementById('setup-artist').value = opts.artist;
    if (opts.title != null) document.getElementById('setup-title').value = opts.title;

    var btn = this.setup.querySelector('#setup-manual button');
    if (btn) btn.textContent = opts.submit || 'Запустить';
  };
})(window.MT);
