import { test, expect } from '@playwright/test';
import { openApp, overflowX } from './app.mjs';

const DESIGNS = ['classic', 'cassette'];
const tab = (page, name) => page.evaluate((n) => import('/js/ui.js').then((m) => m.setTab(n)), name);
const settle = (page, ms = 400) => page.waitForTimeout(ms);

// ---------- Вёрстка: ничего не уезжает вбок ----------
for (const design of DESIGNS) {
  for (const width of [320, 360, 375, 412]) {
    test(`${design} ${width}px: страница не листается вбок`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await openApp(page, { design });
      for (const t of ['library', 'player']) {
        await tab(page, t);
        await settle(page);
        const o = await overflowX(page);
        expect(o.scroll, `${t}: шире экрана ${o.wide.join(', ')}`).toBeLessThanOrEqual(0);
        await page.evaluate(() => scrollBy(200, 0));
        expect(await page.evaluate(() => scrollX)).toBe(0);
      }
    });
  }
}

// ---------- Обучение: окно прожектора ровно вокруг цели ----------
async function holeVsTarget(page) {
  return page.evaluate(() => {
    const hole = document.querySelector('.tour-hole').getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(document.querySelector('.tour-hole')).borderTopLeftRadius);
    const title = document.querySelector('.tour-title').textContent;
    return { hole: { x: hole.left, y: hole.top, w: hole.width, h: hole.height }, radius, title };
  });
}

async function visibleTarget(page, sel) {
  return page.evaluate((s) => {
    const el = [...document.querySelectorAll(s)].find((e) => {
      if (e.closest('dialog, .tour, [data-mini]')) return false;
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none';
    });
    const r = el.getBoundingClientRect();
    const br = getComputedStyle(el).borderTopLeftRadius;
    return { x: r.left, y: r.top, w: r.width, h: r.height, round: br.endsWith('%') ? parseFloat(br) >= 50 : parseFloat(br) >= Math.min(r.width, r.height) / 2 - 0.5 };
  }, sel);
}

for (const design of DESIGNS) {
  test(`${design}: обучение обводит кнопку «Играть» ровно и по кругу`, async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 780 });
    // Обложка приходит с задержкой — плеер перестраивается уже после того, как обучение его измерило.
    await openApp(page, { design, thumbDelay: 900 });
    await page.evaluate(() => import('/js/tour.js').then((m) => m.startTour()));
    const next = page.locator('.tour-next');
    for (let i = 0; i < 12; i++) {
      if ((await page.locator('.tour-title').textContent()) === 'Плеер') break;
      await next.click();
      await settle(page, 150);
    }
    await expect(page.locator('.tour-title')).toHaveText('Плеер');
    // Дольше задержки обложки и анимации окна (0,55 с).
    await settle(page, 1800);
    const { hole, radius } = await holeVsTarget(page);
    const t = await visibleTarget(page, '[data-act="play"]:not([data-mini] *)');
    const cx = (r) => r.x + r.w / 2;
    const cy = (r) => r.y + r.h / 2;
    expect(Math.abs(cx(hole) - cx(t)), 'центр по горизонтали').toBeLessThan(2);
    expect(Math.abs(cy(hole) - cy(t)), 'центр по вертикали').toBeLessThan(2);
    expect(Math.abs(hole.w - (t.w + 16))).toBeLessThan(2);
    expect(Math.abs(hole.h - (t.h + 16))).toBeLessThan(2);
    if (t.round) expect(radius, 'круглая кнопка — круглое окно').toBeGreaterThanOrEqual(Math.min(hole.w, hole.h) / 2 - 1);
  });

  test(`${design}: каждый шаг обучения обводит видимую цель`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openApp(page, { design });
    await page.evaluate(() => import('/js/tour.js').then((m) => m.startTour()));
    const next = page.locator('.tour-next');
    const seen = [];
    for (let i = 0; i < 14; i++) {
      await settle(page, 900);
      const kind = await page.locator('.tour').getAttribute('data-kind');
      if (kind === 'outro') break;
      if (kind === 'spot') {
        const { hole, title } = await holeVsTarget(page);
        seen.push(title);
        // Центр окна — на элементе, который реально видно в этой точке.
        const hit = await page.evaluate(({ x, y }) => {
          const tour = document.querySelector('.tour');
          tour.style.pointerEvents = 'none';
          tour.style.visibility = 'hidden';
          const el = document.elementFromPoint(x, y);
          tour.style.visibility = '';
          tour.style.pointerEvents = '';
          return !!el && el !== document.body && el !== document.documentElement;
        }, { x: hole.x + hole.w / 2, y: hole.y + hole.h / 2 });
        expect(hit, `шаг «${title}»: окно над пустым местом`).toBe(true);
        expect(hole.x, `шаг «${title}»`).toBeGreaterThanOrEqual(-1);
        expect(hole.x + hole.w, `шаг «${title}»`).toBeLessThanOrEqual(360 + 1);
      }
      await next.click();
    }
    expect(seen).toContain('Плеер');
  });
}

