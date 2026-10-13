'use strict';

// ============ Утилиты ============
const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const icon = (cls) => el('i', { class: cls });

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return String(num);
}

function formatSize(bytes) {
  if (!bytes) return '—';
  if (bytes >= 1 << 30) return (bytes / (1 << 30)).toFixed(2) + ' ГБ';
  if (bytes >= 1 << 20) return (bytes / (1 << 20)).toFixed(1) + ' МБ';
  return Math.round(bytes / 1024) + ' КБ';
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return d ? `${d}.${m}.${y}` : iso;
}

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('mp:' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('mp:' + key, JSON.stringify(value)); } catch { /* приватный режим */ }
  },
};

async function api(path, options = {}) {
  const opts = { ...options };
  if (opts.body !== undefined && typeof opts.body !== 'string') {
    opts.body = JSON.stringify(opts.body);
    opts.headers = { 'Content-Type': 'application/json', ...opts.headers };
  }
  const res = await fetch('/api' + path, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw Object.assign(new Error(data?.error || res.statusText), { status: res.status, data });
  return data;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const COVER_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#1e1e1e"/>
   <text x="50" y="62" font-size="40" text-anchor="middle" fill="#555">♪</text></svg>`);

function coverImg(track, cls) {
  const img = el('img', { class: cls, alt: '', loading: 'lazy', src: track.thumbnail_api || COVER_PLACEHOLDER });
  img.addEventListener('error', () => { img.src = COVER_PLACEHOLDER; }, { once: true });
  return img;
}

// ============ DOM ============
const audio = $('audio');
const visualizer = $('visualizer');
const visualizerCtx = visualizer.getContext('2d');
const sidebar = $('sidebar');
const searchInput = $('search-input');
const views = {
  list: $('playlist-list'),
  grid: $('playlist-grid'),
  compact: $('playlist-compact'),
  table: $('playlist-table'),
};
const tableBody = $('table-body');
const playBtn = $('play-btn');
const shuffleBtn = $('shuffle-btn');
const repeatBtn = $('repeat-btn');
const favBtn = $('fav-btn');
const volumeSlider = $('volume-slider');
const volumeBtn = $('volume-btn');
const speedBtn = $('speed-btn');
const speedOptions = $('speed-options');
const visualizerBtn = $('visualizer-btn');
const waveform = $('waveform');
const progressBar = $('progress-bar');
const modals = [...document.querySelectorAll('.modal')];

// ============ Состояние ============
const state = {
  library: [],          // все треки
  byId: new Map(),      // video_id → трек
  playlists: [],
  jobs: new Map(),      // id → задача загрузки
  collection: store.get('collection', 'all'), // all | favorites | recent | pl:<id>
  filtered: [],         // текущий видимый список
  view: store.get('view', 'list'),
  sort: store.get('sort', 'default'),
  sortDesc: store.get('sortDesc', false),
  current: null,        // video_id текущего трека
  context: [],          // порядок воспроизведения (video_id)
  contextBase: [],      // исходный (неперемешанный) порядок
  contextName: '',
  contextPos: -1,
  userQueue: [],        // «играть следующим»
  history: [],
  shuffle: store.get('shuffle', false),
  repeat: store.get('repeat', 'off'), // off | all | one
  showVisualizer: store.get('visualizer', true),
  pendingRestore: null,
  playCounted: false,
  sleepTimer: null,
  sleepMode: 0,
};

// ============ Уведомления ============
function notify(message, type = 'info', timeout = 4000) {
  const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
  const close = () => {
    n.style.opacity = '0';
    n.style.transform = 'translateX(100px)';
    setTimeout(() => n.remove(), 300);
  };
  const n = el('div', { class: `notification ${type}` },
    icon(`fas ${icons[type]}`),
    el('span', { class: 'message' }, message),
    el('button', { class: 'close-notification', onclick: close, title: 'Закрыть' }, '×'));
  $('notifications').append(n);
  if (timeout) setTimeout(close, timeout);
}

// ============ Модальные окна ============
function openModal(modal) {
  modals.forEach((m) => m !== modal && m.classList.add('hidden'));
  modal.classList.remove('hidden');
  modal.querySelector('input:not([type=hidden]), textarea')?.focus();
}
function closeModals() { modals.forEach((m) => m.classList.add('hidden')); }
document.querySelectorAll('.modal .close-btn').forEach((b) => b.addEventListener('click', closeModals));
modals.forEach((m) => m.addEventListener('mousedown', (e) => { if (e.target === m) closeModals(); }));

// ============ Загрузка данных ============
async function loadLibrary() {
  try {
    const tracks = await api('/library');
    state.library = tracks;
    state.byId = new Map(tracks.map((t) => [t.video_id, t]));
    state.context = state.context.filter((id) => state.byId.has(id));
    state.userQueue = state.userQueue.filter((id) => state.byId.has(id));
    if (state.current && !state.byId.has(state.current)) stopPlayback();
    else if (state.current) updateNowPlaying(state.byId.get(state.current), false);
    refresh();
  } catch (err) {
    console.error(err);
    notify('Ошибка загрузки библиотеки: ' + err.message, 'error');
  }
}

async function loadPlaylists() {
  try {
    state.playlists = await api('/playlists');
    if (state.collection.startsWith('pl:') && !currentPlaylist()) state.collection = 'all';
    refresh();
  } catch (err) {
    notify('Ошибка загрузки плейлистов: ' + err.message, 'error');
  }
}

async function loadJobs() {
  try {
    const jobs = await api('/jobs');
    state.jobs = new Map(jobs.map((j) => [j.id, j]));
    renderJobs();
  } catch { /* не критично */ }
}

const reloadLibrary = debounce(loadLibrary, 300);
const reloadPlaylists = debounce(loadPlaylists, 300);

// ============ Коллекции ============
function currentPlaylist() {
  if (!state.collection.startsWith('pl:')) return null;
  const id = Number(state.collection.slice(3));
  return state.playlists.find((p) => p.id === id) || null;
}

function collectionTracks() {
  switch (state.collection) {
    case 'favorites': return state.library.filter((t) => t.favorite);
    case 'recent': return state.library.filter((t) => t.last_played_at)
      .sort((a, b) => b.last_played_at - a.last_played_at).slice(0, 100);
    default: {
      const pl = currentPlaylist();
      return pl ? pl.track_ids.map((id) => state.byId.get(id)).filter(Boolean) : state.library.slice();
    }
  }
}

function collectionName() {
  return { all: 'Все треки', favorites: 'Избранное', recent: 'Недавние' }[state.collection]
    || currentPlaylist()?.name || 'Все треки';
}

function renderCollections() {
  const box = $('collections');
  const chip = (key, label, iconCls, extra = {}) => el('button', {
    class: 'chip' + (state.collection === key ? ' active' : ''),
    onclick: () => setCollection(key),
    ...extra,
  }, icon(iconCls), label);

  const items = [
    chip('all', 'Все', 'fas fa-music'),
    chip('favorites', 'Избранное', 'fas fa-heart'),
    chip('recent', 'Недавние', 'fas fa-clock-rotate-left'),
    ...state.playlists.map((p) => chip(`pl:${p.id}`, `${p.name} · ${p.track_ids.length}`, 'fas fa-list', {
      oncontextmenu: (e) => showPlaylistMenu(e, p),
      title: 'ПКМ — переименовать или удалить',
      ondragover: (e) => e.preventDefault(),
      ondrop: (e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/x-video-id');
        if (id) addToPlaylist(p.id, id);
      },
    })),
    el('button', { class: 'chip ghost', title: 'Новый плейлист', onclick: () => createPlaylistPrompt() }, icon('fas fa-plus')),
  ];
  box.replaceChildren(...items);
}

function setCollection(key) {
  state.collection = key;
  store.set('collection', key);
  refresh();
}

// ============ Фильтры и сортировка ============
function applyFilters() {
  const q = searchInput.value.trim().toLowerCase();
  let list = collectionTracks();
  if (q) {
    const words = q.split(/\s+/);
    list = list.filter((t) => {
      const hay = `${t.title} ${t.artist} ${t.album}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
  const cmp = {
    title: (a, b) => a.title.localeCompare(b.title, 'ru'),
    artist: (a, b) => a.artist.localeCompare(b.artist, 'ru') || a.title.localeCompare(b.title, 'ru'),
    album: (a, b) => a.album.localeCompare(b.album, 'ru') || a.title.localeCompare(b.title, 'ru'),
    duration: (a, b) => a.duration - b.duration,
    plays: (a, b) => b.play_count - a.play_count,
    recent: (a, b) => (b.last_played_at || 0) - (a.last_played_at || 0),
  }[state.sort];
  if (cmp) list.sort(cmp);
  if (state.sortDesc) list.reverse();
  state.filtered = list;
  $('clear-search').classList.toggle('hidden', !q);
}

function refresh() {
  applyFilters();
  renderCollections();
  renderTracks();
  updateStats();
}

function updateStats() {
  const list = state.filtered;
  $('track-count').textContent = `${list.length} ${plural(list.length, 'трек', 'трека', 'треков')}`;
  const total = list.reduce((s, t) => s + (t.duration || 0), 0);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60);
  $('total-duration').textContent = h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
  $('collection-title').textContent = collectionName();
}

