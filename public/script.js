'use strict';

// ============ Элементы ============
const $ = (id) => document.getElementById(id);
const app = $('app');
const audio = $('audio');
const tracklist = $('tracklist');
const searchInput = $('search-input');
const clearSearch = $('clear-search');
const scrub = $('scrub');
const volumeSlider = $('volume-slider');
const cassette = $('cassette');
const vuCanvas = $('vu-canvas');
const vuCtx = vuCanvas.getContext('2d');

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* приватный режим */ }
  },
};

// ============ Состояние ============
let library = [];          // как пришло с сервера
let view = [];             // после поиска и сортировки
let current = null;        // трек, который сейчас в деке
let sortMode = store.get('sort', 'added');
if (!['added', 'artist', 'title', 'album'].includes(sortMode)) sortMode = 'added';
let shuffle = store.get('shuffle', false);
let repeat = store.get('repeat', 'off'); // off | all | one
let vuOn = store.get('vu', true);
const played = new Set(store.get('played', []));
let restoreTimer = null;
let dragging = false;
let dragP = 0;

// ============ Форматирование ============
function parseDuration(str) {
  if (str == null) return 0;
  if (typeof str === 'number') return str;
  return String(str).split(':').reduce((acc, part) => acc * 60 + (parseInt(part, 10) || 0), 0);
}

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function formatNumber(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('ru-RU', { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function yearOf(date) {
  const m = /(\d{4})$/.exec(date || '');
  return m ? m[1] : '';
}

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text ?? '';
  return d.innerHTML;
}

// ============ Уведомления ============
function toast(message, type = 'info', ms = 3200) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
}

// ============ Библиотека ============
async function loadLibrary() {
  try {
    const res = await fetch('/api/library');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    library = await res.json();
    library.forEach((t) => { t._sec = parseDuration(t.duration); });
    if (current) current = library.find((t) => t.video_id === current.video_id) || current;
    applyFilters();
  } catch (err) {
    library = [];
    applyFilters();
    $('empty-title').textContent = 'Нет связи с декой';
    $('empty-text').textContent = 'Сервер не отвечает. Проверьте, что он запущен, и обновите страницу.';
    toast('Не удалось загрузить библиотеку', 'error');
  }
}

const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });

function applyFilters() {
  const q = searchInput.value.trim().toLowerCase();
  clearSearch.hidden = !q;

  view = library.filter((t) => !q || [t.title, t.artist, t.album].some((v) => (v || '').toLowerCase().includes(q)));

  const by = {
    artist: (a, b) => collator.compare(a.artist || '', b.artist || '') || collator.compare(a.title || '', b.title || ''),
    title: (a, b) => collator.compare(a.title || '', b.title || ''),
    album: (a, b) => collator.compare(a.album || '', b.album || '') || collator.compare(a.title || '', b.title || ''),
    added: (a, b) => (b.added || 0) - (a.added || 0),
  }[sortMode];
  if (by) view.sort(by);

  renderList(q);
  updateStats();
}

function updateStats() {
  const n = library.length;
  $('track-count').textContent = `${n} ${plural(n, 'трек', 'трека', 'треков')}`;
  $('total-duration').textContent = formatTime(library.reduce((s, t) => s + t._sec, 0));
}

const tickSvg = '<svg aria-hidden="true"><use href="#i-tick"/></svg>';

function renderList(query) {
  const empty = $('empty-state');
  if (!view.length) {
    tracklist.innerHTML = '';
    empty.hidden = false;
    if (library.length) {
      $('empty-title').textContent = 'Ничего не нашлось';
      $('empty-text').textContent = `На вкладыше нет «${query}». Попробуйте другое слово.`;
    } else if (!$('empty-title').textContent.startsWith('Нет связи')) {
      $('empty-title').textContent = 'Кассета чистая';
      $('empty-text').textContent = 'Запишите первый трек — вставьте ссылку с YouTube или YouTube Music.';
    }
    return;
  }
  empty.hidden = true;

  tracklist.innerHTML = view.map((t, i) => {
    const isCur = current && current.video_id === t.video_id;
    const cls = ['row', isCur ? 'playing' : '', t.file_exists === false ? 'missing' : ''].join(' ');
    const sub = [t.artist, t.album && t.album !== 'Single' ? t.album : ''].filter(Boolean).map(esc).join(' · ');
    return `<li><button type="button" class="${cls}" data-id="${esc(t.video_id)}" ${isCur ? 'aria-current="true"' : ''}>
      <span class="row-num">${String(i + 1).padStart(2, '0')}${played.has(t.video_id) ? tickSvg : ''}</span>
      <span class="row-main">
        <span class="row-title"><mark>${esc(t.title)}</mark></span>
        <span class="row-sub">${t.file_exists === false ? '<span class="tag">нет файла</span>' : ''}${sub}</span>
      </span>
      <span class="row-time">${t._sec ? formatTime(t._sec) : '—'}</span>
    </button></li>`;
  }).join('');
}

