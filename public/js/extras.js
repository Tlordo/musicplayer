// Меню трека (долгое нажатие или правый клик по строке), очередь, таймер сна и статистика.
// Окна общие для всех дизайнов и рисуются токенами --ui-*.

import * as core from './core.js';
import { state } from './core.js';
import { settings } from './store.js';
import { esc, formatTime, formatLong, plural } from './format.js';
import { registerActions, toast, openInfo, download, confirmDelete, isDesktop, setTab } from './ui.js';
import { openAlbumPicker } from './albums.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const cover = (t) => `<img src="${esc(t.thumbnail_api)}" alt="" loading="lazy" decoding="async">`;
const nTracks = (n) => `${n} ${plural(n, 'трек', 'трека', 'треков')}`;

// ============ Меню трека ============
const trackDialog = $('#track-dialog');
let sheetTrack = null;

function openTrackSheet(t) {
  if (!t) return;
  sheetTrack = t;
  const isCur = state.current && state.current.video_id === t.video_id;
  $('#track-sheet-head').innerHTML = `${cover(t)}
    <span class="pick-text"><span class="pick-name">${esc(t.title)}</span><span class="pick-meta">${esc(t.artist || '—')}${t.plays ? ` · ${t.plays} ${plural(t.plays, 'прослушивание', 'прослушивания', 'прослушиваний')}` : ''}</span></span>`;
  const item = (act, icon, label, cls = '') => `<button type="button" class="${cls}" data-ts="${act}"><svg aria-hidden="true"><use href="#${icon}"/></svg>${label}</button>`;
  $('#track-sheet-items').innerHTML = [
    isCur ? '' : item('play-next', 'i-play-next', 'Играть следующим'),
    isCur ? '' : item('enqueue', 'i-queue', 'В конец очереди'),
    item('like', t.liked ? 'i-heart' : 'i-heart-line', t.liked ? 'Убрать из любимого' : 'В любимое', t.liked ? 'liked' : ''),
    item('album', 'i-album', 'В альбом…'),
    item('info', 'i-info', 'О треке'),
    item('download', 'i-down', 'Скачать файл'),
    item('delete', 'i-erase', 'Удалить трек', 'danger'),
  ].join('');
  trackDialog.showModal();
}

$('#track-sheet-items').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ts]');
  const t = sheetTrack;
  if (!b || !t) return;
  trackDialog.close();
  switch (b.dataset.ts) {
    case 'play-next': core.playNext(t); toast(`«${t.title}» заиграет следующим`, 'ok', 2200); break;
    case 'enqueue': core.enqueue(t); toast(`«${t.title}» в очереди`, 'ok', 2200); break;
    case 'like': core.toggleLike(t); break;
    case 'album': openAlbumPicker(t); break;
    case 'info': openInfo(t); break;
    case 'download': download(t); break;
    case 'delete': confirmDelete(t); break;
  }
});

// Долгое нажатие на строку (телефон) и правый клик (компьютер).
const ROWS = '[data-list] [data-id], [data-album-list] [data-id], [data-queue-row]';
let press = null;
let suppressClick = false;