// ============ Отрисовка списка ============
function trackHandlers(track) {
  return {
    onclick: () => playFromView(track.video_id),
    oncontextmenu: (e) => showTrackMenu(e, track.video_id),
    draggable: 'true',
    ondragstart: (e) => {
      e.dataTransfer.setData('text/x-video-id', track.video_id);
      e.dataTransfer.effectAllowed = 'copyMove';
    },
    dataset: { id: track.video_id },
  };
}

function badges(track) {
  return [
    track.favorite ? el('span', { class: 'fav-mark', title: 'Избранное' }, icon('fas fa-heart')) : null,
    !track.file_exists ? el('span', { class: 'restoring-badge', title: 'Файл отсутствует — будет скачан заново при воспроизведении' }, 'нет файла') : null,
  ];
}

function renderTracks() {
  Object.entries(views).forEach(([name, node]) => node.classList.toggle('hidden', name !== state.view || !state.filtered.length));
  document.querySelectorAll('.view-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  $('sort-select').value = state.sort;
  $('sort-dir').classList.toggle('active', state.sortDesc);

  const empty = !state.filtered.length;
  $('empty-state').classList.toggle('hidden', !empty);
  if (empty) {
    $('empty-text').textContent = searchInput.value ? 'Ничего не найдено'
      : state.library.length ? 'В этой подборке пока пусто' : 'Библиотека пуста — добавьте первый трек';
  }

  const list = state.filtered;
  const active = (t) => t.video_id === state.current;
  const reorderable = !!currentPlaylist() && state.sort === 'default' && !state.sortDesc && !searchInput.value;

  switch (state.view) {
    case 'list':
      views.list.replaceChildren(...list.map((t, i) => {
        const li = el('li', { class: active(t) ? 'active' : '', ...trackHandlers(t) },
          el('span', { class: 'track-number' }, i + 1),
          el('span', { class: 'playing-indicator' }, icon('fas fa-volume-up')),
          coverImg(t, 'track-thumb'),
          el('div', { class: 'track-info' },
            el('div', { class: 'track-title-list', title: t.title }, t.title),
            el('div', { class: 'track-artist-list' }, t.artist)),
          ...badges(t),
          el('span', { class: 'track-duration-list' }, formatTime(t.duration)));
        if (reorderable) enableReorder(li, t.video_id);
        return li;
      }));
      break;
    case 'grid':
      views.grid.replaceChildren(...list.map((t) => el('div', { class: 'grid-item' + (active(t) ? ' active' : ''), ...trackHandlers(t) },
        coverImg(t, 'grid-thumb'),
        el('div', { class: 'grid-title', title: t.title }, t.title),
        el('div', { class: 'grid-artist' }, t.artist))));
      break;
    case 'compact':
      views.compact.replaceChildren(...list.map((t) => el('li', { class: active(t) ? 'active' : '', ...trackHandlers(t) },
        coverImg(t, 'track-thumb'),
        el('div', { class: 'track-info' },
          el('div', { class: 'track-title-list' }, t.title),
          el('div', { class: 'track-artist-list' }, `${t.artist} • ${formatTime(t.duration)}`)),
        ...badges(t))));
      break;
    case 'table':
      tableBody.replaceChildren(...list.map((t, i) => el('tr', { class: active(t) ? 'active' : '', ...trackHandlers(t) },
        el('td', {}, i + 1),
        el('td', {}, coverImg(t, 'table-thumb')),
        el('td', { title: t.title }, t.title),
        el('td', { title: t.artist }, t.artist),
        el('td', { title: t.album }, t.album),
        el('td', {}, formatTime(t.duration)))));
      break;
  }
}

/** Лёгкое обновление подсветки текущего трека без перерисовки списка. */
function markActive() {
  document.querySelectorAll('[data-id].active').forEach((n) => n.classList.remove('active'));
  if (!state.current) return;
  document.querySelectorAll(`[data-id="${CSS.escape(state.current)}"]`).forEach((n) => n.classList.add('active'));
}

// Перетаскивание внутри плейлиста меняет порядок.
function enableReorder(li, id) {
  li.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/x-video-id')) return;
    e.preventDefault();
    li.classList.add('drop-target');
  });
  li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
  li.addEventListener('drop', async (e) => {
    e.preventDefault();
    li.classList.remove('drop-target');
    const moved = e.dataTransfer.getData('text/x-video-id');
    const pl = currentPlaylist();
    if (!pl || !moved || moved === id) return;
    const ids = pl.track_ids.filter((x) => x !== moved);
    ids.splice(ids.indexOf(id), 0, moved);
    pl.track_ids = ids;
    refresh();
    try { await api(`/playlists/${pl.id}/tracks`, { method: 'PUT', body: { video_ids: ids } }); }
    catch (err) { notify('Не удалось изменить порядок: ' + err.message, 'error'); reloadPlaylists(); }
  });
}

