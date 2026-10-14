// Экран настроек: дизайн, тема и редактор своих тем, индикатор, воспроизведение.

import * as core from './core.js';
import { settings, save, resetSettings } from './store.js';
import { esc } from './format.js';
import {
  currentDesign, themesFor, activeTheme, applyTheme, newThemeId,
  saveCustomTheme, deleteCustomTheme, exportThemes, importThemes,
  contrast, textOn, mixHex,
} from './themes.js';
import { toast } from './ui.js';
import { saveText } from './native.js';

const dialog = document.getElementById('settings-dialog');
const body = document.getElementById('settings-body');
let designs = {};
let switchDesign = () => {};
let editing = null;   // тема в редакторе: { id, name, design, scheme, vars, isNew }

export function initSettings(map, onSwitch) {
  designs = map;
  switchDesign = onSwitch;
}

export function openSettings() {
  editing = null;
  render();
  dialog.showModal();
}

/** Адрес для телефона и QR-код, версия yt-dlp — подгружаются после открытия окна. */
async function fillServerInfo() {
  const box = body.querySelector('[data-connect]');
  if (box) {
    try {
      const info = await (await fetch('/api/info')).json();
      const here = location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? null : location.origin + '/';
      const url = (info.urls && info.urls[0]) || here;
      box.innerHTML = url
        ? `<img class="qr" src="/api/qr?text=${encodeURIComponent(url)}" alt="QR-код адреса ${esc(url)}" width="168" height="168">
           <div class="connect-text">
             <p>Телефон в той же Wi-Fi сети — наведите камеру на код или откройте в браузере:</p>
             <p class="connect-url"><b>${esc(url)}</b></p>
             ${(info.urls || []).length > 1 ? `<p class="hint">Другие адреса этого компьютера: ${info.urls.slice(1).map(esc).join(', ')}</p>` : ''}
             <p class="hint">iPhone: Safari → «Поделиться» → «На экран Домой» — появится иконка, плеер откроется во весь экран. Android: Chrome → ⋮ → «Добавить на гл. экран».</p>
             <p class="hint">Если не открывается — разрешите программе доступ в частных сетях в брандмауэре Windows.</p>
           </div>`
        : '<p class="hint">Компьютер не подключён к локальной сети — телефону не к чему подключаться.</p>';
    } catch {
      box.innerHTML = '<p class="hint">Не удалось узнать адрес сервера.</p>';
    }
  }
  const ver = body.querySelector('[data-ytdlp-version]');
  if (ver) {
    try {
      const v = await (await fetch('/api/ytdlp')).json();
      ver.textContent = v.ok && v.version ? `yt-dlp ${v.version}` : 'yt-dlp не найден';
    } catch {
      ver.textContent = 'yt-dlp: нет связи с сервером';
    }
  }
}

dialog.addEventListener('close', () => {
  if (editing) { editing = null; applyTheme(); }
});

// Мини-превью дизайнов нарисованы теми же цветами, что и сами дизайны.
const PREVIEW = {
  classic: `<span class="pv pv-classic" aria-hidden="true"><i class="pv-side"></i><i class="pv-cover"></i><i class="pv-bar"></i><i class="pv-play"></i></span>`,
  cassette: `<span class="pv pv-cassette" aria-hidden="true"><i class="pv-card"></i><i class="pv-tape"><b></b><b></b></i><i class="pv-keys"></i></span>`,
};

function swatch(theme, design) {
  const colors = theme.swatch || [
    theme.vars['--bg'] || theme.vars['--deck'] || theme.vars['--card'] || '#111',
    theme.vars[design.id === 'classic' ? '--accent' : '--orange'] || '#888',
    theme.vars['--text'] || theme.vars['--ball'] || '#fff',
  ];
  return `<span class="sw" aria-hidden="true">${colors.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</span>`;
}

function switchRow(key, title, hint) {
  return `<label class="switch-row">
    <span class="switch-text"><span>${title}</span>${hint ? `<small>${hint}</small>` : ''}</span>
    <input type="checkbox" class="switch" data-set="${key}"${settings[key] ? ' checked' : ''}>
  </label>`;
}

