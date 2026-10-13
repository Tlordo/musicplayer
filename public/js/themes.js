// Темы: пресеты дизайнов, свои темы пользователя, цвета из обложки, экспорт/импорт.
// Тема — это набор CSS-переменных поверх значений по умолчанию из css/<дизайн>.css.

import { settings, save } from './store.js';

let designs = {};
let applied = [];
let coverInfo = null;          // { accent: [r,g,b] } текущей обложки
const coverCache = new Map();

export function registerDesigns(map) { designs = map; }

export function currentDesign() { return designs[settings.design] || designs.classic; }

/** Все темы дизайна: сначала пресеты, потом свои. */
export function themesFor(design) {
  const own = settings.customThemes.filter((t) => t.design === design.id).map((t) => ({ ...t, custom: true }));
  return [...design.presets, ...own];
}

export function activeTheme(design = currentDesign()) {
  const id = settings.theme[design.id];
  return themesFor(design).find((t) => t.id === id) || design.presets[0];
}

/** Применить тему активного дизайна (и цвета обложки поверх, если включены). */
export function applyTheme(preview) {
  const design = currentDesign();
  const theme = preview || activeTheme(design);
  const root = document.documentElement;
  applied.forEach((k) => root.style.removeProperty(k));

  const vars = { ...theme.vars };
  // В своих темах пользователь меняет только основные цвета — производные (текст на акценте,
  // линии, волна, вторичные оттенки) считаем из них, чтобы тема не теряла контраст.
  if ((theme.custom || preview) && design.derive) {
    for (const [k, v] of Object.entries(design.derive(vars))) if (!(k in theme.vars) || preview) vars[k] = v;
  }
  // В редакторе темы цвета обложки не подмешиваем — видно ровно то, что редактируется.
  if (!preview && settings.coverColors && coverInfo && design.coverVars) {
    Object.assign(vars, design.coverVars(coverInfo.accent, theme));
  }
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  applied = Object.keys(vars);
  root.style.colorScheme = theme.scheme || design.scheme || 'dark';

  window.dispatchEvent(new Event('mk-theme'));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(root).getPropertyValue(design.themeColorVar || '--bg').trim();
    if (bg) meta.setAttribute('content', bg);
  }
}

// ============ Цвета из обложки ============
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

/** Яркий цвет обложки, приведённый к нужной светлоте; null, если обложка серая. */
export function accentFrom(rgb, { light = 0.6, minSat = 0.5 } = {}) {
  if (!rgb) return null;
  const [h, s] = rgbToHsl(rgb);
  return hslToHex(h, Math.max(minSat, Math.min(0.85, s)), light);
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Чёрный или белый текст поверх цвета. */
export function textOn(hex) {
  return luminance(hex) > 0.32 ? '#0a0a0a' : '#ffffff';
}

/** Контраст двух цветов #rrggbb по WCAG. */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Смешать два #rrggbb: t = доля второго цвета. */
export function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (n, s) => (n >> s) & 255;
  return '#' + [16, 8, 0].map((s) => Math.round(ch(pa, s) * (1 - t) + ch(pb, s) * t).toString(16).padStart(2, '0')).join('');
}

function analyze(url) {
  if (coverCache.has(url)) return coverCache.get(url);
  const job = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const N = 32;
        const c = document.createElement('canvas');
        c.width = c.height = N;
        const g = c.getContext('2d', { willReadFrequently: true });
        // Центральный квадрат — там, где у YouTube-обложек сама картинка.
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, N, N);
        const px = g.getImageData(0, 0, N, N).data;
        // Корзины по оттенку, вес — насыщенность × яркость: побеждает заметный цвет, а не фон.
        const buckets = Array.from({ length: 18 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
        for (let i = 0; i < px.length; i += 4) {
          const rgb = [px[i], px[i + 1], px[i + 2]];
          const [h, s, l] = rgbToHsl(rgb);
          if (l < 0.12 || l > 0.92 || s < 0.22) continue;
          const w = s * (1 - Math.abs(l - 0.5) * 1.4);
          const bk = buckets[Math.floor(h / 20) % 18];
          bk.w += w; bk.r += rgb[0] * w; bk.g += rgb[1] * w; bk.b += rgb[2] * w;
        }
        const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
        resolve(best.w > 6 ? { accent: [best.r / best.w, best.g / best.w, best.b / best.w] } : null);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  coverCache.set(url, job);
  return job;
}

/** Вызывается при смене трека: пересчитать цвета обложки и применить тему. */
export async function setCover(url) {
  const info = url ? await analyze(url) : null;
  coverInfo = info;
  applyTheme();
}

// ============ Свои темы ============
export function newThemeId() {
  return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function saveCustomTheme(theme) {
  const i = settings.customThemes.findIndex((t) => t.id === theme.id);
  const clean = { id: theme.id, name: theme.name || 'Моя тема', design: theme.design, scheme: theme.scheme, vars: { ...theme.vars } };
  if (i >= 0) settings.customThemes[i] = clean; else settings.customThemes.push(clean);
  settings.theme[theme.design] = theme.id;
  save();
}

export function deleteCustomTheme(id) {
  const t = settings.customThemes.find((x) => x.id === id);
  settings.customThemes = settings.customThemes.filter((x) => x.id !== id);
  if (t && settings.theme[t.design] === id) settings.theme[t.design] = designs[t.design].presets[0].id;
  save();
}

export function exportThemes() {
  return JSON.stringify({ format: 'mk-themes', version: 1, themes: settings.customThemes }, null, 2);
}

/** Возвращает число добавленных тем; бросает ошибку с понятным текстом. */
export function importThemes(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Это не файл тем: не удалось прочитать JSON'); }
  const list = Array.isArray(data) ? data : data && data.themes;
  if (!Array.isArray(list)) throw new Error('В файле нет списка тем');
  let n = 0;
  for (const t of list) {
    if (!t || !designs[t.design] || typeof t.vars !== 'object') continue;
    const vars = {};
    for (const [k, v] of Object.entries(t.vars)) {
      // Только переменные, которые дизайн разрешает менять, и только безопасные значения.
      if (designs[t.design].themeVars.some((d) => d.key === k) && /^[#\w\s.,()%-]{1,60}$/.test(String(v))) vars[k] = String(v);
    }
    const exists = settings.customThemes.some((x) => x.id === t.id);
    settings.customThemes.push({
      id: exists || !t.id ? newThemeId() : String(t.id).slice(0, 40),
      name: String(t.name || 'Импорт').slice(0, 40),
      design: t.design,
      scheme: t.scheme === 'light' ? 'light' : 'dark',
      vars,
    });
    n++;
  }
  save();
  return n;
}
