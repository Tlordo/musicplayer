/* musetext :: tags.js — read artist/title/album straight out of an audio file.
   A file name is a guess; a tag is what the track actually says it is, and the
   lyric lookup is only as good as the metadata it starts from.
   Handles ID3v2 (mp3), MP4/M4A, FLAC and Ogg/Opus with no dependencies. */
window.MT = window.MT || {};
(function (MT) {
  'use strict';

  function readSlice(file, start, length) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(new DataView(r.result)); };
      r.onerror = function () { reject(r.error); };
      r.readAsArrayBuffer(file.slice(start, Math.min(file.size, start + length)));
    });
  }

  function ascii(dv, at, len) {
    var s = '';
    for (var i = 0; i < len && at + i < dv.byteLength; i++) {
      s += String.fromCharCode(dv.getUint8(at + i));
    }
    return s;
  }

  function bytes(dv, at, len) {
    var end = Math.min(dv.byteLength, at + len);
    var out = new Uint8Array(Math.max(0, end - at));
    for (var i = 0; i < out.length; i++) out[i] = dv.getUint8(at + i);
    return out;
  }

  function decode(buf, enc) {
    try {
      return new TextDecoder(enc || 'utf-8').decode(buf).replace(/\0+$/, '').trim();
    } catch (e) {
      var s = '';
      for (var i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
      return s.replace(/\0+$/, '').trim();
    }
  }

  /* ---------------------------------------------------------------- ID3v2 */

  function id3TextEncoding(b) {
    return b === 1 ? 'utf-16' : b === 2 ? 'utf-16be' : b === 3 ? 'utf-8' : 'iso-8859-1';
  }

  function synchsafe(dv, at) {
    return (dv.getUint8(at) << 21) | (dv.getUint8(at + 1) << 14) |
           (dv.getUint8(at + 2) << 7) | dv.getUint8(at + 3);
  }

  /** APIC: encoding, MIME (null-terminated ascii), type byte, description, data. */
  function parseApic(dv, at, len) {
    var enc = dv.getUint8(at);
    var p = at + 1;
    var mime = '';
    while (p < at + len && dv.getUint8(p) !== 0) { mime += String.fromCharCode(dv.getUint8(p)); p++; }
    p++;                                   // MIME terminator
    p++;                                   // picture type
    // Description, terminated by one null byte or two for the UTF-16 encodings.
    if (enc === 1 || enc === 2) {
      while (p + 1 < at + len && !(dv.getUint8(p) === 0 && dv.getUint8(p + 1) === 0)) p += 2;
      p += 2;
    } else {
      while (p < at + len && dv.getUint8(p) !== 0) p++;
      p++;
    }
    var dataLen = at + len - p;
    if (dataLen <= 0) return null;
    if (mime === 'PNG') mime = 'image/png';
    if (mime === 'JPG') mime = 'image/jpeg';
    return { mime: mime || 'image/jpeg', data: bytes(dv, p, dataLen) };
  }

  function parseId3(dv) {
    var version = dv.getUint8(3);
    var size = synchsafe(dv, 6);
    var out = {};
    var want = { TIT2: 'title', TPE1: 'artist', TALB: 'album', TPE2: 'albumArtist' };
    var at = 10;
    var end = Math.min(dv.byteLength, 10 + size);

    // An extended header, when present, sits before the first frame.
    if (dv.getUint8(5) & 0x40) {
      at += version >= 4 ? synchsafe(dv, at) : dv.getUint32(at) + 4;
    }

    while (at + 10 <= end) {
      var id = ascii(dv, at, 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;          // padding or garbage
      var fsize = version >= 4 ? synchsafe(dv, at + 4) : dv.getUint32(at + 4);
      if (fsize <= 0 || at + 10 + fsize > end) break;

      if (want[id]) {
        var enc = id3TextEncoding(dv.getUint8(at + 10));
        out[want[id]] = decode(bytes(dv, at + 11, fsize - 1), enc);
      } else if (id === 'APIC' && !out.cover) {
        out.cover = parseApic(dv, at + 10, fsize);
      }
      at += 10 + fsize;
    }
    return out;
  }

  /* --------------------------------------------------------- Vorbis comment */

  /** FLAC PICTURE block, also the payload of a METADATA_BLOCK_PICTURE comment. */
  function parsePictureBlock(dv, at) {
    try {
      at += 4;                                   // picture type
      var mimeLen = dv.getUint32(at); at += 4;
      var mime = ascii(dv, at, mimeLen); at += mimeLen;
      var descLen = dv.getUint32(at); at += 4 + descLen;
      at += 16;                                  // width, height, depth, colours
      var dataLen = dv.getUint32(at); at += 4;
      if (dataLen <= 0 || at + dataLen > dv.byteLength) return null;
      return { mime: mime || 'image/jpeg', data: bytes(dv, at, dataLen) };
    } catch (e) {
      return null;
    }
  }

  function base64ToView(b64) {
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new DataView(arr.buffer);
  }

  function parseVorbisComment(dv, at) {
    var out = {};
    var want = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', ALBUMARTIST: 'albumArtist' };
    var vendorLen = dv.getUint32(at, true);
    at += 4 + vendorLen;
    var count = dv.getUint32(at, true);
    at += 4;
    for (var i = 0; i < count && at + 4 <= dv.byteLength; i++) {
      var len = dv.getUint32(at, true);
      at += 4;
      var entry = decode(bytes(dv, at, len), 'utf-8');
      at += len;
      var eq = entry.indexOf('=');
      if (eq > 0) {
        var key = entry.slice(0, eq).toUpperCase();
        if (want[key] && !out[want[key]]) {
          out[want[key]] = entry.slice(eq + 1).trim();
        } else if (key === 'METADATA_BLOCK_PICTURE' && !out.cover) {
          try { out.cover = parsePictureBlock(base64ToView(entry.slice(eq + 1)), 0); } catch (e) { }
        }
      }
    }
    return out;
  }

  function parseFlac(dv) {
    var out = {};
    var at = 4;
    while (at + 4 <= dv.byteLength) {
      var header = dv.getUint8(at);
      var last = (header & 0x80) !== 0;
      var type = header & 0x7f;
      var len = (dv.getUint8(at + 1) << 16) | (dv.getUint8(at + 2) << 8) | dv.getUint8(at + 3);
      at += 4;
      if (type === 4) Object.assign(out, parseVorbisComment(dv, at));
      else if (type === 6 && !out.cover) out.cover = parsePictureBlock(dv, at);
      if (last) break;
      at += len;
    }
    return out;
  }

  function parseOgg(dv) {
    // The comment header is in the second packet. Rather than reassembling
    // pages, find its signature — it is within the first few kilobytes.
    var marks = ['\x03vorbis', 'OpusTags'];
    for (var m = 0; m < marks.length; m++) {
      var sig = marks[m];
      for (var i = 0; i + sig.length < dv.byteLength - 8; i++) {
        if (ascii(dv, i, sig.length) === sig) {
          return parseVorbisComment(dv, i + sig.length);
        }
      }
    }
    return {};
  }

  /* ------------------------------------------------------------------ MP4 */

  var MP4_KEYS = { '\xa9nam': 'title', '\xa9ART': 'artist', '\xa9alb': 'album', 'aART': 'albumArtist' };

  function parseIlst(dv, at, end) {
    var out = {};
    while (at + 8 <= end) {
      var size = dv.getUint32(at);
      var key = ascii(dv, at + 4, 4);
      if (size < 8) break;
      // one child 'data' atom: 4 size, 4 'data', 4 type, 4 locale, then payload
      var dsize = dv.getUint32(at + 8);
      var isData = ascii(dv, at + 12, 4) === 'data' && dsize >= 16;

      if (MP4_KEYS[key] && isData) {
        out[MP4_KEYS[key]] = decode(bytes(dv, at + 24, dsize - 16), 'utf-8');
      } else if (key === 'covr' && isData && !out.cover) {
        // data type 13 is jpeg, 14 is png
        var kind = dv.getUint32(at + 16) & 0xffffff;
        out.cover = {
          mime: kind === 14 ? 'image/png' : 'image/jpeg',
          data: bytes(dv, at + 24, dsize - 16)
        };
      }
      at += size;
    }
    return out;
  }

  /** Walk the atom tree down to moov > udta > meta > ilst. */
  function findIlst(dv, at, end, depth) {
    while (at + 8 <= end) {
      var size = dv.getUint32(at);
      var type = ascii(dv, at + 4, 4);
      if (size < 8) return null;
      var childStart = at + 8;
      if (type === 'ilst') return parseIlst(dv, childStart, Math.min(end, at + size));
      if (type === 'meta') childStart += 4;            // version + flags
      if (type === 'moov' || type === 'udta' || type === 'meta') {
        var hit = findIlst(dv, childStart, Math.min(end, at + size), depth + 1);
        if (hit) return hit;
      }
      at += size;
    }
    return null;
  }

  async function parseMp4(file) {
    // moov can sit at either end of the file, so locate it by walking the
    // top-level atoms instead of assuming it is near the start.
    var at = 0;
    for (var guard = 0; guard < 64 && at + 8 <= file.size; guard++) {
      var head = await readSlice(file, at, 16);
      if (head.byteLength < 8) break;
      var size = head.getUint32(0);
      var type = ascii(head, 4, 4);
      if (size === 1) {
        // 64-bit size: high word first, then low
        size = head.getUint32(8) * 4294967296 + head.getUint32(12);
      }
      if (size < 8) break;
      if (type === 'moov') {
        var moov = await readSlice(file, at, Math.min(size, 4 * 1024 * 1024));
        return findIlst(moov, 8, moov.byteLength, 0) || {};
      }
      at += size;
    }
    return {};
  }

  /* ---------------------------------------------------------------- entry */

  /**
   * Best-effort tag read. Resolves to {title, artist, album} with whatever was
   * found; never rejects, because a missing tag just means we fall back to the
   * file name.
   */
  /** Turn an extracted picture into a blob URL, or null. Caller revokes it. */
  MT.coverUrl = function (cover) {
    if (!cover || !cover.data || !cover.data.length) return null;
    try {
      return URL.createObjectURL(new Blob([cover.data], { type: cover.mime || 'image/jpeg' }));
    } catch (e) {
      return null;
    }
  };

  MT.readTags = async function (file) {
    try {
      // Generous, because an embedded cover easily runs past a few hundred KB.
      var head = await readSlice(file, 0, 1024 * 1024);
      if (head.byteLength < 12) return {};

      if (ascii(head, 0, 3) === 'ID3') return parseId3(head);
      if (ascii(head, 0, 4) === 'fLaC') return parseFlac(head);
      if (ascii(head, 0, 4) === 'OggS') return parseOgg(head);
      if (ascii(head, 4, 4) === 'ftyp') return await parseMp4(file);
      return {};
    } catch (e) {
      return {};
    }
  };
})(window.MT);