function render() {
  const design = currentDesign();
  const active = activeTheme(design);
  const meterOpts = [['viz', design.meterName], ['lyrics', 'Текст песни'], ['off', 'Выключен']];

  body.innerHTML = `
    <header class="sheet-head">
      <h2 id="settings-title">Настройки</h2>
      <button type="button" class="icon-btn" data-close aria-label="Закрыть"><svg><use href="#i-x"/></svg></button>
    </header>

    <section class="set-sec" aria-labelledby="s-design">
      <h3 id="s-design">Дизайн</h3>
      <div class="design-picks" role="radiogroup" aria-labelledby="s-design">
        ${Object.values(designs).map((d) => `
          <button type="button" class="design-pick" role="radio" aria-checked="${d.id === design.id}" data-s="design" data-v="${d.id}">
            ${PREVIEW[d.id] || ''}
            <span class="dp-name">${d.name}</span>
            <span class="dp-desc">${d.description}</span>
          </button>`).join('')}
      </div>
    </section>

    <section class="set-sec" aria-labelledby="s-theme">
      <h3 id="s-theme">Тема · ${design.name}</h3>
      ${editing ? editorHtml(design) : `
      <div class="theme-grid" role="radiogroup" aria-labelledby="s-theme">
        ${themesFor(design).map((t) => `
          <span class="theme-item">
            <button type="button" class="theme-chip" role="radio" aria-checked="${t.id === active.id}" data-s="theme" data-v="${esc(t.id)}">
              ${swatch(t, design)}<span class="theme-name">${esc(t.name)}</span>
            </button>
            ${t.custom ? `<button type="button" class="icon-btn small theme-edit" data-s="edit" data-v="${esc(t.id)}" aria-label="Изменить тему «${esc(t.name)}»"><svg><use href="#i-edit"/></svg></button>` : ''}
          </span>`).join('')}
        <button type="button" class="theme-chip theme-new" data-s="new"><svg aria-hidden="true"><use href="#i-plus"/></svg><span class="theme-name">Своя тема</span></button>
      </div>
      ${switchRow('coverColors', 'Цвета из обложки', design.id === 'classic' ? 'Акцент интерфейса подстраивается под обложку трека' : 'Индикатор уровня окрашивается в цвет обложки')}
      <div class="row-btns">
        <button type="button" class="btn" data-s="export" ${settings.customThemes.length ? '' : 'disabled'}><svg><use href="#i-down"/></svg>Экспорт тем</button>
        <button type="button" class="btn" data-s="import"><svg><use href="#i-up"/></svg>Импорт тем</button>
        <input type="file" accept=".json,application/json" hidden data-s-file>
      </div>`}
    </section>

    <section class="set-sec" aria-labelledby="s-meter">
      <h3 id="s-meter">Индикатор</h3>
      <div class="segmented" role="radiogroup" aria-labelledby="s-meter">
        ${meterOpts.map(([v, label]) => `<button type="button" role="radio" aria-checked="${settings.meter === v}" data-s="meter" data-v="${v}">${label}</button>`).join('')}
      </div>
      <p class="hint">«Текст песни» — musetext: слова в такт треку на месте индикатора. Полноэкранный режим открывается кнопкой <svg class="inline-icon"><use href="#i-expand"/></svg> или клавишей L.</p>
      ${switchRow('lyricsReact', 'Текст реагирует на звук', 'Вспышки и движение слов в такт музыке')}
    </section>

    <section class="set-sec" aria-labelledby="s-play">
      <h3 id="s-play">Воспроизведение</h3>
      ${switchRow('autoNext', 'Играть следующий трек', 'Когда трек закончился')}
      ${switchRow('resumeLast', 'Открывать последний трек', 'При запуске плеер вставляет то, что играло')}
      ${switchRow('markPlayed', 'Отмечать прослушанные', 'Галочка у треков, которые уже играли')}
      <div class="row-btns">
        <button type="button" class="btn" data-s="clear-played">Сбросить отметки</button>
      </div>
    </section>

    <section class="set-sec" aria-labelledby="s-phone">
      <h3 id="s-phone">Подключить телефон</h3>
      <div class="connect" data-connect><p class="hint">Узнаю адрес…</p></div>
    </section>

    <section class="set-sec" aria-labelledby="s-ytdlp">
      <h3 id="s-ytdlp">Загрузчик YouTube</h3>
      <p class="hint">YouTube часто меняется, и старый yt-dlp перестаёт скачивать. Если треки не добавляются — обновите его.</p>
      <div class="row-btns ytdlp-row">
        <span class="ytdlp-version" data-ytdlp-version>yt-dlp: …</span>
        <button type="button" class="btn" data-s="ytdlp-update"><svg><use href="#i-refresh"/></svg>Обновить yt-dlp</button>
      </div>
      <pre class="ytdlp-out" data-ytdlp-out hidden></pre>
    </section>

    <section class="set-sec" aria-labelledby="s-reset">
      <h3 id="s-reset">Сброс</h3>
      <p class="hint">Настройки хранятся в этом браузере. Свои темы при сбросе сохраняются — их можно перенести на другое устройство экспортом.</p>
      <div class="row-btns">
        <button type="button" class="btn btn-danger" data-s="reset">Сбросить настройки</button>
      </div>
    </section>`;
  fillServerInfo();
}

