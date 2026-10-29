// «Кассета» — мир МК-60: библиотека как вкладыш, заполненный от руки, плеер — кассета
// в деке рядом с обложкой-вкладышем; бобины, счётчик, флуоресцентный индикатор уровня.

import * as core from '../core.js';
import { state, audio } from '../core.js';
import { settings } from '../store.js';
import { accentFrom, textOn } from '../themes.js';

const probe = document.createElement('span');
probe.style.display = 'none';
const css = (name) => {
  if (!probe.isConnected) document.body.append(probe);
  probe.style.color = `var(${name})`;
  return getComputedStyle(probe).color;
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const SORT_BOX = (value, label) =>
  `<label><input type="radio" name="sort" value="${value}"><span class="box"><svg><use href="#i-tick"/></svg></span>${label}</label>`;

export default {
  id: 'cassette',
  name: 'Кассета',
  description: 'Вкладыш, заполненный от руки, и кассета МК-60',
  css: 'css/cassette.css',
  scheme: 'dark',
  themeColorVar: '--deck',
  rowOpensPlayer: true,
  meterName: 'Индикатор уровня',
  emptyTitle: 'Выберите трек на вкладыше',
  emptyArtist: '—',
  emptyLibrary: ['Кассета чистая', 'Запишите первый трек — вставьте ссылку с YouTube или YouTube Music.'],

  themeVars: [
    { key: '--deck', label: 'Дека', type: 'color' },
    { key: '--card', label: 'Бумага вкладыша', type: 'color' },
    { key: '--print', label: 'Типографская краска', type: 'color' },
    { key: '--ball', label: 'Чернила ручки', type: 'color' },
    { key: '--orange', label: 'Полоса 1', type: 'color' },
    { key: '--yellow', label: 'Полоса 2 и маркер', type: 'color' },
    { key: '--cobalt', label: 'Полоса 3', type: 'color' },
    { key: '--vfd', label: 'Индикатор', type: 'color' },
    { key: '--key', label: 'Клавиши', type: 'color' },
  ],

  presets: [
    { id: 'mk60', name: 'МК-60', vars: {}, swatch: ['#f4f4f0', '#ff5a1f', '#2a44d4'] },
    {
      id: 'tdk', name: 'TDK SA',
      vars: {
        '--deck': '#0a0d18', '--card': '#f1f2f5', '--print': '#14182a', '--ball': '#151515',
        '--orange': '#c9a24a', '--orange-ink': '#9c7a2c', '--yellow': '#e9dcae', '--cobalt': '#1b2a6e',
        '--hi': 'rgba(233, 220, 174, 0.75)', '--vfd': '#7fe3ff',
      },
      swatch: ['#0a0d18', '#c9a24a', '#1b2a6e'],
    },
    {
      id: 'svema', name: 'Свема',
      vars: {
        '--card': '#eef4f7', '--rule': '#c9d9e3', '--ball': '#5b2a9a',
        '--orange': '#e2231a', '--orange-ink': '#b5170f', '--yellow': '#f2f2f2', '--cobalt': '#0067b1',
        '--hi': 'rgba(124, 214, 255, 0.55)', '--vfd': '#a4ff7a',
      },
      swatch: ['#eef4f7', '#e2231a', '#0067b1'],
    },
    {
      id: 'night', name: 'Ночная смена', scheme: 'dark',
      vars: {
        '--deck': '#060607', '--card': '#1c1e23', '--card-2': '#26292f', '--print': '#e9e7e0', '--print-2': '#a6a9b1',
        '--rule': '#33363e', '--ball': '#9cc0ff', '--hi': 'rgba(255, 201, 40, 0.32)', '--orange-ink': '#ff7a45',
        '--card-scheme': 'dark',
      },
      swatch: ['#1c1e23', '#9cc0ff', '#ff5a1f'],
    },
  ],

  contrastPairs: {
    '--card': [['--print', 7, 0], ['--ball', 4.5, { dark: '#9cc0ff', light: '#1f3aa8' }]],
  },

  /** Производные цвета своей темы — из основных. */
  derive(v) {
    const card = v['--card'] || '#f4f4f0', print = v['--print'] || '#1b1c20';
    const ball = v['--ball'] || '#1f3aa8', orange = v['--orange'] || '#ff5a1f', yellow = v['--yellow'] || '#ffc928';
    const dark = textOn(card) === '#ffffff';
    return {
      '--card-2': `color-mix(in srgb, ${card} 92%, ${print})`,
      '--print-2': `color-mix(in srgb, ${print} 68%, ${card})`,
      '--rule': `color-mix(in srgb, ${ball} 24%, ${card})`,
      '--orange-ink': `color-mix(in srgb, ${orange} ${dark ? 100 : 85}%, ${dark ? '#fff' : '#000'})`,
      '--hi': `color-mix(in srgb, ${yellow} ${dark ? 35 : 62}%, transparent)`,
      '--card-scheme': dark ? 'dark' : 'light',
    };
  },

  /** Цвет обложки уходит в индикатор уровня. */
  coverVars(rgb) {
    const c = accentFrom(rgb, { light: 0.68, minSat: 0.65 });
    return c ? { '--vfd': c } : {};
  },

  template() {
    return `
<section class="jcard" aria-label="Вкладыш — библиотека">
  <header class="jcard-head">
    <div class="brand">
      <span class="brand-mk">МК-60</span>
      <span class="brand-sub">магнитофонная кассета · тип I</span>
    </div>
    <div class="stripes" aria-hidden="true"><i></i><i></i><i></i></div>
  </header>

  <div class="jcard-owner">
    <span class="form-label">запись</span>
    <span class="hand owner-name">моя музыка</span>
    <span class="side-switch" role="tablist" aria-label="Сторона вкладыша">
      <span class="side-word">сторона</span>
      <button type="button" role="tab" class="side-btn side-a" data-act="libview-library" title="Сторона А — моя музыка">А</button>
      <button type="button" role="tab" class="side-btn side-b" data-act="libview-recs" title="Сторона Б — что ещё записать (рекомендации)">Б</button>
      <button type="button" role="tab" class="side-btn side-shelf" data-act="libview-albums" title="Полка — альбомы">полка</button>
    </span>
    <span class="jcard-stats"><span data-bind="count"></span> · <span data-bind="total"></span></span>
  </div>

  <div class="recs-view recs-head">
    <span class="form-label">по мотивам</span>
    <span class="hand recs-seed" data-recs-seed></span>
    <button type="button" class="icon-btn small" data-act="recs-refresh" aria-label="Подобрать заново" title="Подобрать заново"><svg><use href="#i-refresh"/></svg></button>
  </div>

  <div class="jcard-tools library-view">
    <label class="search-line">
      <span class="form-label">найти</span>
      <input type="search" class="hand" data-search placeholder="название, исполнитель…" autocomplete="off" enterkeyhint="search" aria-label="Поиск по вкладышу">
      <button type="button" class="icon-btn small" data-act="clear-search" aria-label="Очистить поиск" hidden><svg><use href="#i-x"/></svg></button>
    </label>
    <fieldset class="sort-boxes">
      <legend class="form-label">порядок</legend>
      ${SORT_BOX('added', 'новые')}${SORT_BOX('artist', 'артист')}${SORT_BOX('title', 'название')}${SORT_BOX('album', 'альбом')}${SORT_BOX('plays', 'частые')}
    </fieldset>
  </div>

  <div class="form-head" aria-hidden="true"><span>№</span><span>наименование</span><span>время</span></div>

  <div class="albums-view tracklist-wrap shelf">
    <div class="shelf-head"><span class="form-label">подборки</span></div>
    <ol class="spines" data-albums-smart></ol>
    <div class="shelf-head">
      <span class="form-label">мои кассеты</span>
      <span class="shelf-actions">
        <button type="button" class="mini-stamp" data-act="album-new">+ новая</button>
        <button type="button" class="mini-stamp" data-act="album-import" title="Импорт альбома из архива .zip с другого устройства">импорт</button>
      </span>
    </div>
    <p class="shelf-empty hand" data-albums-user-empty>Полка пустая. Соберите кассету из треков или вставьте ссылку на альбом YouTube в «записать трек».</p>
    <ol class="spines" data-albums-user></ol>
    <section data-albums-meta-section hidden>
      <div class="shelf-head"><span class="form-label">альбомы из youtube</span></div>
      <ol class="spines" data-albums-meta></ol>
    </section>
  </div>

  <div class="album-view tracklist-wrap">
    <button type="button" class="text-back" data-act="album-back"><svg aria-hidden="true"><use href="#i-back"/></svg>полка</button>
    <div data-album-head></div>
    <ol class="tracklist" data-album-list aria-label="Треки альбома"></ol>
    <p class="shelf-empty hand" data-album-empty hidden>Кассета пока чистая — добавьте треки.</p>
  </div>

  <div class="tracklist-wrap recs-view">
    <ol class="tracklist" data-recs aria-label="Рекомендации"></ol>
    <div class="empty" data-recs-state hidden>
      <p class="hand empty-title" data-recs-title></p>
      <p class="empty-text" data-recs-text></p>
    </div>
  </div>

  <div class="tracklist-wrap library-view">
    <ol class="tracklist" data-list aria-label="Треки"></ol>
    <div class="empty" data-empty hidden>
      <p class="hand empty-title" data-empty-title></p>
      <p class="empty-text" data-empty-text></p>
    </div>
  </div>

  <footer class="jcard-foot">
    <button type="button" class="stamp" data-act="add"><span class="rec-dot" aria-hidden="true"></span>записать трек</button>
    <span class="jcard-foot-tools">
      <button type="button" class="icon-btn" data-act="settings" aria-label="Настройки" title="Настройки"><svg><use href="#i-gear"/></svg></button>
      <button type="button" class="icon-btn fold-btn" data-act="fold" aria-label="Свернуть вкладыш" title="Свернуть вкладыш (B)"><svg><use href="#i-fold"/></svg></button>
    </span>
  </footer>
</section>

<main class="player" aria-label="Плеер">
  <div class="deck-top">
    <span class="side-badge" aria-hidden="true">А</span>
    <div class="counter" data-counter aria-label="Прошло времени">
      <span class="counter-label">счётчик</span>
      <span class="wheels" data-wheels></span>
    </div>
    <span class="deck-top-tools">
      <button type="button" class="icon-btn like-btn" data-act="like" data-needs-track aria-label="В любимое (F)" title="В любимое (F)"><svg><use data-like-icon href="#i-heart-line"/></svg></button>
      <button type="button" class="text-btn lyrics-btn" data-act="lyrics" data-needs-track title="Текст песни на весь экран (L)"><svg aria-hidden="true"><use href="#i-lyrics-full"/></svg>текст</button>
      <span class="menu-wrap">
        <button type="button" class="icon-btn" data-act="menu" aria-haspopup="true" aria-expanded="false" aria-label="Ещё" title="Ещё"><svg><use href="#i-more"/></svg></button>
        <div class="menu down" role="menu" hidden>
          <button type="button" role="menuitem" data-act="queue"><svg aria-hidden="true"><use href="#i-queue"/></svg>Очередь</button>
          <button type="button" role="menuitem" data-act="sleep"><svg aria-hidden="true"><use href="#i-moon"/></svg>Таймер сна<span class="menu-badge" data-sleep-badge hidden></span></button>
          <button type="button" role="menuitem" data-act="stats"><svg aria-hidden="true"><use href="#i-chart"/></svg>Статистика</button>
          <button type="button" role="menuitem" data-act="add-to-album" data-needs-track><svg aria-hidden="true"><use href="#i-album"/></svg>В альбом…</button>
          <button type="button" role="menuitem" data-act="info" data-needs-track><svg aria-hidden="true"><use href="#i-info"/></svg>О треке</button>
          <button type="button" role="menuitem" data-act="download" data-needs-track><svg aria-hidden="true"><use href="#i-down"/></svg>Скачать файл</button>
          <button type="button" role="menuitem" class="danger" data-act="delete" data-needs-track><svg aria-hidden="true"><use href="#i-erase"/></svg>Стереть с кассеты</button>
        </div>
      </span>
      <button type="button" class="icon-btn settings-top" data-act="settings" aria-label="Настройки" title="Настройки"><svg><use href="#i-gear"/></svg></button>
      <button type="button" class="icon-btn unfold-btn" data-act="unfold" aria-label="Показать вкладыш" title="Показать вкладыш (B)"><svg><use href="#i-card"/></svg></button>
    </span>
  </div>

  <div class="case">
    <button type="button" class="jfront" data-act="cover" data-needs-track aria-label="Обложка во весь экран">
      <span class="jfront-head"><b>МК-60</b><span>сторона А</span></span>
      <span class="jfront-art"><img data-cover alt=""><span class="jfront-empty hand">без обложки</span></span>
      <span class="jfront-stripes" aria-hidden="true"><i></i><i></i><i></i></span>
    </button>

    <div class="cassette" data-cassette>
      <svg class="innards" viewBox="0 0 316 200" aria-hidden="true">
        <defs>
          <radialGradient id="pack" cx="50%" cy="50%" r="50%">
            <stop offset="30%" stop-color="#7a5236"/><stop offset="94%" stop-color="#4a2f1f"/><stop offset="100%" stop-color="#2a1a10"/>
          </radialGradient>
          <linearGradient id="smoke" x1="0" y1="0" x2="0.35" y2="1">
            <stop offset="0" stop-color="#3a3d46" stop-opacity="0.78"/>
            <stop offset="0.45" stop-color="#22242a" stop-opacity="0.8"/>
            <stop offset="1" stop-color="#16171b" stop-opacity="0.86"/>
          </linearGradient>
        </defs>
        <path data-tape class="tape-run" d=""/>
        <circle data-pack="l" cx="118" cy="97" r="40" fill="url(#pack)"/>
        <circle data-pack="r" cx="198" cy="97" r="16" fill="url(#pack)"/>
        <g class="roller"><circle cx="34" cy="176" r="7"/><circle cx="34" cy="176" r="2.5"/></g>
        <g class="roller"><circle cx="282" cy="176" r="7"/><circle cx="282" cy="176" r="2.5"/></g>
        <rect class="pad" x="146" y="181" width="24" height="7" rx="1.5"/>
        <path class="shell" fill="url(#smoke)" fill-rule="evenodd"
          d="M14 0H302A14 14 0 0 1 316 14V186A14 14 0 0 1 302 200H14A14 14 0 0 1 0 186V14A14 14 0 0 1 14 0Z M98 74H218A6 6 0 0 1 224 80V114A6 6 0 0 1 218 120H98A6 6 0 0 1 92 114V80A6 6 0 0 1 98 74Z"/>
        <rect class="glass" x="92" y="74" width="132" height="46" rx="6"/>
        <path class="ribs" d="M10 150H70M246 150H306M10 156H64M252 156H306"/>
        <path class="foot" d="M74 200L84 160H232L242 200Z"/>
        <g class="foot-holes"><circle cx="122" cy="182" r="3.6"/><circle cx="146" cy="174" r="3"/><circle cx="170" cy="174" r="3"/><circle cx="194" cy="182" r="3.6"/></g>
        <g class="screws"><circle cx="10" cy="9" r="4"/><circle cx="306" cy="9" r="4"/><circle cx="10" cy="191" r="4"/><circle cx="306" cy="191" r="4"/><circle cx="158" cy="190" r="3.4"/></g>
        <g data-hub="l" class="hub"><circle cx="118" cy="97" r="10"/><path d="M118 87.5v5M118 101.5v5M109.8 92.2l4.3 2.5M121.9 99.3l4.3 2.5M109.8 101.8l4.3-2.5M121.9 94.7l4.3-2.5"/></g>
        <g data-hub="r" class="hub"><circle cx="198" cy="97" r="10"/><path d="M198 87.5v5M198 101.5v5M189.8 92.2l4.3 2.5M201.9 99.3l4.3 2.5M189.8 101.8l4.3-2.5M201.9 94.7l4.3-2.5"/></g>
      </svg>
      <div class="label" aria-hidden="true">
        <span class="label-strip"><span class="label-side">А</span><span class="label-title hand" data-bind="title"></span></span>
        <span class="label-stripes"><i></i><i></i><i></i></span>
      </div>
      <div class="window-scrub" data-seek role="slider" tabindex="0" aria-label="Перемотка: ведите по окошку кассеты" aria-valuemin="0" aria-valuemax="100">
        <span class="scrub-head"></span>
      </div>
    </div>
  </div>

  <div class="now">
    <h2 class="now-title hand" data-bind="title"></h2>
    <p class="now-artist" data-bind="artist"></p>
    <p class="now-meta" data-bind="meta"></p>
    <p class="times"><span data-bind="time-cur">0:00</span><span class="times-sep">/</span><span data-bind="time-total">0:00</span></p>
  </div>

  <div class="panel">
    <div class="meter-box">
      <canvas class="vfd" data-meter="vfd" aria-hidden="true"></canvas>
      <div class="lyrics-slot" data-lyrics-slot></div>
    </div>
    <div class="panel-row">
      <button type="button" class="led-btn" data-act="shuffle" title="Вперемешку (S)"><span class="led"></span><svg><use href="#i-shuffle"/></svg><span class="sr">Вперемешку</span></button>
      <button type="button" class="led-btn" data-act="repeat" title="Повтор (R)"><span class="led"></span><svg><use href="#i-repeat"/></svg><span class="repeat-one" aria-hidden="true">1</span><span class="sr">Повтор</span></button>
      <div class="volume">
        <button type="button" class="icon-btn" data-act="mute" aria-label="Выключить звук (M)"><svg><use data-vol-icon href="#i-vol"/></svg></button>
        <input type="range" data-volume min="0" max="100" value="80" aria-label="Громкость">
      </div>
      <button type="button" class="led-btn" data-act="meter" title="Индикатор уровня (V)"><span class="led"></span><svg><use href="#i-meter"/></svg><span class="sr">Индикатор уровня</span></button>
      <button type="button" class="led-btn" data-act="lyrics-inline" title="Текст песни на месте индикатора"><span class="led"></span><svg><use href="#i-lyrics"/></svg><span class="sr">Текст песни</span></button>
    </div>
  </div>
</main>

<nav class="transport" aria-label="Управление">
  <button type="button" class="key" data-act="prev" aria-label="Предыдущий (P)"><svg><use href="#i-rew"/></svg></button>
  <button type="button" class="key key-play" data-act="play" aria-label="Играть (пробел)"><svg><use data-play-icon href="#i-play"/></svg></button>
  <button type="button" class="key" data-act="next" aria-label="Следующий (N)"><svg><use href="#i-ffw"/></svg></button>
  <button type="button" class="key key-tab" data-act="tab-toggle" aria-label="Кассета"><svg><use data-tab-icon href="#i-tape"/></svg></button>
</nav>`;
  },

  renderRow(t, i, f, { esc, formatTime, albumOf }) {
    const cls = ['row', f.current ? 'current' : '', f.missing ? 'missing' : ''].filter(Boolean).join(' ');
    const sub = [t.artist, albumOf(t)].filter(Boolean).map(esc).join(' · ');
    const remove = f.removable ? `<button type="button" class="row-remove" data-act="album-remove" data-remove-id="${esc(t.video_id)}" aria-label="Стереть «${esc(t.title)}» с кассеты" title="Убрать с кассеты"><svg><use href="#i-minus"/></svg></button>` : '';
    return `<li${f.removable ? ' class="removable"' : ''}><button type="button" class="${cls}" data-id="${esc(t.video_id)}"${f.current ? ' aria-current="true"' : ''}>
      <span class="row-num">${String(i + 1).padStart(2, '0')}${f.played ? '<svg aria-hidden="true"><use href="#i-tick"/></svg>' : ''}</span>
      <span class="row-thumb"><img src="${esc(t.thumbnail_api)}" alt="" loading="lazy" decoding="async"></span>
      <span class="row-main">
        <span class="row-title"><mark>${esc(t.title)}</mark></span>
        <span class="row-sub">${f.missing ? '<span class="tag">нет файла</span>' : ''}${sub}</span>
      </span>
      <span class="row-time">${t._sec ? formatTime(t._sec) : '—'}</span>
    </button>${remove}</li>`;
  },

  renderAlbumCard(a, info, { esc }) {
    const thumb = info.covers.length ? `<img src="${esc(info.covers[0])}" alt="" loading="lazy">` : '';
    const sub = [esc(a.artist || ''), info.countText, info.count ? info.timeText : ''].filter(Boolean).join(' · ');
    return `<li><button type="button" class="spine" data-act="album-open" data-key="${esc(a.key)}">
      <span class="spine-stripes" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="spine-thumb">${thumb}</span>
      <span class="spine-text"><span class="spine-name">${esc(a.name)}</span><span class="spine-sub">${sub}</span></span>
    </button></li>`;
  },

  renderAlbumHead(a, info, { esc }) {
    const thumb = info.covers.length ? `<img src="${esc(info.covers[0])}" alt="">` : '';
    const own = a.kind === 'user';
    return `<div class="tape-head">
      <span class="row-thumb big">${thumb}</span>
      <span class="tape-title">
        <span class="form-label">${own ? 'моя кассета' : (a.kind === 'smart' ? 'подборка · ' : 'альбом · ') + esc(a.artist || '')}</span>
        <span class="tape-name">${esc(a.name)}</span>
        <span class="tape-sub">${info.countText}${info.count ? ' · ' + info.timeText : ''}</span>
      </span>
      ${own ? `<span class="tape-tools">
        <button type="button" class="icon-btn small" data-act="album-rename" title="Переименовать" aria-label="Переименовать"><svg><use href="#i-edit"/></svg></button>
        <button type="button" class="icon-btn small danger" data-act="album-delete" title="Удалить кассету" aria-label="Удалить кассету"><svg><use href="#i-erase"/></svg></button>
      </span>` : ''}
    </div>
    <div class="tape-actions">
      <button type="button" class="mini-stamp solid" data-act="album-play" ${info.count ? '' : 'disabled'}><svg aria-hidden="true"><use href="#i-play"/></svg>играть</button>
      <button type="button" class="mini-stamp" data-act="album-download" ${info.count ? '' : 'disabled'} title="Скачать альбом архивом .zip — его же можно импортировать на другом устройстве"><svg aria-hidden="true"><use href="#i-down"/></svg>скачать</button>
      ${own ? `<button type="button" class="mini-stamp" data-act="album-add-tracks"><svg aria-hidden="true"><use href="#i-plus"/></svg>треки</button>`
        : `<button type="button" class="mini-stamp" data-act="album-save" title="Сделать своей кассетой — можно менять состав и имя">в мои</button>`}
    </div>`;
  },

  renderRec(r, i, f, { esc, formatTime }) {
    const sub = esc(r.artist || '');
    return `<li><div class="row rec">
      <span class="row-num"><button type="button" class="rec-add" data-act="rec-add" data-rec-id="${esc(r.id)}" aria-busy="${f.adding}" ${f.adding ? 'disabled' : ''} aria-label="Записать «${esc(r.title)}» на кассету" title="Записать на кассету"><svg class="idle" aria-hidden="true"><use href="#i-plus"/></svg><span class="busy rec-dot" aria-hidden="true"></span></button></span>
      <span class="row-thumb"><img src="${esc(r.thumb)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>
      <span class="row-main">
        <span class="row-title">${esc(r.title)}</span>
        <span class="row-sub">${sub}</span>
      </span>
      <span class="row-time">${r.duration ? formatTime(r.duration) : '—'}</span>
    </div></li>`;
  },

  onTab(tab) {
    const toTape = tab !== 'player';
    document.querySelectorAll('[data-tab-icon]').forEach((u) => u.setAttribute('href', toTape ? '#i-tape' : '#i-card'));
    document.querySelectorAll('[data-act="tab-toggle"]').forEach((b) => b.setAttribute('aria-label', toTape ? 'Кассета' : 'Вкладыш'));
    requestAnimationFrame(() => this._resize && this._resize());
  },

  mount(root) {
    // ---------- Счётчик ----------
    const wheels = root.querySelector('[data-wheels]');
    const digits = Array.from({ length: 10 }, (_, i) => `<span>${i}</span>`).join('');
    wheels.innerHTML = [0, 1, 'sep', 2, 3].map((w) => (w === 'sep'
      ? '<span class="wheel sep">:</span>'
      : `<span class="wheel"><span class="wheel-strip">${digits}</span></span>`)).join('');
    const strips = [...wheels.querySelectorAll('.wheel-strip')];
    let lastCounter = '';
    const setCounter = (sec) => {
      sec = Math.max(0, Math.floor(sec || 0));
      const str = String(Math.min(99, Math.floor(sec / 60))).padStart(2, '0') + String(sec % 60).padStart(2, '0');
      if (str === lastCounter) return;
      lastCounter = str;
      strips.forEach((s, i) => { s.style.transform = `translateY(${-Number(str[i]) * 10}%)`; });
    };

    // ---------- Бобины ----------
    const packL = root.querySelector('[data-pack="l"]');
    const packR = root.querySelector('[data-pack="r"]');
    const hubL = root.querySelector('[data-hub="l"]');
    const hubR = root.querySelector('[data-hub="r"]');
    const tape = root.querySelector('[data-tape]');
    const R_MIN = 14, R_MAX = 44;
    let angL = 0, angR = 0, lastP = 0;
    const radii = (p) => {
      // Площадь намотки сохраняется: r = √(rmin² + доля·(rmax² − rmin²)).
      const a = R_MIN ** 2, b = R_MAX ** 2;
      return [Math.sqrt(a + (1 - p) * (b - a)), Math.sqrt(a + p * (b - a))];
    };
    const drawReels = (p, rl, rr) => {
      packL.setAttribute('r', rl.toFixed(2));
      packR.setAttribute('r', rr.toFixed(2));
      tape.setAttribute('d', `M${(118 - rl).toFixed(1)} 97 L27 176 L34 183 L282 183 L289 176 L${(198 + rr).toFixed(1)} 97`);
      hubL.setAttribute('transform', `rotate(${angL.toFixed(1)} 118 97)`);
      hubR.setAttribute('transform', `rotate(${angR.toFixed(1)} 198 97)`);
    };

    // ---------- Флуоресцентный индикатор уровня ----------
    const vfd = root.querySelector('[data-meter="vfd"]');
    const vctx = vfd.getContext('2d');
    const SEG = 30;
    const HOT = 24;           // с этого сегмента — «перегруз»
    let lv = [0, 0], peak = [0, 0], peakHold = [0, 0];
    let colors = {};
    let vfdAlive = true;
    const readColors = () => { colors = { on: css('--vfd') || '#7ff5e8', hot: css('--orange') || '#ff5a1f' }; vfdAlive = true; };
    readColors();
    const dpr = () => Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const r = vfd.getBoundingClientRect();
      const w = Math.round(r.width * dpr()), h = Math.round(r.height * dpr());
      if (w && h && (vfd.width !== w || vfd.height !== h)) { vfd.width = w; vfd.height = h; vfdAlive = true; }
    };
    this._resize = resize;

    const drawVfd = () => {
      const W = vfd.width, H = vfd.height;
      if (!W || !H) return;
      const k = dpr();
      vctx.clearRect(0, 0, W, H);
      const padX = 30 * k, padTop = 16 * k, rowH = (H - padTop - 8 * k) / 2;
      const gap = 3 * k;
      const segW = (W - padX - 12 * k - gap * (SEG - 1)) / SEG;
      vctx.font = `700 ${10 * k}px "PT Mono", monospace`;
      vctx.textBaseline = 'middle';
      // шкала
      const marks = [[0, '−30'], [8, '−20'], [15, '−10'], [20, '−5'], [HOT, '0'], [SEG - 1, '+3']];
      vctx.fillStyle = colors.on;
      vctx.globalAlpha = 0.7;
      for (const [i, txt] of marks) {
        const x = padX + i * (segW + gap) + segW / 2;
        vctx.textAlign = 'center';
        vctx.fillText(txt, x, 7 * k);
      }
      for (let ch = 0; ch < 2; ch++) {
        const y = padTop + ch * rowH + rowH * 0.18;
        const h = rowH * 0.64;
        vctx.globalAlpha = 0.8;
        vctx.textAlign = 'left';
        vctx.fillStyle = colors.on;
        vctx.fillText(ch ? 'П' : 'Л', 6 * k, y + h / 2);
        const lit = Math.round(Math.min(1, lv[ch] / 1.1) * SEG);
        const pk = Math.round(Math.min(1, peak[ch] / 1.1) * SEG) - 1;
        for (let i = 0; i < SEG; i++) {
          const on = i < lit || (i === pk && pk > 0);
          const x = padX + i * (segW + gap);
          vctx.fillStyle = i >= HOT ? colors.hot : colors.on;
          if (on) {
            // люминофор светится: мягкий ореол того же цвета, затем сам сегмент
            vctx.globalAlpha = 0.35;
            vctx.shadowColor = vctx.fillStyle;
            vctx.shadowBlur = 8 * k;
            vctx.fillRect(x, y, segW, h);
            vctx.shadowBlur = 0;
            vctx.globalAlpha = 1;
          } else {
            vctx.globalAlpha = 0.09;   // погасший сегмент всё равно виден под стеклом
          }
          vctx.fillRect(x, y, segW, h);
        }
      }
      // сетка-сеточка поверх стекла, как у настоящего ВЛИ
      vctx.globalAlpha = 0.28;
      vctx.fillStyle = '#000';
      const step = Math.max(2, Math.round(3 * k));
      for (let yy = padTop; yy < H; yy += step) vctx.fillRect(padX - 2 * k, yy, W - padX, Math.max(1, Math.round(k * 0.8)));
      vctx.globalAlpha = 1;
    };

    const insert = () => {
      const c = root.querySelector('[data-cassette]');
      c.classList.remove('insert');
      void c.offsetWidth;
      c.classList.add('insert');
    };
    const offTrack = core.on('track', insert);

    this.frame = (f) => {
      const p = f.p;
      const [rl, rr] = radii(p);
      if (state.dragging && !reduceMotion) {
        // Перематываем пальцем — бобины крутятся вместе с лентой.
        const dp = p - lastP;
        angL = (angL - dp * 9000 / rl) % 360;
        angR = (angR - dp * 9000 / rr) % 360;
      } else if (f.playing && !reduceMotion) {
        // Лента идёт с постоянной линейной скоростью: тонкая бобина вращается быстрее.
        const v = 34 * audio.playbackRate;
        angL = (angL - (v / rl) * f.dt * 57.3) % 360;
        angR = (angR - (v / rr) * f.dt * 57.3) % 360;
      }
      lastP = p;
      drawReels(p, rl, rr);
      setCounter(state.dragging ? p * (audio.duration || 0) : audio.currentTime);

      if (settings.meter === 'viz') {
        const target = core.levels();
        const was = lv.concat(peak);
        // Баллистика: быстрый подъём, медленный спад; пик держится секунду.
        lv = lv.map((v, i) => v + (target[i] - v) * (target[i] > v ? 0.5 : Math.min(1, f.dt * 6)));
        for (let i = 0; i < 2; i++) {
          if (lv[i] >= peak[i]) { peak[i] = lv[i]; peakHold[i] = 1; }
          else if ((peakHold[i] -= f.dt) <= 0) peak[i] = Math.max(lv[i], peak[i] - f.dt * 0.6);
        }
        const moving = lv.concat(peak).some((v, i) => Math.abs(v - was[i]) > 0.001);
        if (moving || vfdAlive) { drawVfd(); vfdAlive = false; }
      }
    };

    const ro = new ResizeObserver(resize);
    ro.observe(vfd);
    window.addEventListener('mk-theme', readColors);
    resize();
    drawReels(core.progress(), ...radii(core.progress()));
    setCounter(audio.currentTime);
    this.onTab(document.documentElement.dataset.tab);

    return () => {
      offTrack();
      ro.disconnect();
      window.removeEventListener('mk-theme', readColors);
      this.frame = null;
      this._resize = null;
    };
  },
};
