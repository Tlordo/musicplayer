/* musetext :: effects.js — the "edit" layer: flashes, shake, zoom punch,
   RGB split, inversion, grain and scanlines. Every one is an independent
   0..1 amount in settings, so the whole look can be dialled from clean to feral. */
window.MT = window.MT || {};
(function (MT) {
  'use strict';

  var GRAIN_FRAMES = 6;     // pre-rolled noise, cycled; nobody can tell they repeat

  MT.Effects = function (root, cfg) {
    this.root = root;
    this.cfg = cfg;
    this.flash = document.getElementById('flash');
    this.vignette = document.getElementById('vignette');
    this.scan = document.getElementById('scan');
    this.stageInner = document.getElementById('stage-inner');
    this.linesEl = document.getElementById('lines');
    this.grainCanvas = document.getElementById('grain');
    this.gctx = this.grainCanvas ? this.grainCanvas.getContext('2d') : null;

    this.shake = 0;
    this.zoom = 0;
    this.invert = 0;
    this.chroma = 0;
    this.flashA = 0;
    this.flashT = 0;
    this.flashDur = 0.08;
    this.flashPeak = 0;
    this.flashColor = '#ffffff';
    this.flashBlend = 'screen';
    this.palette = MT.PALETTES.mono;
    this.rnd = MT.rng(1337);
    this._grainTick = 0;
    this._grainFrame = 0;
    this._grainFrames = null;
    this._grainLite = null;
    this._lite = null;
    this.resize();
  };

  MT.Effects.prototype.setPalette = function (p) { this.palette = p || MT.PALETTES.mono; };

  MT.Effects.prototype.resize = function () {
    if (!this.grainCanvas) return;
    var r = this.root.getBoundingClientRect();
    // Grain is rendered small and stretched — cheap and it looks coarser, which is right.
    var div = MT.isLite(this.cfg) ? 4 : 3;
    this.grainCanvas.width = Math.max(64, Math.round(r.width / div));
    this.grainCanvas.height = Math.max(64, Math.round(r.height / div));
    this._grainFrames = null;     // regenerated lazily at the new size
  };

  /**
   * Roll the noise once instead of 24 times a second.
   *
   * Full mode is grey noise blended with `overlay`. A full-screen blend mode is
   * exactly what a phone GPU chokes on, so lite mode draws plain dark specks
   * with alpha instead: over black they vanish, as overlay noise would, and
   * over the letters they read as the same grit.
   */
  MT.Effects.prototype.makeGrain = function (lite) {
    var w = this.grainCanvas.width, h = this.grainCanvas.height;
    var frames = [];
    for (var f = 0; f < GRAIN_FRAMES; f++) {
      var img = this.gctx.createImageData(w, h);
      var d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var v = (Math.random() * 255) | 0;
        if (lite) {
          d[i] = d[i + 1] = d[i + 2] = 0;
          d[i + 3] = v > 128 ? (v - 128) * 2 : 0;
        } else {
          d[i] = d[i + 1] = d[i + 2] = v;
          d[i + 3] = 255;
        }
      }
      frames.push(img);
    }
    this._grainFrames = frames;
    this._grainLite = lite;
  };

  /** Called when a new lyric line becomes current. */
  MT.Effects.prototype.lineStart = function (line, strength) {
    var c = this.cfg, k = (strength == null ? 1 : strength) * c.intensity;
    if (c.fx.flash > 0 && this.rnd() < c.fx.flash) this.pop(k * MT.range(this.rnd, 0.5, 1));
    if (c.fx.shake > 0) this.shake = Math.max(this.shake, c.fx.shake * k * MT.range(this.rnd, 0.5, 1.2));
    if (c.fx.zoom > 0) this.zoom = Math.max(this.zoom, c.fx.zoom * k * MT.range(this.rnd, 0.4, 1));
    if (c.fx.invert > 0 && this.rnd() < c.fx.invert * 0.5) this.invert = 0.09;
    if (c.fx.chroma > 0 && this.rnd() < c.fx.chroma) this.chroma = c.fx.chroma * k;
  };

  /** Called from the audio analyser on a detected beat. */
  MT.Effects.prototype.beat = function (strength) {
    var c = this.cfg, k = MT.clamp(strength, 0, 1.5) * c.intensity;
    if (c.fx.shake > 0) this.shake = Math.max(this.shake, c.fx.shake * k * 0.7);
    if (c.fx.zoom > 0) this.zoom = Math.max(this.zoom, c.fx.zoom * k * 0.55);
    if (c.fx.flash > 0 && this.rnd() < c.fx.flash * 0.35) this.pop(k * 0.55);
  };

  /* A flash is a hard 2-5 frame punch, not a wash. Anything longer reads as a
     coloured background instead of a cut. */
  MT.Effects.prototype.pop = function (k) {
    var pal = this.palette;
    this.flashColor = pal[Math.floor(this.rnd() * pal.length)] || '#ffffff';
    this.flashBlend = (this.flashColor === '#ffffff') ? 'normal' : 'screen';
    this.flashPeak = MT.clamp(0.45 + k * 0.5, 0, 1);
    this.flashDur = MT.range(this.rnd, 0.045, 0.11);
    this.flashT = this.flashDur;
  };

  MT.Effects.prototype.render = function (dt, level) {
    var c = this.cfg, set = MT.setStyle;
    var decay = Math.exp(-dt * 7);

    // Lite mode is a body class so the stylesheet can drop blend modes too.
    var lite = MT.isLite(c);
    if (lite !== this._lite) {
      this._lite = lite;
      document.body.classList.toggle('lite', lite);
      this.resize();
    }

    this.shake *= decay;
    this.zoom *= Math.exp(-dt * 5.5);
    this.chroma *= Math.exp(-dt * 4);
    this.invert = Math.max(0, this.invert - dt);

    this.flashT = Math.max(0, this.flashT - dt);
    this.flashA = this.flashT > 0 ? this.flashPeak * (this.flashT / this.flashDur) : 0;

    // audio level keeps a low continuous pulse when the analyser is running
    var lvl = level || 0;
    var pulse = 1 + lvl * 0.02 * c.intensity;

    var sx = (this.rnd() - 0.5) * this.shake * 26;
    var sy = (this.rnd() - 0.5) * this.shake * 26;
    var sc = pulse + this.zoom * 0.055;

    if (this.stageInner) {
      set(this.stageInner, 'transform',
        'translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px) scale(' + sc.toFixed(4) + ')');
      set(this.stageInner, 'filter', this.invert > 0 ? 'invert(1)' : '');
    }

    // A text shadow repaints every glyph on screen, so it is only rewritten when
    // the split has moved by a visible half pixel.
    if (this.linesEl) {
      var o = this.chroma > 0.01 ? Math.round(this.chroma * 10) / 2 : 0;
      set(this.linesEl, 'textShadow', o > 0
        ? o + 'px 0 rgba(255,0,64,.85), ' + (-o) + 'px 0 rgba(0,224,255,.85)'
        : '');
    }

    if (this.flash) {
      var fa = this.flashA > 0.004 ? this.flashA.toFixed(2) : '0';
      set(this.flash, 'opacity', fa);
      if (fa !== '0') {
        set(this.flash, 'background', this.flashColor);
        set(this.flash, 'mixBlendMode', lite ? 'normal' : this.flashBlend);
      }
    }

    if (this.vignette) set(this.vignette, 'opacity', String(c.fx.vignette != null ? c.fx.vignette : 0.55));

    this.renderGrain(dt, lite);
    this.renderScan();
  };

  MT.Effects.prototype.renderScan = function () {
    if (this.scan) MT.setStyle(this.scan, 'opacity', (this.cfg.fx.scan * 0.5).toFixed(3));
  };

  MT.Effects.prototype.renderGrain = function (dt, lite) {
    if (!this.gctx) return;
    var amt = this.cfg.fx.grain;
    // Normal-blended specks need a touch more opacity to match overlay grit.
    var op = amt <= 0.01 ? 0 : amt * (lite ? 0.22 : 0.16);
    MT.setStyle(this.grainCanvas, 'opacity', op.toFixed(3));
    MT.setStyle(this.grainCanvas, 'display', op > 0 ? 'block' : 'none');
    if (!op) return;
    this._grainTick += dt;
    if (this._grainTick < 1 / 24) return;       // regenerate at 24 fps, film-ish
    this._grainTick = 0;

    if (!this._grainFrames || this._grainLite !== lite) this.makeGrain(lite);
    this._grainFrame = (this._grainFrame + 1) % this._grainFrames.length;
    this.gctx.putImageData(this._grainFrames[this._grainFrame], 0, 0);
  };
})(window.MT);
