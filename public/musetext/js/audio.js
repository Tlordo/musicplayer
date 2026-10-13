/* musetext :: audio.js — optional loopback analyser.
   Feeds a 0..1 level and onset ("beat") events to the effects layer so the
   flashes land on the track instead of on a timer. Entirely opt-in: without it
   the visuals still run purely off the lyric clock. */
window.MT = window.MT || {};
(function (MT) {
  'use strict';

  MT.AudioReactor = function () {
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.data = null;
    this.prev = null;
    this.level = 0;
    this.energy = 0.4;
    this.tremolo = 0;      // how much the level is wobbling — laughter, vibrato
    this.onBeat = null;
    this.running = false;
    this._fluxAvg = 0;
    this._cool = 0;
    this._hist = [];
  };

  /**
   * Capture system audio. On desktop this is the loopback stream the shell
   * provides; in a browser the user picks a tab/window and ticks "share audio".
   */
  MT.AudioReactor.prototype.start = async function (getStream) {
    if (this.running) return true;
    var stream;
    try {
      stream = getStream ? await getStream() : await navigator.mediaDevices.getDisplayMedia({
        video: true, audio: true
      });
    } catch (e) {
      return false;
    }
    if (!stream || !stream.getAudioTracks().length) {
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      return false;
    }
    stream.getVideoTracks().forEach(function (t) { t.stop(); });

    this.stream = stream;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    var src = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.55;
    src.connect(this.analyser);
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
    this.prev = new Float32Array(this.analyser.frequencyBinCount);
    this.running = true;
    return true;
  };

  MT.AudioReactor.prototype.stop = function () {
    if (this.stream) this.stream.getTracks().forEach(function (t) { t.stop(); });
    if (this.ctx) this.ctx.close();
    this.ctx = null; this.analyser = null; this.stream = null;
    this.running = false; this.level = 0;
  };

  MT.AudioReactor.prototype.tick = function (dt) {
    if (!this.running || !this.analyser) return;
    this.analyser.getByteFrequencyData(this.data);

    var n = this.data.length;
    var bassEnd = Math.floor(n * 0.09);
    var sum = 0, bass = 0, flux = 0;
    for (var i = 0; i < n; i++) {
      var v = this.data[i] / 255;
      sum += v;
      if (i < bassEnd) bass += v;
      var d = v - this.prev[i];
      if (d > 0) flux += d;
      this.prev[i] = v;
    }
    var lvl = MT.clamp(bass / Math.max(1, bassEnd) * 1.35, 0, 1);
    this.level += (lvl - this.level) * Math.min(1, dt * 14);
    this.energy += (MT.clamp(sum / n * 2.4, 0, 1) - this.energy) * Math.min(1, dt * 0.6);

    // Tremolo: how deeply the level is wobbling over the last ~0.7 s. A steady
    // note sits near zero; laughter, vibrato and stuttered ad-libs push it up.
    this._hist.push(this.level);
    if (this._hist.length > 42) this._hist.shift();
    if (this._hist.length > 14) {
      var mean = 0, k;
      for (k = 0; k < this._hist.length; k++) mean += this._hist[k];
      mean /= this._hist.length;
      var varsum = 0;
      for (k = 0; k < this._hist.length; k++) {
        var d2 = this._hist[k] - mean;
        varsum += d2 * d2;
      }
      var sd = Math.sqrt(varsum / this._hist.length);
      var depth = mean > 0.06 ? sd / mean : 0;
      var target = MT.clamp((depth - 0.20) / 0.45, 0, 1);
      this.tremolo += (target - this.tremolo) * Math.min(1, dt * 5);
    }

    // adaptive onset threshold
    this._fluxAvg += (flux - this._fluxAvg) * Math.min(1, dt * 3.2);
    this._cool = Math.max(0, this._cool - dt);
    if (this._cool <= 0 && flux > this._fluxAvg * 1.8 && flux > 1.2) {
      this._cool = 0.16;
      if (this.onBeat) this.onBeat(MT.clamp(flux / Math.max(0.001, this._fluxAvg * 3), 0.2, 1.4));
    }
  };
})(window.MT);