function markPlaying() {
  tracklist.querySelectorAll('.row').forEach((row) => {
    const on = current && row.dataset.id === current.video_id;
    row.classList.toggle('playing', !!on);
    if (on) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current');
  });
}

tracklist.addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const track = library.find((t) => t.video_id === row.dataset.id);
  if (!track) return;
  if (current && current.video_id === track.video_id) {
    togglePlay();
  } else {
    load(track, true);
  }
  if (!isDesktop()) setTab('tape');
});

searchInput.addEventListener('input', applyFilters);
clearSearch.addEventListener('click', () => { searchInput.value = ''; applyFilters(); searchInput.focus(); });

document.querySelectorAll('input[name="sort"]').forEach((r) => {
  r.checked = r.value === sortMode;
  r.addEventListener('change', () => { sortMode = r.value; store.set('sort', sortMode); applyFilters(); });
});

// ============ Счётчик ленты ============
const wheelsEl = $('counter-wheels');
const WHEELS = 4; // мм:сс
function buildWheels() {
  const digits = Array.from({ length: 10 }, (_, i) => `<span>${i}</span>`).join('');
  let html = '';
  for (let i = 0; i < WHEELS; i++) {
    if (i === 2) html += '<span class="wheel sep">:</span>';
    html += `<span class="wheel"><span class="wheel-strip">${digits}</span></span>`;
  }
  wheelsEl.innerHTML = html;
}
let lastCounter = '';
function setCounter(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.min(99, Math.floor(sec / 60));
  const str = String(m).padStart(2, '0') + String(sec % 60).padStart(2, '0');
  if (str === lastCounter) return;
  lastCounter = str;
  wheelsEl.querySelectorAll('.wheel-strip').forEach((strip, i) => {
    strip.style.transform = `translateY(${-Number(str[i]) * 10}%)`;
  });
  $('counter').setAttribute('aria-label', `Прошло ${formatTime(sec)}`);
}

// ============ Бобины ============
const reel = {
  packL: $('pack-l'), packR: $('pack-r'), hubL: $('hub-l'), hubR: $('hub-r'), tape: $('tape-path'),
  angleL: 0, angleR: 0, last: 0, lastP: 0,
  R_MIN: 14, R_MAX: 44,
};

function reelRadii(p) {
  // площадь намотки сохраняется: r = sqrt(rmin² + доля·(rmax² − rmin²))
  const a = reel.R_MIN ** 2, b = reel.R_MAX ** 2;
  return [Math.sqrt(a + (1 - p) * (b - a)), Math.sqrt(a + p * (b - a))];
}

function drawReels(p) {
  const [rl, rr] = reelRadii(p);
  reel.packL.setAttribute('r', rl.toFixed(2));
  reel.packR.setAttribute('r', rr.toFixed(2));
  // лента: с левого рулона на левый ролик, по низу мимо прижимной подушки, на правый
  reel.tape.setAttribute('d', `M${(118 - rl).toFixed(1)} 97 L27 176 L34 183 L282 183 L289 176 L${(198 + rr).toFixed(1)} 97`);
  reel.hubL.setAttribute('transform', `rotate(${reel.angleL.toFixed(1)} 118 97)`);
  reel.hubR.setAttribute('transform', `rotate(${reel.angleR.toFixed(1)} 198 97)`);
  return [rl, rr];
}

function progress() {
  return audio.duration ? Math.min(1, audio.currentTime / audio.duration) : 0;
}

