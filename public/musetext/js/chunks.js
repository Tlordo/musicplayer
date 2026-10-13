/* musetext :: chunks.js — cut a lyric line into fragments.
   The flyby mode does not put a whole line in one place: it drops two or three
   pieces of it in different corners of the frame, each with its own entrance.
   A fragment carries the same shape as a timeline line, so the stage never has
   to know the difference. */
window.MT = window.MT || {};
(function (MT) {
  'use strict';

  // Punctuation is the best place to cut: it is where the singer breathes.
  var BREAK = /[,.!?;:…—–-]$/;

  function countChars(words, a, b) {
    var n = 0;
    for (var i = a; i < b; i++) n += words[i].text.length;
    return n;
  }

  /** How many pieces this line should become. */
  function partCount(line, want) {
    var w = line.words.length;
    var chars = line.chars;
    if (want === 'off') return 1;
    if (w < 4 || chars < 14) return 1;              // too short to read as two
    if (want === '2') return 2;
    if (want === '3') return w >= 6 ? 3 : 2;
    // auto
    if (w >= 9 && chars >= 34) return 3;
    if (w >= 4 && chars >= 14) return 2;
    return 1;
  }

  /**
   * Pick n-1 word indices to cut at, preferring a word that ends on
   * punctuation within a couple of words of the even split.
   */
  function cutPoints(words, n) {
    var cuts = [];
    for (var k = 1; k < n; k++) {
      var ideal = Math.round(words.length * k / n);
      var best = ideal, bestScore = -1;
      for (var d = -2; d <= 2; d++) {
        var at = ideal + d;
        if (at <= 0 || at >= words.length) continue;
        if (cuts.indexOf(at) !== -1) continue;
        // a cut at `at` means the previous word is words[at-1]
        var score = 3 - Math.abs(d);
        if (BREAK.test(words[at - 1].text)) score += 6;
        if (score > bestScore) { bestScore = score; best = at; }
      }
      cuts.push(best);
    }
    cuts.sort(function (a, b) { return a - b; });
    return cuts;
  }

  /**
   * Split a built timeline into fragments.
   * `want` is 'auto' | 'off' | '2' | '3'.
   * Each fragment keeps a stable global index so its layout stays seeded.
   */
  /**
   * Drop bracketed backing vocals from a line. Returns null when nothing but
   * the brackets was there, so the whole line can be skipped.
   */
  function stripParens(line) {
    var kept = line.words.filter(function (w) { return !w.paren; });
    if (!kept.length) return null;
    if (kept.length === line.words.length) return line;

    var words = kept.map(function (w, j) {
      return { text: w.text, start: w.start, end: w.end, i: j, paren: false };
    });
    var chars = words.reduce(function (n, w) { return n + w.text.length; }, 0);
    return Object.assign({}, line, {
      words: words,
      text: words.map(function (w) { return w.text; }).join(' '),
      chars: chars,
      cps: chars / Math.max(0.3, line.dur)
    });
  }

  MT.chunkTimeline = function (tl, want, parens) {
    var out = [], idx = 0;

    for (var li = 0; li < tl.length; li++) {
      var line = tl[li];
      if (parens === 'hide') {
        line = stripParens(line);
        if (!line) continue;
      }
      var n = partCount(line, want);

      if (n <= 1) {
        out.push(Object.assign({}, line, { i: idx++, parent: line.i, part: 0, parts: 1 }));
        continue;
      }

      var cuts = cutPoints(line.words, n);
      var bounds = [0].concat(cuts, [line.words.length]);

      for (var p = 0; p + 1 < bounds.length; p++) {
        var a = bounds[p], b = bounds[p + 1];
        if (b <= a) continue;
        var words = line.words.slice(a, b).map(function (w, j) {
          return { text: w.text, start: w.start, end: w.end, i: j, paren: !!w.paren };
        });
        var start = words[0].start;
        var end = (p + 1 < bounds.length - 1) ? line.words[b].start : line.end;
        end = Math.max(start + 0.35, end);
        var chars = countChars(line.words, a, b);

        out.push({
          i: idx++,
          parent: line.i,
          part: p,
          parts: bounds.length - 1,
          start: start,
          end: end,
          dur: end - start,
          text: words.map(function (w) { return w.text; }).join(' '),
          words: words,
          chars: chars,
          wps: words.length / Math.max(0.3, end - start),
          cps: chars / Math.max(0.3, end - start)
        });
      }
    }
    return out;
  };

  /* ------------------------------------------------------------- vocals */

  var LAUGH = /(?:х[аоеи]){2,}|(?:ha){2,}|(?:he){2,}|(?:hi){2,}|(?:ах){2,}|(?:ой){2,}/i;
  var ANNOTATION = /[\[(]([^\])]*)[\])]/;
  var ANNOTATION_WORDS = /смех|смеётся|смеется|laugh|giggl|vocal|ad-?lib|скэт|scat|шёпот|шепот|whisper|крик|scream/i;
  var LONG_VOWEL = /([аеёиоуыэюяaeiouy])\1{2,}/i;

  /**
   * How much a fragment reads as a non-verbal moment — laughter, a held vowel,
   * a bracketed stage direction. Drives the shake in flyby mode when there is
   * no audio to measure, and adds to it when there is.
   */
  MT.vocalIntensity = function (text) {
    var s = String(text || '');
    if (!s) return 0;
    var v = 0;

    var ann = s.match(ANNOTATION);
    if (ann && ANNOTATION_WORDS.test(ann[1])) v = Math.max(v, 1);

    if (LAUGH.test(s.replace(/[\s\-]/g, ''))) v = Math.max(v, 0.85);
    if (LONG_VOWEL.test(s)) v = Math.max(v, 0.55);

    // a short fragment made of one repeated syllable
    var letters = s.replace(/[^\p{L}]/gu, '').toLowerCase();
    if (letters.length >= 4 && letters.length <= 12) {
      var syl = letters.slice(0, 2);
      var reps = 0;
      for (var i = 0; i + 1 < letters.length; i += 2) if (letters.slice(i, i + 2) === syl) reps++;
      if (reps >= 3) v = Math.max(v, 0.7);
    }

    if (/!{2,}/.test(s)) v = Math.max(v, 0.35);
    return v;
  };
})(window.MT);
