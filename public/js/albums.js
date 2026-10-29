// Альбомы: свои подборки и альбомы из метаданных, загрузка альбома с YouTube,
// скачивание и перенос альбома между устройствами архивом (экспорт/импорт).

import * as core from './core.js';
import { state, albums, jobs } from './core.js';
import { settings } from './store.js';
import { esc, formatTime, formatLong, plural, albumOf } from './format.js';
import { currentDesign } from './themes.js';
import { registerActions, toast, isDesktop, setTab } from './ui.js';
import { saveUrl } from './native.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const html = document.documentElement;
const helpers = { esc, formatTime, albumOf };

function infoOf(album) {
  const tracks = album.tracks.map(core.find).filter(Boolean);
  const n = tracks.length;
  return {
    count: n,
    countText: `${n} ${plural(n, 'трек', 'трека', 'треков')}`,
    timeText: formatLong(tracks.reduce((s, t) => s + (t._sec || 0), 0)),
    covers: tracks.slice(0, 4).map((t) => t.thumbnail_api),
  };
}

// ============ Отрисовка ============
export function renderAlbums() {
  const design = currentDesign();
  if (!design.renderAlbumCard) return;
  const user = core.userAlbums();
  const meta = core.metaAlbums();
  const card = (a) => design.renderAlbumCard(a, infoOf(a), helpers);
  const s = $('[data-albums-smart]');
  if (s) s.innerHTML = core.smartAlbums().map(card).join('');
  const u = $('[data-albums-user]');
  if (u) u.innerHTML = user.map(card).join('');
  const m = $('[data-albums-meta]');
  if (m) m.innerHTML = meta.map(card).join('');
  $$('[data-albums-user-empty]').forEach((el) => { el.hidden = user.length > 0; });
  $$('[data-albums-meta-section]').forEach((el) => { el.hidden = meta.length === 0; });
  renderAlbum();
}

export function renderAlbum() {
  const head = $('[data-album-head]');
  const list = $('[data-album-list]');
  if (!head || !list) return;
  const album = albums.open ? core.findAlbum(albums.open) : null;
  if (!album) {
    if (html.dataset.libview === 'album') html.dataset.libview = 'albums';
    return;
  }
  const design = currentDesign();
  head.innerHTML = design.renderAlbumHead(album, infoOf(album), helpers);
  const cur = state.current && state.current.video_id;
  const tracks = album.tracks.map(core.find).filter(Boolean);
  list.innerHTML = tracks.map((t, i) => design.renderRow(t, i, {
    current: t.video_id === cur,
    played: settings.markPlayed && state.played.has(t.video_id),
    missing: t.file_exists === false,
    removable: album.kind === 'user',
  }, helpers)).join('');
  $$('[data-album-empty]').forEach((el) => { el.hidden = tracks.length > 0; });
}

// ============ Окна ============
const nameDialog = $('#name-dialog');
let nameDone = null;
function askName(title, value, button) {
  $('#name-title').textContent = title;
  $('#name-save').textContent = button;
  const input = $('#name-input');
  input.value = value || '';
  nameDialog.returnValue = '';
  nameDialog.showModal();
  input.select();
  return new Promise((resolve) => { nameDone = resolve; });
}
$('#name-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#name-input').value.trim();
  if (!v) return;
  nameDialog.close();
  nameDone?.(v);
  nameDone = null;
});
nameDialog.addEventListener('close', () => { nameDone?.(null); nameDone = null; });

const askDialog = $('#ask-dialog');
function ask(title, text, yes) {
  $('#ask-title').textContent = title;
  $('#ask-text').textContent = text;
  $('#ask-yes-label').textContent = yes;
  askDialog.returnValue = '';
  askDialog.showModal();
  return new Promise((resolve) => askDialog.addEventListener('close', () => resolve(askDialog.returnValue === 'yes'), { once: true }));
}

// Добавить трек в альбом
const pickAlbum = $('#pick-album-dialog');
let pickTrack = null;
export async function openAlbumPicker(track) {
  if (!track) return;
  pickTrack = track;
  if (!albums.loaded) await core.loadAlbums();
  $('#pick-album-track').textContent = `«${track.title}» — ${track.artist}`;
  const list = core.userAlbums();
  $('[data-pick-albums]').innerHTML = list.length
    ? list.map((a) => {
      const has = a.tracks.includes(track.video_id);
      return `<button type="button" class="pick-row" data-pick-album="${a.id}" ${has ? 'disabled' : ''}>
        <span class="pick-name">${esc(a.name)}</span><span class="pick-meta">${has ? 'уже здесь' : infoOf(a).countText}</span></button>`;
    }).join('')
    : '<p class="hint">Своих альбомов пока нет — создайте первый.</p>';
  pickAlbum.showModal();
}
pickAlbum.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-pick-album]');
  if (btn && pickTrack) {
    const a = core.userAlbums().find((x) => String(x.id) === btn.dataset.pickAlbum);
    pickAlbum.close();
    try {
      await core.addToAlbum(a.id, pickTrack.video_id);
      toast(`Добавлено в «${a.name}»`, 'ok');
    } catch (err) { toast(`Не удалось: ${err.message}`, 'error'); }
  }
  if (e.target.closest('[data-pick-new]') && pickTrack) {
    const track = pickTrack;
    pickAlbum.close();
    const name = await askName('Новый альбом', '', 'Создать');
    if (!name) return;
    try {
      await core.createAlbum(name, [track.video_id]);
      toast(`Альбом «${name}» создан`, 'ok');
    } catch (err) { toast(`Не удалось: ${err.message}`, 'error'); }
  }
});