// ============ VU-метры ============
let audioCtx = null;
let analyser = null;
let analyserData = null;
let vuLevel = [0, 0];

function initAudioGraph() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaElementSource(audio);
    const splitter = audioCtx.createChannelSplitter(2);
    analyser = [audioCtx.createAnalyser(), audioCtx.createAnalyser()];
    analyser.forEach((a) => { a.fftSize = 1024; });
    analyserData = new Float32Array(1024);
    src.connect(audioCtx.destination);
    src.connect(splitter);
    splitter.connect(analyser[0], 0);
    splitter.connect(analyser[1], 1);
  } catch {
    analyser = null;
  }
}

function readLevels() {
  if (!analyser || audio.paused) return [0, 0];
  return analyser.map((a) => {
    a.getFloatTimeDomainData(analyserData);
    let sum = 0;
    for (let i = 0; i < analyserData.length; i++) sum += analyserData[i] * analyserData[i];
    const rms = Math.sqrt(sum / analyserData.length);
    const db = 20 * Math.log10(rms || 1e-6);
    return Math.min(1.08, Math.max(0, (db + 40) / 36)); // −40 dB … −4 dB
  });
}

function drawVU() {
  const W = vuCanvas.width, H = vuCanvas.height;
  vuCtx.clearRect(0, 0, W, H);
  const meterW = W / 2 - 6;
  for (let ch = 0; ch < 2; ch++) {
    const x0 = 4 + ch * (meterW + 4), y0 = 4, w = meterW, h = H - 8;
    // шкала с подсветкой
    // шкала с лампой подсветки снизу: тёплый центр, к краям темнее
    const lamp = vuCtx.createRadialGradient(x0 + w / 2, y0 + h * 1.1, h * 0.2, x0 + w / 2, y0 + h * 0.9, w * 0.75);
    lamp.addColorStop(0, '#ffd56b');
    lamp.addColorStop(0.55, '#f0b53c');
    lamp.addColorStop(1, '#a8701a');
    vuCtx.fillStyle = lamp;
    vuCtx.fillRect(x0, y0, w, h);
    const cx = x0 + w / 2, cy = y0 + h * 1.55, r = h * 1.25;
    const a0 = -Math.PI / 2 - 0.62, a1 = -Math.PI / 2 + 0.62;
    vuCtx.lineWidth = 2;
    vuCtx.strokeStyle = '#1b1c20';
    vuCtx.beginPath(); vuCtx.arc(cx, cy, r, a0, a0 + (a1 - a0) * 0.72); vuCtx.stroke();
    vuCtx.strokeStyle = '#d23a12';
    vuCtx.lineWidth = 4;
    vuCtx.beginPath(); vuCtx.arc(cx, cy, r, a0 + (a1 - a0) * 0.72, a1); vuCtx.stroke();
    vuCtx.lineWidth = 1.5;
    vuCtx.strokeStyle = '#1b1c20';
    for (let i = 0; i <= 10; i++) {
      const a = a0 + (a1 - a0) * (i / 10);
      const inner = r - (i % 5 === 0 ? 9 : 5);
      vuCtx.beginPath();
      vuCtx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      vuCtx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      vuCtx.stroke();
    }
    vuCtx.fillStyle = '#1b1c20';
    vuCtx.font = '700 12px "PT Sans Narrow", sans-serif';
    vuCtx.fillText('VU', x0 + 8, y0 + h - 8);
    vuCtx.fillText(ch ? 'П' : 'Л', x0 + w - 16, y0 + h - 8);
    // стрелка
    const a = a0 + (a1 - a0) * Math.min(1, vuLevel[ch]);
    vuCtx.strokeStyle = '#111';
    vuCtx.lineWidth = 2;
    vuCtx.beginPath();
    vuCtx.moveTo(cx + Math.cos(a) * (r * 0.45), cy + Math.sin(a) * (r * 0.45));
    vuCtx.lineTo(cx + Math.cos(a) * (r + 3), cy + Math.sin(a) * (r + 3));
    vuCtx.stroke();
  }
}