// ============ Контекстные меню ============
function showMenu(e, items) {
  e.preventDefault();
  e.stopPropagation();
  document.querySelector('.context-menu')?.remove();
  const menu = el('div', { class: 'context-menu' }, ...items.map((it) => it === '-'
    ? el('div', { class: 'divider' })
    : el('button', { onclick: () => { menu.remove(); it.action(); }, class: it.danger ? 'danger' : '' }, icon(it.icon), it.label)));
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  const x = e.clientX ?? (e.target.getBoundingClientRect().left);
  const y = e.clientY ?? (e.target.getBoundingClientRect().top);
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }));
}

function showTrackMenu(e, id) {
  const t = state.byId.get(id);
  if (!t) return;
  const pl = currentPlaylist();
  showMenu(e, [
    { icon: 'fas fa-play', label: 'Воспроизвести', action: () => playFromView(id) },
    { icon: 'fas fa-forward', label: 'Играть следующим', action: () => queueNext(id) },
    { icon: 'fas fa-list', label: 'Добавить в очередь', action: () => queueLast(id) },
    '-',
    { icon: t.favorite ? 'fas fa-heart-crack' : 'fas fa-heart', label: t.favorite ? 'Убрать из избранного' : 'В избранное', action: () => toggleFavorite(id) },
    { icon: 'fas fa-folder-plus', label: 'В плейлист…', action: () => choosePlaylist(id) },
    pl ? { icon: 'fas fa-folder-minus', label: `Убрать из «${pl.name}»`, action: () => removeFromPlaylist(pl.id, id) } : null,
    { icon: 'fas fa-user', label: `Ещё от «${t.artist}»`, action: () => { searchInput.value = t.artist; setCollection('all'); } },
    '-',
    { icon: 'fas fa-pen', label: 'Редактировать', action: () => editTrack(id) },
    { icon: 'fas fa-info-circle', label: 'Информация', action: () => showTrackInfo(id) },
    t.original_url ? { icon: 'fas fa-up-right-from-square', label: 'Открыть источник', action: () => window.open(t.original_url, '_blank', 'noopener') } : null,
    { icon: 'fas fa-download', label: 'Скачать файл', action: () => downloadTrackFile(id) },
    !t.file_exists ? { icon: 'fas fa-rotate', label: 'Восстановить файл', action: () => restoreTrack(id) } : null,
    '-',
    { icon: 'fas fa-trash', label: 'Удалить', danger: true, action: () => deleteTrack(id) },
  ].filter(Boolean));
}

function showPlaylistMenu(e, p) {
  showMenu(e, [
    { icon: 'fas fa-play', label: 'Воспроизвести', action: () => { setCollection(`pl:${p.id}`); playAll(); } },
    { icon: 'fas fa-pen', label: 'Переименовать', action: () => renamePlaylist(p) },
    '-',
    { icon: 'fas fa-trash', label: 'Удалить плейлист', danger: true, action: () => deletePlaylist(p) },
  ]);
}

// ============ Воспроизведение ============
let audioContext = null;
let analyser = null;
let animationId = null;

function initAudioContext() {
  if (audioContext) {
    if (audioContext.state === 'suspended') audioContext.resume();
    return;
  }
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    audioContext.createMediaElementSource(audio).connect(analyser);
    analyser.connect(audioContext.destination);
  } catch (e) {
    console.warn('Web Audio API недоступен', e);
  }
}

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Начинает воспроизведение из текущего видимого списка. */
function playFromView(id) {
  const ids = state.filtered.map((t) => t.video_id);
  setContext(ids, id);
  playTrack(id);
}

function playAll() {
  applyFilters();
  const ids = state.filtered.map((t) => t.video_id);
  if (!ids.length) return;
  const first = state.shuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[0];
  setContext(ids, first);
  playTrack(first);
}

function setContext(ids, startId, name = collectionName()) {
  state.contextName = name;
  state.contextBase = ids.slice();
  if (state.shuffle) {
    const rest = shuffled(ids.filter((x) => x !== startId));
    state.context = startId ? [startId, ...rest] : rest;
  } else {
    state.context = ids.slice();
  }
  state.contextPos = state.context.indexOf(startId);
}

function playTrack(id, { addHistory = true, autoplay = true, startAt = 0 } = {}) {
  const track = state.byId.get(id);
  if (!track) return;
  if (addHistory && state.current && state.current !== id) {
    state.history.push(state.current);
    if (state.history.length > 200) state.history.shift();
  }
  state.current = id;
  const pos = state.context.indexOf(id);
  if (pos >= 0) state.contextPos = pos;
  state.playCounted = false;
  store.set('lastTrack', { id, time: startAt });

  updateNowPlaying(track, true);
  audio.src = `/api/stream/${encodeURIComponent(id)}`;
  if (startAt) audio.addEventListener('loadedmetadata', () => { audio.currentTime = startAt; }, { once: true });
  markActive();
  loadWaveform(id);

  if (!autoplay) return;
  initAudioContext();
  audio.play().then(() => {
    if (isMobile()) switchMobileTab('player');
  }).catch((err) => {
    if (err.name === 'NotAllowedError') return; // браузер ждёт жеста пользователя
    if (err.name !== 'AbortError') console.warn('play()', err);
  });
}

