/* musetext :: powerpin.js
   AE "CC Power Pin" equivalent: a projective (homography) transform that maps the
   four corners of an element to four arbitrary points, emitted as a CSS matrix3d.
   Requires transform-origin: 0 0 on the target. */
window.MT = window.MT || {};
(function (MT) {
  'use strict';

  function adj(m) { // adjugate of 3x3
    return [
      m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
      m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
      m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]
    ];
  }
  function mul(a, b) { // 3x3 * 3x3
    var c = [];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
      var s = 0;
      for (var k = 0; k < 3; k++) s += a[3 * i + k] * b[3 * k + j];
      c[3 * i + j] = s;
    }
    return c;
  }
  function mulv(m, v) {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
    ];
  }
  function basis(p) { // p = [x1,y1,x2,y2,x3,y3,x4,y4]
    var m = [p[0], p[2], p[4], p[1], p[3], p[5], 1, 1, 1];
    var v = mulv(adj(m), [p[6], p[7], 1]);
    return mul(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
  }

  /** src/dst: flat arrays of 4 corner points (TL, TR, BR, BL). */
  MT.homography = function (src, dst) {
    return mul(basis(dst), adj(basis(src)));
  };

  /** Corner-pin an element of size w x h to `dst` corners; returns a matrix3d() string. */
  MT.pinMatrix = function (w, h, dst) {
    if (w <= 0 || h <= 0) return 'none';
    var m = MT.homography([0, 0, w, 0, w, h, 0, h], dst);
    for (var i = 0; i < 9; i++) m[i] = m[i] / m[8];
    var t = [
      m[0], m[3], 0, m[6],
      m[1], m[4], 0, m[7],
      0, 0, 1, 0,
      m[2], m[5], 0, 1
    ];
    return 'matrix3d(' + t.map(function (v) { return v.toFixed(6); }).join(',') + ')';
  };

  /** Pin described as fractional offsets per corner: [[dx,dy] x4] in units of w / h. */
  MT.pinFromOffsets = function (w, h, off) {
    var base = [[0, 0], [w, 0], [w, h], [0, h]], dst = [];
    for (var i = 0; i < 4; i++) {
      dst.push(base[i][0] + off[i][0] * w, base[i][1] + off[i][1] * h);
    }
    return MT.pinMatrix(w, h, dst);
  };

  MT.lerpOffsets = function (a, b, t) {
    var o = [];
    for (var i = 0; i < 4; i++) {
      o.push([a[i][0] + (b[i][0] - a[i][0]) * t, a[i][1] + (b[i][1] - a[i][1]) * t]);
    }
    return o;
  };

  MT.ZERO_PIN = [[0, 0], [0, 0], [0, 0], [0, 0]];
})(window.MT);
