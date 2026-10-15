// Общий слой интерфейса. Дизайны рисуют разметку с атрибутами data-act / data-bind /
// data-seek / data-list и т. д., а здесь они оживают — одинаково для всех дизайнов.

import * as core from './core.js';
import { state, audio, recs } from './core.js';
import { settings, save } from './store.js';
import { formatTime, formatLong, formatNumber, plural, yearOf, esc, albumOf } from './format.js';
import { currentDesign, setCover } from './themes.js';
import { saveUrl } from './native.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = document.getElementById('app');
const html = document.documentElement;

let actions = {};
export function registerActions(map) { Object.assign(actions, map); }

export function isDesktop() { return matchMedia('(min-width: 960px)').matches; }

// Обложка не загрузилась (нет файла, нет сети) — прячем значок «битой» картинки, остаётся фон.
document.addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement) e.target.classList.add('broken');
}, true);

// ============ Уведомления ============
export function toast(text, type = 'info', ms = 3200) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
}
core.on('toast', (t) => toast(t.text, t.type, t.ms));

// ============ Привязки к треку ============
function trackBinds(t) {
  const design = currentDesign();
  return {
    title: t ? t.title : design.emptyTitle,
    artist: t ? (t.artist || '—') : design.emptyArtist,
    album: t ? albumOf(t) : '',
    year: t ? yearOf(t.release_date) : '',
    bitrate: t && t.abr ? `${Math.round(t.abr)} кбит/с` : '',
    meta: t ? [albumOf(t), yearOf(t.release_date), t.abr ? `${Math.round(t.abr)} кбит/с` : ''].filter(Boolean).join(' · ') : '',
    views: t ? formatNumber(t.view_count) : '—',
    likes: t ? formatNumber(t.like_count) : '—',
  };
}

export function renderTrack() {
  const t = state.current;
  const binds = trackBinds(t);
  for (const [k, v] of Object.entries(binds)) {
    $$(`[data-bind="${k}"]`).forEach((el) => { el.textContent = v; el.hidden = v === '' && el.hasAttribute('data-hide-empty'); });
  }
  const cover = t ? t.thumbnail_api : '';
  $$('img[data-cover]').forEach((img) => {
    if (!cover) { img.removeAttribute('src'); img.alt = ''; return; }
    if (img.getAttribute('src') !== cover) {
      img.classList.remove('loaded');
      img.onload = () => img.classList.add('loaded');
      img.src = cover;
    }
    img.alt = `Обложка: ${t.title}`;
  });
  $$('[data-cover-bg]').forEach((el) => { el.style.backgroundImage = cover ? `url("${cover}")` : ''; });
  html.classList.toggle('has-track', !!t);
  $$('[data-needs-track]').forEach((el) => { el.disabled = !t; });
  document.title = t ? `${t.title} — ${t.artist}` : 'Моя музыка';
  setCover(cover || null);
  renderTime();
  markRows();
  updateMediaSession();
}

export function renderTime() {
  const dur = audio.duration || (state.current ? state.current._sec : 0) || 0;
  const cur = state.dragging ? state.dragP * dur : audio.currentTime;
  $$('[data-bind="time-cur"]').forEach((el) => { el.textContent = formatTime(cur); });
  $$('[data-bind="time-total"]').forEach((el) => { el.textContent = formatTime(dur); });
  $$('[data-bind="time-left"]').forEach((el) => { el.textContent = '−' + formatTime(Math.max(0, dur - cur)); });
}

let lastP = -1;
function renderProgress(p) {
  if (Math.abs(p - lastP) < 0.0004) return;
  lastP = p;
  $$('[data-seek], [data-seek-view]').forEach((el) => {
    el.style.setProperty('--p', p.toFixed(4));
    if (el.hasAttribute('data-seek')) {
      el.setAttribute('aria-valuenow', Math.round(p * 100));
      el.setAttribute('aria-valuetext', `${formatTime(audio.currentTime)} из ${formatTime(audio.duration)}`);
    }
  });
  renderTime();
}

