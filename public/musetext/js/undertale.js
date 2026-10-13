/* musetext :: undertale.js — the easter egg.
   With Tiny5 as the active face, hold the left mouse button on the stage for
   five seconds and the lyrics stop being decoration: a red soul drops in with
   20 HP and every word on screen turns into something to dodge.
   Arrows or WASD to move, Esc to leave. */
window.MT = window.MT || {};
(function (MT) {
  'use strict';

  var HOLD_MS = 5000;
  var MAX_HP = 20;
  var SPEED = 320;          // px per second
  var IFRAMES = 0.75;       // seconds of mercy after a hit
  var SOUL = 15;            // heart size in px

  MT.Soul = function (app) {
    this.app = app;
    this.stage = app.stage;
    this.active = false;
    this.el = null;
    this.keys = {};
    this.holdTimer = null;
    this.hp = MAX_HP;
    this.inv = 0;
    this.x = 0;
    this.y = 0;
    this.placed = false;
    this.over = 0;
    this.bind();
  };

  MT.Soul.prototype.eligible = function () {
    return this.stage.fontKey === 'tiny5';
  };

  MT.Soul.prototype.bind = function () {
    var self = this;
    var root = document.getElementById('stage');

    root.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || self.active || !self.eligible()) return;
      self.holdTimer = setTimeout(function () { self.start(); }, HOLD_MS);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      root.addEventListener(ev, function () {
        if (self.holdTimer) { clearTimeout(self.holdTimer); self.holdTimer = null; }
      });
    });

    window.addEventListener('keydown', function (e) {
      if (!self.active) return;
      if (e.key === 'Escape') { self.stop(); return; }
      self.keys[e.key.toLowerCase()] = true;
      if (/^arrow| $/i.test(e.key)) e.preventDefault();
    });
    window.addEventListener('keyup', function (e) {
      if (!self.active) return;
      self.keys[e.key.toLowerCase()] = false;
    });

    // On a phone there is no keyboard. Drag anywhere to steer, by the movement
    // of the finger rather than its position, so it never covers the soul.
    root.addEventListener('pointerdown', function (e) {
      if (!self.active) return;
      self.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    root.addEventListener('pointermove', function (e) {
      if (!self.active || !self.drag || e.pointerId !== self.drag.id) return;
      self.x += e.clientX - self.drag.x;
      self.y += e.clientY - self.drag.y;
      self.drag.x = e.clientX;
      self.drag.y = e.clientY;
      e.preventDefault();
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      root.addEventListener(ev, function () { self.drag = null; });
    });
  };

  MT.Soul.prototype.start = function () {
    if (this.active) return;
    this.active = true;
    this.hp = MAX_HP;
    this.inv = 0;
    this.over = 0;
    this.keys = {};

    var box = MT.el('div', 'ut');
    box.innerHTML =
      '<div class="ut-frame"></div>' +
      '<div class="ut-soul"></div>' +
      '<div class="ut-hud">' +
        '<span class="ut-name">MUSETEXT</span>' +
        '<span class="ut-lv">LV 1</span>' +
        '<span class="ut-hplabel">HP</span>' +
        '<span class="ut-bar"><i></i></span>' +
        '<span class="ut-hpnum">20 / 20</span>' +
      '</div>' +
      '<button class="ut-close" title="Выйти">✕</button>' +
      '<div class="ut-over">GAME OVER</div>';
    document.body.appendChild(box);

    this.el = box;
    this.soul = box.querySelector('.ut-soul');
    this.bar = box.querySelector('.ut-bar i');
    this.num = box.querySelector('.ut-hpnum');
    this.overEl = box.querySelector('.ut-over');
    var self = this;
    box.querySelector('.ut-close').addEventListener('click', function () { self.stop(); });

    this.x = this.stage.W / 2;
    this.y = this.stage.H * 0.72;
    this.placed = this.stage.W > 50;

    this.app.ui.toast('* Ты чувствуешь, как слова смотрят на тебя.', true);
  };

  MT.Soul.prototype.stop = function () {
    if (!this.active) return;
    this.active = false;
    this.placed = false;
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    this.el = null;
    this.app.ui.toast('');
  };

  MT.Soul.prototype.tick = function (dt) {
    if (!this.active) return;

    if (this.over > 0) {
      this.over -= dt;
      if (this.over <= 0) this.stop();
      return;
    }

    // The stage keeps its own measurements and refreshes them on resize. Using
    // them here means one frame measured mid-reflow cannot pin the soul into a
    // corner it can never leave.
    var W = this.stage.W, H = this.stage.H;
    if (!(W > 50 && H > 50)) return;
    if (!this.placed) { this.x = W / 2; this.y = H * 0.72; this.placed = true; }
    var m = 18 + SOUL;

    var dx = 0, dy = 0;
    if (this.keys.arrowleft || this.keys.a || this.keys['ф']) dx -= 1;
    if (this.keys.arrowright || this.keys.d || this.keys['в']) dx += 1;
    if (this.keys.arrowup || this.keys.w || this.keys['ц']) dy -= 1;
    if (this.keys.arrowdown || this.keys.s || this.keys['ы']) dy += 1;
    if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }

    this.x = MT.clamp(this.x + dx * SPEED * dt, m, Math.max(m, W - m));
    this.y = MT.clamp(this.y + dy * SPEED * dt, m, Math.max(m, H - m));

    this.inv = Math.max(0, this.inv - dt);
    if (this.inv <= 0 && this.hits()) {
      this.hp = Math.max(0, this.hp - 1);
      this.inv = IFRAMES;
      if (this.hp === 0) {
        this.over = 2.6;
        this.overEl.style.opacity = '1';
      }
    }

    var half = SOUL / 2;
    this.soul.style.transform = 'translate(' + (this.x - half).toFixed(1) + 'px,' +
      (this.y - half).toFixed(1) + 'px)';
    // Blink through the mercy window, the way the original does.
    this.soul.style.opacity = (this.inv > 0 && Math.floor(this.inv * 14) % 2) ? '0.25' : '1';

    var pct = (this.hp / MAX_HP) * 100;
    this.bar.style.width = pct.toFixed(1) + '%';
    this.num.textContent = this.hp + ' / ' + MAX_HP;
  };

  /** Every visible word on the stage is a bullet. */
  MT.Soul.prototype.hits = function () {
    var half = SOUL / 2 - 2;              // a touch forgiving
    var l = this.x - half, rgt = this.x + half, t = this.y - half, b = this.y + half;
    var hit = false;

    this.stage.active.forEach(function (v) {
      if (hit) return;
      if (parseFloat(v.slot.style.opacity || '1') < 0.3) return;
      for (var i = 0; i < v.words.length; i++) {
        var el = v.words[i].el;
        if (parseFloat(el.style.opacity || '1') < 0.3) continue;
        var q = el.getBoundingClientRect();
        if (q.width < 1) continue;
        if (rgt > q.left && l < q.right && b > q.top && t < q.bottom) { hit = true; return; }
      }
    });
    return hit;
  };
})(window.MT);
