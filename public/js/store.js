// Настройки и маленькие локальные данные. Всё хранится в браузере этого устройства;
// любое обращение к хранилищу обёрнуто — в приватном режиме его может не быть.

const KEY = 'mk.settings.v2';

export const DEFAULTS = {
  design: 'classic',
  theme: { classic: 'emerald', cassette: 'mk60' },
  customThemes: [],        // [{ id, name, design, vars: { '--accent': '#…' } }]
  coverColors: false,      // акцент из обложки текущего трека (по умолчанию — цвета темы)
  meter: 'viz',            // 'viz' — индикатор дизайна, 'lyrics' — текст песни, 'off'
  lyricsReact: true,       // musetext реагирует на звук плеера
  resumeLast: true,        // при запуске вставлять последний трек
  autoNext: true,          // по окончании играть следующий
  markPlayed: true,        // отмечать прослушанные
  volume: 0.8,
  shuffle: false,
  repeat: 'off',           // off | all | one
  sort: 'added',           // added | artist | title | album
  folded: false,           // свёрнутая библиотека на десктопе
};

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* приватный режим */ }
}

function load() {
  const saved = read(KEY, null);
  const s = structuredClone(DEFAULTS);
  if (saved && typeof saved === 'object') {
    Object.assign(s, saved);
    s.theme = { ...DEFAULTS.theme, ...(saved.theme || {}) };
    if (!Array.isArray(s.customThemes)) s.customThemes = [];
  } else {
    // Переезд с прошлой версии интерфейса (отдельные ключи).
    for (const k of ['volume', 'shuffle', 'repeat', 'sort', 'folded']) {
      const v = read(k, undefined);
      if (v !== undefined) s[k] = v;
    }
    if (read('vu', true) === false) s.meter = 'off';
  }
  if (!['added', 'artist', 'title', 'album'].includes(s.sort)) s.sort = 'added';
  if (!['off', 'all', 'one'].includes(s.repeat)) s.repeat = 'off';
  if (!['viz', 'lyrics', 'off'].includes(s.meter)) s.meter = 'viz';
  if (!['classic', 'cassette'].includes(s.design)) s.design = 'classic';
  return s;
}

export const settings = load();

export function save() {
  write(KEY, settings);
}

export function resetSettings() {
  const keep = settings.customThemes;
  Object.assign(settings, structuredClone(DEFAULTS), { customThemes: keep });
  save();
}

// Небольшие данные, не относящиеся к настройкам.
export const local = {
  played() { return new Set(read('mk.played', read('played', []))); },
  savePlayed(set) { write('mk.played', [...set]); },
  last() { return read('mk.last', read('last', null)); },
  saveLast(id) { write('mk.last', id); },
};