// ============ Главный цикл ============
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function frame(t) {
  const dt = reel.last ? Math.min(0.1, (t - reel.last) / 1000) : 0;
  reel.last = t;
  const p = dragging ? dragP : progress();
  const [rl, rr] = reelRadii(p);
  if (dragging && !reduceMotion) {
    // при перемотке пальцем бобины прокручиваются вместе с лентой
    const dp = p - reel.lastP;
    reel.angleL = (reel.angleL - dp * 9000 / rl) % 360;
    reel.angleR = (reel.angleR - dp * 9000 / rr) % 360;
  } else if (!audio.paused && !reduceMotion) {
    // лента идёт с постоянной линейной скоростью: тонкая бобина крутится быстрее
    const v = 34 * audio.playbackRate; // условных единиц/с
    reel.angleL = (reel.angleL - (v / rl) * dt * 57.3) % 360;
    reel.angleR = (reel.angleR - (v / rr) * dt * 57.3) % 360;
  }
  reel.lastP = p;
  drawReels(p);

  if (!dragging) setProgressUI(p);
  setCounter(audio.currentTime);

  if (vuOn) {
    const target = readLevels();
    // баллистика стрелки: быстрый подъём, медленный спад
    vuLevel = vuLevel.map((v, i) => v + (target[i] - v) * (target[i] > v ? 0.35 : 0.12));
    drawVU();
  }
  requestAnimationFrame(frame);
}

// ============ Воспроизведение ============
function load(track, autoplay) {
  clearTimeout(restoreTimer);
  current = track;
  initAudioGraph();
  audio.src = `/api/stream/${encodeURIComponent(track.video_id)}`;
  audio.load();

  cassette.classList.remove('insert');
  void cassette.offsetWidth;
  cassette.classList.add('insert');

  renderNow();
  markPlaying();
  store.set('last', track.video_id);
  if (autoplay) play();
}

function renderNow() {
  const t = current;
  const art = $('label-art');
  $('label-title').textContent = t ? t.title : 'вставьте кассету';
  $('track-title').textContent = t ? t.title : 'Выберите трек на вкладыше';
  $('track-artist').textContent = t ? (t.artist || '—') : '—';
  const meta = t ? [t.album && t.album !== 'Single' ? t.album : '', yearOf(t.release_date), t.abr ? `${Math.round(t.abr)} кбит/с` : ''].filter(Boolean).join(' · ') : '';
  $('track-meta').textContent = meta;
  $('total-time').textContent = t ? formatTime(t._sec) : '0:00';

  if (t) {
    art.classList.remove('empty');
    art.style.backgroundImage = `url("${t.thumbnail_api}")`;
  } else {
    art.classList.add('empty');
    art.style.backgroundImage = '';
  }
  ['info-btn', 'download-btn', 'delete-btn'].forEach((id) => { $(id).disabled = !t; });
  document.title = t ? `${t.title} — ${t.artist} · МК-60` : 'МК-60 · Моя музыка';
  updateMediaSession();
}

async function play() {
  if (!current) {
    if (view.length) load(view[0], true);
    return;
  }
  if (!audio.getAttribute('src')) { load(current, true); return; }
  initAudioGraph();
  try {
    if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
    await audio.play();
  } catch (err) {
    if (err.name !== 'AbortError') console.warn(err);
  }
}

function togglePlay() {
  if (audio.paused) play(); else audio.pause();
}

function neighbour(step) {
  if (!view.length) return null;
  if (shuffle && view.length > 1) {
    let next;
    do { next = view[Math.floor(Math.random() * view.length)]; } while (current && next.video_id === current.video_id);
    return next;
  }
  const idx = current ? view.findIndex((t) => t.video_id === current.video_id) : -1;
  let i = idx + step;
  if (i >= view.length) { if (repeat === 'all' || idx === -1) i = 0; else return null; }
  if (i < 0) i = repeat === 'all' ? view.length - 1 : 0;
  return view[i];
}

function playNext() {
  const t = neighbour(1);
  if (t) load(t, true);
}

function playPrev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  const t = neighbour(-1);
  if (t) load(t, true);
}