document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  const row = e.target.closest(ROWS);
  if (!row || e.target.closest('[data-act]')) return;
  press = {
    x: e.clientX, y: e.clientY,
    timer: setTimeout(() => {
      press = null;
      suppressClick = true;
      navigator.vibrate?.(12);
      openTrackSheet(core.find(row.dataset.id));
    }, 480),
  };
});
const cancelPress = () => { if (press) { clearTimeout(press.timer); press = null; } };
document.addEventListener('pointermove', (e) => {
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
});
document.addEventListener('pointerup', cancelPress);
document.addEventListener('pointercancel', cancelPress);
document.addEventListener('scroll', cancelPress, true);
// После долгого нажатия отпускание пальца не должно включать трек.
document.addEventListener('click', (e) => {
  if (!suppressClick) return;
  suppressClick = false;
  if (e.target.closest(ROWS)) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
document.addEventListener('contextmenu', (e) => {
  const row = e.target.closest(ROWS);
  if (!row) return;
  e.preventDefault();
  cancelPress();
  openTrackSheet(core.find(row.dataset.id));
});

// ============ Очередь ============
const queueDialog = $('#queue-dialog');

function queueRow(t, i, kind) {
  const tools = kind === 'queued' ? `<span class="q-tools">
      <button type="button" class="icon-btn small" data-q="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Выше «${esc(t.title)}»" title="Выше"><svg><use href="#i-chev-up"/></svg></button>
      <button type="button" class="icon-btn small" data-q="remove" data-i="${i}" aria-label="Убрать «${esc(t.title)}» из очереди" title="Убрать из очереди"><svg><use href="#i-x"/></svg></button>
    </span>` : '';
  return `<li class="q-row">
    <button type="button" class="q-main" data-queue-row data-q="play-${kind}" data-i="${i}" data-id="${esc(t.video_id)}">
      ${cover(t)}<span class="pick-text"><span class="pick-name">${esc(t.title)}</span><span class="pick-meta">${esc(t.artist || '')}</span></span>
      <span class="pick-meta">${t._sec ? formatTime(t._sec) : ''}</span>
    </button>${tools}</li>`;
}

function renderQueue() {
  if (!queueDialog.open) return;
  const { queued, then, shuffled } = core.upcoming(30);
  const cur = state.current;
  const ctx = core.contextName();
  $('#queue-body').innerHTML = `
    ${cur ? `<section class="q-sec"><h3 class="q-h">Сейчас играет</h3><div class="q-now">${cover(cur)}<span class="pick-text"><span class="pick-name">${esc(cur.title)}</span><span class="pick-meta">${esc(cur.artist || '')}</span></span></div></section>` : ''}
    <section class="q-sec">
      <div class="q-h-row"><h3 class="q-h">Далее в очереди${queued.length ? ` · ${nTracks(queued.length)}` : ''}</h3>
        ${queued.length ? '<button type="button" class="pill-btn q-clear" data-q="clear">Очистить</button>' : ''}</div>
      ${queued.length ? `<ol class="q-list">${queued.map((t, i) => queueRow(t, i, 'queued')).join('')}</ol>`
        : '<p class="hint">Пусто. Зажмите трек в списке (или правый клик) → «Играть следующим» или «В конец очереди».</p>'}
    </section>
    <section class="q-sec">
      <h3 class="q-h">Потом — из «${esc(ctx)}»</h3>
      ${shuffled ? '<p class="hint">Вперемешку, без повторов, пока не прозвучит весь список.</p>'
        : then.length ? `<ol class="q-list">${then.map((t, i) => queueRow(t, i, 'then')).join('')}</ol>`
          : `<p class="hint">${settings.autoNext ? 'Это последний трек. Включите «повтор всего», чтобы начать сначала.' : 'Автопереход выключен в настройках.'}</p>`}
    </section>`;
}

function openQueue() {
  queueDialog.showModal();
  renderQueue();
}

$('#queue-body').addEventListener('click', (e) => {
  const b = e.target.closest('[data-q]');
  if (!b || b.disabled) return;
  const i = Number(b.dataset.i);
  switch (b.dataset.q) {
    case 'up': core.moveInQueue(i, i - 1); break;
    case 'remove': core.dequeue(i); break;
    case 'clear': core.clearUpNext(); break;
    case 'play-queued': {
      const t = core.find(state.upNext[i]);
      core.dequeue(i);
      if (t) core.load(t, true);
      break;
    }
    case 'play-then': { const t = core.find(b.dataset.id); if (t) core.load(t, true); break; }
  }
});

core.on('queue', renderQueue);
core.on('track', renderQueue);
core.on('state', renderQueue);

// ============ Таймер сна ============
const sleepDialog = $('#sleep-dialog');
const SLEEP_OPTS = [10, 15, 30, 45, 60, 90];

function clock(ms) {
  return new Date(ms).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
}

function renderSleep() {
  const left = core.sleepLeft();
  const s = state.sleep;
  const badge = s ? (s.endOfTrack ? 'трек' : `${Math.ceil(left / 60)} мин`) : '';
  $$('[data-sleep-badge]').forEach((el) => { el.hidden = !s; el.textContent = badge; });
  $$('[data-act="sleep"]').forEach((el) => el.classList.toggle('on', !!s));
  if (!sleepDialog.open) return;
  $('#sleep-status').textContent = !s ? 'Выключен'
    : s.endOfTrack ? 'Остановится, когда закончится этот трек'
      : `Остановится в ${clock(s.at)} — через ${formatTime(left)}${left < 20 ? ', звук затихает' : ''}`;
  $('#sleep-off').hidden = !s;
}

function openSleep() {
  $('#sleep-opts').innerHTML = SLEEP_OPTS.map((m) => `<button type="button" class="pill-btn" data-sleep="${m}">${m} мин</button>`).join('')
    + '<button type="button" class="pill-btn" data-sleep="track">До конца трека</button>';
  sleepDialog.showModal();
  renderSleep();
}

$('#sleep-opts').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sleep]');
  if (!b) return;
  const v = b.dataset.sleep;
  core.setSleep(v === 'track' ? 'track' : Number(v));
  toast(v === 'track' ? 'Остановлю после этого трека' : `Остановлю в ${clock(state.sleep.at)}`, 'ok', 2400);
  sleepDialog.close();
});
$('#sleep-off').addEventListener('click', () => { core.setSleep(0); toast('Таймер сна выключен'); renderSleep(); });
core.on('sleep', renderSleep);
core.on('sleep-tick', renderSleep);

