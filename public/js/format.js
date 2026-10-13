// Форматирование чисел, времени и текста для интерфейса.

export function parseDuration(str) {
  if (str == null) return 0;
  if (typeof str === 'number') return str;
  return String(str).split(':').reduce((acc, part) => acc * 60 + (parseInt(part, 10) || 0), 0);
}

export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** «1 ч 12 мин», «56 мин» — для итогов библиотеки. */
export function formatLong(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

export function formatNumber(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('ru-RU', { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
}

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function yearOf(date) {
  const m = /(\d{4})$/.exec(date || '');
  return m ? m[1] : '';
}

export function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Альбом, если он осмысленный: yt-dlp ставит «Single», когда альбома нет. */
export function albumOf(t) {
  return t && t.album && t.album !== 'Single' ? t.album : '';
}