function updatePlayState() {
  const playing = !audio.paused;
  $('play-icon').setAttribute('href', playing ? '#i-pause' : '#i-play');
  $('play-btn').classList.toggle('latched', playing);
  $('play-btn').setAttribute('aria-label', playing ? 'Пауза (пробел)' : 'Играть (пробел)');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

audio.addEventListener('play', updatePlayState);
audio.addEventListener('pause', updatePlayState);
audio.addEventListener('loadedmetadata', () => { $('total-time').textContent = formatTime(audio.duration); });
audio.addEventListener('playing', () => {
  if (current && !played.has(current.video_id)) {
    played.add(current.video_id);
    store.set('played', [...played]);
    const row = tracklist.querySelector(`.row[data-id="${CSS.escape(current.video_id)}"] .row-num`);
    if (row && !row.querySelector('svg')) row.insertAdjacentHTML('beforeend', tickSvg);
  }
});
audio.addEventListener('ended', () => {
  if (repeat === 'one') { audio.currentTime = 0; play(); } else playNext();
});
audio.addEventListener('error', onAudioError);

// Файла нет — сервер начинает восстановление; ждём, пока он появится.
async function onAudioError() {
  if (!current || !audio.getAttribute('src')) return;
  const track = current;
  let data = null;
  try {
    const res = await fetch(`/api/stream/${encodeURIComponent(track.video_id)}`, { headers: { Range: 'bytes=0-0' } });
    if (res.ok) { load(track, true); return; }
    data = await res.json().catch(() => null);
  } catch { /* сеть */ }

  if (data && data.restoring) {
    track.file_exists = false;
    renderList(searchInput.value.trim());
    toast('Файла нет — перезаписываю трек с YouTube…', 'info', 5000);
    pollRestore(track, 0);
  } else {
    toast(data && data.error ? `Не воспроизводится: ${data.error}` : 'Не удалось воспроизвести трек', 'error');
  }
}

function pollRestore(track, attempt) {
  clearTimeout(restoreTimer);
  if (attempt > 40 || current !== track) return;
  restoreTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/stream/${encodeURIComponent(track.video_id)}`, { headers: { Range: 'bytes=0-0' } });
      if (res.ok) {
        track.file_exists = true;
        renderList(searchInput.value.trim());
        toast('Трек восстановлен', 'ok');
        if (current === track) load(track, true);
        return;
      }
    } catch { /* ещё пишется */ }
    pollRestore(track, attempt + 1);
  }, 4000);
}

// ============ Перемотка ============
function setProgressUI(p) {
  const pct = (p * 100).toFixed(2);
  $('scrub-head').style.left = `${pct}%`;
  scrub.setAttribute('aria-valuenow', Math.round(p * 100));
  scrub.setAttribute('aria-valuetext', `${formatTime(audio.currentTime)} из ${formatTime(audio.duration)}`);
  $('current-time').textContent = formatTime(audio.currentTime);
}

function pointerToP(e) {
  const r = scrub.getBoundingClientRect();
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
}

scrub.addEventListener('pointerdown', (e) => {
  if (!audio.duration) return;
  dragging = true;
  scrub.classList.add('dragging');
  scrub.setPointerCapture(e.pointerId);
  dragP = pointerToP(e);
  setProgressUI(dragP);
});
scrub.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  dragP = pointerToP(e);
  setProgressUI(dragP);
  $('current-time').textContent = formatTime(dragP * audio.duration);
});
scrub.addEventListener('pointerup', (e) => {
  if (!dragging) return;
  dragging = false;
  scrub.classList.remove('dragging');
  audio.currentTime = pointerToP(e) * audio.duration;
});
scrub.addEventListener('pointercancel', () => { dragging = false; scrub.classList.remove('dragging'); });
scrub.addEventListener('keydown', (e) => {
  if (!audio.duration) return;
  const step = { ArrowRight: 5, ArrowLeft: -5, PageUp: 30, PageDown: -30 }[e.key];
  if (step) { e.preventDefault(); e.stopPropagation(); audio.currentTime = Math.max(0, audio.currentTime + step); }
  if (e.key === 'Home') audio.currentTime = 0;
});

// ============ Громкость и режимы ============
function setVolume(v, save = true) {
  audio.volume = Math.min(1, Math.max(0, v));
  volumeSlider.value = Math.round(audio.volume * 100);
  volumeSlider.style.setProperty('--fill', `${volumeSlider.value}%`);
  $('volume-icon').setAttribute('href', audio.muted || audio.volume === 0 ? '#i-mute' : '#i-vol');
  if (save) store.set('volume', audio.volume);
}
volumeSlider.addEventListener('input', () => { audio.muted = false; setVolume(volumeSlider.value / 100); });
$('volume-btn').addEventListener('click', () => { audio.muted = !audio.muted; setVolume(audio.volume, false); });

function renderModes() {
  const sh = $('shuffle-btn'), rp = $('repeat-btn'), vu = $('vu-btn');
  sh.classList.toggle('on', shuffle);
  sh.setAttribute('aria-pressed', shuffle);
  rp.classList.toggle('on', repeat !== 'off');
  rp.classList.toggle('one', repeat === 'one');
  rp.setAttribute('aria-pressed', repeat !== 'off');
  rp.title = { off: 'Повтор выключен (R)', all: 'Повтор всего вкладыша (R)', one: 'Повтор одного трека (R)' }[repeat];
  vu.classList.toggle('on', vuOn);
  vu.setAttribute('aria-pressed', vuOn);
  $('vu').classList.toggle('off', !vuOn);
}
$('shuffle-btn').addEventListener('click', () => { shuffle = !shuffle; store.set('shuffle', shuffle); renderModes(); });
$('repeat-btn').addEventListener('click', () => {
  repeat = { off: 'all', all: 'one', one: 'off' }[repeat];
  store.set('repeat', repeat);
  renderModes();
});
$('vu-btn').addEventListener('click', () => { vuOn = !vuOn; store.set('vu', vuOn); renderModes(); });

// ============ Клавиши деки ============
$('play-btn').addEventListener('click', togglePlay);
$('prev-btn').addEventListener('click', playPrev);
$('next-btn').addEventListener('click', playNext);

function isDesktop() { return matchMedia('(min-width: 960px)').matches; }

function setTab(tab) {
  app.dataset.tab = tab;
  const toTape = tab === 'card';
  $('tab-icon').setAttribute('href', toTape ? '#i-tape' : '#i-card');
  $('tab-btn').setAttribute('aria-label', toTape ? 'Кассета' : 'Вкладыш');
}
$('tab-btn').addEventListener('click', () => setTab(app.dataset.tab === 'card' ? 'tape' : 'card'));

function setFolded(folded) {
  app.classList.toggle('folded', folded);
  store.set('folded', folded);
}
$('fold-btn').addEventListener('click', () => setFolded(true));
$('unfold-btn').addEventListener('click', () => setFolded(false));

// ============ Окна ============
document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  });
});

$('cover-btn').addEventListener('click', () => {
  if (!current) return;
  const dlg = $('cover-dialog');
  let img = dlg.querySelector('img');
  if (!img) { img = document.createElement('img'); dlg.append(img); }
  img.src = current.thumbnail_api;
  img.alt = `Обложка: ${current.title}`;
  $('cover-dialog').showModal();
});

// Запись трека
const addDialog = $('add-dialog');
const addStatus = $('add-status');
$('add-btn').addEventListener('click', () => {
  addStatus.textContent = '';
  addStatus.className = 'status';
  addDialog.showModal();
  $('url-input').focus();
});

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('url-input');
  const url = input.value.trim();
  if (!url) return;
  const btn = $('submit-add');
  btn.disabled = true;
  btn.classList.add('recording');
  $('add-btn').classList.add('recording');
  $('submit-label').textContent = 'идёт запись…';
  addStatus.className = 'status';
  addStatus.textContent = 'Скачиваю и конвертирую — можно закрыть окно, запись продолжится.';

  try {
    const res = await fetch('/api/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

    input.value = '';
    addStatus.className = 'status ok';
    addStatus.textContent = `Записано: ${data.track?.title || 'трек'}`;
    toast(`На вкладыш добавлен «${data.track?.title || 'трек'}»`, 'ok');
    await loadLibrary();
    const id = data.track?.video_id;
    const row = id && tracklist.querySelector(`.row[data-id="${CSS.escape(id)}"]`);
    if (row) { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); row.classList.add('flash'); }
    setTimeout(() => addDialog.open && addDialog.close(), 900);
  } catch (err) {
    addStatus.className = 'status error';
    addStatus.textContent = `Не записалось: ${err.message}. Проверьте ссылку и подключение и попробуйте снова.`;
    if (!addDialog.open) toast('Запись трека не удалась', 'error', 5000);
  } finally {
    btn.disabled = false;
    btn.classList.remove('recording');
    $('add-btn').classList.remove('recording');
    $('submit-label').textContent = 'запись';
  }
});

// О треке
$('info-btn').addEventListener('click', () => {
  const t = current;
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
  $('info-list').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v ?? '—')}</dd>`).join('');
  $('info-dialog').showModal();
});

