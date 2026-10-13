/* musetext :: stage.js — the renderer.
   Owns the DOM for the currently visible lines and rewrites their transforms
   every animation frame from the audio clock. No CSS keyframes anywhere: the
   text is always exactly where the song is. */
window.MT = window.MT || {};
(function (MT) {
  'use strict';

  var E = MT.ease;

  function px(v) { return v.toFixed(2) + 'px'; }

  // How far past the stage width each layout is allowed to run.
  var BLEED = {
    flyby: 0.55,        // fragments live in a corner, so they stay compact
    camera: 0.85,       // world-space lines, kept under a screen wide
    stair: 0.72,        // a step must stay short, or the left/right offset vanishes
    bleedLeft: 1.45,
    diagonal: 1.10,
    perspectiveRun: 1.00,
    bigCenter: 0.94,
    sweep: 0.98,
    scatter: 0.94,
    stackDrift: 0.90
  };

  MT.Stage = function (root, cfg) {
    this.root = root;
    this.cfg = cfg;
    this.lines = document.getElementById('lines');
    this.timeline = [];
    this.specs = [];
    this.active = new Map();   // line index -> view
    this.seed = 'musetext';
    this.vibe = 'edit';
    this.font = MT.FONTS.oswald;
    this.palette = MT.PALETTES.mono;
    this.vmin = 10;
    this.lastLayout = null;
    this.recent = [];
    this.onLineStart = null;
    this._lastLineIdx = -2;
    this.measure();
  };

  MT.Stage.prototype.measure = function () {
    var r = this.root.getBoundingClientRect();
    this.W = r.width; this.H = r.height;
    this.vmin = Math.min(r.width, r.height) / 100;
  };

  MT.Stage.prototype.setTrack = function (seed, timeline, vibe) {
    this.clear();
    this.seed = seed || 'musetext';
    this.timeline = timeline || [];
    this.measureWorld();
    this.setVibe(vibe);
  };

  /**
   * Camera mode lays the whole song out along one long strip and drives the
   * viewpoint down it. This picks how many pixels one second of song is worth,
   * so consecutive lines land roughly a screen apart whatever the tempo.
   */
  MT.Stage.prototype.measureWorld = function () {
    var tl = this.timeline;
    var step = 3;
    if (tl && tl.length > 1) {
      step = (tl[tl.length - 1].start - tl[0].start) / (tl.length - 1);
    }
    // The speed multiplier folds in here so the world and the camera stay in
    // step: a line is centred exactly when its timestamp arrives.
    this.worldScale = (this.W * 0.82 * (this.cfg.cameraSpeed || 1)) / MT.clamp(step, 0.8, 12);

    /* Tunnel mode is the same idea turned into depth. A line stands still at a
       point in the corridor and is at its most readable exactly when its
       timestamp arrives; before that it is flying in out of the dark, after it
       it sweeps past the viewer. Two song-steps of approach keeps three or four
       lines receding into the distance without them piling up. */
    var approach = MT.clamp(step * 2.0, 1.4, 5.5) /
      MT.clamp(this.cfg.cameraSpeed || 1, 0.2, 3);
    var far = -2800, read = -140, past = 760;
    var speed = (read - far) / approach;
    this.tunnel = {
      far: far, read: read, past: past,
      speed: speed,
      approach: approach,
      pass: (past - read) / speed
    };
  };

  /** Drive the viewpoint down the strip: dolly right, slow roll, gentle bob. */
  MT.Stage.prototype.applyCamera = function (t) {
    var cfg = this.cfg;
    var camX = (this.worldScale || 0) * t;
    var roll = Math.sin(t * 0.11) * cfg.cameraRoll;
    var bob = Math.sin(t * 0.07) * this.vmin * 2.2;
    var dolly = 1 + Math.sin(t * 0.05) * 0.045;
    this.lines.style.transformOrigin = '50% 50%';
    this.lines.style.transform =
      'rotate(' + roll.toFixed(3) + 'deg) ' +
      'scale(' + dolly.toFixed(4) + ') ' +
      'translate(' + (this.W / 2 - camX).toFixed(1) + 'px,' + bob.toFixed(1) + 'px)';
  };

  MT.Stage.prototype.worldX = function (line) {
    return this.worldScale * line.start;
  };

  MT.Stage.prototype.setVibe = function (vibe) {
    this.vibe = vibe;
    var v = MT.VIBES[vibe] || MT.VIBES.edit;
    var f = MT.resolveFont(vibe);
    var ov = this.cfg.fontOverride;
    if (ov && ov !== 'auto' && MT.FONTS[ov] && MT.fontAvailable(ov)) {
      f = { key: ov, spec: MT.FONTS[ov] };
    }
    this.font = f.spec;
    this.fontKey = f.key;
    this.palette = MT.PALETTES[this.cfg.palette === 'auto' ? v.palette : this.cfg.palette]
      || MT.PALETTES.mono;
    this.specs = [];              // specs are vibe-dependent, so rebuild lazily
    this.recent = [];
    this.rebuildActive();
  };

  MT.Stage.prototype.clear = function () {
    this.active.forEach(function (v) { if (v.slot.parentNode) v.slot.parentNode.removeChild(v.slot); });
    this.active.clear();
    this.specs = [];
    this.recent = [];
    this.lastLayout = null;
    this._lastLineIdx = -2;
  };

  /** Drop every staged line so the next frame rebuilds them under the new look. */
  MT.Stage.prototype.rebuildActive = function () {
    this.active.forEach(function (v) {
      if (v.slot.parentNode) v.slot.parentNode.removeChild(v.slot);
    });
    this.active.clear();
  };

  MT.Stage.prototype.specFor = function (i) {
    if (this.specs[i]) return this.specs[i];
    var line = this.timeline[i];
    var spec = MT.makeSpec({
      seed: this.seed, line: line, vibe: this.vibe, cfg: this.cfg,
      recent: this.recent, last: this.lastLayout
    });
    this.lastLayout = spec.name;
    this.recent.push({ y: spec.y, h: spec.size * 1.3 });
    if (this.recent.length > 3) this.recent.shift();
    this.specs[i] = spec;
    return spec;
  };

  /* ---------------------------------------------------------------- build */

  MT.Stage.prototype.build = function (i) {
    var line = this.timeline[i];
    var spec = this.specFor(i);
    var rnd = MT.rng(MT.hash(this.seed + '@' + i));

    var slot = MT.el('div', 'slot');
    var pin = MT.el('div', 'pin');
    var txt = MT.el('div', 'txt');

    // A fragment that lands on a loud syllable is set bigger. The level is
    // sampled once, at birth, so the size stays put while the piece travels.
    var birthMul = 1;
    if (this.cfg.voiceSize > 0 && this.audio && this.audio.running) {
      birthMul = MT.clamp(1 + (this.audio.level - 0.45) * this.cfg.voiceSize, 0.72, 1.5);
    }

    var upper = this.cfg.uppercase === 'auto' ? this.font.upper : this.cfg.uppercase === 'on';
    txt.style.fontFamily = this.font.css + ', system-ui, sans-serif';
    txt.style.fontWeight = String(this.font.weight);
    txt.style.letterSpacing = (this.font.tracking) + 'em';
    txt.style.fontSize = px(spec.size * birthMul * this.vmin);
    txt.style.textTransform = upper ? 'uppercase' : 'none';
    // Hollow letters have no side to extrude, so they stay out of the tunnel.
    if (this.cfg.outline && !spec.tunnel && rnd() < 0.22) txt.classList.add('outline');

    var words = [];
    for (var w = 0; w < line.words.length; w++) {
      var span = MT.el('span', 'w', line.words[w].text);
      var jx = 0, jy = 0, jr = 0;
      if (spec.wordMode === 'scatter') {
        jx = MT.range(rnd, -0.5, 0.5); jy = MT.range(rnd, -0.6, 0.6); jr = MT.range(rnd, -10, 10);
      }
      if (this.cfg.colorWords && this.palette.length > 1 && rnd() < 0.22) {
        span.style.color = this.palette[1 + Math.floor(rnd() * (this.palette.length - 1))];
      }
      txt.appendChild(span);
      if (w < line.words.length - 1) txt.appendChild(document.createTextNode(' '));
      // Backing vocals are written in brackets; hold them back rather than
      // letting them compete with the lead line.
      var dim = (line.words[w].paren && this.cfg.parens === 'dim') ? 0.4 : 1;
      words.push({ el: span, t: line.words[w], jx: jx, jy: jy, jr: jr, seed: rnd(), dim: dim });
    }

    pin.appendChild(txt);
    slot.appendChild(pin);
    this.lines.appendChild(slot);

    // Fit: some layouts are meant to bleed off the edge, the rest must not.
    var size = spec.size * birthMul;
    var box = txt.getBoundingClientRect();
    var allow = (BLEED[spec.name] || 0.92) * this.W;
    if (box.width > allow) {
      size = Math.max(2.2, size * (allow / box.width));
      txt.style.fontSize = px(size * this.vmin);
      box = txt.getBoundingClientRect();
    }

    var view = {
      i: i, line: line, spec: spec, slot: slot, pin: pin, txt: txt, words: words,
      size: size,
      w: Math.max(1, box.width), h: Math.max(1, box.height),
      anchor: spec.anchor === 'l' ? 0 : spec.anchor === 'r' ? -100 : -50,
      vocal: MT.vocalIntensity ? MT.vocalIntensity(line.text) : 0,
      // When the last word has been sung. Nothing should fly off before this.
      readEnd: line.words.length ? line.words[line.words.length - 1].end : line.end,
      pinned: false
    };

    if (spec.tunnel) {
      // Everything about a tunnel slab lives in its 3D transform, so the box
      // just sits at the centre and the offsets are applied from there.
      slot.style.left = '50%';
      slot.style.top = '50%';
      this.extrude(view, size * this.vmin);
    } else if (spec.world) {
      // Placed by world coordinate; the camera, not the line, does the moving.
      slot.style.left = this.worldX(line).toFixed(1) + 'px';
      slot.style.top = spec.y + '%';
      this.clampStart(view);          // horizontal is world space; vertical is not
    } else {
      slot.style.left = spec.x + '%';
      slot.style.top = spec.y + '%';
      this.clampStart(view);
    }
    if (spec.exit) view.travel = this.travelToEdge(view);
    return view;
  };

  /**
   * Give each word a side.
   *
   * A shadow cannot do this: the extrusion has to run along the slab's own
   * normal, and once the slab is turned to face a wall that direction is out of
   * its plane. So the depth is real — a stack of copies at decreasing Z inside
   * each word, shading from a lit near edge to an unlit far one. They sit inside
   * the word's own span, so revealing a word brings its whole block with it and
   * nothing has to be restyled per frame.
   */
  MT.Stage.prototype.extrude = function (v, fontPx) {
    var amt = this.cfg.extrude;
    if (!(amt > 0.01)) return;

    var depth = fontPx * 0.45 * amt;
    // closer than ~1.4px reads as solid; a phone gets a coarser stack, since
    // every copy is another full paint of the word in 3D
    var layers = Math.round(MT.clamp(depth / 1.4, 3, MT.isLite(this.cfg) ? 6 : 16));
    var step = depth / layers;

    for (var i = 0; i < v.words.length; i++) {
      var span = v.words[i].el;
      var text = span.textContent;
      var frag = document.createDocumentFragment();
      for (var k = layers; k >= 1; k--) {
        var copy = MT.el('span', 'ext', text);
        var lit = Math.round(58 - (k / layers) * 46);
        copy.style.color = 'hsl(0,0%,' + lit + '%)';
        copy.style.transform = 'translateZ(' + (-k * step).toFixed(2) + 'px)';
        frag.appendChild(copy);
      }
      span.appendChild(frag);
    }
    v.extruded = true;
  };

  /** Rebuild the side faces at a new size, dropping the old stack first. */
  MT.Stage.prototype.reextrude = function (v) {
    for (var i = 0; i < v.words.length; i++) {
      var old = v.words[i].el.querySelectorAll('.ext');
      for (var k = 0; k < old.length; k++) old[k].parentNode.removeChild(old[k]);
    }
    v.extruded = false;
    this.extrude(v, v.size * this.vmin);
  };

  /**
   * Keep a line's starting position inside the frame.
   *
   * Placement is chosen in percentages before the text has been measured, so a
   * wide line anchored near an edge could begin partly outside it. Nudge it back
   * in, using the rotated bounding box rather than the raw one, and leave the
   * layouts that are meant to run off the edge alone.
   */
  MT.Stage.prototype.clampStart = function (v) {
    var spec = v.spec;

    var m = MT.clamp(this.cfg.safeArea, 0, 0.4) * Math.min(this.W, this.H);

    // A rotated line's footprint is its axis-aligned bounding box, which for a
    // wide line at 20 degrees is far taller than the text itself. On a short
    // frame that box can be most of the height, leaving no room for the drift
    // and scale that follow, so ease the angle back until the line fits.
    var maxH = Math.max(v.h, this.H - 2 * m) * 0.72;
    var rad, cos, sin, bw, bh;
    for (var pass = 0; pass < 8; pass++) {
      rad = Math.abs(spec.rot || 0) * Math.PI / 180;
      cos = Math.abs(Math.cos(rad)); sin = Math.abs(Math.sin(rad));
      bw = v.w * cos + v.h * sin;
      bh = v.w * sin + v.h * cos;
      if (bh <= maxH || Math.abs(spec.rot) < 0.6) break;
      spec.rot *= 0.75;
    }

    // Vertical is clamped for every layout without exception. Running off the
    // side is a deliberate look; running off the top or bottom is just a line
    // you cannot read, and on a short frame the tall diagonals do exactly that.
    var top = spec.y / 100 * this.H - bh / 2;
    var nt = MT.clamp(top, m, Math.max(m, this.H - bh - m));
    if (Math.abs(nt - top) > 0.5) {
      spec.y = (nt + bh / 2) / this.H * 100;
      v.slot.style.top = spec.y + '%';
    }

    // Horizontal is left alone for the layouts that are meant to bleed, and for
    // camera mode, where x is a world coordinate rather than a screen one.
    if (spec.world || (BLEED[spec.name] || 0.92) > 1) return;

    var offset = spec.anchor === 'l' ? 0 : spec.anchor === 'r' ? -v.w : -v.w / 2;
    var left = spec.x / 100 * this.W + offset - (bw - v.w) / 2;
    var nl = MT.clamp(left, m, Math.max(m, this.W - bw - m));
    if (Math.abs(nl - left) > 0.5) {
      spec.x = (nl + (bw - v.w) / 2 - offset) / this.W * 100;
      v.slot.style.left = spec.x + '%';
    }
  };

  /**
   * How far a fragment must travel along its exit vector before the whole box
   * has left the frame. Flyby pieces do not fade out, they leave, so the
   * distance has to come from the measured box rather than a guess in vmin.
   */
  MT.Stage.prototype.travelToEdge = function (v) {
    var spec = v.spec, W = this.W, H = this.H;
    var offset = spec.anchor === 'l' ? 0 : spec.anchor === 'r' ? -v.w : -v.w / 2;
    var left = spec.x / 100 * W + offset;
    var top = spec.y / 100 * H - v.h / 2;
    var ex = spec.exit[0], ey = spec.exit[1];

    var tx = ex > 0.001 ? (W - left) / ex
      : ex < -0.001 ? (left + v.w) / -ex : Infinity;
    var ty = ey > 0.001 ? (H - top) / ey
      : ey < -0.001 ? (top + v.h) / -ey : Infinity;

    return Math.min(tx, ty) + Math.max(v.w, v.h) * 0.15;
  };

  /* --------------------------------------------------------------- update */

  MT.Stage.prototype.lifeOf = function (line) {
    var lead = this.cfg.lead;
    if (this.cfg.mode === 'flyby') {
      // A fragment lives long enough to cross the frame, not just until the
      // next one starts — several are meant to be in the air at once.
      var fly = MT.clamp(line.dur * 1.7, 1.8, 5.5) * this.cfg.flyTime;
      return { a: line.start - lead, b: line.start + fly };
    }
    if (this.cfg.mode === 'camera') {
      // A line must already be past the right edge when it is created and fully
      // past the left edge before it is dropped, otherwise it would appear and
      // vanish in mid-air instead of being passed by the camera. One `cross` is
      // the time to travel a full screen width; the extra covers half of the
      // widest line we allow plus the roll and dolly of the camera itself.
      var cross = this.W / Math.max(1, this.worldScale || 1);
      var edge = cross * 1.15;
      return { a: line.start - edge, b: line.start + edge };
    }
    if (this.cfg.mode === 'tunnel') {
      // Born far down the corridor, dropped once it has swept past the viewer.
      var tn = this.tunnel || { approach: 3, pass: 1.2 };
      return { a: line.start - tn.approach, b: line.start + tn.pass };
    }
    if (this.cfg.mode === 'stair') {
      // A step holds until its place in the stack is needed again, so the whole
      // staircase stands on screen at once instead of one line at a time.
      var steps = Math.round(MT.clamp(this.cfg.maxLines, 2, 4));
      var reuse = this.timeline[line.i + steps];
      var b = reuse ? reuse.start - 0.05 : line.end + this.cfg.hold;
      return {
        a: line.start - lead,
        b: MT.clamp(b, line.start + 0.4, line.end + 6)
      };
    }
    return { a: line.start - lead, b: line.end + this.cfg.hold };
  };

  MT.Stage.prototype.render = function (t, dt, audio) {
    this.audio = audio || null;
    var cfg = this.cfg, tl = this.timeline, i;
    if (!tl.length) return;

    // Which lines belong on screen right now? Flyby scatters a line into
    // pieces, so it needs more of them in the air at once.
    var camera = cfg.mode === 'camera';
    var tunnel = cfg.mode === 'tunnel';
    var cap = cfg.maxLines + (cfg.mode === 'flyby' ? 2 : camera ? 4 : tunnel ? 3 : 0);

    // The tunnel needs its whole chain kept in 3D; every other mode is flat.
    this.lines.classList.toggle('depth', tunnel);
    var want = [];
    var cur = MT.lineAt(tl, t);
    // Camera mode holds lines on both sides of the current one, so scan wide.
    var from = Math.max(0, cur - cap - 2);
    var to = Math.min(tl.length - 1, cur + cap + 2);
    for (i = from; i <= to; i++) {
      if (i < 0) continue;
      var life = this.lifeOf(tl[i]);
      if (t >= life.a && t <= life.b) want.push(i);
    }
    if (want.length > cap) {
      if (camera) {
        // Keep the lines nearest the camera. Dropping the oldest instead would
        // make one vanish in the middle of the frame while it is still leaving.
        want.sort(function (a, b) { return Math.abs(a - cur) - Math.abs(b - cur); });
        want = want.slice(0, cap);
        want.sort(function (a, b) { return a - b; });
      } else {
        want = want.slice(want.length - cap);
      }
    }

    // Drop the ones that left.
    var self = this;
    var dead = [];
    this.active.forEach(function (v, k) { if (want.indexOf(k) === -1) dead.push(k); });
    dead.forEach(function (k) {
      var v = self.active.get(k);
      if (v.slot.parentNode) v.slot.parentNode.removeChild(v.slot);
      self.active.delete(k);
    });

    // Add the new ones.
    for (i = 0; i < want.length; i++) {
      if (!this.active.has(want[i])) this.active.set(want[i], this.build(want[i]));
    }

    if (cur !== this._lastLineIdx) {
      this._lastLineIdx = cur;
      if (cur >= 0 && this.onLineStart) this.onLineStart(tl[cur], cur);
    }

    // Draw.
    // Only camera mode moves the whole strip; leaving its transform behind
    // would drag every other mode along with it after a switch.
    if (camera) this.applyCamera(t);
    else if (this.lines.style.transform) this.lines.style.transform = '';

    // Per-word blur filters are the costliest thing in the reveal; lite drops them.
    this._blur = cfg.motionBlur && !MT.isLite(cfg);
    this.active.forEach(function (v) { self.drawLine(v, t, dt); });
  };

  MT.Stage.prototype.drawLine = function (v, t, dt) {
    var spec = v.spec, line = v.line, cfg = this.cfg;
    var flyby = cfg.mode === 'flyby';
    var camera = cfg.mode === 'camera';
    var tunnel = !!spec.tunnel;
    var life = this.lifeOf(line);

    // Audio timing: once every word has landed, sustained quiet means the phrase
    // is over even if the next timestamp is still far away. Only the analyser
    // can tell us that, so this does nothing without it.
    if (cfg.timing === 'audio' && v.cut == null && this.audio && this.audio.running) {
      if (t > v.readEnd + 0.15 && this.audio.level < 0.055) {
        v.quiet = (v.quiet || 0) + (dt || 0.016);
        if (v.quiet > 0.3) v.cut = t;
      } else {
        v.quiet = 0;
      }
    }
    if (v.cut != null) life.b = Math.min(life.b, v.cut + 0.35);
    var span = Math.max(0.25, life.b - life.a);
    var q = MT.clamp((t - life.a) / span, 0, 1);
    var qe = flyby ? q : E.inOutCubic(q);   // flyby travels at a constant speed

    var fin = MT.clamp((t - life.a) / 0.22, 0, 1);
    var alpha, dx, dy, sc, zDepth = 0;

    if (flyby) {
      // It leaves the frame instead of dissolving, so the only fade is a short
      // one at the very end as insurance against an odd aspect ratio.
      alpha = E.outCubic(fin) * MT.clamp((life.b - t) / 0.25, 0, 1);

      // Two phases. While the words are still being sung the piece only drifts;
      // once the last one has landed it accelerates out of frame. Without this a
      // fragment can be gone before you have read it.
      var travel = v.travel || 0;
      var readEnd = Math.min(v.readEnd, life.a + span * 0.72);
      var pRead = MT.clamp((t - life.a) / Math.max(0.2, readEnd - life.a), 0, 1);
      var pGo = MT.clamp((t - readEnd) / Math.max(0.2, life.b - readEnd), 0, 1);
      var prog = 0.16 * pRead + 0.84 * pGo * pGo;

      dx = spec.exit[0] * travel * prog;
      dy = spec.exit[1] * travel * prog;
      sc = 1;
    } else if (tunnel) {
      // The slab never moves. Its distance is a pure function of the song
      // position, so the corridor reads the same whatever the frame rate.
      var tn = this.tunnel;
      zDepth = tn.read + (t - line.start) * tn.speed;
      // Out of the dark at the far end, gone once it has swept past the viewer.
      alpha = MT.clamp((zDepth - tn.far) / 700, 0, 1) *
              MT.clamp((tn.past - zDepth) / 420, 0, 1);
      dx = 0; dy = 0; sc = 1;
    } else if (camera) {
      // No fade at all: it is born off the right edge and dropped off the left,
      // so anything you can see is at full strength.
      alpha = 1;
      dx = 0; dy = 0; sc = 1;
    } else {
      var fout = MT.clamp((life.b - t) / Math.max(0.18, cfg.hold * 0.8), 0, 1);
      alpha = E.outCubic(fin) * E.outCubic(fout);
      dx = MT.lerp(spec.drift[0], spec.drift[2], qe) * this.vmin;
      dy = MT.lerp(spec.drift[1], spec.drift[3], qe) * this.vmin;
      sc = MT.lerp(spec.scale[0], spec.scale[1], qe);
    }

    // Laughter, held vowels and vibrato get a jitter of their own. The text
    // itself flags the first two; the analyser catches the rest when it runs.
    var shakeAmt = 0;
    if (cfg.vocalShake > 0) {
      var trem = (this.audio && this.audio.running) ? this.audio.tremolo : 0;
      shakeAmt = MT.clamp(Math.max(v.vocal, trem * 0.9), 0, 1) * cfg.vocalShake;
    }
    if (shakeAmt > 0.01) {
      var amp = shakeAmt * v.h * 0.16;
      dx += (Math.random() - 0.5) * amp;
      dy += (Math.random() - 0.5) * amp;
    }

    // A gentle live breath on top of the size baked in at birth.
    if (cfg.voiceSize > 0 && this.audio && this.audio.running) {
      sc *= 1 + (this.audio.level - 0.45) * cfg.voiceSize * 0.18;
    }

    MT.setStyle(v.slot, 'opacity', alpha.toFixed(3));

    if (tunnel) {
      var tk = spec.tunnel;
      v.slot.style.transform =
        'translate3d(' + px(tk.offX * this.W + dx) + ',' + px(tk.offY * this.H + dy) +
        ',' + zDepth.toFixed(1) + 'px) ' +
        'rotateY(' + tk.yaw.toFixed(2) + 'deg) ' +
        'rotateX(' + tk.pitch.toFixed(2) + 'deg) ' +
        'rotateZ(' + tk.roll.toFixed(2) + 'deg) ' +
        'scale(' + sc.toFixed(4) + ') ' +
        'translate(-50%,-50%)';
    } else {
      v.slot.style.transform =
        'translate(' + px(dx) + ',' + px(dy) + ') ' +
        'rotate(' + spec.rot.toFixed(2) + 'deg) ' +
        'skewX(' + spec.skew.toFixed(2) + 'deg) ' +
        'scale(' + sc.toFixed(4) + ') ' +
        'translate(' + v.anchor + '%,-50%)';
    }

    // CC Power Pin. In flyby the corners are set once, when the fragment
    // appears, and never touched again; otherwise they travel across its life.
    if (tunnel || cfg.perspective <= 0.001) {
      // The tunnel gets its depth from a real 3D transform, so a faked corner
      // pin on top of it would only fight the projection.
      if (v.pin.style.transform) { v.pin.style.transform = ''; v.pinned = false; }
    } else if (spec.frozen) {
      if (!v.pinned) {
        v.pin.style.transform = MT.pinFromOffsets(v.w, v.h, spec.pinA);
        v.pinned = true;
      }
    } else {
      var off = MT.lerpOffsets(spec.pinA, spec.pinB, qe);
      v.pin.style.transform = MT.pinFromOffsets(v.w, v.h, off);
    }

    // words
    var mode = spec.wordMode, reveal = 0.14 + spec.stagger * 2.2;

    /* A tunnel slab is born a full approach before its timestamp, so revealing
       words at the moment they are sung would leave it blank for the whole
       flight in and readable only as it swept past. Instead the line writes
       itself on the way down the corridor, in the rhythm of its own words, and
       stands complete exactly when it arrives. */
    var wa = 0, wb = 1, base = 0, windowLen = 0;
    if (tunnel) {
      wa = v.words.length ? v.words[0].t.start : line.start;
      wb = Math.max(wa + 0.2, v.readEnd);
      base = life.a + this.tunnel.approach * 0.10;
      windowLen = this.tunnel.approach * 0.72;
    }

    for (var i = 0; i < v.words.length; i++) {
      var w = v.words[i];
      var ws;
      if (tunnel) {
        ws = base + ((w.t.start - wa) / (wb - wa)) * windowLen;
      } else {
        ws = w.t.start - this.cfg.lead * 0.35;
      }
      var p = MT.clamp((t - ws) / reveal, 0, 1);
      // A word that has finished (or not yet started) its reveal holds still, so
      // rewriting its styles every frame would be pure recalc for nothing.
      if (p === w.lastP && this._blur === w.lastBlur) continue;
      w.lastP = p; w.lastBlur = this._blur;
      applyWord(w, p, mode, this._blur);
    }
  };

  function applyWord(w, p, mode, motionBlur) {
    var el = w.el, tr = '', op = p, blur = 0;

    if (mode === 'typewriter') {
      el.style.opacity = p > 0.5 ? String(w.dim) : '0';
      el.style.transform = '';
      el.style.filter = '';
      return;
    }

    if (mode === 'cascade') {
      var e1 = E.outQuint(p);
      tr = 'translateY(' + ((1 - e1) * 0.55).toFixed(3) + 'em)';
      blur = (1 - e1) * 10;
      op = E.outCubic(p);
    } else if (mode === 'pop') {
      var e2 = E.outBack(p);
      tr = 'scale(' + (0.35 + e2 * 0.65).toFixed(4) + ')';
      blur = (1 - p) * 8;
      op = E.outExpo(p);
    } else if (mode === 'slide') {
      var e3 = E.outQuint(p);
      tr = 'translateX(' + ((1 - e3) * -0.7).toFixed(3) + 'em)';
      blur = (1 - e3) * 7;
      op = E.outCubic(p);
    } else if (mode === 'stamp') {
      var e4 = E.outExpo(p);
      tr = 'scale(' + (2.3 - e4 * 1.3).toFixed(4) + ')';
      blur = (1 - e4) * 16;
      op = Math.min(1, p * 2.4);
    } else if (mode === 'depth') {
      // The word arrives from further down the corridor than its own slab.
      var e6 = E.outQuint(p);
      tr = 'translateZ(' + ((1 - e6) * -320).toFixed(1) + 'px)';
      blur = (1 - e6) * 6;
      op = E.outCubic(p);
    } else if (mode === 'scatter') {
      var e5 = E.outQuint(p);
      tr = 'translate(' + ((1 - e5) * w.jx).toFixed(3) + 'em,' + ((1 - e5) * w.jy).toFixed(3) + 'em) ' +
           'rotate(' + ((1 - e5) * w.jr).toFixed(2) + 'deg)';
      blur = (1 - e5) * 9;
      op = E.outCubic(p);
    }

    blur = Math.min(blur, 8);   // past this it stops reading as motion and just looks soft
    el.style.opacity = (op * w.dim).toFixed(3);
    el.style.transform = tr;
    el.style.filter = (motionBlur && blur > 0.4) ? 'blur(' + blur.toFixed(1) + 'px)' : '';
  }

  MT.Stage.prototype.resize = function () {
    this.measure();
    this.measureWorld();
    var self = this;
    this.active.forEach(function (v) {
      v.txt.style.fontSize = px(v.size * self.vmin);

      if (v.spec.tunnel) {
        // A slab is already turned in 3D, so its client rect is the projected
        // shape rather than the box. offsetWidth/Height ignore transforms.
        v.w = Math.max(1, v.txt.offsetWidth);
        v.h = Math.max(1, v.txt.offsetHeight);
        self.reextrude(v);
        return;
      }

      var box = v.txt.getBoundingClientRect();
      v.w = Math.max(1, box.width); v.h = Math.max(1, box.height);
      v.pinned = false;                                   // re-pin at the new size
      if (v.spec.world) v.slot.style.left = self.worldX(v.line).toFixed(1) + 'px';
      else self.clampStart(v);
      if (v.spec.exit) v.travel = self.travelToEdge(v);
    });
  };
})(window.MT);