function updateNowPlaying(track, newTrack) {
  $('track-title').textContent = track.title;
  $('track-artist').textContent = track.artist;
  $('track-album').textContent = track.album;
  $('track-year').textContent = track.release_date?.slice(0, 4) || '';
  $('track-quality').textContent = track.abr ? `${Math.round(track.abr)} kbps` : 'HQ';
  $('track-views').replaceChildren(icon('fas fa-eye'), ' ', formatNumber(track.view_count));
  $('track-likes').replaceChildren(icon('fas fa-thumbs-up'), ' ', formatNumber(track.like_count));
  $('track-plays').replaceChildren(icon('fas fa-headphones'), ' ', String(track.play_count || 0));
  $('track-bitrate').replaceChildren(icon('fas fa-wave-square'), ' ', track.abr ? `${Math.round(track.abr)} kbps` : '—');
  favBtn.classList.toggle('active', !!track.favorite);
  favBtn.firstElementChild.className = track.favorite ? 'fas fa-heart' : 'far fa-heart';
  document.title = `${track.title} — ${track.artist}`;

  if (newTrack) {
    const cover = $('cover');
    cover.src = track.thumbnail_api;
    cover.onerror = () => { cover.onerror = null; cover.src = COVER_PLACEHOLDER; };
    $('background-blur').style.backgroundImage = `url("${track.thumbnail_api}")`;
    $('total-time').textContent = formatTime(track.duration);
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: [{ src: new URL(track.thumbnail_api, location.href).href }],
    });
  }
}

function stopPlayback() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  state.current = null;
  $('track-title').textContent = 'Выберите трек';
  $('track-artist').textContent = 'Исполнитель';
  document.title = 'Music Player';
  waveform.replaceChildren();
  stopVisualizer();
  markActive();
}

function togglePlay() {
  if (!state.current) {
    const last = store.get('lastTrack', null);
    if (last && state.byId.has(last.id)) {
      playFromView(last.id);
    } else {
      playAll();
    }
    return;
  }
  initAudioContext();
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function nextId() {
  if (state.userQueue.length) return state.userQueue.shift();
  if (!state.context.length) return null;
  let pos = state.contextPos + 1;
  if (pos >= state.context.length) {
    if (state.repeat !== 'all') return null;
    if (state.shuffle) state.context = shuffled(state.context);
    pos = 0;
  }
  state.contextPos = pos;
  return state.context[pos];
}

function playNext({ auto = false } = {}) {
  const id = nextId();
  if (id) return playTrack(id);
  if (!auto && state.context.length) {
    state.contextPos = -1;
    return playTrack(nextId() || state.context[0]);
  }
  audio.pause();
}

function playPrevious() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  const prev = state.history.pop();
  if (prev && state.byId.has(prev)) return playTrack(prev, { addHistory: false });
  if (state.contextPos > 0) return playTrack(state.context[state.contextPos - 1], { addHistory: false });
  audio.currentTime = 0;
}

function queueNext(id) {
  state.userQueue.unshift(id);
  notify(`«${state.byId.get(id)?.title}» сыграет следующим`, 'success', 2500);
  renderQueue();
}

function queueLast(id) {
  state.userQueue.push(id);
  notify(`«${state.byId.get(id)?.title}» добавлен в очередь`, 'success', 2500);
  renderQueue();
}

// ============ События аудио ============
function updatePlayButton() {
  const playing = !audio.paused;
  playBtn.replaceChildren(icon(`fas ${playing ? 'fa-pause' : 'fa-play'}`));
  playBtn.title = playing ? 'Пауза (Пробел)' : 'Воспроизвести (Пробел)';
  document.body.classList.toggle('is-playing', playing);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

audio.addEventListener('play', () => { updatePlayButton(); startVisualizer(); });
audio.addEventListener('pause', () => { updatePlayButton(); stopVisualizer(); saveProgress(); });

audio.addEventListener('timeupdate', () => {
  const d = audio.duration;
  if (!Number.isFinite(d) || !d) return;
  const progress = audio.currentTime / d;
  $('progress-fill').style.width = `${progress * 100}%`;
  $('current-time').textContent = formatTime(audio.currentTime);
  updateWaveformProgress(progress);
  // Засчитываем прослушивание после 30 секунд или половины трека.
  if (!state.playCounted && (audio.currentTime > 30 || progress > 0.5)) {
    state.playCounted = true;
    const id = state.current;
    api(`/tracks/${encodeURIComponent(id)}/play`, { method: 'POST' }).then(() => {
      const t = state.byId.get(id);
      if (t) {
        t.play_count = (t.play_count || 0) + 1;
        t.last_played_at = Math.floor(Date.now() / 1000);
        if (id === state.current) $('track-plays').replaceChildren(icon('fas fa-headphones'), ' ', String(t.play_count));
      }
    }).catch(() => {});
  }
  if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
    try { navigator.mediaSession.setPositionState({ duration: d, position: audio.currentTime, playbackRate: audio.playbackRate }); } catch { /* ignore */ }
  }
  throttledSave();
});

const throttledSave = (() => {
  let last = 0;
  return () => { if (Date.now() - last > 5000) { last = Date.now(); saveProgress(); } };
})();

function saveProgress() {
  if (state.current) store.set('lastTrack', { id: state.current, time: audio.currentTime || 0 });
}

audio.addEventListener('loadedmetadata', () => {
  $('total-time').textContent = formatTime(audio.duration);
});

