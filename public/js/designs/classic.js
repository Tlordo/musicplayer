// «Классика» — улучшенный исходный дизайн: тёмный фон, зелёный акцент, обложки в списке,
// большая обложка, круглая кнопка воспроизведения, волна трека и спектр внизу.

import * as core from '../core.js';
import { state } from '../core.js';
import { settings } from '../store.js';
import { accentFrom, textOn } from '../themes.js';

// Цвет CSS-переменной в виде, понятном холсту: браузер сам разрешает color-mix и var().
const probe = document.createElement('span');
probe.style.display = 'none';
const css = (name) => {
  if (!probe.isConnected) document.body.append(probe);
  probe.style.color = `var(${name})`;
  return getComputedStyle(probe).color;
};

export default {
  id: 'classic',
  name: 'Классика',
  description: 'Тёмный, обложка крупно, как в привычных плеерах',
  css: 'css/classic.css',
  scheme: 'dark',
  themeColorVar: '--bg',
  rowOpensPlayer: false,
  meterName: 'Спектр',
  emptyTitle: 'Ничего не играет',
  emptyArtist: 'Выберите трек в библиотеке',
  emptyLibrary: ['Библиотека пуста', 'Добавьте первый трек — вставьте ссылку с YouTube или YouTube Music.'],

  themeVars: [
    { key: '--bg', label: 'Фон', type: 'color' },
    { key: '--surface', label: 'Панель библиотеки', type: 'color' },
    { key: '--surface-2', label: 'Поля и наведение', type: 'color' },
    { key: '--text', label: 'Текст', type: 'color' },
    { key: '--text-2', label: 'Второстепенный текст', type: 'color' },
    { key: '--accent', label: 'Акцент', type: 'color' },
    { key: '--play-bg', label: 'Кнопка «Играть»', type: 'color' },
    { key: '--backdrop-strength', label: 'Фон из обложки', type: 'range', min: 0, max: 1, step: 0.05 },
    { key: '--cover-radius', label: 'Скругление обложки', type: 'range', min: 0, max: 40, step: 1, unit: 'px' },
  ],

  presets: [
    {
      id: 'emerald', name: 'Изумруд',
      vars: {},
      swatch: ['#0a0a0a', '#1db954', '#ffffff'],
    },
    {
      id: 'sapphire', name: 'Сапфир',
      vars: { '--bg': '#070a12', '--surface': '#0d1220', '--surface-2': '#18213a', '--line': '#1f2a44', '--accent': '#4c8dff', '--on-accent': '#ffffff' },
      swatch: ['#070a12', '#4c8dff', '#ffffff'],
    },
    {
      id: 'coral', name: 'Коралл',
      vars: { '--bg': '#0e0908', '--surface': '#171110', '--surface-2': '#251b19', '--line': '#2e2220', '--accent': '#ff6b57', '--on-accent': '#1a0b08' },
      swatch: ['#0e0908', '#ff6b57', '#ffffff'],
    },
    {
      id: 'mono', name: 'Монохром',
      vars: { '--bg': '#000000', '--surface': '#0c0c0c', '--surface-2': '#1a1a1a', '--line': '#222222', '--accent': '#f2f2f2', '--on-accent': '#000000', '--text-2': '#a3a3a3' },
      swatch: ['#000000', '#f2f2f2', '#6b6b6b'],
    },
    {
      id: 'light', name: 'Светлая', scheme: 'light',
      vars: {
        '--bg': '#f3f4f6', '--surface': '#ffffff', '--surface-2': '#e9ebef', '--line': '#dde0e5',
        '--text': '#0d0f12', '--text-2': '#545b66', '--text-3': '#6f7681',
        '--accent': '#11873f', '--on-accent': '#ffffff', '--play-bg': '#0d0f12', '--play-fg': '#ffffff',
        '--backdrop-strength': '0.3', '--wave-rest': 'rgba(13, 15, 18, 0.16)', '--wave-hover': 'rgba(13, 15, 18, 0.4)',
        '--shadow-cover': 'rgba(13, 15, 18, 0.28)', '--spectrum-opacity': '0.16',
      },
      swatch: ['#f3f4f6', '#11873f', '#0d0f12'],
    },
  ],

  contrastPairs: {
    '--bg': [['--text', 7, 0], ['--text-2', 4.5, 0.3]],
    '--surface': [['--text', 7, 0], ['--text-2', 4.5, 0.3]],
  },

  /** Производные цвета своей темы — из основных. */
  derive(v) {
    const out = {};
    const text = v['--text'] || '#ffffff', text2 = v['--text-2'] || '#b3b3b3';
    const bg = v['--bg'] || '#0a0a0a', surface = v['--surface'] || '#121212';
    if (v['--accent']) out['--on-accent'] = textOn(v['--accent']);
    if (v['--play-bg']) out['--play-fg'] = textOn(v['--play-bg']);
    out['--text-3'] = `color-mix(in srgb, ${text2} 78%, ${bg})`;
    out['--line'] = `color-mix(in srgb, ${text} 12%, ${surface})`;
    out['--wave-rest'] = `color-mix(in srgb, ${text} 20%, transparent)`;
    out['--wave-hover'] = `color-mix(in srgb, ${text} 45%, transparent)`;
    return out;
  },

  /** Акцент из обложки, подогнанный под светлую или тёмную тему. */
  coverVars(rgb, theme) {
    const light = theme.scheme === 'light';
    const accent = accentFrom(rgb, { light: light ? 0.36 : 0.62, minSat: 0.5 });
    return accent ? { '--accent': accent, '--on-accent': textOn(accent) } : {};
  },

  template() {
    return `
<aside class="library" aria-label="Библиотека">
  <header class="lib-head">
    <div class="brand"><svg class="brand-icon" aria-hidden="true"><use href="#i-note"/></svg><h1>Моя музыка</h1></div>
    <div class="lib-head-actions">
      <button type="button" class="icon-btn add-icon" data-act="add" aria-label="Добавить трек" title="Добавить трек"><svg><use href="#i-plus"/></svg></button>
      <button type="button" class="icon-btn" data-act="settings" aria-label="Настройки" title="Настройки"><svg><use href="#i-gear"/></svg></button>
    </div>
  </header>
  <div class="lib-tabs" role="tablist" aria-label="Раздел">
    <button type="button" role="tab" class="lib-tab tab-lib" data-act="libview-library">Треки</button>
    <button type="button" role="tab" class="lib-tab tab-albums" data-act="libview-albums">Альбомы</button>
    <button type="button" role="tab" class="lib-tab tab-recs" data-act="libview-recs">Похожее</button>
  </div>
  <div class="library-view lib-stack">
  <label class="search">
    <svg aria-hidden="true"><use href="#i-search"/></svg>
    <input type="search" data-search placeholder="Поиск в библиотеке" autocomplete="off" enterkeyhint="search" aria-label="Поиск в библиотеке">
    <button type="button" class="icon-btn small" data-act="clear-search" aria-label="Очистить поиск" hidden><svg><use href="#i-x"/></svg></button>
  </label>
  <div class="lib-bar">
    <p class="lib-stats"><span data-bind="count"></span><span class="dot" aria-hidden="true">·</span><span data-bind="total"></span></p>
    <div class="sort" role="radiogroup" aria-label="Порядок">
      <button type="button" role="radio" data-sort="added" title="Сначала новые" aria-label="Сначала новые"><svg><use href="#i-sort-time"/></svg></button>
      <button type="button" role="radio" data-sort="title" title="По названию" aria-label="По названию"><svg><use href="#i-sort-az"/></svg></button>
      <button type="button" role="radio" data-sort="artist" title="По исполнителю" aria-label="По исполнителю"><svg><use href="#i-user"/></svg></button>
      <button type="button" role="radio" data-sort="album" title="По альбому" aria-label="По альбому"><svg><use href="#i-disc"/></svg></button>
    </div>
  </div>
  <div class="tracks-wrap">
    <ol class="tracks" data-list aria-label="Треки"></ol>
    <div class="empty" data-empty hidden>
      <svg class="empty-icon" aria-hidden="true"><use href="#i-note"/></svg>
      <p class="empty-title" data-empty-title></p>
      <p class="empty-text" data-empty-text></p>
    </div>
  </div>
  </div>
  <div class="albums-view lib-stack">
    <div class="albums-scroll">
      <div class="albums-head">
        <h2>Мои альбомы</h2>
        <span class="albums-actions">
          <button type="button" class="chip-btn" data-act="album-new"><svg aria-hidden="true"><use href="#i-plus"/></svg>Создать</button>
          <button type="button" class="chip-btn" data-act="album-import" title="Импорт альбома из архива .zip с другого устройства"><svg aria-hidden="true"><use href="#i-up"/></svg>Импорт</button>
        </span>
      </div>
      <p class="albums-empty" data-albums-user-empty>Соберите альбом из треков библиотеки или скачайте целый альбом с YouTube — вставьте ссылку на него в «Добавить трек».</p>
      <div class="album-grid" data-albums-user></div>
      <section class="albums-meta" data-albums-meta-section hidden>
        <div class="albums-head"><h2>Альбомы из YouTube</h2></div>
        <div class="album-grid" data-albums-meta></div>
      </section>
    </div>
  </div>
  <div class="album-view lib-stack">
    <div class="albums-scroll">
      <button type="button" class="back-link" data-act="album-back"><svg aria-hidden="true"><use href="#i-back"/></svg>Альбомы</button>
      <div data-album-head></div>
      <ol class="tracks" data-album-list aria-label="Треки альбома"></ol>
      <p class="albums-empty" data-album-empty hidden>В альбоме пока нет треков — добавьте их кнопкой «+».</p>
    </div>
  </div>
  <div class="recs-view lib-stack">
    <div class="recs-head">
      <p class="recs-seed-line">Похоже на <b data-recs-seed></b></p>
      <button type="button" class="icon-btn" data-act="recs-refresh" aria-label="Подобрать заново" title="Подобрать заново"><svg><use href="#i-refresh"/></svg></button>
    </div>
    <div class="tracks-wrap">
      <ol class="tracks" data-recs aria-label="Рекомендации"></ol>
      <div class="empty" data-recs-state hidden>
        <svg class="empty-icon" aria-hidden="true"><use href="#i-wave"/></svg>
        <p class="empty-title" data-recs-title></p>
        <p class="empty-text" data-recs-text></p>
      </div>
    </div>
  </div>
  <footer class="lib-foot">
    <button type="button" class="add-btn" data-act="add"><svg aria-hidden="true"><use href="#i-plus"/></svg>Добавить трек</button>
    <button type="button" class="icon-btn fold-btn" data-act="fold" aria-label="Скрыть библиотеку" title="Скрыть библиотеку (B)"><svg><use href="#i-fold"/></svg></button>
  </footer>
  <div class="mini" data-act="tab-player" role="button" tabindex="0" aria-label="Открыть плеер">
    <span class="mini-cover"><img data-cover alt=""></span>
    <span class="mini-text"><span class="mini-title" data-bind="title"></span><span class="mini-artist" data-bind="artist"></span></span>
    <button type="button" class="icon-btn mini-play" data-act="play" aria-label="Играть"><svg><use data-play-icon href="#i-play"/></svg></button>
    <span class="mini-progress" data-seek-view aria-hidden="true"></span>
  </div>
</aside>

<main class="player" aria-label="Плеер">
  <div class="backdrop-wrap" aria-hidden="true"><div class="backdrop" data-cover-bg></div></div>
  <canvas class="spectrum" data-meter="spectrum" aria-hidden="true"></canvas>
  <header class="player-top">
    <button type="button" class="icon-btn unfold-btn" data-act="unfold" aria-label="Показать библиотеку" title="Показать библиотеку (B)"><svg><use href="#i-list"/></svg></button>
    <button type="button" class="icon-btn back-btn" data-act="tab-library" aria-label="К библиотеке"><svg><use href="#i-chev-down"/></svg></button>
    <span class="player-top-title">Сейчас играет</span>
    <button type="button" class="lyrics-btn" data-act="lyrics" data-needs-track title="Текст песни на весь экран (L)"><svg aria-hidden="true"><use href="#i-lyrics-full"/></svg><span>Текст</span></button>
    <button type="button" class="icon-btn settings-top" data-act="settings" aria-label="Настройки" title="Настройки"><svg><use href="#i-gear"/></svg></button>
  </header>

  <div class="stage">
    <section class="hero">
      <div class="art">
        <button type="button" class="cover" data-act="cover" data-needs-track aria-label="Обложка во весь экран">
          <img data-cover alt="">
          <span class="cover-empty" aria-hidden="true"><svg><use href="#i-note"/></svg></span>
        </button>
      </div>
      <canvas class="spectrum-mini" data-meter="spectrum" aria-hidden="true"></canvas>
      <div class="details">
        <h2 class="title" data-bind="title"></h2>
        <p class="artist" data-bind="artist"></p>
        <p class="meta">
          <span class="meta-album" data-bind="album" data-hide-empty></span>
          <span class="meta-year" data-bind="year" data-hide-empty></span>
          <span class="pill" data-bind="bitrate" data-hide-empty></span>
        </p>
        <p class="stats">
          <span title="Просмотры"><svg aria-hidden="true"><use href="#i-eye"/></svg><span data-bind="views"></span></span>
          <span title="Лайки"><svg aria-hidden="true"><use href="#i-heart"/></svg><span data-bind="likes"></span></span>
        </p>
      </div>
    </section>

    <div class="lyrics-band lyrics-slot" data-lyrics-slot></div>

    <section class="deck">
      <div class="seek" data-seek role="slider" tabindex="0" aria-label="Перемотка" aria-valuemin="0" aria-valuemax="100">
        <canvas class="wave" data-wave aria-hidden="true"></canvas>
      </div>
      <div class="times"><span data-bind="time-cur">0:00</span><span data-bind="time-total">0:00</span></div>
      <div class="controls">
        <button type="button" class="ctl" data-act="shuffle" aria-label="Перемешать (S)"><svg><use href="#i-shuffle"/></svg></button>
        <button type="button" class="ctl" data-act="prev" aria-label="Предыдущий (P)"><svg><use href="#i-prev"/></svg></button>
        <button type="button" class="play" data-act="play" aria-label="Играть (пробел)"><svg><use data-play-icon href="#i-play"/></svg></button>
        <button type="button" class="ctl" data-act="next" aria-label="Следующий (N)"><svg><use href="#i-next"/></svg></button>
        <button type="button" class="ctl repeat" data-act="repeat" aria-label="Повтор (R)"><svg><use href="#i-repeat"/></svg><span class="repeat-one" aria-hidden="true">1</span></button>
      </div>
      <div class="extras">
        <div class="volume">
          <button type="button" class="icon-btn" data-act="mute" aria-label="Выключить звук (M)"><svg><use data-vol-icon href="#i-vol"/></svg></button>
          <input type="range" data-volume min="0" max="100" value="80" aria-label="Громкость">
        </div>
        <div class="extras-btns">
          <button type="button" class="icon-btn toggle" data-act="meter" aria-label="Спектр (V)" title="Спектр (V)"><svg><use href="#i-meter"/></svg></button>
          <button type="button" class="icon-btn toggle" data-act="lyrics-inline" aria-label="Текст песни вместо спектра" title="Текст песни вместо спектра"><svg><use href="#i-lyrics"/></svg></button>
          <span class="menu-wrap">
            <button type="button" class="icon-btn" data-act="menu" aria-haspopup="true" aria-expanded="false" aria-label="Ещё" title="Ещё"><svg><use href="#i-more"/></svg></button>
            <div class="menu" role="menu" hidden>
              <button type="button" role="menuitem" data-act="add-to-album" data-needs-track><svg aria-hidden="true"><use href="#i-album"/></svg>В альбом…</button>
              <button type="button" role="menuitem" data-act="info" data-needs-track><svg aria-hidden="true"><use href="#i-info"/></svg>О треке</button>
              <button type="button" role="menuitem" data-act="download" data-needs-track><svg aria-hidden="true"><use href="#i-down"/></svg>Скачать файл</button>
              <button type="button" role="menuitem" class="danger" data-act="delete" data-needs-track><svg aria-hidden="true"><use href="#i-erase"/></svg>Удалить трек</button>
            </div>
          </span>
        </div>
      </div>
    </section>
  </div>
</main>

<nav class="tabbar" aria-label="Разделы">
  <button type="button" class="tab tab-player" data-act="tab-player"><svg aria-hidden="true"><use href="#i-note"/></svg><span>Плеер</span></button>
  <button type="button" class="tab tab-library" data-act="tab-library"><svg aria-hidden="true"><use href="#i-list"/></svg><span>Моё</span></button>
</nav>`;
  },

  renderRow(t, i, f, { esc, formatTime }) {
    const cls = ['row', f.current ? 'current' : '', f.missing ? 'missing' : '', f.played ? 'played' : ''].filter(Boolean).join(' ');
    const remove = f.removable ? `<button type="button" class="row-remove" data-act="album-remove" data-remove-id="${esc(t.video_id)}" aria-label="Убрать «${esc(t.title)}» из альбома" title="Убрать из альбома"><svg><use href="#i-minus"/></svg></button>` : '';
    return `<li${f.removable ? ' class="removable"' : ''}><button type="button" class="${cls}" data-id="${esc(t.video_id)}"${f.current ? ' aria-current="true"' : ''}>
      <span class="row-num"><span class="num">${i + 1}</span><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span></span>
      <span class="row-thumb"><img src="${esc(t.thumbnail_api)}" alt="" loading="lazy" decoding="async"></span>
      <span class="row-main">
        <span class="row-title">${esc(t.title)}</span>
        <span class="row-sub">${f.missing ? '<span class="tag">нет файла</span>' : ''}${esc(t.artist || '')}</span>
      </span>
      <span class="row-time">${f.played ? '<svg class="played-mark" aria-label="прослушан"><use href="#i-check"/></svg>' : ''}${t._sec ? formatTime(t._sec) : ''}</span>
    </button>${remove}</li>`;
  },

  renderAlbumCard(a, info, { esc }) {
    const art = info.covers.length >= 4
      ? info.covers.map((c) => `<img src="${esc(c)}" alt="" loading="lazy">`).join('')
      : info.covers.length ? `<img src="${esc(info.covers[0])}" alt="" loading="lazy">` : '<svg aria-hidden="true"><use href="#i-album"/></svg>';
    const sub = a.kind === 'meta' ? `${esc(a.artist || '')} · ${info.countText}` : info.countText;
    return `<button type="button" class="album-card" data-act="album-open" data-key="${esc(a.key)}">
      <span class="album-art${info.covers.length >= 4 ? ' mosaic' : ''}">${art}</span>
      <span class="album-name">${esc(a.name)}</span>
      <span class="album-sub">${sub}</span>
    </button>`;
  },

  renderAlbumHead(a, info, { esc }) {
    const art = info.covers.length >= 4
      ? info.covers.map((c) => `<img src="${esc(c)}" alt="">`).join('')
      : info.covers.length ? `<img src="${esc(info.covers[0])}" alt="">` : '<svg aria-hidden="true"><use href="#i-album"/></svg>';
    const own = a.kind === 'user';
    return `<div class="album-hero">
      <span class="album-art${info.covers.length >= 4 ? ' mosaic' : ''}">${art}</span>
      <div class="album-hero-text">
        <h2 class="album-title">${esc(a.name)}</h2>
        <p class="album-sub">${[own ? 'мой альбом' : esc(a.artist || ''), info.countText, info.count ? info.timeText : ''].filter(Boolean).join(' · ')}</p>
      </div>
    </div>
    <div class="album-actions">
      <button type="button" class="add-btn album-play" data-act="album-play" ${info.count ? '' : 'disabled'}><svg aria-hidden="true"><use href="#i-play"/></svg>Слушать</button>
      <button type="button" class="icon-btn" data-act="album-download" ${info.count ? '' : 'disabled'} title="Скачать альбом архивом .zip — его же можно импортировать на другом устройстве" aria-label="Скачать альбом"><svg><use href="#i-down"/></svg></button>
      ${own ? `<button type="button" class="icon-btn" data-act="album-add-tracks" title="Добавить треки" aria-label="Добавить треки"><svg><use href="#i-plus"/></svg></button>
      <button type="button" class="icon-btn" data-act="album-rename" title="Переименовать" aria-label="Переименовать"><svg><use href="#i-edit"/></svg></button>
      <button type="button" class="icon-btn danger" data-act="album-delete" title="Удалить альбом" aria-label="Удалить альбом"><svg><use href="#i-erase"/></svg></button>`
        : `<button type="button" class="icon-btn" data-act="album-save" title="Сделать своим альбомом — можно менять состав и имя" aria-label="Сделать своим альбомом"><svg><use href="#i-album"/></svg></button>`}
    </div>`;
  },

  renderRec(r, i, f, { esc, formatTime }) {
    const sub = [r.artist, r.duration ? formatTime(r.duration) : ''].filter(Boolean).map(esc).join(' · ');
    return `<li><div class="row rec">
      <span class="row-thumb"><img src="${esc(r.thumb)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>
      <span class="row-main">
        <span class="row-title">${esc(r.title)}</span>
        <span class="row-sub">${sub}</span>
      </span>
      <button type="button" class="rec-add" data-act="rec-add" data-rec-id="${esc(r.id)}" aria-busy="${f.adding}" ${f.adding ? 'disabled' : ''} aria-label="Добавить «${esc(r.title)}» в библиотеку" title="Добавить в библиотеку">
        <svg class="idle" aria-hidden="true"><use href="#i-plus"/></svg><svg class="busy" aria-hidden="true"><use href="#i-refresh"/></svg>
      </button>
    </div></li>`;
  },

  onTab() {
    requestAnimationFrame(() => this._resize && this._resize());
  },

  mount(root) {
    const wave = root.querySelector('[data-wave]');
    const specs = [...root.querySelectorAll('[data-meter="spectrum"]')].map((c) => ({ c, g: c.getContext('2d'), bars: [], alive: false }));
    const wctx = wave.getContext('2d');
    const peaksCache = new Map();
    let peaks = null;
    let colors = {};
    let waveKey = '';
    let hoverP = -1;
    const dpr = () => Math.min(2, window.devicePixelRatio || 1);

    const readColors = () => {
      colors = {
        accent: css('--accent') || '#1db954',
        rest: css('--wave-rest') || 'rgba(255,255,255,0.22)',
        hover: css('--wave-hover') || 'rgba(255,255,255,0.45)',
      };
      waveKey = '';
    };
    readColors();

    const fit = (c) => {
      const r = c.getBoundingClientRect();
      const w = Math.round(r.width * dpr()), h = Math.round(r.height * dpr());
      if (w && h && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; return true; }
      return false;
    };
    const resize = () => { fit(wave); specs.forEach((s) => { fit(s.c); s.alive = true; }); waveKey = ''; };
    this._resize = resize;

    const loadPeaks = async (t) => {
      peaks = null;
      waveKey = '';
      if (!t) return;
      const id = t.video_id;
      if (peaksCache.has(id)) { peaks = peaksCache.get(id); return; }
      try {
        const res = await fetch(`/api/peaks/${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        peaksCache.set(id, data.peaks);
        if (state.current && state.current.video_id === id) { peaks = data.peaks; waveKey = ''; }
      } catch { /* нет ffmpeg или файла — останется ровная полоса */ }
    };

    const drawWave = (p) => {
      const W = wave.width, H = wave.height;
      if (!W || !H) return;
      const k = dpr();
      const step = Math.max(4, Math.round(5 * k));
      const bw = Math.max(2, Math.round(3 * k));
      const n = Math.max(10, Math.floor(W / step));
      const key = `${W}x${H}:${n}:${Math.round(p * n * 4)}:${Math.round(hoverP * n)}:${peaks ? peaks.length : 0}`;
      if (key === waveKey) return;
      waveKey = key;
      wctx.clearRect(0, 0, W, H);
      const played = p * n;
      const hover = hoverP >= 0 ? hoverP * n : -1;
      for (let i = 0; i < n; i++) {
        const src = peaks ? peaks[Math.min(peaks.length - 1, Math.floor((i / n) * peaks.length))] : 0.18;
        const h = Math.max(bw, (0.12 + src * 0.88) * H);
        wctx.fillStyle = i < played ? colors.accent : (hover >= 0 && i < hover ? colors.hover : colors.rest);
        const x = i * step;
        wctx.beginPath();
        wctx.roundRect(x, (H - h) / 2, bw, h, bw / 2);
        wctx.fill();
      }
    };

    // Спектр: логарифмические полосы, быстрый подъём и плавный спад.
    // Большой — внизу плеера на десктопе, маленький — эквалайзер под обложкой на телефоне.
    const drawSpectrum = (f, s) => {
      const { c, g } = s;
      const W = c.width, H = c.height;
      if (!W || !H || !c.offsetParent) return;
      const mini = c.classList.contains('spectrum-mini');
      const data = settings.meter === 'viz' ? core.spectrum() : null;
      const n = mini ? 28 : Math.max(24, Math.min(72, Math.floor(W / (14 * dpr()))));
      if (s.bars.length !== n) s.bars = new Array(n).fill(0);
      let alive = false;
      for (let i = 0; i < n; i++) {
        let v = 0;
        if (data) {
          const a = Math.floor(2 * Math.pow(110, i / n)), b = Math.max(a + 1, Math.floor(2 * Math.pow(110, (i + 1) / n)));
          for (let j = a; j < b && j < data.length; j++) v = Math.max(v, data[j]);
          v = Math.pow(v / 255, 2) * 0.9;
        }
        s.bars[i] = v > s.bars[i] ? s.bars[i] + (v - s.bars[i]) * 0.55 : s.bars[i] * (1 - Math.min(1, f.dt * 5));
        if (s.bars[i] > 0.004) alive = true;
      }
      if (!alive && !s.alive) return;
      s.alive = alive;
      g.clearRect(0, 0, W, H);
      const gap = Math.max(2, Math.round((mini ? 4 : 3) * dpr()));
      const bw = (W - gap * (n - 1)) / n;
      if (mini) {
        g.fillStyle = colors.accent;
      } else {
        const grad = g.createLinearGradient(0, H, 0, 0);
        grad.addColorStop(0, colors.accent);
        grad.addColorStop(1, 'transparent');
        g.fillStyle = grad;
      }
      const r = Math.min(mini ? bw / 2 : 4, bw / 2);
      for (let i = 0; i < n; i++) {
        // у мини-эквалайзера всегда виден «пол», как у плеера на паузе
        const h = mini ? Math.max(bw, s.bars[i] * H) : s.bars[i] * H;
        if (h < 1) continue;
        g.beginPath();
        g.roundRect(i * (bw + gap), H - h, bw, h, mini ? r : [r, r, 0, 0]);
        g.fill();
      }
    };

    this.frame = (f) => {
      drawWave(f.p);
      specs.forEach((s) => drawSpectrum(f, s));
    };

    const seek = root.querySelector('[data-seek]');
    const onMove = (e) => { const r = seek.getBoundingClientRect(); hoverP = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
    const onLeave = () => { hoverP = -1; };
    seek.addEventListener('pointermove', onMove);
    seek.addEventListener('pointerleave', onLeave);

    const offTrack = core.on('track', loadPeaks);
    const ro = new ResizeObserver(resize);
    ro.observe(wave);
    specs.forEach((s) => ro.observe(s.c));
    const onTheme = () => { readColors(); specs.forEach((s) => { s.alive = true; }); };
    window.addEventListener('mk-theme', onTheme);
    loadPeaks(state.current);
    resize();

    return () => {
      offTrack();
      ro.disconnect();
      window.removeEventListener('mk-theme', onTheme);
      this.frame = null;
      this._resize = null;
    };
  },
};