// ============ Статистика ============
const statsDialog = $('#stats-dialog');
const PERIODS = [[7, '7 дней'], [30, '30 дней'], [365, 'Год'], [0, 'Всё время']];
let statsDays = 30;
let statsToken = 0;

function hours(sec) {
  return sec >= 3600 ? formatLong(sec) : `${Math.round(sec / 60)} мин`;
}

/** Столбики по дням (за 7/30 дней) или по месяцам (год, всё время). Одна серия — цвет акцента. */
function chartHtml(days, period) {
  const byMonth = !period || period > 31;
  const buckets = new Map();
  const key = (d) => (byMonth ? d.slice(0, 7) : d);
  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (!byMonth) {
    for (let i = period - 1; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); buckets.set(iso(d), [0, 0]); }
  } else if (period) {
    for (let i = 11; i >= 0; i--) { const d = new Date(today.getFullYear(), today.getMonth() - i, 1); buckets.set(iso(d).slice(0, 7), [0, 0]); }
  }
  for (const [d, n, sec] of days) {
    const k = key(d);
    const b = buckets.get(k) || [0, 0];
    b[0] += n; b[1] += sec;
    buckets.set(k, b);
  }
  const list = [...buckets].sort((a, b) => a[0].localeCompare(b[0]));
  if (!list.length) return '';
  const max = Math.max(1, ...list.map(([, b]) => b[1]));
  const label = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    return byMonth ? new Date(y, m - 1, 1).toLocaleDateString('ru', { month: 'short', year: '2-digit' })
      : new Date(y, m - 1, d).toLocaleDateString('ru', { day: 'numeric', month: 'short' });
  };
  const bars = list.map(([k, [n, sec]]) => {
    const tip = `${label(k)}: ${hours(sec)}, ${n} ${plural(n, 'прослушивание', 'прослушивания', 'прослушиваний')}`;
    return `<span class="st-col" title="${esc(tip)}" aria-label="${esc(tip)}" role="img"><i${sec > 0 ? ' class="some"' : ''} style="--h:${(sec / max).toFixed(3)}"></i></span>`;
  }).join('');
  return `<figure class="st-chart">
    <figcaption class="q-h">Время прослушивания ${byMonth ? 'по месяцам' : 'по дням'}</figcaption>
    <div class="st-bars" style="--n:${list.length}">${bars}</div>
    <div class="st-axis"><span>${esc(label(list[0][0]))}</span><span>${esc(label(list[list.length - 1][0]))}</span></div>
  </figure>`;
}