audio.addEventListener('ended', () => {
  if (state.sleepMode === -1) { setSleep(0); notify('Таймер сна: воспроизведение остановлено', 'info'); return; }
  if (state.repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
  playNext({ auto: true });
});

// Если файла нет, сервер сам ставит трек на восстановление — ждём событие о готовности.
audio.addEventListener('error', async () => {
  const id = state.current;
  if (!id || !audio.getAttribute('src')) return;
  try {
    const res = await fetch(`/api/stream/${encodeURIComponent(id)}`, { headers: { Range: 'bytes=0-0' } });
    const data = res.ok ? null : await res.json().catch(() => null);
    if (data?.restoring) {
      state.pendingRestore = id;
      if (data.job) { state.jobs.set(data.job.id, data.job); renderJobs(); }
      const t = state.byId.get(id);
      if (t) t.file_exists = false;
      notify('Файл трека отсутствует — скачиваю заново…', 'warning');
      return;
    }
  } catch { /* ниже — общее сообщение */ }
  notify('Ошибка воспроизведения', 'error');
});

// ============ Прогресс и волновая форма ============
function seekToFraction(frac) {
  const d = audio.duration;
  if (Number.isFinite(d) && d > 0) audio.currentTime = Math.max(0, Math.min(1, frac)) * d;
}

function fractionFromEvent(e, node) {
  const rect = node.getBoundingClientRect();
  return (e.clientX - rect.left) / rect.width;
}

let seeking = false;
progressBar.parentElement.addEventListener('pointerdown', (e) => {
  seeking = true;
  progressBar.parentElement.setPointerCapture(e.pointerId);
  seekToFraction(fractionFromEvent(e, progressBar));
});
progressBar.parentElement.addEventListener('pointermove', (e) => {
  const frac = Math.max(0, Math.min(1, fractionFromEvent(e, progressBar)));
  $('progress-hover').style.width = `${frac * 100}%`;
  const tip = $('progress-tooltip');
  tip.textContent = formatTime(frac * (audio.duration || 0));
  tip.style.left = `${frac * 100}%`;
  if (seeking) seekToFraction(frac);
});
progressBar.parentElement.addEventListener('pointerup', () => { seeking = false; });
waveform.addEventListener('click', (e) => seekToFraction(fractionFromEvent(e, waveform)));

async function loadWaveform(id) {
  waveform.replaceChildren();
  let bars;
  try {
    bars = (await api(`/tracks/${encodeURIComponent(id)}/waveform`)).bars;
  } catch {
    return;
  }
  if (id !== state.current) return;
  const target = Math.max(40, Math.min(bars.length, Math.floor(waveform.clientWidth / 4) || bars.length));
  const step = bars.length / target;
  const nodes = [];
  for (let i = 0; i < target; i++) {
    const v = bars[Math.floor(i * step)] / 255;
    nodes.push(el('div', { class: 'waveform-bar', style: `height:${Math.max(6, v * 100)}%` }));
  }
  waveform.replaceChildren(...nodes);
  updateWaveformProgress(audio.duration ? audio.currentTime / audio.duration : 0);
}

let lastPlayed = -1;
function updateWaveformProgress(progress) {
  const bars = waveform.children;
  const played = Math.floor(progress * bars.length);
  if (played === lastPlayed) return;
  lastPlayed = played;
  for (let i = 0; i < bars.length; i++) bars[i].classList.toggle('played', i < played);
}

// ============ Визуализатор ============
function startVisualizer() {
  if (!state.showVisualizer || !analyser || animationId) return;
  visualizer.classList.remove('hidden');
  const data = new Uint8Array(analyser.frequencyBinCount);
  const draw = () => {
    animationId = requestAnimationFrame(draw);
    const w = visualizer.offsetWidth, h = visualizer.offsetHeight;
    if (visualizer.width !== w || visualizer.height !== h) { visualizer.width = w; visualizer.height = h; }
    analyser.getByteFrequencyData(data);
    visualizerCtx.clearRect(0, 0, w, h);
    const gradient = visualizerCtx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(29, 185, 84, 0.8)');
    gradient.addColorStop(0.5, 'rgba(78, 205, 196, 0.6)');
    gradient.addColorStop(1, 'rgba(29, 185, 84, 0.1)');
    visualizerCtx.fillStyle = gradient;
    const bins = Math.floor(data.length * 0.75); // верхние частоты почти всегда пусты
    const barWidth = w / bins;
    const radius = Math.min(barWidth / 2, 4);
    for (let i = 0; i < bins; i++) {
      const bh = (data[i] / 255) * h * 0.85;
      if (bh < 1) continue;
      visualizerCtx.beginPath();
      visualizerCtx.roundRect(i * barWidth, h - bh, barWidth - 1, bh, [radius, radius, 0, 0]);
      visualizerCtx.fill();
    }
  };
  draw();
}

function stopVisualizer() {
  if (animationId) cancelAnimationFrame(animationId);
  animationId = null;
}

// ============ Громкость и скорость ============
function setVolume(v, remember = true) {
  v = Math.max(0, Math.min(1, v));
  audio.volume = v;
  volumeSlider.value = Math.round(v * 100);
  volumeSlider.style.setProperty('--fill', `${v * 100}%`);
  volumeBtn.firstElementChild.className = v === 0 ? 'fas fa-volume-mute' : v < 0.5 ? 'fas fa-volume-down' : 'fas fa-volume-up';
  if (remember) store.set('volume', v);
}

volumeSlider.addEventListener('input', () => setVolume(volumeSlider.value / 100));
volumeBtn.addEventListener('click', () => {
  if (audio.volume > 0) { store.set('prevVolume', audio.volume); setVolume(0); }
  else setVolume(store.get('prevVolume', 0.75) || 0.75);
});
volumeSlider.addEventListener('wheel', (e) => { e.preventDefault(); setVolume(audio.volume - Math.sign(e.deltaY) * 0.05); }, { passive: false });

function setSpeed(speed) {
  audio.playbackRate = speed;
  audio.defaultPlaybackRate = speed;
  speedBtn.firstElementChild.textContent = `${speed}x`;
  speedOptions.querySelectorAll('button').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === speed));
  store.set('speed', speed);
}
speedBtn.addEventListener('click', (e) => { e.stopPropagation(); speedOptions.classList.toggle('visible'); });
speedOptions.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  setSpeed(Number(b.dataset.speed));
  speedOptions.classList.remove('visible');
});
document.addEventListener('click', () => speedOptions.classList.remove('visible'));

// ============ Режимы ============
function renderModes() {
  shuffleBtn.classList.toggle('active', state.shuffle);
  repeatBtn.classList.toggle('active', state.repeat !== 'off');
  repeatBtn.querySelector('.repeat-badge').classList.toggle('hidden', state.repeat !== 'one');
  visualizerBtn.classList.toggle('active', state.showVisualizer);
}

shuffleBtn.addEventListener('click', () => {
  state.shuffle = !state.shuffle;
  store.set('shuffle', state.shuffle);
  // Перестраиваем оставшуюся часть очереди воспроизведения.
  if (state.context.length && state.current) {
    setContext(state.contextBase, state.current, state.contextName);
  }
  renderModes();
  renderQueue();
  notify(state.shuffle ? 'Перемешивание включено' : 'Перемешивание выключено', 'info', 1500);
});

repeatBtn.addEventListener('click', () => {
  const modes = ['off', 'all', 'one'];
  state.repeat = modes[(modes.indexOf(state.repeat) + 1) % modes.length];
  store.set('repeat', state.repeat);
  renderModes();
  notify({ off: 'Повтор выключен', all: 'Повтор списка', one: 'Повтор трека' }[state.repeat], 'info', 1500);
});

visualizerBtn.addEventListener('click', () => {
  state.showVisualizer = !state.showVisualizer;
  store.set('visualizer', state.showVisualizer);
  renderModes();
  if (state.showVisualizer && !audio.paused) startVisualizer();
  else { stopVisualizer(); visualizer.classList.add('hidden'); }
});

