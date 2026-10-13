/* musetext :: themes.js — font/palette "vibes" and the heuristic that picks one */
window.MT = window.MT || {};
(function (MT) {
  'use strict';

  // Families marked user:true only resolve if the user dropped the file into fonts/user/.
  MT.FONTS = {
    stalinist: { css: "'Stalinist One'", weight: 400, upper: true, tracking: 0.00, squash: 1.00 },
    unbounded: { css: "'Unbounded'", weight: 900, upper: true, tracking: -0.02, squash: 1.00 },
    oswald:    { css: "'Oswald'", weight: 700, upper: true, tracking: 0.01, squash: 1.00 },
    jetbrains: { css: "'JetBrains Mono'", weight: 800, upper: false, tracking: -0.03, squash: 1.00 },
    tiny5:     { css: "'Tiny5'", weight: 400, upper: true, tracking: 0.02, squash: 1.00 },
    bartle:    { css: "'BBH Bartle'", weight: 400, upper: true, tracking: 0.00, squash: 1.00, user: true },
    druk:      { css: "'Druk'", weight: 900, upper: true, tracking: -0.01, squash: 1.00, user: true }
  };

  MT.PALETTES = {
    mono:    ['#ffffff'],
    blood:   ['#ff1e1e', '#ffffff', '#7a0000'],
    acid:    ['#c6ff00', '#00e5ff', '#ff00d4'],
    y2k:     ['#00ffe0', '#ff5bf0', '#fffb00', '#ffffff'],
    ember:   ['#ff6a00', '#ffd400', '#ff0043'],
    cold:    ['#5ce1ff', '#ffffff', '#2b6cff'],
    vhs:     ['#ff2e63', '#08d9d6', '#eaeaea']
  };

  /* Each vibe is a full look: font, motion energy, which layouts it favours,
     and the default effect mix. */
  MT.VIBES = {
    brutal: {
      label: 'Brutal',
      font: 'stalinist', fallback: 'unbounded',
      palette: 'blood',
      energy: 0.55, sizeBias: 1.25, rotBias: 0.5, pinBias: 1.0,
      layouts: { bigCenter: 4, bleedLeft: 3, diagonal: 2, perspectiveRun: 2, stackDrift: 2 },
      fx: { flash: 0.35, shake: 0.35, chroma: 0.1, invert: 0.12, zoom: 0.5, grain: 0.35, scan: 0 }
    },
    edit: {
      label: 'Edit (AE)',
      font: 'oswald', fallback: 'unbounded',
      palette: 'mono',
      energy: 0.75, sizeBias: 1.1, rotBias: 1.25, pinBias: 1.35,
      layouts: { diagonal: 5, perspectiveRun: 4, bleedLeft: 3, bigCenter: 2, sweep: 3, stackDrift: 2 },
      fx: { flash: 0.3, shake: 0.45, chroma: 0.2, invert: 0.15, zoom: 0.6, grain: 0.25, scan: 0 }
    },
    hyper: {
      label: 'Hyperpop',
      font: 'unbounded', fallback: 'oswald',
      palette: 'y2k',
      energy: 1.0, sizeBias: 1.0, rotBias: 1.4, pinBias: 1.2,
      layouts: { sweep: 4, diagonal: 4, scatter: 4, bigCenter: 2, perspectiveRun: 2 },
      fx: { flash: 0.8, shake: 0.6, chroma: 0.45, invert: 0.3, zoom: 0.8, grain: 0.2, scan: 0.15 }
    },
    tech: {
      label: 'Tech',
      font: 'jetbrains', fallback: 'jetbrains',
      palette: 'cold',
      energy: 0.6, sizeBias: 0.72, rotBias: 0.35, pinBias: 0.8,
      layouts: { stackDrift: 5, bleedLeft: 3, sweep: 2, perspectiveRun: 2, bigCenter: 1 },
      fx: { flash: 0.2, shake: 0.2, chroma: 0.5, invert: 0.1, zoom: 0.25, grain: 0.4, scan: 0.5 }
    },
    pixel: {
      label: 'Pixel',
      font: 'tiny5', fallback: 'jetbrains',
      palette: 'acid',
      energy: 0.85, sizeBias: 0.95, rotBias: 0.6, pinBias: 0.7,
      layouts: { stackDrift: 4, sweep: 3, scatter: 3, bigCenter: 2, diagonal: 2 },
      fx: { flash: 0.55, shake: 0.35, chroma: 0.15, invert: 0.25, zoom: 0.5, grain: 0.15, scan: 0.6 }
    },
    dream: {
      label: 'Dream',
      font: 'unbounded', fallback: 'oswald',
      palette: 'vhs',
      energy: 0.3, sizeBias: 1.15, rotBias: 0.6, pinBias: 1.1,
      layouts: { bigCenter: 4, perspectiveRun: 3, bleedLeft: 3, stackDrift: 2 },
      fx: { flash: 0.18, shake: 0.12, chroma: 0.3, invert: 0.05, zoom: 0.35, grain: 0.5, scan: 0.1 }
    },
    raw: {
      label: 'Raw',
      font: 'bartle', fallback: 'oswald',
      palette: 'ember',
      energy: 0.7, sizeBias: 1.15, rotBias: 1.0, pinBias: 1.15,
      layouts: { bleedLeft: 4, diagonal: 3, bigCenter: 3, scatter: 2, perspectiveRun: 2 },
      fx: { flash: 0.45, shake: 0.4, chroma: 0.2, invert: 0.2, zoom: 0.55, grain: 0.45, scan: 0 }
    }
  };

  MT.VIBE_KEYS = Object.keys(MT.VIBES);

  /* document.fonts.check() answers "is there a rule for this family", not "did
     the file load", so a missing user font would pass. Probe by actually loading
     the face and reading its status. */
  MT._userFontOk = {};

  MT.probeFonts = function () {
    var keys = Object.keys(MT.FONTS).filter(function (k) { return MT.FONTS[k].user; });
    if (!document.fonts) {
      keys.forEach(function (k) { MT._userFontOk[k] = false; });
      return Promise.resolve();
    }
    return Promise.all(keys.map(function (k) {
      var name = MT.FONTS[k].css.replace(/'/g, '');
      return document.fonts.load('40px "' + name + '"', 'AaЖж')
        .then(function (faces) { MT._userFontOk[k] = faces.length > 0; })
        .catch(function () { MT._userFontOk[k] = false; });
    }));
  };

  /** Does a family actually have glyphs we can render? */
  MT.fontAvailable = function (key) {
    var f = MT.FONTS[key];
    if (!f) return false;
    if (!f.user) return true;
    return MT._userFontOk[key] === true;
  };

  MT.resolveFont = function (vibe) {
    var v = MT.VIBES[vibe] || MT.VIBES.edit;
    var key = MT.fontAvailable(v.font) ? v.font : v.fallback;
    return { key: key, spec: MT.FONTS[key] };
  };

  /**
   * Pick a vibe from what we can actually measure: lyric density, line length,
   * how long lines hold, and (when enabled) live audio energy.
   * stats: { cps, wps, avgDur, avgWords, cyrillic, energy }
   */
  MT.autoVibe = function (stats) {
    var s = stats || {};
    var cps = s.cps || 6, avgDur = s.avgDur || 3.5, avgWords = s.avgWords || 5;
    var energy = (typeof s.energy === 'number') ? s.energy : null;

    var score = {
      brutal: 0, edit: 0, hyper: 0, tech: 0, pixel: 0, dream: 0, raw: 0
    };

    // Slow, sparse, long-held lines read as monumental.
    if (avgDur > 4.2) { score.dream += 2; score.brutal += 1.5; }
    if (avgWords <= 4) { score.brutal += 2; score.bigWordish = 0; }
    if (avgWords >= 8) { score.tech += 1.5; score.edit += 1; }

    // Density drives the fast looks.
    if (cps > 11) { score.hyper += 2.5; score.pixel += 1.5; score.tech += 1; }
    else if (cps > 7) { score.edit += 2; score.hyper += 1; }
    else { score.brutal += 1.5; score.dream += 1.5; }

    if (s.cyrillic) { score.brutal += 1.5; score.edit += 1; }
    else { score.tech += 0.75; score.pixel += 0.75; }

    if (energy != null) {
      if (energy > 0.62) { score.hyper += 2; score.raw += 1.5; score.brutal += 1; }
      else if (energy < 0.3) { score.dream += 2; score.tech += 1; }
      else { score.edit += 1.5; }
    } else {
      score.edit += 0.75; // no audio to judge by — the safe general-purpose look
    }

    var best = 'edit', bestVal = -1;
    MT.VIBE_KEYS.forEach(function (k) {
      if (score[k] > bestVal) { bestVal = score[k]; best = k; }
    });
    return best;
  };

  /** Aggregate stats from a built timeline. */
  MT.timelineStats = function (tl) {
    if (!tl || !tl.length) return { cps: 6, wps: 2, avgDur: 3.5, avgWords: 5, cyrillic: false };
    var cps = 0, wps = 0, dur = 0, words = 0, text = '';
    for (var i = 0; i < tl.length; i++) {
      cps += tl[i].cps; wps += tl[i].wps; dur += tl[i].dur; words += tl[i].words.length;
      if (i < 40) text += tl[i].text;
    }
    var n = tl.length;
    return {
      cps: cps / n, wps: wps / n, avgDur: dur / n, avgWords: words / n,
      cyrillic: MT.hasCyrillic(text)
    };
  };
})(window.MT);
