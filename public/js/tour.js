// Обучение: приветствие, затем «прожектор» по настоящим кнопкам плеера, в конце — шпаргалка.
// Работает в обоих дизайнах: шаг ищет первый видимый элемент по селектору, а если его нет
// (другой дизайн, узкий экран) — шаг пропускается. На телефоне сам переключает вкладки.

import { state } from './core.js';
import { setTab, isDesktop, toastAction } from './ui.js';

const KEY = 'mk.tour.v1';
const html = document.documentElement;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const isTouch = () => matchMedia('(hover: none)').matches;

const STEPS = [
  {
    kind: 'intro',
    title: 'Своя музыка — с YouTube и навсегда',
    text: 'Любой трек с YouTube или YouTube Music становится файлом на вашем компьютере: с обложкой, текстом песни и без рекламы. Покажу главное за минуту.',
  },
  {
    sel: '[data-act="add"]',
    tab: 'library',
    title: 'Добавить трек',
    text: () => isTouch()
      ? 'Вставьте ссылку или напишите «исполнитель — песня». Ещё быстрее: в YouTube нажмите «Поделиться» → «Моя музыка» — трек начнёт скачиваться сам.'
      : 'Вставьте ссылку или напишите «исполнитель — песня». Ещё быстрее: скопируйте ссылку и нажмите Ctrl+V прямо здесь, в любом месте, — или перетащите её в окно.',
  },
  {
    sel: 'input[data-search]',
    tab: 'library',
    title: 'Поиск по библиотеке',
    text: 'Ищет по названию, исполнителю и альбому. Если у вас такого трека нет, одна кнопка найдёт его на YouTube. Клавиша / — сразу сюда.',
  },
  {
    sel: '[data-act="libview-recs"]',
    tab: 'library',
    title: 'Рекомендации',
    text: 'Микс YouTube по тому, что сейчас играет. Нажмите на обложку ▶ — трек зазвучит сразу, без скачивания; понравился — «+», и он ваш.',
  },
  {
    sel: '[data-act="libview-albums"]',
    tab: 'library',
    title: 'Альбомы и подборки',
    text: 'Свои альбомы, целые плейлисты по одной ссылке и подборки, которые плеер собирает сам: «Любимое», «Чаще всего», «Давно не слушал».',
  },
  {
    sel: '[data-act="play"]',
    tab: 'player',
    title: 'Плеер',
    text: () => isTouch()
      ? 'Пауза, следующий, предыдущий. Зажмите трек в списке — появится меню: «Играть следующим», «В очередь», «В альбом».'
      : 'Пробел — пауза, N и P — следующий и предыдущий, ←/→ — перемотка. Правый клик по треку в списке — «Играть следующим», «В очередь», «В альбом».',
  },
  {
    sel: '[data-seek]',
    tab: 'player',
    title: 'Перемотка',
    text: 'Ведите пальцем или мышью по полосе — она показывает настоящую форму волны трека, тихие и громкие места видно заранее.',
  },
  {
    sel: '[data-act="lyrics"]',
    tab: 'player',
    title: 'Текст песни',
    text: 'Синхронный текст идёт поверх плеера в такт музыке. Клавиша L.',
  },
  {
    sel: '[data-act="menu"]',
    tab: 'player',
    title: 'Ещё',
    text: 'Очередь, таймер сна, статистика прослушиваний, «о треке» и скачивание файла.',
  },
  {
    sel: '[data-act="settings"]',
    title: 'Настройки',
    text: 'Два дизайна — «Классика» и «Кассета», темы и свои цвета, эквалайзер, плавный переход между треками и QR-код, чтобы открыть плеер на телефоне.',
  },
  {
    kind: 'outro',
    title: 'Готово!',
    text: 'Обучение всегда можно пройти снова: Настройки → «Как пользоваться» или клавиша F1.',
  },
];

let root = null;
let steps = [];
let index = 0;
let target = null;
let lastFocus = null;

function visible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
}

function findTarget(step) {
  if (!step.sel) return null;
  return [...document.querySelectorAll(step.sel)].find((el) => !el.closest('dialog, .tour') && visible(el)) || null;
}

/** Шаги, у которых есть что показать именно в этом дизайне и на этом экране. */
function usableSteps() {
  return STEPS.filter((s) => {
    if (s.kind) return true;
    if (s.tab && !isDesktop()) {
      // Элемент может быть на другой вкладке: проверяем, существует ли он вообще.
      return [...document.querySelectorAll(s.sel)].some((el) => !el.closest('dialog'));
    }
    return !!findTarget(s);
  });
}