// Скачать
$('download-btn').addEventListener('click', () => {
  const t = current;
  if (!t) return;
  const a = document.createElement('a');
  a.href = `/api/stream/${encodeURIComponent(t.video_id)}`;
  a.download = `${t.artist} - ${t.title}.opus`.replace(/[\\/:*?"<>|]/g, ' ');
  document.body.append(a);
  a.click();
  a.remove();
  toast('Скачивание началось');
});

// Стереть
$('delete-btn').addEventListener('click', () => {
  const t = current;
  if (!t) return;
  const dlg = $('confirm-dialog');
  $('confirm-text').textContent = `«${t.title}» — ${t.artist}`;
  dlg.returnValue = '';
  dlg.showModal();
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'yes') return;
    try {
      const res = await fetch(`/api/track/${encodeURIComponent(t.video_id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (current && current.video_id === t.video_id) {
        const next = neighbour(1);
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        current = null;
        library = library.filter((x) => x.video_id !== t.video_id);
        applyFilters();
        if (next && next.video_id !== t.video_id) load(next, false); else renderNow();
      } else {
        library = library.filter((x) => x.video_id !== t.video_id);
        applyFilters();
      }
      played.delete(t.video_id);
      store.set('played', [...played]);
      toast(`«${t.title}» стёрт с кассеты`, 'ok');
    } catch (err) {
      toast(`Не удалось стереть: ${err.message}`, 'error');
    }
  }, { once: true });
});

// ============ Media Session (экран блокировки телефона) ============
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  if (!current) { navigator.mediaSession.metadata = null; return; }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: current.title || '',
    artist: current.artist || '',
    album: current.album && current.album !== 'Single' ? current.album : 'МК-60',
    artwork: [{ src: new URL(current.thumbnail_api, location.href).href, sizes: '480x360', type: 'image/jpeg' }],
  });
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', play);
  ms.setActionHandler('pause', () => audio.pause());
  ms.setActionHandler('previoustrack', playPrev);
  ms.setActionHandler('nexttrack', playNext);
  try {
    ms.setActionHandler('seekto', (d) => { if (d.seekTime != null) audio.currentTime = d.seekTime; });
  } catch { /* не поддерживается */ }
}

// ============ Горячие клавиши ============
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, dialog') || e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.code) {
    case 'Space': e.preventDefault(); togglePlay(); break;
    case 'ArrowRight': if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); break;
    case 'ArrowLeft': audio.currentTime = Math.max(0, audio.currentTime - 5); break;
    case 'ArrowUp': e.preventDefault(); setVolume(audio.volume + 0.05); break;
    case 'ArrowDown': e.preventDefault(); setVolume(audio.volume - 0.05); break;
    case 'KeyN': playNext(); break;
    case 'KeyP': playPrev(); break;
    case 'KeyM': $('volume-btn').click(); break;
    case 'KeyS': $('shuffle-btn').click(); break;
    case 'KeyR': $('repeat-btn').click(); break;
    case 'KeyV': $('vu-btn').click(); break;
    case 'KeyB': if (isDesktop()) setFolded(!app.classList.contains('folded')); else $('tab-btn').click(); break;
    case 'Slash': e.preventDefault(); if (!isDesktop()) setTab('card'); searchInput.focus(); break;
    default: return;
  }
});

// ============ Старт ============
async function init() {
  buildWheels();
  setCounter(0);
  setVolume(store.get('volume', 0.8), false);
  renderModes();
  setTab('card');
  if (store.get('folded', false)) app.classList.add('folded');
  renderNow();
  requestAnimationFrame(frame);

  await loadLibrary();
  const last = store.get('last', null);
  const track = last && library.find((t) => t.video_id === last);
  if (track) {
    current = track; // кассета вставлена, но не играет: src подставится по нажатию «играть»
    renderNow();
    markPlaying();
  }
}

init();