function editorHtml(design) {
  const e = editing;
  const base = getComputedStyle(document.documentElement);
  const field = (v) => {
    const val = e.vars[v.key] ?? base.getPropertyValue(v.key).trim();
    if (v.type === 'color') {
      return `<label class="ed-field"><span>${v.label}</span><input type="color" data-ed="${v.key}" value="${esc(toHex(val))}"></label>`;
    }
    const num = parseFloat(val) || 0;
    return `<label class="ed-field ed-range"><span>${v.label}</span><input type="range" data-ed="${v.key}" min="${v.min}" max="${v.max}" step="${v.step}" value="${num}" data-unit="${v.unit || ''}"><output>${num}${v.unit || ''}</output></label>`;
  };
  return `
    <div class="editor" aria-label="Редактор темы">
      <label class="field">
        <span class="field-label">Название</span>
        <input type="text" data-ed-name value="${esc(e.name)}" maxlength="40" autocomplete="off">
      </label>
      <div class="segmented small" role="radiogroup" aria-label="Тип темы">
        <button type="button" role="radio" aria-checked="${e.scheme !== 'light'}" data-s="scheme" data-v="dark">Тёмная</button>
        <button type="button" role="radio" aria-checked="${e.scheme === 'light'}" data-s="scheme" data-v="light">Светлая</button>
      </div>
      <div class="ed-grid">${design.themeVars.map(field).join('')}</div>
      <p class="hint">Изменения видны сразу. Тему можно экспортировать и отправить другу.</p>
      <div class="sheet-actions">
        ${e.isNew ? '' : '<button type="button" class="btn btn-danger" data-s="delete-theme">Удалить</button>'}
        <span class="spacer"></span>
        <button type="button" class="btn" data-s="cancel-edit">Отмена</button>
        <button type="button" class="btn btn-primary" data-s="save-theme"><svg><use href="#i-check"/></svg>Сохранить</button>
      </div>
    </div>`;
}

/** Любой CSS-цвет → #rrggbb для <input type="color">. */
function toHex(value) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) return '#' + [...value.slice(1)].map((c) => c + c).join('');
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = '#000';
  c.fillStyle = value;
  const v = c.fillStyle;
  return /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000';
}

function startEdit(theme) {
  const design = currentDesign();
  editing = {
    id: theme && theme.custom ? theme.id : newThemeId(),
    name: theme && theme.custom ? theme.name : `Моя тема ${settings.customThemes.filter((t) => t.design === design.id).length + 1}`,
    design: design.id,
    scheme: (theme && theme.scheme) || design.scheme || 'dark',
    vars: { ...((theme && theme.vars) || {}) },
    isNew: !(theme && theme.custom),
  };
  // Новая тема начинается с текущих цветов, чтобы было от чего отталкиваться.
  const cs = getComputedStyle(document.documentElement);
  for (const v of design.themeVars) {
    if (editing.vars[v.key] == null) editing.vars[v.key] = v.type === 'color' ? toHex(cs.getPropertyValue(v.key).trim()) : cs.getPropertyValue(v.key).trim();
  }
  render();
}