// Добавить треки в открытый альбом
const pickTracks = $('#pick-tracks-dialog');
let picked = new Set();
function renderPicker() {
  const album = core.findAlbum(albums.open);
  const q = $('#pick-search').value.trim().toLowerCase();
  const list = state.library
    .filter((t) => !album.tracks.includes(t.video_id))
    .filter((t) => !q || [t.title, t.artist, t.album].some((v) => (v || '').toLowerCase().includes(q)));
  $('[data-pick-tracks]').innerHTML = list.length
    ? list.map((t) => `<label class="pick-track">
        <input type="checkbox" value="${esc(t.video_id)}" ${picked.has(t.video_id) ? 'checked' : ''}>
        <img src="${esc(t.thumbnail_api)}" alt="" loading="lazy">
        <span class="pick-text"><span class="pick-name">${esc(t.title)}</span><span class="pick-meta">${esc(t.artist || '')}</span></span>
      </label>`).join('')
    : `<p class="hint">${q ? 'Ничего не нашлось.' : 'Все треки библиотеки уже в этом альбоме.'}</p>`;
  $('#pick-add-label').textContent = picked.size ? `Добавить (${picked.size})` : 'Добавить';
  $('#pick-add').disabled = !picked.size;
}
function openTrackPicker() {
  picked = new Set();
  $('#pick-search').value = '';
  renderPicker();
  pickTracks.showModal();
}
$('#pick-search').addEventListener('input', renderPicker);
pickTracks.addEventListener('change', (e) => {
  if (!e.target.matches('input[type="checkbox"]')) return;
  if (e.target.checked) picked.add(e.target.value); else picked.delete(e.target.value);
  $('#pick-add-label').textContent = picked.size ? `Добавить (${picked.size})` : 'Добавить';
  $('#pick-add').disabled = !picked.size;
});
$('#pick-add').addEventListener('click', async () => {
  const album = core.findAlbum(albums.open);
  if (!album || album.kind !== 'user' || !picked.size) return;
  pickTracks.close();
  try {
    await core.setAlbumTracks(album.id, [...album.tracks, ...picked]);
    toast(`Добавлено треков: ${picked.size}`, 'ok');
  } catch (err) { toast(`Не удалось: ${err.message}`, 'error'); }
});

// ============ Фоновые задачи и импорт ============
const jobsEl = $('#jobs');
const finishedAt = new Map();
let jobsSeen = false;

export function renderJobs() {
  const now = Date.now();
  // Задачи, завершённые ещё до открытия страницы, не показываем — это не новость.
  if (!jobsSeen && jobs.list.length) {
    jobs.list.forEach((j) => { if (j.state === 'done') finishedAt.set(j.id, 0); });
    jobsSeen = true;
  }
  const items = [];
  for (const j of jobs.list) {
    if (j.state === 'done') {
      if (!finishedAt.has(j.id)) finishedAt.set(j.id, now);
      if (now - finishedAt.get(j.id) > 6000) continue;
    }
    const p = j.total ? (j.done + j.failed) / j.total : 0;
    const status = j.state === 'done'
      ? `готово: ${j.done} из ${j.total}${j.failed ? `, не скачалось ${j.failed}` : ''}`
      : `${j.done + j.failed + 1 > j.total ? j.total : j.done + j.failed + 1} из ${j.total}${j.current ? ` · ${j.current}` : ''}`;
    items.push(`<button type="button" class="job${j.state === 'done' ? ' done' : ''}" data-act="album-open" data-key="u:${j.album_id}" style="--p:${p.toFixed(3)}">
      <span class="job-name">${esc(j.name)}</span><span class="job-status">${esc(status)}</span><span class="job-bar"></span></button>`);
  }
  for (const j of jobs.local) {
    items.push(`<div class="job" style="--p:${j.p.toFixed(3)}"><span class="job-name">${esc(j.name)}</span><span class="job-status">${esc(j.status)}</span><span class="job-bar"></span></div>`);
  }
  jobsEl.innerHTML = items.join('');
  jobsEl.hidden = !items.length;
  if (jobs.list.some((j) => j.state === 'done' && now - (finishedAt.get(j.id) || now) <= 6000)) setTimeout(renderJobs, 1500);
}

const importInput = document.createElement('input');
importInput.type = 'file';
importInput.accept = '.zip,application/zip';
// Можно выбрать сразу несколько архивов (например, медиатеку, разбитую на части) — по очереди.
importInput.multiple = true;
importInput.addEventListener('change', async () => {
  const files = [...importInput.files];
  importInput.value = '';
  for (const file of files) await importOne(file);
});