async function renderStats() {
  const token = ++statsToken;
  const box = $('#stats-body');
  $('#stats-periods').innerHTML = PERIODS.map(([d, l]) => `<button type="button" role="radio" aria-checked="${d === statsDays}" data-period="${d}">${l}</button>`).join('');
  box.setAttribute('aria-busy', 'true');
  let s;
  try {
    s = await core.loadStats(statsDays);
  } catch (err) {
    if (token === statsToken) box.innerHTML = `<p class="status error">Не удалось загрузить: ${esc(err.message)}</p>`;
    return;
  } finally {
    if (token === statsToken) box.removeAttribute('aria-busy');
  }
  if (token !== statsToken) return;
  if (!s.plays) {
    box.innerHTML = '<p class="hint">За этот период прослушиваний нет. Трек засчитывается, когда прозвучала половина его или хотя бы 30 секунд.</p>';
    return;
  }
  const maxArtist = Math.max(1, ...s.top_artists.map((a) => a[1]));
  const tracks = s.top_tracks.map(([id, n]) => [core.find(id), n]).filter(([t]) => t).slice(0, 10);
  box.innerHTML = `
    <div class="st-tiles">
      <div class="st-tile"><span class="st-num">${hours(s.seconds)}</span><span class="st-cap">музыки</span></div>
      <div class="st-tile"><span class="st-num">${s.plays}</span><span class="st-cap">${plural(s.plays, 'прослушивание', 'прослушивания', 'прослушиваний')}</span></div>
      <div class="st-tile"><span class="st-num">${s.tracks}</span><span class="st-cap">${plural(s.tracks, 'разный трек', 'разных трека', 'разных треков')}</span></div>
    </div>
    ${chartHtml(s.days, statsDays)}
    <section class="q-sec"><h3 class="q-h">Чаще всего</h3>
      <ol class="q-list st-top">${tracks.map(([t, n], i) => `<li class="q-row"><button type="button" class="q-main" data-queue-row data-id="${esc(t.video_id)}" data-st-play>
        <span class="st-rank">${i + 1}</span>${cover(t)}<span class="pick-text"><span class="pick-name">${esc(t.title)}</span><span class="pick-meta">${esc(t.artist || '')}</span></span>
        <span class="pick-meta">${n}×</span></button></li>`).join('')}</ol>
    </section>
    <section class="q-sec"><h3 class="q-h">Исполнители</h3>
      <ol class="st-artists">${s.top_artists.map(([name, n, sec]) => `<li title="${esc(`${name}: ${n}×, ${hours(sec)}`)}">
        <span class="st-a-name">${esc(name)}</span><span class="st-a-bar"><i style="--w:${(n / maxArtist).toFixed(3)}"></i></span><span class="st-a-n">${n}</span></li>`).join('')}</ol>
    </section>`;
}

function openStats() {
  statsDialog.showModal();
  renderStats();
}

$('#stats-periods').addEventListener('click', (e) => {
  const b = e.target.closest('[data-period]');
  if (!b) return;
  statsDays = Number(b.dataset.period);
  renderStats();
});
$('#stats-body').addEventListener('click', (e) => {
  const b = e.target.closest('[data-st-play]');
  const t = b && core.find(b.dataset.id);
  if (!t) return;
  statsDialog.close();
  core.playFrom(t, null);
  if (!isDesktop()) setTab('player');
});

registerActions({
  queue: () => openQueue(),
  sleep: () => openSleep(),
  stats: () => openStats(),
});

// Q — очередь, F — в любимое.
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, dialog, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.getElementById('lyrics-full').hidden === false) return;
  if (e.code === 'KeyQ') openQueue();
  else if (e.code === 'KeyF' && state.current) core.toggleLike(state.current);
});

export { openTrackSheet };