// ============ Состояние кнопок ============
export function renderState() {
  const playing = !audio.paused;
  html.classList.toggle('is-playing', playing);
  html.classList.toggle('is-muted', audio.muted);
  $$('[data-play-icon]').forEach((u) => u.setAttribute('href', playing ? '#i-pause' : '#i-play'));
  $$('[data-act="play"]').forEach((b) => {
    b.setAttribute('aria-label', playing ? 'Пауза (пробел)' : 'Играть (пробел)');
    b.classList.toggle('latched', playing);
  });
  $$('[data-act="shuffle"]').forEach((b) => { b.classList.toggle('on', settings.shuffle); b.setAttribute('aria-pressed', settings.shuffle); });
  $$('[data-act="repeat"]').forEach((b) => {
    b.classList.toggle('on', settings.repeat !== 'off');
    b.classList.toggle('one', settings.repeat === 'one');
    b.setAttribute('aria-pressed', settings.repeat !== 'off');
    b.title = { off: 'Повтор выключен (R)', all: 'Повтор всего списка (R)', one: 'Повтор одного трека (R)' }[settings.repeat];
  });
  $$('[data-act="meter"]').forEach((b) => { b.classList.toggle('on', settings.meter === 'viz'); b.setAttribute('aria-pressed', settings.meter === 'viz'); });
  $$('[data-act="lyrics-inline"]').forEach((b) => { b.classList.toggle('on', settings.meter === 'lyrics'); b.setAttribute('aria-pressed', settings.meter === 'lyrics'); });
  html.dataset.meter = settings.meter;
  const vol = Math.round(audio.volume * 100);
  $$('input[data-volume]').forEach((r) => { r.value = audio.muted ? 0 : vol; r.style.setProperty('--fill', `${audio.muted ? 0 : vol}%`); });
  $$('[data-vol-icon]').forEach((u) => u.setAttribute('href', audio.muted || audio.volume === 0 ? '#i-mute' : '#i-vol'));
  $$('[data-act="mute"]').forEach((b) => b.setAttribute('aria-label', audio.muted ? 'Включить звук (M)' : 'Выключить звук (M)'));
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

// ============ Список ============
export function renderList() {
  const list = $('[data-list]');
  if (!list) return;
  const design = currentDesign();
  const empty = $('[data-empty]');
  const q = state.query.trim();

  $$('[data-bind="count"]').forEach((el) => { const n = state.library.length; el.textContent = `${n} ${plural(n, 'трек', 'трека', 'треков')}`; });
  $$('[data-bind="total"]').forEach((el) => { el.textContent = formatLong(core.totalSeconds()); });
  $$('[data-act="clear-search"]').forEach((b) => { b.hidden = !q; });
  $$('[data-sort]').forEach((b) => {
    const on = b.dataset.sort === settings.sort;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on);
  });
  $$('input[name="sort"]').forEach((r) => { r.checked = r.value === settings.sort; });

  if (!state.view.length) {
    list.innerHTML = '';
    if (empty) {
      empty.hidden = false;
      const [title, text] = state.loadError
        ? ['Нет связи с сервером', 'Сервер не отвечает. Проверьте, что он запущен, и обновите страницу.']
        : state.library.length
          ? ['Ничего не нашлось', `В библиотеке нет «${q}». Попробуйте другое слово.`]
          : design.emptyLibrary;
      $('[data-empty-title]', empty).textContent = title;
      $('[data-empty-text]', empty).textContent = text;
    }
    return;
  }
  if (empty) empty.hidden = true;
  const cur = state.current && state.current.video_id;
  list.innerHTML = state.view.map((t, i) => design.renderRow(t, i, {
    current: t.video_id === cur,
    played: settings.markPlayed && state.played.has(t.video_id),
    missing: t.file_exists === false,
  }, { esc, formatTime, albumOf })).join('');
}

