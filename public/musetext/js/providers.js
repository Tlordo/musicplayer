/* musetext :: providers.js — where the words come from.
   Order: local cache -> user-pinned .lrc -> LRCLIB exact -> LRCLIB search ->
   NetEase (desktop only, needs the shell to proxy it) -> plain lyrics fallback.
   Nothing is bundled with the app; every line is fetched at play time. */
window.MT = window.MT || {};
(function (MT) {
  'use strict';

  var CACHE_KEY = 'musetext.lyriccache.v1';
  var CACHE_MAX = 120;

  function bridge() { return window.museBridge || null; }

  /** All network reads go through here so the desktop shell can dodge CORS. */
  async function getText(url, headers) {
    var b = bridge();
    if (b && b.fetchText) return await b.fetchText(url, headers || {});
    var res = await fetch(url, { headers: headers || {} });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  }
  async function getJSON(url, headers) {
    var t = await getText(url, headers);
    return JSON.parse(t);
  }
  MT.getText = getText;
  MT.getJSON = getJSON;

  /* ----------------------------------------------------------------- cache */

  function loadCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveCache(c) {
    try {
      var keys = Object.keys(c);
      if (keys.length > CACHE_MAX) {
        keys.sort(function (a, b) { return (c[a].at || 0) - (c[b].at || 0); });
        keys.slice(0, keys.length - CACHE_MAX).forEach(function (k) { delete c[k]; });
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch (e) { /* private mode / quota — cache is a nicety, not a requirement */ }
  }
  MT.cacheKey = function (tr) {
    return (MT.cleanArtist(tr.artist) + '|' + MT.cleanTitle(tr.title) + '|' + Math.round(tr.duration || 0))
      .toLowerCase();
  };

  /* ------------------------------------------------------------- matching */

  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/[‘’“”]/g, "'")
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function tokens(s) { return norm(s).split(' ').filter(Boolean); }

  function similarity(a, b) {
    var ta = tokens(a), tb = tokens(b);
    if (!ta.length || !tb.length) return 0;
    var set = {}, hit = 0;
    tb.forEach(function (t) { set[t] = 1; });
    ta.forEach(function (t) { if (set[t]) hit++; });
    return hit / Math.max(ta.length, tb.length);
  }

  function scoreCandidate(c, tr) {
    // Compare against both the raw and the cleaned metadata: a filename may be
    // messy, but a tag may equally be the thing that is closer to the truth.
    var titleSim = Math.max(similarity(c.trackName, tr.title),
                            similarity(c.trackName, MT.cleanTitle(tr.title)));
    var artistSim = Math.max(similarity(c.artistName, tr.artist),
                             similarity(c.artistName, MT.cleanArtist(tr.artist)));
    var s = titleSim * 2 + artistSim * 1.5;
    if (tr.duration && c.duration) {
      var d = Math.abs(c.duration - tr.duration);
      s += d < 2 ? 1.5 : d < 6 ? 0.8 : d < 15 ? 0.1 : -1.2;
    }
    // The whole app is built on word timing, so a synced hit is worth much more
    // than a slightly better name match with no timestamps at all.
    if (c.syncedLyrics) s += 3;
    if (c.instrumental) s -= 2;
    return s;
  }

  /* ------------------------------------------------------------- LRCLIB */

  var lrclib = {
    id: 'lrclib',
    label: 'LRCLIB',
    async exact(tr) {
      var q = 'artist_name=' + encodeURIComponent(MT.cleanArtist(tr.artist)) +
              '&track_name=' + encodeURIComponent(MT.cleanTitle(tr.title));
      if (tr.album) q += '&album_name=' + encodeURIComponent(tr.album);
      if (tr.duration) q += '&duration=' + Math.round(tr.duration);
      var j = await getJSON('https://lrclib.net/api/get?' + q);
      return j && (j.syncedLyrics || j.plainLyrics) ? j : null;
    },
    /**
     * Metadata reaches us in whatever shape the player or the file name had, so
     * one query is not enough. Try several readings of the same track — cleaned,
     * raw, title only, and artist/title swapped in case the file was named the
     * other way round — and keep the best-scoring hit across all of them.
     */
    async search(tr) {
      var A = MT.cleanArtist(tr.artist), T = MT.cleanTitle(tr.title);
      var Araw = String(tr.artist || '').trim(), Traw = String(tr.title || '').trim();

      var queries = [];
      function add(params) {
        var qs = Object.keys(params)
          .filter(function (k) { return params[k]; })
          .map(function (k) { return k + '=' + encodeURIComponent(params[k]); })
          .join('&');
        if (qs && queries.indexOf(qs) === -1) queries.push(qs);
      }
      add({ track_name: T, artist_name: A });
      if (Araw && Araw !== A) add({ track_name: T, artist_name: Araw });
      add({ track_name: T });
      add({ q: (A + ' ' + T).trim() });
      if (Traw !== T) add({ q: Traw });
      add({ q: T });
      if (Araw && Traw) add({ track_name: Araw, artist_name: Traw });   // swapped

      var seen = {}, best = null, bestScore = -Infinity;

      for (var i = 0; i < queries.length; i++) {
        var list;
        try {
          list = await getJSON('https://lrclib.net/api/search?' + queries[i]);
        } catch (e) { continue; }
        if (!Array.isArray(list)) continue;

        for (var j = 0; j < list.length; j++) {
          var c = list[j];
          if (!c || seen[c.id]) continue;
          seen[c.id] = 1;
          if (!c.syncedLyrics && !c.plainLyrics) continue;
          var sc = scoreCandidate(c, tr);
          if (sc > bestScore) { bestScore = sc; best = c; }
        }
        // Stop early only on a synced hit — a well-named plain result would
        // otherwise cut the search short before the timed version is seen.
        if (best && best.syncedLyrics && bestScore >= 4.5) break;
      }

      return bestScore > 1.2 ? best : null;
    },
    async fetch(tr) {
      var hit = null;
      try { hit = await this.exact(tr); } catch (e) { /* 404 is normal here */ }

      // An exact name match with no timestamps is worth less than a searched
      // match that has them, so keep looking unless the exact hit is synced.
      if (!hit || !hit.syncedLyrics) {
        var alt = null;
        try { alt = await this.search(tr); } catch (e) { }
        if (alt && (alt.syncedLyrics || !hit)) hit = alt;
      }
      if (!hit) return null;
      return {
        source: 'LRCLIB',
        synced: hit.syncedLyrics || null,
        plain: hit.plainLyrics || null,
        title: hit.trackName, artist: hit.artistName, duration: hit.duration
      };
    }
  };

  /* ------------------------------------------------------------- NetEase */
  /* Wide catalogue and often word-synced, but the endpoint refuses cross-origin
     requests, so it only runs when the desktop shell can proxy for us. */

  var netease = {
    id: 'netease',
    label: 'NetEase',
    available: function () { var b = bridge(); return !!(b && b.fetchText); },
    async fetch(tr) {
      if (!this.available()) return null;
      var q = encodeURIComponent(MT.cleanArtist(tr.artist) + ' ' + MT.cleanTitle(tr.title));
      var hdr = { 'Referer': 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' };
      var s = await getJSON('https://music.163.com/api/search/get?s=' + q + '&type=1&limit=8&offset=0', hdr);
      var songs = s && s.result && s.result.songs;
      if (!songs || !songs.length) return null;

      var cands = songs.map(function (x) {
        return {
          id: x.id,
          trackName: x.name,
          artistName: (x.artists || []).map(function (a) { return a.name; }).join(', '),
          duration: (x.duration || 0) / 1000,
          syncedLyrics: 1
        };
      });
      cands.sort(function (a, b) { return scoreCandidate(b, tr) - scoreCandidate(a, tr); });
      if (scoreCandidate(cands[0], tr) < 1.0) return null;

      var l = await getJSON('https://music.163.com/api/song/lyric?id=' + cands[0].id + '&lv=1&kv=1&tv=-1', hdr);
      var lrc = l && l.lrc && l.lrc.lyric;
      if (!lrc) return null;
      return {
        source: 'NetEase', synced: lrc, plain: null,
        title: cands[0].trackName, artist: cands[0].artistName, duration: cands[0].duration
      };
    }
  };

  MT.PROVIDERS = [lrclib, netease];

  /**
   * Resolve lyrics for a track.
   * Returns { source, synced, plain, cached } or null. `onStatus` reports progress.
   */
  MT.findLyrics = async function (tr, opts) {
    opts = opts || {};
    var key = MT.cacheKey(tr);
    var cache = loadCache();

    if (!opts.force && cache[key]) {
      var c = cache[key];
      c.at = Date.now(); saveCache(cache);
      return { source: c.source + ' (cached)', synced: c.synced, plain: c.plain, cached: true };
    }

    for (var i = 0; i < MT.PROVIDERS.length; i++) {
      var p = MT.PROVIDERS[i];
      if (opts.disabled && opts.disabled.indexOf(p.id) !== -1) continue;
      if (opts.onStatus) opts.onStatus('Ищу текст: ' + p.label + '…');
      try {
        var r = await p.fetch(tr);
        if (r && (r.synced || r.plain)) {
          cache[key] = { source: r.source, synced: r.synced, plain: r.plain, at: Date.now() };
          saveCache(cache);
          return r;
        }
      } catch (e) {
        if (opts.onStatus) opts.onStatus(p.label + ': ' + e.message);
      }
    }
    return null;
  };

  /* ------------------------------------------------------------- artwork */

  var ART_KEY = 'musetext.artcache.v1';

  /**
   * Cover art for the backdrop. A local file usually carries its own picture;
   * for anything coming off a media session there is nothing to read, so fall
   * back to the iTunes search endpoint, which needs no key and allows any origin.
   * Returns an image URL or null.
   */
  MT.findArtwork = async function (tr) {
    var key = MT.cacheKey(tr);
    var cache;
    try { cache = JSON.parse(localStorage.getItem(ART_KEY) || '{}'); } catch (e) { cache = {}; }
    if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];

    var url = null;
    try {
      var term = encodeURIComponent(
        (MT.cleanArtist(tr.artist) + ' ' + MT.cleanTitle(tr.title)).trim());
      if (term) {
        var j = await getJSON('https://itunes.apple.com/search?term=' + term +
          '&entity=song&limit=5');
        var best = null, bestScore = 0;
        (j.results || []).forEach(function (r) {
          var s = similarity(r.trackName, tr.title) * 2 + similarity(r.artistName, tr.artist);
          if (s > bestScore) { bestScore = s; best = r; }
        });
        if (best && bestScore > 0.9 && best.artworkUrl100) {
          // The thumbnail URL carries its size; ask for a bigger one.
          url = best.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.');
        }
      }
    } catch (e) { /* no art is a normal outcome */ }

    cache[key] = url;
    var keys = Object.keys(cache);
    if (keys.length > 200) delete cache[keys[0]];
    try { localStorage.setItem(ART_KEY, JSON.stringify(cache)); } catch (e) { }
    return url;
  };

  MT.pinLyrics = function (tr, lrcText, label) {
    var cache = loadCache();
    cache[MT.cacheKey(tr)] = {
      source: label || 'Локально', synced: lrcText, plain: null, at: Date.now()
    };
    saveCache(cache);
  };

  MT.forgetLyrics = function (tr) {
    var cache = loadCache();
    delete cache[MT.cacheKey(tr)];
    saveCache(cache);
  };
})(window.MT);