// Таймер сна: выкл → 15 → 30 → 60 мин → до конца трека.
function setSleep(mode) {
  clearTimeout(state.sleepTimer);
  state.sleepMode = mode;
  const btn = $('sleep-btn');
  btn.classList.toggle('active', mode !== 0);
  btn.title = mode === 0 ? 'Таймер сна' : mode === -1 ? 'Таймер сна: до конца трека' : `Таймер сна: ${mode} мин`;
  if (mode > 0) {
    state.sleepTimer = setTimeout(() => {
      audio.pause();
      setSleep(0);
      notify('Таймер сна: воспроизведение остановлено', 'info');
    }, mode * 60_000);
  }
}
$('sleep-btn').addEventListener('click', () => {
  const modes = [0, 15, 30, 60, -1];
  const next = modes[(modes.indexOf(state.sleepMode) + 1) % modes.length];
  setSleep(next);
  notify(next === 0 ? 'Таймер сна выключен' : next === -1 ? 'Остановлю после этого трека' : `Остановлю через ${next} мин`, 'info', 2000);
});

// ============ Действия с треками ============
async function toggleFavorite(id = state.current) {
  const t = state.byId.get(id);
  if (!t) return;
  try {
    const updated = await api(`/tracks/${encodeURIComponent(id)}`, { method: 'PATCH', body: { favorite: !t.favorite } });
    Object.assign(t, updated);
    if (id === state.current) updateNowPlaying(t, false);
    refresh();
  } catch (err) {
    notify('Не удалось обновить: ' + err.message, 'error');
  }
}
favBtn.addEventListener('click', () => toggleFavorite());

function editTrack(id) {
  const t = state.byId.get(id);
  if (!t) return;
  const form = $('edit-form');
  const f = form.elements;
  f.title.value = t.title;
  f.artist.value = t.artist;
  f.album.value = t.album;
  form.dataset.id = id;
  openModal($('edit-modal'));
}

$('edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const id = form.dataset.id;
  try {
    const updated = await api(`/tracks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { title: form.elements.title.value, artist: form.elements.artist.value, album: form.elements.album.value },
    });
    Object.assign(state.byId.get(id), updated);
    if (id === state.current) updateNowPlaying(state.byId.get(id), false);
    refresh();
    closeModals();
    notify('Сохранено', 'success', 2000);
  } catch (err) {
    notify('Ошибка: ' + err.message, 'error');
  }
});

function showTrackInfo(id) {
  const t = state.byId.get(id);
  if (!t) return;
  const row = (label, value) => el('div', { class: 'info-row' }, el('span', { class: 'label' }, label), el('span', { class: 'value' }, value));
  $('track-info-content').replaceChildren(el('div', { class: 'track-info-detail' },
    row('Название', t.title),
    row('Исполнитель', t.artist),
    row('Альбом', t.album),
    row('Дата релиза', formatDate(t.release_date)),
    row('Длительность', formatTime(t.duration)),
    row('Просмотры', formatNumber(t.view_count)),
    row('Лайки', formatNumber(t.like_count)),
    row('Прослушиваний', String(t.play_count || 0)),
    row('Битрейт', t.abr ? `${Math.round(t.abr)} kbps` : '—'),
    row('Кодек', t.audio_codec || 'opus'),
    row('Размер', formatSize(t.filesize)),
    row('Добавлен', new Date(t.added_at * 1000).toLocaleString('ru')),
    row('ID', t.video_id)));
  openModal($('info-modal'));
}

function downloadTrackFile(id) {
  const a = el('a', { href: `/api/tracks/${encodeURIComponent(id)}/download`, download: '' });
  document.body.append(a);
  a.click();
  a.remove();
}

async function restoreTrack(id) {
  try {
    const job = await api(`/tracks/${encodeURIComponent(id)}/restore`, { method: 'POST' });
    state.jobs.set(job.id, job);
    renderJobs();
    notify('Восстановление поставлено в очередь', 'info', 2500);
  } catch (err) {
    notify('Ошибка: ' + err.message, 'error');
  }
}

async function deleteTrack(id) {
  const t = state.byId.get(id);
  if (!t || !confirm(`Удалить «${t.title}» из библиотеки и с диска?`)) return;
  try {
    await api(`/tracks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (state.current === id) {
      const next = nextId();
      stopPlayback();
      if (next && next !== id) playTrack(next);
    }
    state.library = state.library.filter((x) => x.video_id !== id);
    state.byId.delete(id);
    state.playlists.forEach((p) => { p.track_ids = p.track_ids.filter((x) => x !== id); });
    refresh();
    notify('Трек удалён', 'success', 2000);
  } catch (err) {
    notify('Ошибка удаления: ' + err.message, 'error');
  }
}

$('more-btn').addEventListener('click', (e) => { if (state.current) showTrackMenu(e, state.current); });

// ============ Плейлисты ============
async function createPlaylist(name) {
  const p = await api('/playlists', { method: 'POST', body: { name } });
  state.playlists.push(p);
  state.playlists.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return p;
}

async function createPlaylistPrompt() {
  const name = prompt('Название нового плейлиста:');
  if (!name?.trim()) return;
  try {
    const p = await createPlaylist(name.trim());
    setCollection(`pl:${p.id}`);
    notify('Плейлист создан. Перетаскивайте треки на его название или используйте меню трека.', 'success');
  } catch (err) {
    notify('Ошибка: ' + err.message, 'error');
  }
}

async function renamePlaylist(p) {
  const name = prompt('Новое название:', p.name);
  if (!name?.trim() || name.trim() === p.name) return;
  try {
    await api(`/playlists/${p.id}`, { method: 'PATCH', body: { name: name.trim() } });
    p.name = name.trim();
    refresh();
  } catch (err) {
    notify('Ошибка: ' + err.message, 'error');
  }
}

async function deletePlaylist(p) {
  if (!confirm(`Удалить плейлист «${p.name}»? Треки останутся в библиотеке.`)) return;
  try {
    await api(`/playlists/${p.id}`, { method: 'DELETE' });
    state.playlists = state.playlists.filter((x) => x.id !== p.id);
    if (state.collection === `pl:${p.id}`) state.collection = 'all';
    refresh();
  } catch (err) {
    notify('Ошибка: ' + err.message, 'error');
  }
}

async function addToPlaylist(playlistId, videoId) {
  const p = state.playlists.find((x) => x.id === playlistId);
  if (!p) return;
  if (p.track_ids.includes(videoId)) { notify(`Уже в «${p.name}»`, 'info', 2000); return; }
  try {
    await api(`/playlists/${playlistId}/tracks`, { method: 'POST', body: { video_id: videoId } });
    p.track_ids.push(videoId);
    refresh();
    notify(`Добавлено в «${p.name}»`, 'success', 2000);
  } catch (err) {
    notify('Ошибка: ' + err.message, 'error');
  }
}

async function removeFromPlaylist(playlistId, videoId) {
  try {
    await api(`/playlists/${playlistId}/tracks/${encodeURIComponent(videoId)}`, { method: 'DELETE' });
    const p = state.playlists.find((x) => x.id === playlistId);
    if (p) p.track_ids = p.track_ids.filter((x) => x !== videoId);
    refresh();
  } catch (err) {
    notify('Ошибка: ' + err.message, 'error');
  }
}

function choosePlaylist(videoId) {
  const list = $('playlist-choices');
  list.replaceChildren(...(state.playlists.length ? state.playlists.map((p) => el('li', {},
    el('button', {
      class: 'choice' + (p.track_ids.includes(videoId) ? ' done' : ''),
      onclick: () => { addToPlaylist(p.id, videoId); closeModals(); },
    }, icon(p.track_ids.includes(videoId) ? 'fas fa-check' : 'fas fa-list'), p.name, el('span', { class: 'muted' }, p.track_ids.length))))
    : [el('li', { class: 'muted center' }, 'Плейлистов пока нет — создайте первый')]));
  $('new-playlist-form').dataset.videoId = videoId;
  openModal($('playlist-modal'));
}

$('new-playlist-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    const p = await createPlaylist(form.elements.name.value.trim());
    form.reset();
    if (form.dataset.videoId) await addToPlaylist(p.id, form.dataset.videoId);
    closeModals();
    refresh();
  } catch (err) {
    notify('Ошибка: ' + err.message, 'error');
  }
});