async function importOne(file) {
  const job = { name: `Импорт «${file.name.replace(/\.zip$/i, '')}»`, p: 0, status: 'отправляю…' };
  jobs.local.push(job);
  renderJobs();
  try {
    const r = await core.importAlbum(file, (p) => {
      job.p = p;
      job.status = p < 1 ? `отправляю… ${Math.round(p * 100)}%` : 'распаковываю…';
      renderJobs();
    });
    await core.loadLibrary();
    await core.loadAlbums();
    const parts = [`новых ${r.imported}`];
    if (r.skipped) parts.push(`уже были ${r.skipped}`);
    if (r.failed) parts.push(`с ошибкой ${r.failed}`);
    toast(`Альбом «${r.name}» импортирован: ${parts.join(', ')}`, 'ok', 5000);
    albums.open = `u:${r.album_id}`;
    html.dataset.libview = 'album';
    renderAlbums();
  } catch (err) {
    toast(`Импорт не удался: ${err.message}`, 'error', 6000);
  } finally {
    jobs.local = jobs.local.filter((j) => j !== job);
    renderJobs();
  }
}

// ============ Действия ============
function openAlbum(key) {
  albums.open = key;
  html.dataset.libview = 'album';
  renderAlbum();
  $('[data-album-list]')?.closest('.album-scroll, .tracks-wrap, .tracklist-wrap')?.scrollTo(0, 0);
}

registerActions({
  'libview-albums': () => {
    html.dataset.libview = 'albums';
    if (!isDesktop() && html.dataset.tab === 'player') setTab('library');
    if (!albums.loaded) core.loadAlbums(); else renderAlbums();
  },
  'album-open': (el) => {
    if (!isDesktop() && html.dataset.tab === 'player') setTab('library');
    if (!albums.loaded) core.loadAlbums().then(() => openAlbum(el.dataset.key)); else openAlbum(el.dataset.key);
  },
  'album-back': () => { html.dataset.libview = 'albums'; renderAlbums(); },
  'album-play': () => {
    const a = core.findAlbum(albums.open);
    if (!a || !a.tracks.length) return;
    core.playAlbum(a);
    if (!isDesktop() && currentDesign().rowOpensPlayer) setTab('player');
  },
  'album-download': () => {
    const a = core.findAlbum(albums.open);
    if (!a || !a.tracks.length) return;
    if (saveUrl(core.exportUrl(a))) { toast('Собираю архив альбома — он появится в «Загрузках»', 'info', 4500); return; }
    const link = document.createElement('a');
    link.href = core.exportUrl(a);
    link.download = '';
    document.body.append(link);
    link.click();
    link.remove();
    toast('Собираю архив альбома — скачивание начнётся само', 'info', 4500);
  },
  'album-new': async () => {
    const name = await askName('Новый альбом', '', 'Создать');
    if (!name) return;
    try {
      const a = await core.createAlbum(name);
      openAlbum(`u:${a.id}`);
    } catch (err) { toast(`Не удалось: ${err.message}`, 'error'); }
  },
  'album-rename': async () => {
    const a = core.findAlbum(albums.open);
    if (!a || a.kind !== 'user') return;
    const name = await askName('Переименовать альбом', a.name, 'Сохранить');
    if (!name || name === a.name) return;
    try { await core.renameAlbum(a.id, name); } catch (err) { toast(`Не удалось: ${err.message}`, 'error'); }
  },
  'album-delete': async () => {
    const a = core.findAlbum(albums.open);
    if (!a || a.kind !== 'user') return;
    if (!(await ask('Удалить альбом?', `«${a.name}». Сами треки останутся в библиотеке.`, 'Удалить альбом'))) return;
    try {
      await core.deleteAlbum(a.id);
      albums.open = null;
      html.dataset.libview = 'albums';
      toast(`Альбом «${a.name}» удалён`);
    } catch (err) { toast(`Не удалось: ${err.message}`, 'error'); }
  },
  'album-save': async () => {
    // Альбом из метаданных → своя подборка (её можно менять и переименовывать).
    const a = core.findAlbum(albums.open);
    if (!a) return;
    try {
      const n = await core.createAlbum(a.name, a.tracks);
      openAlbum(`u:${n.id}`);
      toast(`«${a.name}» теперь в ваших альбомах`, 'ok');
    } catch (err) { toast(`Не удалось: ${err.message}`, 'error'); }
  },
  'album-add-tracks': () => openTrackPicker(),
  'album-remove': async (el) => {
    const a = core.findAlbum(albums.open);
    if (!a || a.kind !== 'user') return;
    try { await core.removeFromAlbum(a.id, el.dataset.removeId); } catch (err) { toast(`Не удалось: ${err.message}`, 'error'); }
  },
  'album-import': () => importInput.click(),
  'add-to-album': () => openAlbumPicker(state.current),
});

core.on('albums', renderAlbums);
core.on('library', renderAlbums);
core.on('like', renderAlbums);
core.on('stats', renderAlbums);
core.on('track', () => renderAlbum());
core.on('jobs', renderJobs);