function build() {
  root = document.createElement('div');
  root.className = 'tour';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'tour-title');
  root.innerHTML = `
    <div class="tour-shade"></div>
    <div class="tour-hole" aria-hidden="true"></div>
    <section class="tour-card" tabindex="-1">
      <div class="tour-art" aria-hidden="true">
        <div class="tour-disc"><span></span></div>
        <div class="tour-eq"><i></i><i></i><i></i><i></i><i></i></div>
      </div>
      <p class="tour-count" aria-live="polite"></p>
      <h2 class="tour-title" id="tour-title"></h2>
      <p class="tour-text"></p>
      <div class="tour-extra"></div>
      <div class="tour-dots" aria-hidden="true"></div>
      <div class="tour-actions">
        <button type="button" class="tour-skip" data-tour="skip">Пропустить</button>
        <span class="tour-gap"></span>
        <button type="button" class="tour-back" data-tour="back">Назад</button>
        <button type="button" class="tour-next" data-tour="next">Дальше</button>
      </div>
    </section>`;
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tour]');
    if (b) { e.stopPropagation(); act(b.dataset.tour); return; }
    // Клик в подсвеченное окно — тоже «дальше»: человек тянется к кнопке, которую ему показали.
    if (e.target.closest('.tour-hole')) act('next');
  });
  document.body.append(root);
}

function act(what) {
  if (what === 'next') go(index + 1);
  else if (what === 'back') go(index - 1);
  else if (what === 'skip') finish();
  else if (what === 'add') { finish(); document.querySelector('[data-act="add"]')?.click(); }
}

function extraFor(step) {
  if (step.kind === 'intro') {
    return `<ul class="tour-points">
      <li><b>▶ сразу</b><span>слушайте с YouTube до скачивания</span></li>
      <li><b>офлайн</b><span>файлы остаются у вас</span></li>
      <li><b>везде</b><span>компьютер, телефон, Android</span></li>
    </ul>`;
  }
  if (step.kind === 'outro') {
    const keys = isTouch() ? '' : `<div class="tour-keys">
      <span><kbd>Пробел</kbd> пауза</span><span><kbd>N</kbd> <kbd>P</kbd> треки</span><span><kbd>/</kbd> поиск</span>
      <span><kbd>Q</kbd> очередь</span><span><kbd>F</kbd> любимое</span><span><kbd>L</kbd> текст</span>
    </div>`;
    return keys;
  }
  return '';
}

function go(i) {
  if (i < 0) return;
  if (i >= steps.length) { finish(); return; }
  index = i;
  const step = steps[i];
  if (step.tab && !isDesktop() && html.dataset.tab !== step.tab) setTab(step.tab);
  // Вкладка переключается с анимацией — даём ей кадр-другой, потом меряем.
  requestAnimationFrame(() => requestAnimationFrame(() => show(step)));
}

function show(step) {
  if (!root) return;
  const card = root.querySelector('.tour-card');
  const centered = !!step.kind;
  target = centered ? null : findTarget(step);
  if (!centered && !target) { go(index + (index >= steps.length - 1 ? -1 : 1)); return; }

  root.classList.toggle('centered', centered);
  root.dataset.kind = step.kind || 'spot';
  const n = steps.filter((s) => !s.kind).length;
  const pos = steps.slice(0, index + 1).filter((s) => !s.kind).length;
  root.querySelector('.tour-count').textContent = centered ? '' : `${pos} из ${n}`;
  root.querySelector('.tour-title').textContent = step.title;
  root.querySelector('.tour-text').textContent = typeof step.text === 'function' ? step.text() : step.text;
  root.querySelector('.tour-extra').innerHTML = extraFor(step);
  root.querySelector('.tour-dots').innerHTML = steps.map((s, k) => (s.kind ? '' : `<i class="${k === index ? 'on' : k < index ? 'past' : ''}"></i>`)).join('');

  const back = root.querySelector('.tour-back');
  const next = root.querySelector('.tour-next');
  const skip = root.querySelector('.tour-skip');
  back.hidden = index === 0 || step.kind === 'outro';
  skip.hidden = step.kind === 'outro';
  if (step.kind === 'intro') next.textContent = 'Покажите';
  else if (step.kind === 'outro') next.textContent = state.library.length ? 'Слушать' : 'Добавить первый трек';
  else next.textContent = index === steps.length - 2 ? 'Готово' : 'Дальше';
  next.dataset.tour = step.kind === 'outro' && !state.library.length ? 'add' : 'next';
  skip.textContent = step.kind === 'intro' ? 'Я разберусь сам' : 'Пропустить';

  // Карточка «перелистывается» — без этого смена текста выглядит как мигание.
  card.classList.remove('swap');
  void card.offsetWidth;
  card.classList.add('swap');

  if (target) target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  place();
  card.focus({ preventScroll: true });
}