function markRows() {
  const cur = state.current && state.current.video_id;
  $$('[data-list] [data-id], [data-album-list] [data-id]').forEach((row) => {
    const on = row.dataset.id === cur;
    row.classList.toggle('current', on);
    if (on) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current');
  });
}

// ============ Рекомендации ============
export function renderRecs() {
  const list = $('[data-recs]');
  if (!list) return;
  const design = currentDesign();
  const box = $('[data-recs-state]');
  const seed = recs.seeds.length === 1 ? core.find(recs.seeds[0]) : null;
  $$('[data-recs-seed]').forEach((el) => {
    el.textContent = seed ? `«${seed.title}»` : recs.seeds.length ? 'ваши последние треки' : '—';
  });
  $$('[data-act="recs-refresh"]').forEach((b) => { b.disabled = recs.loading; b.classList.toggle('spinning', recs.loading); });

  let state_ = null;
  if (recs.loading && !recs.items.length) state_ = ['Подбираю треки на YouTube…', 'Это занимает несколько секунд.', 'loading'];
  else if (recs.error && !recs.items.length) state_ = ['YouTube не отвечает', `${recs.error}. Проверьте интернет и нажмите «обновить».`, 'error'];
  else if (!recs.items.length && !state.library.length) state_ = ['Пока не из чего выбирать', 'Добавьте пару треков — рекомендации строятся по вашей музыке.', 'empty'];
  else if (!recs.items.length && recs.loadedFor !== null) state_ = ['Ничего нового', 'Всё похожее уже в библиотеке. Попробуйте другой трек.', 'empty'];

  if (box) {
    box.hidden = !state_;
    if (state_) {
      box.dataset.kind = state_[2];
      $('[data-recs-title]', box).textContent = state_[0];
      $('[data-recs-text]', box).textContent = state_[1];
    }
  }
  list.innerHTML = recs.items.map((r, i) => design.renderRec(r, i, { adding: recs.adding.has(r.id) }, { esc, formatTime })).join('');
}

function openRecs() {
  html.dataset.libview = 'recs';
  const want = state.current ? state.current.video_id : '';
  if (!recs.loading && (recs.loadedFor !== want || recs.error)) core.loadRecs();
  else renderRecs();
}