// ============ Очередь ============
function queueItem(id, onRemove) {
  const t = state.byId.get(id);
  if (!t) return null;
  return el('li', { class: id === state.current ? 'active' : '' },
    coverImg(t, 'track-thumb'),
    el('div', { class: 'track-info', onclick: () => playTrack(id) },
      el('div', { class: 'track-title-list' }, t.title),
      el('div', { class: 'track-artist-list' }, `${t.artist} • ${formatTime(t.duration)}`)),
    onRemove ? el('button', { class: 'icon-btn', title: 'Убрать', onclick: onRemove }, icon('fas fa-xmark')) : null);
}

function renderQueue() {
  if ($('queue-modal').classList.contains('hidden')) return;
  $('queue-now').replaceChildren(...[state.current && queueItem(state.current)].filter(Boolean));
  $('queue-user').replaceChildren(...state.userQueue.map((id, i) => queueItem(id, () => { state.userQueue.splice(i, 1); renderQueue(); })).filter(Boolean));
  if (!state.userQueue.length) $('queue-user').append(el('li', { class: 'muted' }, 'Пусто. «Играть следующим» в меню трека.'));
  $('queue-context-name').textContent = state.contextName || '—';
  const upcoming = state.context.slice(state.contextPos + 1, state.contextPos + 51);
  $('queue-context').replaceChildren(...upcoming.map((id) => queueItem(id)).filter(Boolean));
}

$('queue-btn').addEventListener('click', () => { openModal($('queue-modal')); renderQueue(); });
$('clear-queue').addEventListener('click', () => { state.userQueue = []; renderQueue(); });

// ============ Загрузки ============
const JOB_LABELS = {
  queued: 'В очереди', resolving: 'Получаю информацию', downloading: 'Скачиваю',
  processing: 'Обработка', done: 'Готово', failed: 'Ошибка', cancelled: 'Отменено',
};
const FINISHED = new Set(['done', 'failed', 'cancelled']);

function renderJobs() {
  const jobs = [...state.jobs.values()].sort((a, b) => b.id - a.id);
  const active = jobs.filter((j) => !FINISHED.has(j.status)).length;
  const badge = $('jobs-badge');
  badge.textContent = active;
  badge.classList.toggle('hidden', !active);
  $('jobs-btn').classList.toggle('busy', active > 0);
  $('jobs-empty').classList.toggle('hidden', jobs.length > 0);
  $('jobs-list').replaceChildren(...jobs.map((j) => {
    const pct = Math.round((j.progress || 0) * 100);
    return el('li', { class: `job ${j.status}` },
      el('div', { class: 'job-head' },
        el('span', { class: 'job-title', title: j.url }, j.title || j.url),
        el('span', { class: 'job-status' }, JOB_LABELS[j.status] + (j.status === 'downloading' ? ` · ${pct}%` : '')),
        !FINISHED.has(j.status)
          ? el('button', { class: 'icon-btn', title: 'Отменить', onclick: () => api(`/jobs/${j.id}`, { method: 'DELETE' }).catch((e) => notify(e.message, 'error')) }, icon('fas fa-xmark'))
          : null),
      !FINISHED.has(j.status) ? el('div', { class: 'progress-bar-mini' + (j.status === 'downloading' ? '' : ' indeterminate') },
        el('div', { class: 'progress-fill-mini', style: `width:${j.status === 'downloading' ? pct : 100}%` })) : null,
      j.message ? el('div', { class: 'job-message' }, j.message) : null);
  }));
}

function onJobEvent(job) {
  const prev = state.jobs.get(job.id);
  state.jobs.set(job.id, job);
  renderJobs();
  if (prev?.status === job.status || !FINISHED.has(job.status)) return;
  if (job.status === 'done') {
    if (job.message && !job.restore) notify(job.message, 'info');
    if (job.restore && job.video_id === state.pendingRestore) {
      state.pendingRestore = null;
      notify('Файл восстановлен', 'success', 2000);
      reloadLibrary();
      setTimeout(() => playTrack(job.video_id, { addHistory: false }), 400);
    }
  } else if (job.status === 'failed') {
    notify(`Не удалось загрузить: ${job.title || job.url}\n${job.message || ''}`, 'error', 8000);
  }
}

$('jobs-btn').addEventListener('click', () => openModal($('jobs-modal')));
$('clear-jobs').addEventListener('click', () => api('/jobs', { method: 'DELETE' }).then(loadJobs).catch(() => {}));

// ============ Добавление треков ============
async function submitUrls(text) {
  const status = $('add-status');
  const btn = $('submit-add');
  btn.disabled = true;
  status.textContent = 'Ставлю в очередь…';
  status.className = 'status-message';
  try {
    const { jobs } = await api('/add', { method: 'POST', body: { url: text } });
    jobs.forEach((j) => state.jobs.set(j.id, j));
    renderJobs();
    $('url-input').value = '';
    status.textContent = '';
    closeModals();
    notify(`В очереди: ${jobs.length} ${plural(jobs.length, 'ссылка', 'ссылки', 'ссылок')}. Прогресс — в «Загрузках».`, 'success');
  } catch (err) {
    status.textContent = 'Ошибка: ' + err.message;
    status.className = 'status-message error';
  } finally {
    btn.disabled = false;
  }
}

$('add-btn').addEventListener('click', () => openModal($('add-modal')));
$('submit-add').addEventListener('click', () => {
  const text = $('url-input').value.trim();
  if (text) submitUrls(text);
});
$('url-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey && !e.target.value.includes('\n'))) {
    e.preventDefault();
    $('submit-add').click();
  }
});

