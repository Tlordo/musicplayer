/* musetext :: lrc.js — LRC / enhanced-LRC parsing and word-level timing */
window.MT = window.MT || {};
(function (MT) {
  'use strict';

  var TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  var WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
  var META = /^\[(ti|ar|al|by|offset|length|re|ve):([^\]]*)\]\s*$/i;

  // A bare leading timestamp, no brackets: "00:07.17 - text", "1:02:33,5 text",
  // "00:07 — text". The separator after it is optional.
  var BARE = /^\s*(?:(\d{1,2}):)?(\d{1,3}):(\d{1,2})(?:[.,](\d{1,3}))?\s*(?:[-–—|>:]+\s*)?(.*)$/;

  // Anything left over that would read as a separator rather than as words.
  var LEAD_SEP = /^[\s\-–—|>:]+/;

  function toSec(m, s, frac) {
    var f = 0;
    if (frac != null) {
      f = parseInt(frac, 10) / Math.pow(10, frac.length);
    }
    return parseInt(m, 10) * 60 + parseInt(s, 10) + f;
  }

  /** Parse an .lrc string. Returns { meta, lines, enhanced }. */
  MT.parseLRC = function (text) {
    var out = { meta: {}, lines: [], enhanced: false };
    if (!text) return out;
    var raw = String(text).replace(/\r/g, '').split('\n');

    // Only read bare "mm:ss - text" timestamps when the file clearly uses that
    // format throughout. Otherwise a lyric that happens to open with a time of
    // day would be mistaken for one.
    var bracketed = 0, bareish = 0;
    for (var s0 = 0; s0 < raw.length; s0++) {
      if (/^\s*\[\d{1,3}:\d{1,2}/.test(raw[s0])) { bracketed++; continue; }
      var probe = raw[s0].match(BARE);
      if (probe && probe[5] && probe[5].trim()) bareish++;
    }
    var allowBare = bracketed === 0 && bareish >= 2;

    for (var i = 0; i < raw.length; i++) {
      var line = raw[i];
      var mm = line.match(META);
      if (mm) { out.meta[mm[1].toLowerCase()] = mm[2].trim(); continue; }

      // Only tags that sit flush at the front count; note that exec() resets
      // lastIndex to 0 once it stops matching, so track the end ourselves.
      TAG.lastIndex = 0;
      var stamps = [], m, end = 0;
      while ((m = TAG.exec(line))) {
        if (m.index !== end) break;
        stamps.push(toSec(m[1], m[2], m[3]));
        end = TAG.lastIndex;
      }
      if (!stamps.length) {
        if (!allowBare) continue;
        // The plain "mm:ss.xx - text" form some sites and editors export.
        var bare = line.match(BARE);
        if (bare && bare[5] && bare[5].trim()) {
          var hh = bare[1] ? parseInt(bare[1], 10) * 3600 : 0;
          stamps.push(hh + toSec(bare[2], bare[3], bare[4]));
          end = line.length - bare[5].length;
        } else {
          continue;
        }
      }

      var body = line.slice(end).replace(LEAD_SEP, '').trim();
      var words = null;

      if (/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/.test(body)) {
        out.enhanced = true;
        WORD_TAG.lastIndex = 0;
        words = [];
        var parts = body.split(WORD_TAG);
        // split() with 3 capture groups yields [text, m, s, frac, text, ...]
        var cursor = (parts[0] || '').trim();
        if (cursor) words.push({ t: stamps[0], text: cursor });
        for (var p = 1; p + 3 <= parts.length - 1; p += 4) {
          if (parts[p] == null) break;
          var wt = toSec(parts[p], parts[p + 1], parts[p + 2]);
          var wtx = (parts[p + 3] || '').trim();
          if (wtx) words.push({ t: wt, text: wtx });
        }
        body = words.map(function (w) { return w.text; }).join(' ');
      }

      if (!body) continue;
      for (var s2 = 0; s2 < stamps.length; s2++) {
        out.lines.push({ t: stamps[s2], text: body, words: words });
      }
    }

    out.lines.sort(function (a, b) { return a.t - b.t; });
    var off = parseFloat(out.meta.offset || '0');
    if (isFinite(off) && off !== 0) {
      var shift = off / 1000;
      out.lines.forEach(function (l) {
        l.t -= shift;
        if (l.words) l.words.forEach(function (w) { w.t -= shift; });
      });
    }
    return out;
  };

  /** Plain (unsynced) lyrics -> evenly spread lines across the track. */
  MT.spreadPlain = function (text, duration) {
    var lines = String(text || '').split('\n').map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length; });
    if (!lines.length) return [];
    var d = (duration && duration > 5) ? duration : lines.length * 3.2;
    var lead = Math.min(6, d * 0.05);
    var step = (d - lead) / lines.length;
    return lines.map(function (s, i) { return { t: lead + i * step, text: s, words: null }; });
  };

  function splitWords(text) {
    return String(text).split(/\s+/).filter(function (w) { return w.length; });
  }

  /**
   * Flag the words that sit inside brackets. Backing vocals and ad-libs are
   * written that way, and they usually want to be quieter than the lead line
   * or gone altogether.
   */
  function markParens(words) {
    var depth = 0;
    for (var i = 0; i < words.length; i++) {
      var t = words[i].text;
      var opens = (t.match(/[(\[]/g) || []).length;
      var closes = (t.match(/[)\]]/g) || []).length;
      var wasOpen = depth > 0;
      depth += opens;
      words[i].paren = wasOpen || opens > 0;
      depth -= closes;
      if (depth < 0) depth = 0;
    }
    return words;
  }

  /**
   * How fast this track is actually sung, in characters per second.
   *
   * A line followed by an instrumental break looks slow if you measure it by
   * the gap to the next line, while a line inside a phrase measures close to
   * the truth. The high end of that distribution is therefore the real rate,
   * so take a high percentile rather than the mean.
   */
  MT.estimateRate = function (lines, duration) {
    var rates = [];
    for (var i = 0; i < lines.length; i++) {
      var next = lines[i + 1];
      var gap = (next ? next.t : duration || 0) - lines[i].t;
      var chars = lines[i].text.replace(/\s/g, '').length;
      if (gap > 0.4 && gap < 12 && chars >= 4) rates.push(chars / gap);
    }
    if (!rates.length) return 12;
    rates.sort(function (a, b) { return a - b; });
    var r = rates[Math.min(rates.length - 1, Math.floor(rates.length * 0.75))];
    return MT.clamp(r, 4, 26);
  };

  /**
   * Turn parsed lines into a playable timeline.
   * Each entry: { i, start, end, dur, text, words:[{text,start,end,i,share}], wps, chars }
   */
  MT.buildTimeline = function (lines, duration, opts) {
    opts = opts || {};
    var maxHold = opts.maxHold || 8;      // a line never lingers longer than this
    var minDur = opts.minDur || 0.45;
    var byTempo = opts.timing !== 'gap';  // 'tempo' and 'audio' both start here
    var rate = byTempo ? MT.estimateRate(lines, duration) : 0;
    var tl = [];

    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var next = lines[i + 1];
      var end;
      if (next) end = next.t;
      else if (duration && duration > l.t) end = Math.min(duration, l.t + maxHold);
      else end = l.t + maxHold;
      end = Math.max(l.t + minDur, Math.min(end, l.t + maxHold));

      // Stop the line where it is actually sung rather than where the next one
      // begins, so a phrase followed by a break is not stretched across it.
      if (byTempo && !(l.words && l.words.length)) {
        var spoken = l.text.replace(/\s/g, '').length / rate * 1.15 + 0.35;
        end = Math.max(l.t + minDur, Math.min(end, l.t + spoken));
      }

      var words = [];
      if (l.words && l.words.length) {
        for (var w = 0; w < l.words.length; w++) {
          var ws = l.words[w].t;
          var we = (w + 1 < l.words.length) ? l.words[w + 1].t : end;
          words.push({ text: l.words[w].text, start: ws, end: Math.max(ws + 0.08, we), i: w });
        }
      } else {
        var toks = splitWords(l.text);
        var weights = toks.map(function (t) { return t.length + 1.6; });
        var total = weights.reduce(function (a, b) { return a + b; }, 0) || 1;
        // Words are dealt out over most of the line so the last one can breathe.
        // With tempo timing the end already sits near the real end of the phrase,
        // so there is less slack to leave.
        var tail = byTempo ? 0.88 : 0.78;
        var span = (end - l.t) * (toks.length > 1 ? tail : 0.5);
        var acc = 0;
        for (var k = 0; k < toks.length; k++) {
          var s = l.t + span * (acc / total);
          acc += weights[k];
          var e = l.t + span * (acc / total);
          words.push({ text: toks[k], start: s, end: Math.max(s + 0.1, e), i: k });
        }
      }

      markParens(words);

      var chars = l.text.replace(/\s/g, '').length;
      tl.push({
        i: i,
        start: l.t,
        end: end,
        dur: end - l.t,
        text: l.text,
        words: words,
        chars: chars,
        wps: words.length / Math.max(0.3, end - l.t),
        cps: chars / Math.max(0.3, end - l.t)
      });
    }
    return tl;
  };

  /** Index of the line active at time t (-1 before the first). */
  MT.lineAt = function (tl, t) {
    var lo = 0, hi = tl.length - 1, res = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (tl[mid].start <= t) { res = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return res;
  };
})(window.MT);
