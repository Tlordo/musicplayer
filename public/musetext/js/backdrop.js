/* musetext :: backdrop.js — what sits behind the words.
   A heavily blurred, heavily darkened album cover, lit by coloured pulses that
   fire with the music. With no cover the pulses light plain black instead, so
   the frame still breathes. Off by setting, and every part is adjustable. */
window.MT = window.MT || {};
(function (MT) {
  'use strict';

  var LIGHT_COUNT = 4;

  // A light is drawn as a small gradient and scaled up on the compositor. A
  // gradient upscales without visible loss, and a 95vmax layer at 3x DPR would
  // be a texture the size of a poster, four of them, on a phone.
  var LIGHT_PX = 64;

  MT.Backdrop = function (root, cfg) {
    this.root = root;
    this.cfg = cfg;
    this.el = document.getElementById('bg');
    this.coverEl = document.getElementById('bg-cover');
    this.lightsEl = document.getElementById('bg-lights');

    // The blurred cover is baked once into a small canvas and stretched. A CSS
    // blur that changes every frame re-rasterises the whole picture each time,
    // which is the single most expensive thing a phone can be asked to do here.
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'bg-bake';
    this.coverEl.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.canFilter = !!this.ctx && typeof this.ctx.filter === 'string';
    this.img = null;
    this.bakedKey = '';

    this.coverUrl = null;
    this.hasCover = false;
    this.palette = MT.PALETTES.mono;
    this.rnd = MT.rng(20260904);

    this.lights = [];
    for (var i = 0; i < LIGHT_COUNT; i++) {
      var d = MT.el('div', 'light');
      d.style.width = LIGHT_PX + 'px';
      d.style.height = LIGHT_PX + 'px';
      d.style.display = 'none';
      this.lightsEl.appendChild(d);
      this.lights.push({ el: d, amp: 0, x: 0, y: 0, color: '#ffffff', size: 60, dirty: false });
    }
    this.pulse = 0;
  };

  MT.Backdrop.prototype.setPalette = function (p) {
    this.palette = (p && p.length) ? p : MT.PALETTES.mono;
  };

  /** Hand it a URL (blob or remote) or null to go back to plain lights. */
  MT.Backdrop.prototype.setCover = function (url) {
    if (this.coverUrl && this.coverUrl.indexOf('blob:') === 0 && this.coverUrl !== url) {
      URL.revokeObjectURL(this.coverUrl);
    }
    this.coverUrl = url || null;
    this.hasCover = false;
    this.img = null;
    this.bakedKey = '';
    if (!url) return;

    var self = this, img = new Image();
    img.decoding = 'async';
    img.onload = function () {
      if (self.coverUrl !== url) return;          // a newer cover arrived meanwhile
      self.img = img;
      self.hasCover = true;
      self.bake();
    };
    img.src = url;
  };

  MT.Backdrop.prototype.resize = function () {
    this.bakedKey = '';
    if (this.img) this.bake();
  };

  /** Draw the cover, cropped to fill, blurred and slightly desaturated. */
  MT.Backdrop.prototype.bake = function () {
    var img = this.img, ctx = this.ctx;
    if (!img || !ctx) return;
    var blur = Math.max(0, this.cfg.bgBlur || 0);
    var cw = Math.max(1, this.coverEl.clientWidth || this.root.clientWidth);
    var ch = Math.max(1, this.coverEl.clientHeight || this.root.clientHeight);
    var key = blur + '|' + cw + '|' + ch;
    if (key === this.bakedKey) return;
    this.bakedKey = key;

    // The blurrier it is, the fewer pixels it needs: a 46px blur survives being
    // baked at a tenth of the size and stretched back up.
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var f = MT.clamp(4 / Math.max(blur, 0.5), 0.1, dpr);
    var bw = Math.max(16, Math.round(cw * f));
    var bh = Math.max(16, Math.round(ch * f));
    this.canvas.width = bw;
    this.canvas.height = bh;

    // cover-fit crop
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var s = Math.max(bw / iw, bh / ih);
    var dw = iw * s, dh = ih * s, dx = (bw - dw) / 2, dy = (bh - dh) / 2;
    var bb = blur * f;

    ctx.clearRect(0, 0, bw, bh);
    if (this.canFilter) {
      // Overdraw past the edges so the blur does not pull in transparent black.
      var pad = bb * 2;
      ctx.filter = (bb > 0.3 ? 'blur(' + bb.toFixed(1) + 'px) ' : '') + 'saturate(0.8)';
      ctx.drawImage(img, dx - pad, dy - pad, dw + pad * 2, dh + pad * 2);
      ctx.filter = 'none';
    } else if (bb > 0.3) {
      // No canvas filters (older Safari): shrink hard and let smoothing blur it.
      var tw = Math.max(2, Math.round(bw / (bb * 1.5)));
      var th = Math.max(2, Math.round(bh / (bb * 1.5)));
      var tmp = document.createElement('canvas');
      tmp.width = tw; tmp.height = th;
      var tc = tmp.getContext('2d');
      tc.imageSmoothingQuality = 'high';
      tc.drawImage(img, dx * tw / bw, dy * th / bh, dw * tw / bw, dh * th / bh);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tmp, 0, 0, bw, bh);
    } else {
      ctx.drawImage(img, dx, dy, dw, dh);
    }
  };

  MT.Backdrop.prototype.mode = function () {
    var m = this.cfg.bgMode;
    if (m === 'auto') return this.hasCover ? 'cover' : 'lights';
    return m;
  };

  /** Fire a light. Called on beats and on each new lyric line. */
  MT.Backdrop.prototype.flash = function (strength) {
    if (this.mode() === 'off') return;
    var k = MT.clamp(strength, 0, 1.5);
    var l = this.lights[Math.floor(this.rnd() * this.lights.length)];
    l.color = this.palette[Math.floor(this.rnd() * this.palette.length)] || '#ffffff';
    l.x = MT.range(this.rnd, 8, 92);
    l.y = MT.range(this.rnd, 10, 90);
    l.size = MT.range(this.rnd, 45, 95);
    l.amp = Math.max(l.amp, 0.45 + k * 0.55);
    l.dirty = true;
    this.pulse = Math.max(this.pulse, k);
  };

  MT.Backdrop.prototype.render = function (dt, level) {
    var cfg = this.cfg;
    var mode = this.mode();
    var set = MT.setStyle;

    if (mode === 'off') {
      set(this.el, 'opacity', '0');
      return;
    }
    set(this.el, 'opacity', '1');

    this.pulse *= Math.exp(-dt * 3.2);
    var lit = (this.pulse * cfg.bgFlash) + (level || 0) * 0.35 * cfg.bgFlash;

    // The cover is kept near black and pushed up by the light, so the picture
    // reads as something being lit rather than as a wallpaper behind the text.
    // Over black, opacity is brightness, and opacity is free to animate.
    if (mode === 'cover' && this.hasCover) {
      this.bake();                               // no-op unless the blur setting moved
      set(this.coverEl, 'opacity', '1');
      set(this.canvas, 'opacity', MT.clamp(cfg.bgLevel + lit * 0.9, 0, 1).toFixed(3));
      set(this.coverEl, 'transform', 'scale(' + (1.18 + lit * 0.05).toFixed(3) + ')');
    } else {
      set(this.coverEl, 'opacity', '0');
    }

    var vmax = Math.max(window.innerWidth, window.innerHeight) / 100;
    for (var i = 0; i < this.lights.length; i++) {
      var l = this.lights[i];
      l.amp *= Math.exp(-dt * 2.6);
      var a = l.amp * cfg.bgFlash * (mode === 'cover' ? 0.5 : 0.85);
      if (a < 0.004) {
        // Hidden outright, so the layer is dropped rather than kept at zero.
        set(l.el, 'display', 'none');
        continue;
      }
      set(l.el, 'display', 'block');
      if (l.dirty) {
        l.dirty = false;
        set(l.el, 'background',
          'radial-gradient(circle at center, ' + l.color + ' 0%, transparent 68%)');
        set(l.el, 'left', l.x + '%');
        set(l.el, 'top', l.y + '%');
        set(l.el, 'transform', 'translate(-50%,-50%) scale(' +
          (l.size * vmax / LIGHT_PX).toFixed(3) + ')');
      }
      set(l.el, 'opacity', a.toFixed(2));
    }
  };
})(window.MT);
