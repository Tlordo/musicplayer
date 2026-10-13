/* musetext :: util.js — no build step, classic script, global MT namespace */
window.MT = window.MT || {};
(function (MT) {
  'use strict';

  MT.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  MT.lerp = function (a, b, t) { return a + (b - a) * t; };
  MT.inv = function (v, a, b) { return b === a ? 0 : (v - a) / (b - a); };

  // deterministic 32-bit string hash
  MT.hash = function (str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  };

  // seeded PRNG — same track always renders the same edit
  MT.rng = function (seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  MT.pick = function (rnd, arr) { return arr[Math.floor(rnd() * arr.length) % arr.length]; };
  MT.range = function (rnd, a, b) { return a + rnd() * (b - a); };

  // easings
  MT.ease = {
    linear: function (t) { return t; },
    outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    outQuint: function (t) { return 1 - Math.pow(1 - t, 5); },
    outExpo: function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); },
    inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    outBack: function (t) {
      var c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
  };

  MT.fmtTime = function (sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  };

  MT.el = function (tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  };

  /* Phones and weak tablets cannot afford per-frame filters, blend modes and a
     layer per word. Touch is the tell; a two-core machine gets the same deal. */
  MT.LITE_DEVICE = (function () {
    try {
      var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      return !!coarse || (navigator.hardwareConcurrency || 8) <= 2;
    } catch (e) { return false; }
  })();

  MT.isLite = function (cfg) {
    var p = cfg && cfg.perf;
    if (p === 'lite') return true;
    if (p === 'full') return false;
    return MT.LITE_DEVICE;
  };

  /** Write a style only when it actually changes; repeated writes still cost a recalc. */
  MT.setStyle = function (el, prop, val) {
    var c = el._mtStyle || (el._mtStyle = {});
    if (c[prop] === val) return;
    c[prop] = val;
    el.style[prop] = val;
  };

  MT.hasCyrillic =function (s) { return /[Ѐ-ӿ]/.test(s || ''); };

  /* Annotations that are packaging rather than part of the song's name. Words
     that actually change the recording — remix, cover, acoustic, live version —
     are deliberately absent, because dropping them would match the wrong take. */
  var JUNK = /\b(official|lyrics?|audio|video|visuali[sz]er|m\/?v|hd|4k|hq|full (?:song|version)|sped\s?-?\s?up|speed\s?up|slowed|reverb|nightcore|extended|radio edit|clean|explicit|remaster(?:ed)?|bonus|deluxe|anniversary|edition|free download|out now|prod\.?|feat\.?|ft\.?|colou?r coded)\b/i;

  MT.cleanTitle = function (t) {
    var s = String(t || '');
    // Names left behind by download sites, which are very common in a drop folder.
    s = s.replace(/^\s*(?:y2?mate|ssyoutube|savefrom|yt1s|snaptube|4kdownload|tubidy)[\s._-]*(?:com)?[\s._-]*/i, '');
    s = s.replace(/[\s._-]*\b(?:\d{3,4}p|hd|fhd|uhd|60fps|mp3|m4a|webm)\b\s*$/i, '');
    s = s.replace(/[_]+/g, ' ');
    s = s.replace(/^\s*\d{1,2}\s*[.\-)]\s+/, '');            // leading track number
    // Drop a bracketed group only when it reads as an annotation.
    s = s.replace(/\s*[\(\[\{]([^)\]\}]*)[\)\]\}]/g, function (m, inner) {
      return JUNK.test(inner) ? ' ' : m;
    });
    s = s.replace(/\s*[-–—]\s*(?:official|lyrics?|audio|video|hd|4k|remaster(?:ed)?|radio edit|sped\s?-?\s?up|slowed)\b.*$/i, '');
    return s.replace(/\s{2,}/g, ' ').trim();
  };
  MT.cleanArtist = function (a) {
    return (a || '')
      .split(/\s*(?:,|;|\/|\bfeat\.?\b|\bft\.?\b|\bx\b|&)\s*/i)[0]
      .trim();
  };
})(window.MT);