/** Фон поменялся так, что текст на нём не читается, — подбираем текст сами (его можно поправить). */
function keepReadable(changed) {
  const pairs = currentDesign().contrastPairs || {};
  const bg = editing.vars[changed];
  if (!pairs[changed] || !/^#[0-9a-f]{6}$/i.test(bg || '')) return;
  for (const [fg, min, soft] of pairs[changed]) {
    const cur = editing.vars[fg];
    if (/^#[0-9a-f]{6}$/i.test(cur || '') && contrast(cur, bg) >= min) continue;
    const base = textOn(bg);
    // soft — доля фона в подобранном цвете или готовая пара цветов для тёмного/светлого фона
    const next = typeof soft === 'object' ? soft[base === '#ffffff' ? 'dark' : 'light'] : soft ? mixHex(base, bg, soft) : base;
    editing.vars[fg] = next;
    const input = body.querySelector(`[data-ed="${fg}"]`);
    if (input) input.value = next;
  }
}

function previewEdit() {
  applyTheme({ ...editing, vars: { ...editing.vars } });
}

body.addEventListener('click', (e) => {
  const el = e.target.closest('[data-s]');
  if (!el || el.disabled) return;
  const v = el.dataset.v;
  switch (el.dataset.s) {
    case 'design':
      if (v !== settings.design) { switchDesign(v); render(); }
      break;
    case 'theme':
      settings.theme[currentDesign().id] = v;
      save();
      applyTheme();
      render();
      break;
    case 'new': startEdit(activeTheme()); break;
    case 'edit': startEdit(themesFor(currentDesign()).find((t) => t.id === v)); break;
    case 'scheme': editing.scheme = v; previewEdit(); render(); break;
    case 'cancel-edit': editing = null; applyTheme(); render(); break;
    case 'save-theme':
      saveCustomTheme(editing);
      toast(`Тема «${editing.name}» сохранена`, 'ok');
      editing = null;
      applyTheme();
      render();
      break;
    case 'delete-theme':
      deleteCustomTheme(editing.id);
      toast(`Тема «${editing.name}» удалена`);
      editing = null;
      applyTheme();
      render();
      break;
    case 'export': {
      if (saveText('my-music-themes.json', 'application/json', exportThemes())) { toast('Сохраняю темы в «Загрузки»'); break; }
      const blob = new Blob([exportThemes()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'my-music-themes.json';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      break;
    }
    case 'import': body.querySelector('[data-s-file]').click(); break;
    case 'meter': settings.meter = v; save(); core.emit('meter'); render(); break;
    case 'clear-played': core.clearPlayed(); toast('Отметки прослушанного сброшены'); break;
    case 'ytdlp-update': {
      const out = body.querySelector('[data-ytdlp-out]');
      el.disabled = true;
      el.classList.add('spinning');
      out.hidden = false;
      out.textContent = 'Обновляю…';
      fetch('/api/ytdlp/update', { method: 'POST' })
        .then((r) => r.json())
        .then((r) => {
          out.textContent = r.output || r.error || 'Готово';
          if (r.version) body.querySelector('[data-ytdlp-version]').textContent = `yt-dlp ${r.version}`;
          toast(r.ok ? 'yt-dlp обновлён' : 'Не удалось обновить yt-dlp — подробности в настройках', r.ok ? 'ok' : 'error');
        })
        .catch((err) => { out.textContent = err.message; })
        .finally(() => { el.disabled = false; el.classList.remove('spinning'); });
      break;
    }
    case 'reset':
      resetSettings();
      switchDesign(settings.design, true);
      core.setVolume(settings.volume, false);
      core.applyFilters();
      core.emit('state');
      core.emit('meter');
      toast('Настройки сброшены');
      render();
      break;
  }
});

body.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.matches('[data-set]')) {
    settings[t.dataset.set] = t.checked;
    save();
    if (t.dataset.set === 'coverColors') applyTheme();
    if (t.dataset.set === 'markPlayed') core.emit('library', core.state);
  } else if (t.matches('[data-s-file]') && t.files[0]) {
    try {
      const n = importThemes(await t.files[0].text());
      toast(n ? `Импортировано тем: ${n}` : 'В файле не нашлось подходящих тем', n ? 'ok' : 'info');
      render();
    } catch (err) {
      toast(err.message, 'error', 5000);
    }
    t.value = '';
  }
});

body.addEventListener('input', (e) => {
  const t = e.target;
  if (!editing) return;
  if (t.matches('[data-ed-name]')) { editing.name = t.value; return; }
  if (t.matches('[data-ed]')) {
    const unit = t.dataset.unit || '';
    editing.vars[t.dataset.ed] = t.type === 'range' ? `${t.value}${unit}` : t.value;
    const out = t.parentElement.querySelector('output');
    if (out) out.textContent = `${t.value}${unit}`;
    keepReadable(t.dataset.ed);
    previewEdit();
  }
});