/** Окно прожектора — вокруг цели, карточка — рядом, не вылезая за экран. */
function place() {
  if (!root) return;
  const hole = root.querySelector('.tour-hole');
  const card = root.querySelector('.tour-card');
  const vw = innerWidth;
  const vh = innerHeight;
  if (!target || !visible(target)) {
    hole.style.cssText = `--x:${vw / 2}px;--y:${vh / 2}px;--w:0px;--h:0px;--r:999px`;
    card.style.removeProperty('--cx');
    card.style.removeProperty('--cy');
    return;
  }
  const r = target.getBoundingClientRect();
  const pad = 8;
  const w = r.width + pad * 2;
  const h = r.height + pad * 2;
  const radius = Math.min(18, Math.min(w, h) / 2);
  hole.style.cssText = `--x:${r.left - pad}px;--y:${r.top - pad}px;--w:${w}px;--h:${h}px;--r:${radius}px`;

  // На узком экране — нижний «лист» или верхний, если цель внизу.
  const narrow = vw < 640;
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const gap = 16;
  let x;
  let y;
  if (narrow) {
    x = (vw - cw) / 2;
    y = r.top + r.height / 2 > vh / 2 ? Math.max(12, r.top - pad - gap - ch) : Math.min(vh - ch - 12, r.bottom + pad + gap);
    // Не помещается рядом — к краю экрана, противоположному цели.
    if (y < 12 || y + ch > vh - 12) y = r.top > vh / 2 ? 12 : vh - ch - 12;
  } else {
    const below = r.bottom + pad + gap;
    const above = r.top - pad - gap - ch;
    const right = r.right + pad + gap;
    const left = r.left - pad - gap - cw;
    if (below + ch <= vh - 12) { y = below; x = r.left + r.width / 2 - cw / 2; }
    else if (above >= 12) { y = above; x = r.left + r.width / 2 - cw / 2; }
    else if (right + cw <= vw - 12) { x = right; y = r.top + r.height / 2 - ch / 2; }
    else { x = Math.max(12, left); y = r.top + r.height / 2 - ch / 2; }
  }
  x = Math.min(Math.max(12, x), vw - cw - 12);
  y = Math.min(Math.max(12, y), vh - ch - 12);
  card.style.setProperty('--cx', `${Math.round(x)}px`);
  card.style.setProperty('--cy', `${Math.round(y)}px`);
}

function onKey(e) {
  if (!root) return;
  const keys = { Escape: 'skip', ArrowRight: 'next', ArrowLeft: 'back' };
  if (keys[e.key]) { e.preventDefault(); e.stopImmediatePropagation(); act(keys[e.key]); return; }
  if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); e.stopImmediatePropagation(); act('next'); return; }
  if (e.key === 'Tab') {
    // Фокус не уходит из карточки.
    const f = [...root.querySelectorAll('button:not([hidden])')];
    const i = f.indexOf(document.activeElement);
    e.preventDefault();
    f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
    return;
  }
  // Горячие клавиши плеера, пока идёт обучение, не срабатывают.
  e.stopImmediatePropagation();
}

let raf = 0;
const relayout = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); };

export async function startTour() {
  if (root) return;
  await cssReady;
  if (root) return;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  lastFocus = document.activeElement;
  steps = usableSteps();
  build();
  html.classList.add('touring');
  document.addEventListener('keydown', onKey, true);
  addEventListener('resize', relayout);
  addEventListener('scroll', relayout, true);
  requestAnimationFrame(() => root && root.classList.add('in'));
  go(0);
}

function finish() {
  if (!root) return;
  try { localStorage.setItem(KEY, '1'); } catch { /* приватный режим */ }
  document.removeEventListener('keydown', onKey, true);
  removeEventListener('resize', relayout);
  removeEventListener('scroll', relayout, true);
  const el = root;
  root = null;
  target = null;
  html.classList.remove('touring');
  el.classList.remove('in');
  el.classList.add('out');
  setTimeout(() => el.remove(), reduced() ? 0 : 320);
  if (!isDesktop() && state.library.length) setTab('library');
  if (lastFocus && lastFocus.isConnected) lastFocus.focus?.({ preventScroll: true });
}

/** Первый запуск — обучение целиком; у тех, кто уже пользуется, — короткая подсказка о новом. */
export function maybeStartTour() {
  let seen = false;
  try { seen = localStorage.getItem(KEY) === '1'; } catch { seen = true; }
  if (seen) return;
  if (!state.library.length) { setTimeout(startTour, 500); return; }
  try { localStorage.setItem(KEY, '1'); } catch { /* ничего */ }
  setTimeout(() => toastAction('Новое: ссылку YouTube можно просто вставить Ctrl+V, а ▶ на обложке включает трек до скачивания', 'Обучение', startTour, 12000), 1200);
}

// Стили — только когда обучение понадобилось; показываем после загрузки, чтобы не было кадра без оформления.
const cssReady = new Promise((resolve) => {
  if (document.getElementById('tour-css')) { resolve(); return; }
  const link = document.createElement('link');
  link.id = 'tour-css';
  link.rel = 'stylesheet';
  link.href = 'css/tour.css';
  link.onload = link.onerror = () => resolve();
  document.head.append(link);
});
