/* musetext :: settings.js — the config object, its persistence, and the schema
   the settings panel is generated from. */
window.MT = window.MT || {};
(function (MT) {
  'use strict';

  var KEY = 'musetext.settings.v1';

  MT.defaults = function () {
    return {
      // 'edit'  — a line is staged whole, perspective animates across its life
      // 'flyby' — perspective is fixed at birth, the piece travels out of frame,
      //           and long lines are scattered across the screen in fragments
      // 'stair' — flat, no rotation, lines stacked as steps left to right
      // 'tunnel'— extruded slabs standing in a corridor you fly down
      mode: 'edit',
      extrude: 0.8,            // depth of the letters' side faces in tunnel mode
      split: 'auto',           // 'auto' | 'off' | '2' | '3' fragments per line
      timing: 'tempo',         // 'gap' | 'tempo' | 'audio' — how long a line lasts
      parens: 'dim',           // 'normal' | 'dim' | 'hide' for bracketed backing vocals
      flyTime: 1.0,            // multiplier on how long a fragment stays in the air
      cameraSpeed: 1.0,        // how fast the viewpoint travels down the strip
      cameraRoll: 7,           // degrees of slow camera roll
      voiceSize: 0.7,          // how much vocal loudness drives fragment size
      vocalShake: 0.8,         // jitter on laughter, held vowels, vibrato

      renderSize: '1920x1080', // preset; 'custom' leaves width and height alone
      renderW: 1920,
      renderH: 1080,
      renderFps: 30,
      renderFormat: 'prores4444',
      renderPlain: true,       // typography only, no effects that move the text
      renderFrom: 0,
      renderTo: 0,             // 0 means "to the end of the lyrics"

      bgMode: 'auto',          // 'auto' | 'cover' | 'lights' | 'off'
      bgBlur: 46,              // px of blur on the cover
      bgLevel: 0.2,            // how dark the cover sits before any light hits it
      bgFlash: 0.85,           // how hard the pulses light it

      vlcEnabled: false,       // VLC 3 publishes no media session; use its web UI
      vlcPort: 8080,
      vlcPassword: '',

      vibeMode: 'auto',        // 'auto' or a key from MT.VIBES
      palette: 'auto',         // 'auto' or a key from MT.PALETTES
      uppercase: 'auto',
      fontOverride: 'auto',    // 'auto' or a key from MT.FONTS

      maxLines: 3,
      safeArea: 0.06,          // margin kept clear at the edges when placing a line
      lead: 0.45,              // seconds a line appears before its timestamp
      hold: 0.9,               // seconds it lingers after the next line starts

      motion: 1.0,
      scale: 1.0,
      rotation: 1.0,
      perspective: 1.0,        // 0 disables the power-pin entirely
      intensity: 0.8,

      motionBlur: true,
      colorWords: true,
      outline: true,

      sourceApp: 'auto',       // which media session to follow, or 'auto'
      offset: 0,               // lyric offset in seconds, + = text later
      audioReactive: false,
      energy: null,            // filled by the analyser when it runs

      perf: 'auto',            // 'auto' | 'lite' | 'full' — lite drops the costly bits on phones

      fxAuto: true,
      fx: {
        flash: 0.3, shake: 0.4, chroma: 0.2, invert: 0.15,
        zoom: 0.6, grain: 0.25, scan: 0, vignette: 0.5
      }
    };
  };

  MT.loadSettings = function () {
    var d = MT.defaults();
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || '{}');
      Object.keys(s).forEach(function (k) {
        if (k === 'fx') Object.assign(d.fx, s.fx || {});
        else if (k in d) d[k] = s[k];
      });
    } catch (e) { /* fall back to defaults */ }
    return d;
  };

  MT.saveSettings = function (cfg) {
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { }
  };

  MT.applyVibeFx = function (cfg, vibe) {
    if (!cfg.fxAuto) return;
    var v = MT.VIBES[vibe];
    if (!v) return;
    Object.keys(v.fx).forEach(function (k) { cfg.fx[k] = v.fx[k]; });
  };

  /* The panel is built from this; adding a control means adding a line here. */
  MT.SCHEMA = [
    {
      title: 'Режим', rows: [
        { k: 'mode', type: 'select', label: 'Подача', options: [
            ['edit', 'Классика — строка целиком'],
            ['flyby', 'Разлёт — куски, уход за край'],
            ['stair', 'Лесенка — уступом, без перспективы'],
            ['camera', 'Камера — текст стоит, едет вид'],
            ['tunnel', 'Тоннель — объёмный текст, полёт сквозь']] },
        { k: 'extrude', type: 'range', label: 'Объём букв', min: 0, max: 1.6, step: 0.05 },
        { k: 'split', type: 'select', label: 'Дробление строки', options: [
            ['auto', 'Авто'], ['off', 'Не дробить'], ['2', 'На 2'], ['3', 'На 3']] },
        { k: 'flyTime', type: 'range', label: 'Время полёта', min: 0.4, max: 2.5, step: 0.05 },
        { k: 'cameraSpeed', type: 'range', label: 'Скорость камеры', min: 0.2, max: 3, step: 0.05 },
        { k: 'cameraRoll', type: 'range', label: 'Крен камеры', min: 0, max: 25, step: 0.5 },
        { k: 'voiceSize', type: 'range', label: 'Размер от громкости', min: 0, max: 1.5, step: 0.05 },
        { k: 'vocalShake', type: 'range', label: 'Тряска на смехе и вибрато', min: 0, max: 1.5, step: 0.05 }
      ]
    },
    {
      title: 'Вайб', rows: [
        { k: 'vibeMode', type: 'select', label: 'Пресет', options: function () {
            var o = [['auto', 'Авто (по треку)']];
            MT.VIBE_KEYS.forEach(function (k) { o.push([k, MT.VIBES[k].label]); });
            return o;
          } },
        { k: 'fontOverride', type: 'select', label: 'Шрифт', options: function () {
            var o = [['auto', 'По пресету']];
            Object.keys(MT.FONTS).forEach(function (k) {
              var f = MT.FONTS[k];
              var name = f.css.replace(/'/g, '');
              o.push([k, name + (f.user && !MT.fontAvailable(k) ? ' (нет файла)' : '')]);
            });
            return o;
          } },
        { k: 'palette', type: 'select', label: 'Палитра', options: function () {
            var o = [['auto', 'По пресету']];
            Object.keys(MT.PALETTES).forEach(function (k) { o.push([k, k]); });
            return o;
          } },
        { k: 'uppercase', type: 'select', label: 'Регистр', options: [
            ['auto', 'По шрифту'], ['on', 'ВЕРХНИЙ'], ['off', 'как есть']] }
      ]
    },
    {
      title: 'Движение', rows: [
        { k: 'motion', type: 'range', label: 'Скорость выезда', min: 0, max: 2.5, step: 0.05 },
        { k: 'perspective', type: 'range', label: 'Перспектива (Power Pin)', min: 0, max: 2.5, step: 0.05 },
        { k: 'rotation', type: 'range', label: 'Наклон', min: 0, max: 2.5, step: 0.05 },
        { k: 'scale', type: 'range', label: 'Кегль', min: 0.4, max: 2.2, step: 0.05 },
        { k: 'maxLines', type: 'range', label: 'Строк на экране', min: 1, max: 6, step: 1, int: true },
        { k: 'safeArea', type: 'range', label: 'Отступ от краёв', min: 0, max: 0.3, step: 0.01 },
        { k: 'lead', type: 'range', label: 'Появление раньше, с', min: 0, max: 1.5, step: 0.05 },
        { k: 'hold', type: 'range', label: 'Задержка после, с', min: 0, max: 3, step: 0.05 },
        { k: 'motionBlur', type: 'bool', label: 'Motion blur' }
      ]
    },
    {
      title: 'Фон', rows: [
        { k: 'bgMode', type: 'select', label: 'Задник', options: [
            ['auto', 'Авто — обложка, иначе засветки'],
            ['cover', 'Только обложка'],
            ['lights', 'Только засветки'],
            ['off', 'Выключен']] },
        { k: 'bgBlur', type: 'range', label: 'Размытие обложки', min: 0, max: 120, step: 2, int: true },
        { k: 'bgLevel', type: 'range', label: 'Базовая яркость', min: 0, max: 1, step: 0.02 },
        { k: 'bgFlash', type: 'range', label: 'Сила засветок', min: 0, max: 2, step: 0.05 }
      ]
    },
    {
      title: 'Эффекты', rows: [
        { k: 'perf', type: 'select', label: 'Производительность', options: [
            ['auto', 'Авто (лёгкий на телефоне)'],
            ['lite', 'Лёгкий режим'],
            ['full', 'Полное качество']] },
        { k: 'fxAuto', type: 'bool', label: 'Эффекты по пресету' },
        { k: 'intensity', type: 'range', label: 'Общая сила', min: 0, max: 1.5, step: 0.05 },
        { k: 'fx.flash', type: 'range', label: 'Цветные вспышки', min: 0, max: 1, step: 0.05 },
        { k: 'fx.shake', type: 'range', label: 'Тряска', min: 0, max: 1, step: 0.05 },
        { k: 'fx.zoom', type: 'range', label: 'Зум-панч', min: 0, max: 1, step: 0.05 },
        { k: 'fx.chroma', type: 'range', label: 'RGB-сдвиг', min: 0, max: 1, step: 0.05 },
        { k: 'fx.invert', type: 'range', label: 'Инверсия', min: 0, max: 1, step: 0.05 },
        { k: 'fx.grain', type: 'range', label: 'Зерно', min: 0, max: 1, step: 0.05 },
        { k: 'fx.scan', type: 'range', label: 'Скан-линии', min: 0, max: 1, step: 0.05 },
        { k: 'fx.vignette', type: 'range', label: 'Виньетка', min: 0, max: 1, step: 0.05 },
        { k: 'colorWords', type: 'bool', label: 'Цветные слова' },
        { k: 'outline', type: 'bool', label: 'Контурные строки' }
      ]
    },
    {
      title: 'Рендер видео', rows: [
        { k: 'renderSize', type: 'select', label: 'Разрешение', options: [
            ['1920x1080', '1920 × 1080'],
            ['3840x2160', '3840 × 2160'],
            ['1280x720', '1280 × 720'],
            ['1080x1920', '1080 × 1920 (вертикаль)'],
            ['1080x1080', '1080 × 1080 (квадрат)'],
            ['custom', 'Своё']] },
        { k: 'renderW', type: 'number', label: 'Ширина', min: 16, max: 7680, step: 2 },
        { k: 'renderH', type: 'number', label: 'Высота', min: 16, max: 4320, step: 2 },
        { k: 'renderFps', type: 'select', label: 'Кадров в секунду', options: [
            ['24', '24'], ['25', '25'], ['30', '30'], ['50', '50'], ['60', '60']] },
        { k: 'renderFormat', type: 'select', label: 'Формат', options: [
            ['prores4444', 'QuickTime ProRes 4444 (альфа)'],
            ['qtrle', 'QuickTime Animation (альфа, без потерь)'],
            ['png', 'Секвенция PNG (альфа)']] },
        { k: 'renderPlain', type: 'bool', label: 'Только текст, без эффектов' },
        { k: 'renderFrom', type: 'number', label: 'С секунды', min: 0, max: 100000, step: 1 },
        { k: 'renderTo', type: 'number', label: 'По секунду (0 — до конца)', min: 0, max: 100000, step: 1 },
        { k: 'renderGo', type: 'button', label: 'Фон прозрачный', text: 'Рендерить' }
      ]
    },
    {
      title: 'Источник', rows: [
        { k: 'sourceApp', type: 'select', label: 'Плеер', options: function () {
            var o = [['auto', 'Авто']];
            (MT.SESSION_LIST || []).forEach(function (s) {
              var mark = s.playing ? ' ▶' : '';
              o.push([s.app, (s.app || '?').replace(/\.exe$/i, '') + mark]);
            });
            return o;
          } },
        { k: 'vlcEnabled', type: 'bool', label: 'Ловить VLC (веб-интерфейс)' },
        { k: 'vlcPort', type: 'number', label: 'Порт VLC', min: 1, max: 65535, step: 1 },
        { k: 'vlcPassword', type: 'text', label: 'Пароль VLC', password: true }
      ]
    },
    {
      title: 'Синхронизация', rows: [
        { k: 'timing', type: 'select', label: 'Длительность строки', options: [
            ['tempo', 'По темпу пения'],
            ['audio', 'По темпу + обрыв на тишине'],
            ['gap', 'До следующей строки']] },
        { k: 'parens', type: 'select', label: 'Текст в скобках', options: [
            ['dim', 'Тусклее'], ['normal', 'Как обычный'], ['hide', 'Скрыть']] },
        { k: 'offset', type: 'range', label: 'Сдвиг текста, с', min: -3, max: 3, step: 0.05 },
        { k: 'audioReactive', type: 'bool', label: 'Реагировать на звук' }
      ]
    }
  ];

  MT.getPath = function (obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, obj);
  };
  MT.setPath = function (obj, path, val) {
    var ks = path.split('.'), last = ks.pop();
    var o = ks.reduce(function (a, k) { return a[k]; }, obj);
    o[last] = val;
  };
})(window.MT);
