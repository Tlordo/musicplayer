/* musetext :: layouts.js — how a single lyric line is staged.
   Every layout returns a "spec" the stage turns into DOM + per-frame transforms.
   Everything is seeded from the track id, so the same song always cuts the same way. */
window.MT = window.MT || {};
(function (MT) {
  'use strict';

  var R = MT.range, P = MT.pick;

  /**
   * A CC Power Pin built from edge scale factors rather than free corners.
   * L / R scale the left and right edge heights, T / B the top and bottom widths.
   * Keeping each in a bounded range guarantees a convex trapezoid whose vanishing
   * point stays far away, so a line never collapses into an unreadable ribbon.
   */
  function pinEdges(Lf, Rf, Tf, Bf) {
    var t = (1 - Tf) / 2, b = (1 - Bf) / 2, l = (1 - Lf) / 2, r = (1 - Rf) / 2;
    return [
      [t, l],     // TL
      [-t, r],    // TR
      [-b, -r],   // BR
      [b, -l]     // BL
    ];
  }

  var PIN_MAX = 0.42;   // hard ceiling on how far an edge may deviate from 1.0

  function pinTilt(rnd, amt, bias) {
    var dev = MT.clamp(amt * 0.20, 0, PIN_MAX);
    var mode = Math.floor(rnd() * 4);
    var k = bias || 1;
    if (mode === 0)            // yaw: one side nearer than the other
      return pinEdges(1 + dev * k, 1 - dev * k, 1, 1);
    if (mode === 1)            // pitch: top edge narrower, like looking down at it
      return pinEdges(1, 1, 1 - dev * 0.9 * k, 1 + dev * 0.5 * k);
    if (mode === 2)            // opposite yaw
      return pinEdges(1 - dev * k, 1 + dev * k, 1, 1);
    return pinEdges(1 + dev * 0.6 * k, 1 - dev * 0.6 * k,
                    1 + dev * 0.4 * k, 1 - dev * 0.4 * k);   // combined
  }

  function pinScaled(off, k) {
    return off.map(function (p) {
      return [MT.clamp(p[0] * k, -PIN_MAX, PIN_MAX), MT.clamp(p[1] * k, -PIN_MAX, PIN_MAX)];
    });
  }

  // Nudge a new line away from where the previous ones sit.
  function freeY(rnd, recent, lo, hi, h) {
    var best = null, bestGap = -1;
    for (var i = 0; i < 8; i++) {
      var y = R(rnd, lo, hi), gap = 999;
      for (var j = 0; j < recent.length; j++) {
        gap = Math.min(gap, Math.abs(recent[j].y - y) - (recent[j].h + h) * 0.5);
      }
      if (gap > bestGap) { bestGap = gap; best = y; }
      if (gap > 6) break;
    }
    return best;
  }

  var L = {};

  L.bigCenter = function (c) {
    var r = c.rnd, y = freeY(r, c.recent, 34, 62, 22);
    return {
      size: R(r, 13, 20) * c.sizeBias / Math.max(1, Math.pow(c.words / 4, 0.55)),
      x: R(r, 42, 58), y: y, anchor: 'c',
      rot: R(r, -5, 5) * c.rotBias,
      skew: R(r, -4, 4) * c.rotBias,
      drift: [R(r, -3, 3) * c.sp, R(r, -2.5, 2.5) * c.sp, R(r, -6, 6) * c.sp, R(r, -4, 4) * c.sp],
      scale: [R(r, 0.86, 0.95), R(r, 1.02, 1.14)],
      pinA: pinScaled(pinTilt(r, c.pinBias), 0.35),
      pinB: pinTilt(r, c.pinBias),
      wordMode: P(r, ['stamp', 'pop', 'cascade']),
      stagger: R(r, 0.02, 0.09)
    };
  };

  L.bleedLeft = function (c) {
    // The concept frame: a big line anchored past the edge so it crops.
    var r = c.rnd, right = r() < 0.35;
    var y = freeY(r, c.recent, 18, 78, 14);
    return {
      size: R(r, 8, 13) * c.sizeBias,
      x: right ? R(r, 82, 104) : R(r, -6, 8), y: y, anchor: right ? 'r' : 'l',
      rot: R(r, -3, 3) * c.rotBias,
      skew: R(r, -8, 2) * c.rotBias,
      drift: [0, 0, (right ? 1 : -1) * R(r, 4, 14) * c.sp, R(r, -3, 3) * c.sp],
      scale: [R(r, 0.95, 1.0), R(r, 1.0, 1.08)],
      pinA: pinScaled(pinTilt(r, c.pinBias), 0.5),
      pinB: pinTilt(r, c.pinBias * 0.9),
      wordMode: P(r, ['cascade', 'slide', 'typewriter']),
      stagger: R(r, 0.03, 0.1)
    };
  };

  L.diagonal = function (c) {
    var r = c.rnd, dir = r() < 0.5 ? -1 : 1;
    var y = freeY(r, c.recent, 25, 72, 12);
    return {
      size: R(r, 6.5, 11) * c.sizeBias,
      x: R(r, 30, 66), y: y, anchor: 'c',
      rot: dir * R(r, 12, 27) * Math.max(0.6, c.rotBias),
      skew: dir * R(r, 2, 10) * c.rotBias,
      drift: [-dir * R(r, 8, 20) * c.sp, R(r, 3, 9) * c.sp,
              dir * R(r, 8, 22) * c.sp, -R(r, 3, 10) * c.sp],
      scale: [R(r, 0.9, 1.0), R(r, 1.04, 1.16)],
      pinA: pinScaled(pinTilt(r, c.pinBias), 0.6),
      pinB: pinTilt(r, c.pinBias * 1.15),
      wordMode: P(r, ['cascade', 'slide']),
      stagger: R(r, 0.035, 0.1)
    };
  };

  L.perspectiveRun = function (c) {
    var r = c.rnd, deep = r() < 0.5 ? 1 : -1;
    var y = freeY(r, c.recent, 28, 70, 16);
    // The depth swings across the line's life: one edge starts near, ends far.
    var d = MT.clamp(c.pinBias * R(r, 0.22, 0.34), 0, PIN_MAX);
    return {
      size: R(r, 9, 15) * c.sizeBias,
      x: R(r, 34, 66), y: y, anchor: 'c',
      rot: R(r, -8, 8) * c.rotBias,
      skew: 0,
      drift: [deep * R(r, 4, 12) * c.sp, 0, -deep * R(r, 6, 16) * c.sp, R(r, -4, 4) * c.sp],
      scale: [R(r, 0.8, 0.92), R(r, 1.05, 1.25)],
      pinA: pinEdges(1 + deep * d, 1 - deep * d * 0.55, 1, 1),
      pinB: pinEdges(1 - deep * d * 0.8, 1 + deep * d, 1, 1),
      wordMode: P(r, ['pop', 'stamp', 'cascade']),
      stagger: R(r, 0.02, 0.07)
    };
  };

  L.sweep = function (c) {
    // Subtitle-style: enters from one side and crosses at a speed set by lyric density.
    var r = c.rnd, dir = r() < 0.5 ? -1 : 1;
    var y = freeY(r, c.recent, 22, 80, 10);
    var travel = R(r, 26, 52) * c.sp;
    return {
      size: R(r, 5.5, 9) * c.sizeBias,
      x: 50, y: y, anchor: 'c',
      rot: R(r, -6, 6) * c.rotBias,
      skew: R(r, -6, 6) * c.rotBias,
      drift: [dir * travel * 0.55, R(r, -2, 2), -dir * travel * 0.45, R(r, -2, 2)],
      scale: [1, 1],
      pinA: pinScaled(pinTilt(r, c.pinBias), 0.4),
      pinB: pinScaled(pinTilt(r, c.pinBias), 1.0),
      wordMode: 'slide',
      stagger: R(r, 0.02, 0.06)
    };
  };

  L.scatter = function (c) {
    var r = c.rnd, y = freeY(r, c.recent, 24, 74, 18);
    return {
      size: R(r, 7, 12) * c.sizeBias,
      x: R(r, 26, 74), y: y, anchor: 'c',
      rot: R(r, -14, 14) * c.rotBias,
      skew: R(r, -10, 10) * c.rotBias,
      drift: [R(r, -6, 6) * c.sp, R(r, -5, 5) * c.sp, R(r, -10, 10) * c.sp, R(r, -8, 8) * c.sp],
      scale: [R(r, 0.85, 0.98), R(r, 1.05, 1.2)],
      pinA: pinScaled(pinTilt(r, c.pinBias), 0.7),
      pinB: pinTilt(r, c.pinBias * 1.3),
      wordMode: 'scatter',
      stagger: R(r, 0.04, 0.12)
    };
  };

  L.stackDrift = function (c) {
    // Quiet mode: near-horizontal, scrolling upward like burned-in subtitles.
    var r = c.rnd, side = P(r, ['l', 'l', 'c']);
    return {
      size: R(r, 4.5, 7.5) * c.sizeBias,
      x: side === 'l' ? R(r, 5, 12) : 50,
      y: R(r, 62, 78), anchor: side,
      rot: R(r, -2.5, 2.5) * c.rotBias,
      skew: R(r, -5, 5) * c.rotBias,
      drift: [0, R(r, 4, 9) * c.sp, R(r, -3, 3) * c.sp, -R(r, 8, 18) * c.sp],
      scale: [R(r, 0.97, 1.0), R(r, 1.0, 1.06)],
      pinA: pinScaled(pinTilt(r, c.pinBias), 0.3),
      pinB: pinScaled(pinTilt(r, c.pinBias), 0.75),
      wordMode: P(r, ['typewriter', 'cascade']),
      stagger: R(r, 0.03, 0.09)
    };
  };

  /* Flyby: the second mode.
     Perspective is chosen once, at the moment the fragment appears, and then
     never touched — the piece travels in a straight line at constant speed and
     leaves the frame rather than dissolving in place. Fragments of one line are
     scattered to different corners instead of being set as a single sentence. */

  var CELLS = [
    [20, 26], [72, 22], [16, 52], [78, 50],
    [30, 74], [68, 76], [44, 38], [54, 64]
  ];

  L.flyby = function (c) {
    var r = c.rnd;

    // Parts of the same line take different cells; the offset is seeded from
    // the parent so a line always scatters the same way.
    var cell = CELLS[(c.cellSeed + c.part * 3) % CELLS.length];
    var x = cell[0] + R(r, -5, 5);
    var y = cell[1] + R(r, -6, 6);

    var anchor = 'c';
    if (x < 35) { anchor = 'l'; x -= 7; }
    else if (x > 65) { anchor = 'r'; x += 7; }

    // Leave the way it is already facing, with the occasional crossing shot.
    var ex = (x < 50 ? -1 : 1);
    if (r() < 0.22) ex = -ex;
    var ey = R(r, -0.42, 0.42);
    var len = Math.sqrt(ex * ex + ey * ey) || 1;

    var pin = pinTilt(r, c.pinBias * R(r, 0.9, 1.6));

    return {
      size: R(r, 6, 11.5) * c.sizeBias,
      x: x, y: y, anchor: anchor,
      rot: R(r, -13, 13) * c.rotBias,
      skew: R(r, -6, 6) * c.rotBias,
      drift: [0, 0, 0, 0],          // flyby computes its own travel from the box size
      scale: [1, 1],
      pinA: pin,
      pinB: pin,                    // frozen: no interpolation over the life
      frozen: true,
      exit: [ex / len, ey / len],
      wordMode: P(r, ['cascade', 'slide', 'pop']),
      stagger: R(r, 0.03, 0.1)
    };
  };

  /* Stair: lines stacked as steps down the frame, the first flush left, the
     last flush right, so a phrase reads as a caption laid out by hand.
     No rotation and no drift to speak of — the depth comes from the pin, which
     is set once when the step appears and then left alone. */

  L.stair = function (c) {
    var r = c.rnd;
    var steps = c.steps;
    var k = c.index % steps;
    var spread = 34;                                  // total height of the stack, vmin
    var y = 50 + (k - (steps - 1) / 2) * (spread / Math.max(1, steps - 1));

    var x, anchor;
    if (k === 0) { x = 4; anchor = 'l'; }
    else if (k === steps - 1) { x = 96; anchor = 'r'; }
    else { x = 50; anchor = 'c'; }

    // Depth without tilt: a gentler pin than the other modes use, so the step
    // still reads as a straight line of type.
    var stairPin = pinTilt(r, c.pinBias * R(r, 0.6, 1.05));

    return {
      // Kept modest on purpose: a step that fills the width reads as one long
      // line and the staircase disappears.
      size: R(r, 6.5, 9.5) * c.sizeBias,
      x: x, y: y, anchor: anchor,
      rot: 0, skew: 0,
      drift: [0, 0, 0, -R(r, 0.6, 2.2) * c.sp],       // a slow lift, nothing more
      scale: [1, 1],
      pinA: stairPin,
      pinB: stairPin,
      frozen: true,                                   // set at birth, then left alone
      wordMode: P(r, ['cascade', 'slide']),
      stagger: R(r, 0.03, 0.09)
    };
  };

  /* Camera: the text is nailed to a world that stretches off to the right, and
     the camera dollies along it. Nothing moves of its own accord — what you see
     travelling is the viewpoint. The stage places these by world coordinate,
     so x is filled in there rather than here. */

  L.camera = function (c) {
    var r = c.rnd;
    var pin = pinTilt(r, c.pinBias * R(r, 0.8, 1.5));
    return {
      size: R(r, 7, 12) * c.sizeBias,
      x: 50, y: R(r, 30, 70), anchor: 'c',
      rot: R(r, -7, 7) * c.rotBias,
      skew: R(r, -4, 4) * c.rotBias,
      drift: [0, 0, 0, 0],          // stationary in world space, by definition
      scale: [1, 1],
      pinA: pin,
      pinB: pin,
      frozen: true,
      world: true,
      wordMode: P(r, ['cascade', 'pop', 'slide']),
      stagger: R(r, 0.03, 0.09)
    };
  };

  /* Tunnel: the song becomes a corridor and the viewer flies down it.
     Every line is a solid slab of type standing at a fixed point in depth —
     some painted on the left wall, some on the right, some square across the
     way, a few on the floor and ceiling. Nothing slides; what moves is you.

     The walls are turned about 55-65 degrees rather than a flat 90, because at
     a right angle a line is edge-on and unreadable until you are level with it.
     This keeps the corridor legible the whole way in. */

  var WALLS = ['left', 'center', 'right', 'center', 'left', 'ceil', 'right', 'floor'];

  L.tunnel = function (c) {
    var r = c.rnd;
    var wall = WALLS[c.index % WALLS.length];
    if (r() < 0.18) wall = 'center';               // break the rhythm now and then

    var offX = 0, offY = 0, yaw = 0, pitch = 0;
    if (wall === 'left') {
      offX = -R(r, 0.26, 0.36);
      yaw = R(r, 52, 66);
      offY = R(r, -0.14, 0.14);
    } else if (wall === 'right') {
      offX = R(r, 0.26, 0.36);
      yaw = -R(r, 52, 66);
      offY = R(r, -0.14, 0.14);
    } else if (wall === 'floor') {
      offY = R(r, 0.20, 0.30);
      pitch = -R(r, 38, 52);
      offX = R(r, -0.12, 0.12);
    } else if (wall === 'ceil') {
      offY = -R(r, 0.20, 0.30);
      pitch = R(r, 38, 52);
      offX = R(r, -0.12, 0.12);
    } else {
      offX = R(r, -0.10, 0.10);
      offY = R(r, -0.12, 0.12);
      yaw = R(r, -10, 10) * c.rotBias;
      pitch = R(r, -6, 6) * c.rotBias;
    }

    return {
      // Perspective does the shrinking, so these start larger than elsewhere.
      size: (wall === 'center' ? R(r, 8, 13) : R(r, 9, 14)) * c.sizeBias,
      x: 50, y: 50, anchor: 'c',
      rot: 0, skew: 0,
      drift: [0, 0, 0, 0],
      scale: [1, 1],
      pinA: MT.ZERO_PIN,          // real 3D here, so the power pin stays out of it
      pinB: MT.ZERO_PIN,
      frozen: true,
      tunnel: {
        wall: wall,
        offX: offX, offY: offY,
        yaw: yaw, pitch: pitch,
        roll: R(r, -4, 4) * c.rotBias
      },
      wordMode: r() < 0.55 ? 'depth' : P(r, ['cascade', 'pop']),
      stagger: R(r, 0.03, 0.1)
    };
  };

  MT.LAYOUTS = L;

  function weightedPick(rnd, table, avoid) {
    var keys = Object.keys(table), total = 0, i;
    var w = keys.map(function (k) {
      var v = table[k];
      if (k === avoid) v *= 0.25;   // avoid repeating the same move back to back
      total += v;
      return v;
    });
    var x = rnd() * total;
    for (i = 0; i < keys.length; i++) { x -= w[i]; if (x <= 0) return keys[i]; }
    return keys[keys.length - 1];
  }

  /**
   * Build a spec for one timeline line.
   * ctx: { seed, line, vibe, cfg, recent:[{y,h}], last }
   */
  MT.makeSpec = function (ctx) {
    var v = MT.VIBES[ctx.vibe] || MT.VIBES.edit;
    var line = ctx.line;
    var rnd = MT.rng(MT.hash(ctx.seed + '#' + line.i));
    var mode = ctx.cfg.mode;
    var name = mode === 'flyby' ? 'flyby'
      : mode === 'stair' ? 'stair'
      : mode === 'camera' ? 'camera'
      : mode === 'tunnel' ? 'tunnel'
      : weightedPick(rnd, v.layouts, ctx.last);
    var energy = (ctx.cfg.energy != null) ? ctx.cfg.energy : v.energy;

    var c = {
      rnd: rnd,
      words: line.words.length,
      part: line.part || 0,
      parts: line.parts || 1,
      index: line.i,
      // The stack has exactly as many steps as there are lines allowed on screen,
      // so consecutive entries never land on top of each other.
      steps: Math.round(MT.clamp(ctx.cfg.maxLines, 2, 4)),
      // scatter cells are seeded from the parent line so its pieces stay together
      cellSeed: MT.hash(ctx.seed + '/' + (line.parent != null ? line.parent : line.i)) % CELLS.length,
      // drift distance follows how fast the words arrive — the "subtitle speed" rule
      sp: MT.clamp(line.cps / 9, 0.42, 2.1) * (0.6 + energy * 0.8) * ctx.cfg.motion,
      sizeBias: v.sizeBias * ctx.cfg.scale,
      rotBias: v.rotBias * ctx.cfg.rotation,
      pinBias: v.pinBias * ctx.cfg.perspective,
      recent: ctx.recent || []
    };

    var spec = (L[name] || L.bigCenter)(c);

    // Long lines must not run off the stage.
    var lenPenalty = Math.pow(Math.max(8, ctx.line.text.length) / 18, 0.62);
    spec.size = MT.clamp(spec.size / lenPenalty, 2.6, 26);
    spec.stagger *= MT.clamp(1.4 - energy * 0.6, 0.5, 1.4);
    spec.name = name;
    return spec;
  };
})(window.MT);