// ---------- Уведомление о загрузке не дёргается ----------
test('карточка загрузки обновляется на месте, а не появляется заново', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 780 });
  let polls = 0;
  let finished = false;
  const job = () => ({
    id: 7, kind: 'track', name: 'Artist — Song', album_id: 0, total: 1, done: finished ? 1 : 0, failed: 0,
    current: `скачиваю ${Math.min(99, polls * 10)}%`, state: finished ? 'done' : 'running', video_id: 'abcdefghijk', error: null,
  });
  await openApp(page, { jobs: () => { polls += 1; return [job()]; } });
  // Задача появилась после открытия страницы (иначе это «старая новость», и её не показывают).
  await page.evaluate(() => import('/js/core.js').then((m) => m.pollJobs()));
  const card = page.locator('#jobs .job');
  await expect(card).toBeVisible();
  await card.evaluate((el) => { el.__mark = true; });
  const before = await page.locator('#jobs .job-status').textContent();
  await page.waitForTimeout(3500);   // два-три опроса
  expect(await card.evaluate((el) => el.__mark === true), 'тот же элемент, не пересоздан').toBe(true);
  expect(await page.locator('#jobs .job-status').textContent(), 'текст обновился').not.toBe(before);
  // Появление проиграно один раз; бегущая полоска не перезапускалась.
  const anims = await card.evaluate((el) => el.getAnimations({ subtree: true }).map((a) => ({ name: a.animationName, t: a.currentTime })));
  expect(anims.filter((a) => a.name === 'toast-in')).toHaveLength(0);
  const run = anims.find((a) => a.name === 'job-run');
  expect(run && run.t, 'полоска идёт с первого показа').toBeGreaterThan(2500);

  // Готово: карточка становится кнопкой «включить» — без повторного влёта.
  finished = true;
  await page.evaluate(() => import('/js/core.js').then((m) => m.pollJobs()));
  const done = page.locator('#jobs button.job');
  await expect(done).toBeVisible();
  expect(await done.evaluate((el) => el.getAnimations().some((a) => a.animationName === 'toast-in'))).toBe(false);
  await expect(page.locator('#jobs .job')).toHaveCount(1);
});

// ---------- Поиск треков: кнопки окна всегда на экране ----------
for (const design of DESIGNS) {
  for (const height of [740, 420]) {   // 420 — с открытой клавиатурой (приложение сжимает окно)
    test(`${design} ${height}px: «Найти» и «Отмена» видны при длинном списке результатов`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await openApp(page, { design });
      await page.locator('[data-act="add"]:visible').first().click();
      await page.locator('#url-input').fill('исполнитель песня');
      await expect(page.locator('#submit-label')).toHaveText('Найти');
      await page.locator('#submit-add').click();
      await expect(page.locator('#add-results')).toBeVisible();
      await page.setViewportSize({ width: 360, height });
      await settle(page, 500);
      const box = await page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const list = document.querySelector('#add-results');
        return { submit: r('#submit-add'), cancel: r('#add-dialog .sheet-actions [data-close]'), vh: innerHeight, list: { sh: list.scrollHeight, ch: list.clientHeight }, hint: getComputedStyle(document.querySelector('#add-dialog .hint')).display };
      });
      for (const b of [box.submit, box.cancel]) {
        expect(b.top).toBeGreaterThanOrEqual(0);
        expect(b.bottom).toBeLessThanOrEqual(box.vh);
      }
      expect(box.list.sh, 'длинный список прокручивается сам').toBeGreaterThan(box.list.ch);
      expect(box.list.ch, 'хоть пара результатов видна').toBeGreaterThanOrEqual(90);
      expect(box.hint).toBe('none');
    });
  }
}

// ---------- Громкость ----------
test('ползунок громкости скрыт по умолчанию', async ({ page }) => {
  await openApp(page);
  await tab(page, 'player');
  await expect(page.locator('input[data-volume]')).toHaveCount(await page.locator('input[data-volume]').count());
  for (const el of await page.locator('input[data-volume]').all()) await expect(el).toBeHidden();
});

for (const design of DESIGNS) {
  test(`${design}: включённый ползунок громкости двигается и меняет громкость`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await openApp(page, { design, settings: { volumeSlider: true, volume: 0.8 } });
    await tab(page, 'player');
    const slider = page.locator('input[data-volume]:visible').first();
    await expect(slider).toBeVisible();
    await slider.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await settle(page, 200);
    const b = await slider.boundingBox();
    // Палец попадает в сам ползунок, а не в панель вкладок поверх него.
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches('input[data-volume]'), { x: b.x + b.width / 2, y: b.y + b.height / 2 })).toBe(true);
    expect(b.width, 'ползунок не сжат в точку').toBeGreaterThan(50);
    // Палец по ползунку: жесты плеера не должны его перехватывать.
    const cdp = await page.context().newCDPSession(page);
    const y = b.y + b.height / 2;
    const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', b.x + b.width * 0.9);
    for (let k = 1; k <= 8; k++) await touch('touchMove', b.x + b.width * (0.9 - k * 0.0875));
    await touch('touchEnd');
    await settle(page, 200);
    const v = await page.evaluate(() => JSON.parse(localStorage.getItem('mk.settings.v2')).volume);
    expect(v).toBeLessThan(0.45);
  });
}
