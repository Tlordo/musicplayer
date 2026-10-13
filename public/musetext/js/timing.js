/* musetext :: timing.js — a smooth playback clock on top of coarse OS position polls */
window.MT = window.MT || {};
(function (MT) {
  'use strict';

  /**
   * Media-session reports arrive every ~250 ms and can jitter. This keeps a local
   * clock that free-runs on performance.now() and is nudged toward each report,
   * so text never stutters but also never drifts away from the audio.
   */
  MT.Clock = function () {
    this.pos = 0;          // last reported position (s)
    this.anchor = 0;       // performance.now() at that report (ms)
    this.playing = false;
    this.rate = 1;
    this.offset = 0;       // user lyric offset (s), + = lyrics later
    this._smooth = 0;
    this._has = false;
  };

  MT.Clock.prototype.report = function (pos, playing, rate) {
    if (typeof pos === 'number' && isFinite(pos)) {
      this.pos = pos;
      this.anchor = performance.now();
    }
    if (typeof playing === 'boolean') this.playing = playing;
    if (typeof rate === 'number' && rate > 0) this.rate = rate;
    if (!this._has) { this._smooth = this.pos; this._has = true; }
  };

  MT.Clock.prototype.seek = function (pos) {
    this.pos = pos; this.anchor = performance.now(); this._smooth = pos;
  };

  /** Raw extrapolated position. */
  MT.Clock.prototype.raw = function () {
    if (!this.playing) return this.pos;
    return this.pos + ((performance.now() - this.anchor) / 1000) * this.rate;
  };

  /** Drift-corrected position used for rendering. */
  MT.Clock.prototype.now = function (dt) {
    var target = this.raw();
    var d = target - this._smooth;
    if (Math.abs(d) > 0.6) {
      this._smooth = target;            // real seek — snap
    } else {
      this._smooth += d * Math.min(1, (dt || 0.016) * 6);
      if (this.playing) this._smooth += 0; // free-run already folded into target
    }
    return this._smooth - this.offset;
  };
})(window.MT);