// Вставка ссылки в любом месте страницы открывает окно добавления.
document.addEventListener('paste', (e) => {
  if (e.target.closest('input, textarea')) return;
  const text = e.clipboardData?.getData('text') || '';
  if (/^https?:\/\//m.test(text)) {
    openModal($('add-modal'));
    $('url-input').value = text.trim();
  }
});

// ============ Прочее UI ============
$('expand-cover').addEventListener('click', () => {
  $('cover-full').src = $('cover').src;
  openModal($('cover-modal'));
});

document.querySelectorAll('.view-btn').forEach((btn) => btn.addEventListener('click', () => {
  state.view = btn.dataset.view;
  store.set('view', state.view);
  renderTracks();
}));

$('sort-select').addEventListener('change', (e) => {
  state.sort = e.target.value;
  store.set('sort', state.sort);
  refresh();
});
$('sort-dir').addEventListener('click', () => {
  state.sortDesc = !state.sortDesc;
  store.set('sortDesc', state.sortDesc);
  refresh();
});
$('play-all').addEventListener('click', playAll);

searchInput.addEventListener('input', debounce(refresh, 120));
$('clear-search').addEventListener('click', () => { searchInput.value = ''; refresh(); searchInput.focus(); });

$('toggle-sidebar').addEventListener('click', () => {
  sidebar.classList.add('collapsed');
  $('show-sidebar').classList.remove('hidden');
});
$('show-sidebar').addEventListener('click', () => {
  sidebar.classList.remove('collapsed');
  $('show-sidebar').classList.add('hidden');
});
$('shortcuts-btn').addEventListener('click', () => openModal($('shortcuts-modal')));
$('prev-btn').addEventListener('click', playPrevious);
$('next-btn').addEventListener('click', () => playNext());
playBtn.addEventListener('click', togglePlay);

// ============ Горячие клавиши ============
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModals(); document.querySelector('.context-menu')?.remove(); return; }
  if (e.target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
  const seek = e.shiftKey ? 30 : 5;
  switch (e.code) {
    case 'Space': e.preventDefault(); togglePlay(); break;
    case 'ArrowRight': audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + seek); break;
    case 'ArrowLeft': audio.currentTime = Math.max(0, audio.currentTime - seek); break;
    case 'ArrowUp': e.preventDefault(); setVolume(audio.volume + 0.05); break;
    case 'ArrowDown': e.preventDefault(); setVolume(audio.volume - 0.05); break;
    case 'KeyN': playNext(); break;
    case 'KeyP': playPrevious(); break;
    case 'KeyM': volumeBtn.click(); break;
    case 'KeyS': shuffleBtn.click(); break;
    case 'KeyR': repeatBtn.click(); break;
    case 'KeyV': visualizerBtn.click(); break;
    case 'KeyL': toggleFavorite(); break;
    case 'KeyQ': $('queue-btn').click(); break;
    case 'KeyA': e.preventDefault(); openModal($('add-modal')); break;
    case 'KeyB': (sidebar.classList.contains('collapsed') ? $('show-sidebar') : $('toggle-sidebar')).click(); break;
    case 'Slash':
      if (e.shiftKey) openModal($('shortcuts-modal'));
      else { e.preventDefault(); searchInput.focus(); searchInput.select(); }
      break;
    default:
      if (/^Digit\d$/.test(e.code)) seekToFraction(Number(e.code.slice(5)) / 10);
  }
});

// ============ Media Session (кнопки клавиатуры, экран блокировки) ============
if ('mediaSession' in navigator) {
  const handlers = {
    play: () => audio.play(),
    pause: () => audio.pause(),
    previoustrack: playPrevious,
    nexttrack: () => playNext(),
    seekbackward: (d) => { audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10)); },
    seekforward: (d) => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d.seekOffset || 10)); },
    seekto: (d) => { audio.currentTime = d.seekTime; },
  };
  for (const [action, fn] of Object.entries(handlers)) {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* не поддерживается */ }
  }
}

// ============ Живые обновления (SSE) ============
function connectEvents() {
  const es = new EventSource('/api/events');
  es.onmessage = (msg) => {
    let e;
    try { e = JSON.parse(msg.data); } catch { return; }
    switch (e.type) {
      case 'job': onJobEvent(e); break;
      case 'jobs_cleared': e.ids.forEach((id) => state.jobs.delete(id)); renderJobs(); break;
      case 'library': reloadLibrary(); if (e.action === 'deleted') reloadPlaylists(); break;
      case 'playlists': reloadPlaylists(); break;
    }
  };
  es.addEventListener('resync', () => { loadLibrary(); loadPlaylists(); loadJobs(); });
  // После обрыва соединения EventSource переподключается сам — подтягиваем пропущенное.
  es.onopen = () => { if (connectEvents.opened) { loadLibrary(); loadJobs(); } connectEvents.opened = true; };
}

// ============ Мобильная навигация ============
const isMobile = () => window.innerWidth <= 768;

function switchMobileTab(tab) {
  if (!isMobile()) return;
  document.querySelectorAll('.bottom-nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelector('.player-panel').classList.toggle('tab-active', tab === 'player');
  sidebar.classList.toggle('tab-hidden', tab === 'player');
}

document.querySelectorAll('.bottom-nav-btn').forEach((btn) => btn.addEventListener('click', () => switchMobileTab(btn.dataset.tab)));
window.addEventListener('resize', debounce(() => {
  if (!isMobile()) {
    document.querySelector('.player-panel').classList.remove('tab-active');
    sidebar.classList.remove('tab-hidden');
  } else {
    switchMobileTab(document.querySelector('.bottom-nav-btn.active')?.dataset.tab || 'library');
  }
}, 150));

// Полифилл roundRect для старых браузеров.
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
}

// ============ Инициализация ============
async function init() {
  $('cover').src = COVER_PLACEHOLDER;
  setVolume(store.get('volume', 0.75), false);
  setSpeed(store.get('speed', 1));
  renderModes();
  if (!state.showVisualizer) visualizer.classList.add('hidden');
  await Promise.all([loadLibrary(), loadPlaylists(), loadJobs()]);
  connectEvents();

  // Восстанавливаем последний трек и позицию (без автозапуска).
  const last = store.get('lastTrack', null);
  if (last && state.byId.has(last.id)) {
    setContext(state.filtered.map((t) => t.video_id), last.id);
    playTrack(last.id, { autoplay: false, addHistory: false, startAt: last.time || 0 });
  }
  window.addEventListener('beforeunload', saveProgress);
}

init();
