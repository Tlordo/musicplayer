// Общая подготовка: страница открывается так, как её видит Android-приложение.
// Мост window.MkAndroid — заглушка (отступы под часы и полосу жестов, остальное — ничего не делает),
// сервер плеера — подменённые ответы /api/*.

export const tracks = Array.from({ length: 24 }, (_, i) => ({
  video_id: `vid${String(i).padStart(8, '0')}`,
  title: i === 0 ? 'Очень длинное название трека, которое не помещается в одну строку на телефоне' : `Трек ${i + 1}`,
  artist: `Исполнитель ${(i % 5) + 1}`,
  album: i % 3 ? `Альбом ${(i % 4) + 1}` : null,
  duration: `${3 + (i % 3)}:${String(10 + i).padStart(2, '0')}`,
  thumbnail_api: `/api/thumbnail/vid${String(i).padStart(8, '0')}`,
  plays: i % 7,
  liked: i % 4 === 0,
  added: 100 - i,
}));

// 1×1 PNG: обложка «приходит» — с задержкой, как по Wi‑Fi с компьютера.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

export const searchItems = Array.from({ length: 20 }, (_, i) => ({
  id: `res${String(i).padStart(8, '0')}`,
  title: `Найденный трек ${i + 1}`,
  artist: 'Кто-то',
  duration: 200 + i,
  url: `https://www.youtube.com/watch?v=res${String(i).padStart(8, '0')}`,
  thumb: '/api/thumbnail/none',
  in_library: i === 2,
}));

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ design?: 'classic'|'cassette', settings?: object, jobs?: () => object[], last?: string|null, tourSeen?: boolean, thumbDelay?: number }} [o]
 */
export async function openApp(page, o = {}) {
  const settings = { design: o.design || 'classic', ...(o.settings || {}) };
  await page.addInitScript(({ settings, last, tourSeen }) => {
    const noop = () => {};
    window.MkAndroid = new Proxy({ insets: () => '32,24' }, { get: (t, k) => (k in t ? t[k] : noop) });
    try {
      localStorage.setItem('mk.settings.v2', JSON.stringify(settings));
      if (tourSeen) localStorage.setItem('mk.tour.v1', '1');
      if (last) localStorage.setItem('mk.last', JSON.stringify(last));
    } catch { /* нет хранилища */ }
  }, { settings, last: o.last === undefined ? tracks[0].video_id : o.last, tourSeen: o.tourSeen !== false });

  const jobs = o.jobs || (() => []);
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/api/library') return json(tracks);
    if (p === '/api/jobs') return json(jobs());
    if (p === '/api/albums') return json([]);
    if (p === '/api/search') return json({ items: searchItems });
    if (p === '/api/recommendations') return json({ items: [], seeds: [] });
    if (p === '/api/info') return json({ urls: [] });
    if (p === '/api/ytdlp') return json({ ok: true, version: 'test' });
    if (p.startsWith('/api/thumbnail/')) {
      if (o.thumbDelay) await new Promise((r) => setTimeout(r, o.thumbDelay));
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    }
    if (p.startsWith('/api/peaks/')) return json({ peaks: [] });
    if (p.startsWith('/api/stream/')) return route.fulfill({ status: 404, body: '' });
    return json({});
  });
  await page.goto(o.url || '/');
  await page.waitForFunction(() => document.documentElement.classList.contains('in-android') && document.querySelector('[data-act="play"]'));
}

/** Ширина документа больше экрана — страницу можно таскать вбок. */
export function overflowX(page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    const wide = [...document.querySelectorAll('body *')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && getComputedStyle(el).position !== 'fixed'; })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
    return { scroll: d.scrollWidth - d.clientWidth, body: document.body.scrollWidth - innerWidth, wide };
  });
}