function flashRow(id) {
  const row = id && $(`[data-list] [data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row.classList.add('flash');
  setTimeout(() => row.classList.remove('flash'), 1900);
}

// ============ Действия ============
function setTab(tab) {
  html.dataset.tab = tab;
  currentDesign().onTab?.(tab);
  core.emit('tab', tab);
}

// Меню «ещё» (о треке, скачать, удалить): кнопка data-act="menu" + соседний .menu.
function closeMenus(except) {
  $$('.menu:not([hidden])').forEach((m) => {
    if (m === except) return;
    m.hidden = true;
    m.previousElementSibling?.setAttribute('aria-expanded', 'false');
  });
}
function toggleMenu(btn) {
  const menu = btn.nextElementSibling;
  if (!menu) return;
  const open = menu.hidden;
  closeMenus(menu);
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('button:not(:disabled)')?.focus();
}

const builtin = {
  menu: (el) => toggleMenu(el),
  play: () => core.toggle(),
  prev: () => core.prev(),
  next: () => core.next(),
  shuffle: () => core.toggleShuffle(),
  repeat: () => core.cycleRepeat(),
  mute: () => core.toggleMute(),
  meter: () => { settings.meter = settings.meter === 'viz' ? 'off' : 'viz'; save(); core.emit('meter'); },
  'lyrics-inline': () => { settings.meter = settings.meter === 'lyrics' ? 'viz' : 'lyrics'; save(); core.emit('meter'); },
  add: () => openAdd(),
  info: () => openInfo(),
  download: () => download(),
  delete: () => confirmDelete(),
  cover: () => openCover(),
  'clear-search': () => {
    $$('input[data-search]').forEach((i) => { i.value = ''; });
    core.setQuery('');
    $('input[data-search]')?.focus();
  },
  'tab-player': () => setTab('player'),
  'tab-library': () => setTab('library'),
  'tab-toggle': () => setTab(html.dataset.tab === 'player' ? 'library' : 'player'),
  'libview-library': () => { html.dataset.libview = 'library'; },
  'libview-recs': () => openRecs(),
  'recs-refresh': () => core.loadRecs({ fresh: true }),
  'rec-add': (el) => core.addRec(el.dataset.recId),
  fold: () => { settings.folded = true; save(); html.classList.add('folded'); },
  unfold: () => { settings.folded = false; save(); html.classList.remove('folded'); },
};

function runAction(name, el, e) {
  const fn = actions[name] || builtin[name];
  if (fn) fn(el, e);
}

document.addEventListener('click', (e) => {
  const row = e.target.closest('[data-list] [data-id], [data-album-list] [data-id]');
  if (row && !e.target.closest('[data-act]')) {
    const t = core.find(row.dataset.id);
    if (!t) return;
    const album = row.closest('[data-album-list]') ? core.findAlbum(core.albums.open) : null;
    if (state.current && state.current.video_id === t.video_id) core.toggle();
    else if (album) core.playAlbum(album, t.video_id);
    else core.playFrom(t, null);
    if (!isDesktop() && currentDesign().rowOpensPlayer) setTab('player');
    return;
  }
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled) {
    e.stopPropagation();
    if (el.dataset.act !== 'menu') closeMenus();
    runAction(el.dataset.act, el, e);
    return;
  }
  closeMenus();
  const sort = e.target.closest('[data-sort]');
  if (sort) core.setSort(sort.dataset.sort);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('.menu:not([hidden])')) { closeMenus(); return; }
  // Клавиатура на «кнопках», сделанных не из <button> (мини-плеер).
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-act][role="button"]')) {
    e.preventDefault();
    runAction(e.target.dataset.act, e.target, e);
  }
});

document.addEventListener('input', (e) => {
  if (e.target.matches('input[data-search]')) {
    $$('input[data-search]').forEach((i) => { if (i !== e.target) i.value = e.target.value; });
    core.setQuery(e.target.value);
  } else if (e.target.matches('input[data-volume]')) {
    audio.muted = false;
    core.setVolume(e.target.value / 100);
  }
});

document.addEventListener('change', (e) => {
  if (e.target.matches('input[name="sort"]')) core.setSort(e.target.value);
});

// ============ Перемотка ============
function pointerP(el, e) {
  const r = el.getBoundingClientRect();
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
}

let seekEl = null;
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('[data-seek]');
  if (!el || !audio.duration || e.button > 0) return;
  seekEl = el;
  state.dragging = true;
  state.dragP = pointerP(el, e);
  el.classList.add('dragging');
  el.setPointerCapture(e.pointerId);
  renderProgress(state.dragP);
});
document.addEventListener('pointermove', (e) => {
  if (!seekEl) return;
  state.dragP = pointerP(seekEl, e);
  renderProgress(state.dragP);
});
function endSeek(e, commit) {
  if (!seekEl) return;
  if (commit) core.seekP(pointerP(seekEl, e));
  seekEl.classList.remove('dragging');
  seekEl = null;
  state.dragging = false;
}
document.addEventListener('pointerup', (e) => endSeek(e, true));
document.addEventListener('pointercancel', (e) => endSeek(e, false));

// ============ Окна ============
document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  });
});

function openCover() {
  const t = state.current;
  if (!t) return;
  const dlg = $('#cover-dialog');
  let img = $('img', dlg);
  if (!img) { img = document.createElement('img'); dlg.append(img); }
  img.src = t.thumbnail_api;
  img.alt = `Обложка: ${t.title}`;
  dlg.showModal();
}

const addDialog = $('#add-dialog');
const addStatus = $('#add-status');
let adding = false;

function openAdd() {
  if (!adding && !searching) { addStatus.textContent = ''; addStatus.className = 'status'; }
  addDialog.showModal();
  $('#url-input').focus();
}

// В поле — ссылка или название? Название ищется на YouTube.
const isLink = (v) => /^https?:\/\//i.test(v) || /^(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(v);
function submitLabel() {
  const v = $('#url-input').value.trim();
  return v && !isLink(v) ? 'Найти' : 'Загрузить';
}

// ---- Поиск по названию ----
const search = { items: [], busy: new Set() };
let searching = false;
let searchToken = 0;

function renderSearch() {
  const box = $('#add-results');
  box.hidden = !search.items.length;
  box.innerHTML = search.items.map((r, i) => {
    const sub = [r.artist, r.duration ? formatTime(r.duration) : ''].filter(Boolean).map(esc).join(' · ');
    const busy = search.busy.has(r.id);
    const btn = r.in_library
      ? `<span class="icon-btn in-lib" title="Уже в библиотеке" aria-label="Уже в библиотеке"><svg aria-hidden="true"><use href="#i-check"/></svg></span>`
      : `<button type="button" class="icon-btn" data-search-add="${i}" aria-busy="${busy}" ${busy ? 'disabled' : ''} aria-label="Загрузить «${esc(r.title)}»" title="Загрузить в библиотеку">
          <svg class="idle" aria-hidden="true"><use href="#i-plus"/></svg><svg class="busy" aria-hidden="true"><use href="#i-refresh"/></svg>
        </button>`;
    return `<li class="search-row">
      <img src="${esc(r.thumb)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
      <span class="pick-text"><span class="pick-name">${esc(r.title)}</span><span class="pick-meta">${sub}</span></span>
      ${btn}
    </li>`;
  }).join('');
}

async function runSearch(q) {
  const token = ++searchToken;
  searching = true;
  $('#submit-add').disabled = true;
  $('#submit-label').textContent = 'Ищу…';
  addStatus.className = 'status';
  addStatus.textContent = `Ищу «${q}» на YouTube…`;
  try {
    const items = await core.searchTracks(q);
    if (token !== searchToken) return;
    search.items = items;
    addStatus.textContent = items.length ? '' : 'Ничего не нашлось. Попробуйте написать иначе или вставьте ссылку.';
  } catch (err) {
    if (token !== searchToken) return;
    addStatus.className = 'status error';
    addStatus.textContent = `Поиск не удался: ${err.message}. Проверьте интернет и попробуйте ещё раз.`;
  } finally {
    if (token === searchToken) {
      searching = false;
      $('#submit-add').disabled = false;
      $('#submit-label').textContent = submitLabel();
      renderSearch();
    }
  }
}

$('#add-results').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-search-add]');
  if (!btn) return;
  const r = search.items[+btn.dataset.searchAdd];
  if (!r || r.in_library || search.busy.has(r.id)) return;
  search.busy.add(r.id);
  renderSearch();
  try {
    const track = await core.addTrack(r.url);
    r.in_library = true;
    toast(`Добавлен «${track?.title || r.title}»`, 'ok');
    flashRow(track?.video_id);
  } catch (err) {
    toast(`Не удалось добавить «${r.title}»: ${err.message}`, 'error', 5000);
  } finally {
    search.busy.delete(r.id);
    renderSearch();
  }
});

// Ссылка на альбом/плейлист: предлагаем скачать его целиком.
function playlistKind(url) {
  if (/\/(playlist|browse)\b/.test(url)) return 'playlist';   // сам плейлист или альбом
  if (/[?&]list=/.test(url)) return 'track';                     // трек внутри плейлиста — по умолчанию только он
  return null;
}
$('#url-input').addEventListener('input', (e) => {
  if (!adding && !searching) $('#submit-label').textContent = submitLabel();
  const v = e.target.value.trim();
  const kind = isLink(v) ? playlistKind(v) : null;
  const box = $('#add-mode');
  const was = !box.hidden;
  box.hidden = !kind;
  if (kind && !was) $(`input[name="add-mode"][value="${kind}"]`).checked = true;
});

$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#url-input');
  let url = input.value.trim();
  if (!url || adding) return;
  if (!isLink(url)) {
    if (!searching) runSearch(url);
    return;
  }
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  if (!$('#add-mode').hidden && $('input[name="add-mode"]:checked').value === 'playlist') {
    adding = true;
    $('#submit-add').disabled = true;
    $('#submit-label').textContent = 'Читаю плейлист…';
    addStatus.className = 'status';
    addStatus.textContent = 'Узнаю, какие треки в плейлисте…';
    try {
      const job = await core.addPlaylist(url);
      input.value = '';
      $('#add-mode').hidden = true;
      toast(`Скачиваю «${job.name}»: ${job.total} ${plural(job.total, 'трек', 'трека', 'треков')} — прогресс внизу`, 'ok', 5000);
      addDialog.close();
    } catch (err) {
      addStatus.className = 'status error';
      addStatus.textContent = `Не получилось: ${err.message}`;
    } finally {
      adding = false;
      $('#submit-add').disabled = false;
      $('#submit-label').textContent = 'Загрузить';
    }
    return;
  }
  adding = true;
  const btn = $('#submit-add');
  btn.disabled = true;
  html.classList.add('is-adding');
  $('#submit-label').textContent = 'Загружаю…';
  addStatus.className = 'status';
  addStatus.textContent = 'Скачиваю и конвертирую. Окно можно закрыть — загрузка продолжится.';
  try {
    const track = await core.addTrack(url);
    input.value = '';
    addStatus.className = 'status ok';
    addStatus.textContent = `Готово: ${track?.title || 'трек'}`;
    toast(`Добавлен «${track?.title || 'трек'}»`, 'ok');
    flashRow(track?.video_id);
    setTimeout(() => { if (addDialog.open) addDialog.close(); }, 900);
  } catch (err) {
    addStatus.className = 'status error';
    addStatus.textContent = `Не получилось: ${err.message}. Проверьте ссылку и интернет и попробуйте ещё раз.`;
    if (!addDialog.open) toast('Не удалось добавить трек', 'error', 5000);
  } finally {
    adding = false;
    btn.disabled = false;
    html.classList.remove('is-adding');
    $('#submit-label').textContent = 'Загрузить';
  }
});

function openInfo() {
  const t = state.current;
  if (!t) return;
  const rows = [
    ['Название', t.title],
    ['Исполнитель', t.artist],
    ['Альбом', t.album],
    ['Дата', t.release_date],
    ['Длительность', t._sec ? formatTime(t._sec) : t.duration],
    ['Просмотры', formatNumber(t.view_count)],
    ['Лайки', formatNumber(t.like_count)],
    ['Битрейт', t.abr ? `${Math.round(t.abr)} кбит/с` : '—'],
    ['Размер', t.filesize_mb ? `${t.filesize_mb} МБ` : '—'],
    ['Формат', 'opus'],
  ];
  if (t.original_url) rows.push(['Источник', t.original_url]);
  // Каждая строка — один блок с одной линией снизу, поэтому подпись и значение не «плывут».
  $('#info-list').innerHTML = rows.map(([k, v]) => `<div class="kv"><span class="kv-key">${k}</span><span class="kv-val">${esc(v ?? '—')}</span></div>`).join('');
  $('#info-dialog').showModal();
}

function download() {
  const t = state.current;
  if (!t) return;
  const url = `/api/stream/${encodeURIComponent(t.video_id)}`;
  const name = `${t.artist} - ${t.title}.opus`.replace(/[\\/:*?"<>|]/g, ' ');
  if (saveUrl(url, name)) { toast('Сохраняю в «Загрузки»'); return; }
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  toast('Скачивание началось');
}

function confirmDelete() {
  const t = state.current;
  if (!t) return;
  const dlg = $('#confirm-dialog');
  $('#confirm-text').textContent = `«${t.title}» — ${t.artist}`;
  dlg.returnValue = '';
  dlg.showModal();
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'yes') return;
    try {
      await core.removeTrack(t);
      toast(`«${t.title}» удалён`, 'ok');
    } catch (err) {
      toast(`Не удалось удалить: ${err.message}`, 'error');
    }
  }, { once: true });
}

// ============ Экран блокировки телефона ============
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const t = state.current;
  if (!t) { navigator.mediaSession.metadata = null; return; }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title || '',
    artist: t.artist || '',
    album: albumOf(t),
    artwork: [{ src: new URL(t.thumbnail_api, location.href).href, sizes: '1280x720', type: 'image/jpeg' }],
  });
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const safe = (name, fn) => { try { ms.setActionHandler(name, fn); } catch { /* не поддерживается */ } };
  safe('play', () => core.play());
  safe('pause', () => core.pause());
  safe('previoustrack', () => core.prev());
  safe('nexttrack', () => core.next());
  safe('seekto', (d) => { if (d.seekTime != null) core.seek(d.seekTime); });
  safe('seekbackward', (d) => core.seek(audio.currentTime - (d.seekOffset || 10)));
  safe('seekforward', (d) => core.seek(audio.currentTime + (d.seekOffset || 10)));
}

// ============ Горячие клавиши ============
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, dialog, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.getElementById('lyrics-full').hidden === false && e.code !== 'Escape') return;
  // Пробел и Enter на кнопке в фокусе нажимают её саму — не дублируем это паузой.
  if ((e.code === 'Space' || e.code === 'Enter') && e.target.closest('button, [role="button"]')) return;
  switch (e.code) {
    case 'Space': e.preventDefault(); core.toggle(); break;
    case 'ArrowRight': e.preventDefault(); core.seek(audio.currentTime + 5); break;
    case 'ArrowLeft': e.preventDefault(); core.seek(audio.currentTime - 5); break;
    case 'ArrowUp': e.preventDefault(); core.setVolume(audio.volume + 0.05); break;
    case 'ArrowDown': e.preventDefault(); core.setVolume(audio.volume - 0.05); break;
    case 'KeyN': core.next(); break;
    case 'KeyP': core.prev(); break;
    case 'KeyM': core.toggleMute(); break;
    case 'KeyS': core.toggleShuffle(); break;
    case 'KeyR': core.cycleRepeat(); break;
    case 'KeyV': runAction('meter'); break;
    case 'KeyL': runAction('lyrics'); break;
    case 'KeyB':
      if (isDesktop()) runAction(html.classList.contains('folded') ? 'unfold' : 'fold');
      else runAction('tab-toggle');
      break;
    case 'Slash':
      e.preventDefault();
      if (!isDesktop()) setTab('library');
      $('input[data-search]')?.focus();
      break;
    default: return;
  }
});

// ============ Рендер дизайна ============
let unmountDesign = null;
export function mountDesign() {
  const design = currentDesign();
  if (unmountDesign) { unmountDesign(); unmountDesign = null; }
  app.innerHTML = design.template();
  html.classList.toggle('folded', !!settings.folded);
  if (!html.dataset.tab) html.dataset.tab = 'library';
  $$('input[data-search]').forEach((i) => { i.value = state.query; });
  unmountDesign = design.mount?.(app) || null;
  lastP = -1;
  if (!html.dataset.libview) html.dataset.libview = 'library';
  renderList();
  renderRecs();
  renderTrack();
  renderState();
  renderProgress(core.progress());
}

core.on('library', renderList);
core.on('recs', renderRecs);
// Сменился трек, а рекомендации открыты и видны — подобрать новые под него.
core.on('track', (t) => {
  const panel = $('[data-recs]');
  if (t && html.dataset.libview === 'recs' && panel && panel.offsetParent && recs.loadedFor !== t.video_id && !recs.loading) core.loadRecs();
});
core.on('track', renderTrack);
core.on('state', renderState);
core.on('meter', renderState);
core.on('time', () => renderProgress(core.progress()));
core.on('played', () => renderList());
core.on('frame', (f) => {
  renderProgress(f.p);
  currentDesign().frame?.(f);
});

export { setTab, runAction };
