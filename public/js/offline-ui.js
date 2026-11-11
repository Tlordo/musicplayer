// Музыка на телефоне — всё, что видно: плашка «компьютер недоступен», значки у сохранённых
// треков (в обоих дизайнах, без правки их разметки), действия «Сохранить на телефон»
// и раздел настроек с местом и кнопкой «Освободить место».

import * as core from './core.js';
import { state } from './core.js';
import * as offline from './offline.js';
import { settings, save } from './store.js';
import { plural, esc } from './format.js';
import { registerActions, toast } from './ui.js';
import { renderAlbum } from './albums.js';

const html = document.documentElement;
const nTracks = (n) => `${n} ${plural(n, 'трек', 'трека', 'треков')}`;
const mb = (bytes) => {
  const m = bytes / 1048576;
  return m >= 1024 ? `${(m / 1024).toFixed(1).replace('.', ',')} ГБ` : `${m < 10 ? m.toFixed(1).replace('.', ',') : Math.round(m)} МБ`;
};

// ============ Плашка связи ============
const banner = document.createElement('div');
banner.className = 'conn-banner';
banner.setAttribute('role', 'status');
banner.hidden = true;
banner.innerHTML = `<span class="conn-dot" aria-hidden="true"></span><span class="conn-text" data-conn-text></span>
  <button type="button" class="conn-retry" data-conn-retry>Проверить</button>`;
document.body.append(banner);

function renderConn() {
  const down = state.serverDown;
  html.dataset.conn = down ? 'down' : 'up';
  banner.hidden = !down;
  if (!down) return;
  const saved = offline.index.size;
  banner.querySelector('[data-conn-text]').textContent = saved
    ? 'Компьютер недоступен — играю сохранённое'
    : 'Компьютер недоступен — на телефоне пока ничего не сохранено';
}
banner.querySelector('[data-conn-retry]').addEventListener('click', () => core.checkServer());
core.on('conn', renderConn);

// ============ Значки у треков ============
// Строки рисуют дизайны; мы только помечаем их атрибутом data-off, значок — в CSS.
const ROWS = '[data-list] [data-id], [data-album-list] [data-id], [data-queue-row]';

function markRow(row) {
  const id = row.dataset.id;
  const kind = offline.has(id) || (offline.pending(id) ? 'busy' : null);
  if (kind) {
    if (row.dataset.off !== kind) row.dataset.off = kind;
  } else if (row.hasAttribute('data-off')) {
    row.removeAttribute('data-off');
  }
}
function markAll() { document.querySelectorAll(ROWS).forEach(markRow); }

// Списки перерисовываются целиком или по кусочкам при прокрутке — помечаем всё новое.
new MutationObserver((records) => {
  for (const r of records) {
    for (const n of r.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches(ROWS)) markRow(n);
      n.querySelectorAll?.(ROWS).forEach(markRow);
    }
  }
}).observe(document.body, { childList: true, subtree: true });

let markQueued = false;
function markSoon() {
  if (markQueued) return;
  markQueued = true;
  requestAnimationFrame(() => {
    markQueued = false;
    markAll();
    renderConn();
    refreshSettings();
    if (html.dataset.libview === 'album') renderAlbum();
  });
}
core.on('offline', markSoon);

// ============ Действия ============
/** Сохранить треки на телефон с понятным отчётом. */
export async function saveTracks(tracks, what) {
  const list = tracks.filter((t) => t && t.file_exists !== false);
  if (!list.length) { toast('Сохранять нечего', 'info'); return; }
  if (state.serverDown) { toast('Компьютер недоступен — сохранить не получится', 'info'); return; }
  const n = await offline.saveMany(list);
  if (!n) { toast(`${what} уже на телефоне`, 'ok', 2400); return; }
  toast(`Сохраняю на телефон: ${nTracks(n)}`, 'ok', 2600);
  waitDone(what);
}

let doneWatch = null;
function waitDone(what) {
  if (doneWatch) return;
  doneWatch = offline.onChange(() => {
    if (offline.progress.total) return;
    doneWatch();
    doneWatch = null;
    toast(`${what} — на телефоне, играет и без компьютера`, 'ok', 3200);
  });
}

export async function removeTrack(t) {
  await offline.remove(t.video_id);
  toast(`«${t.title}» убран с телефона`, 'info', 2400);
}

registerActions({
  'album-offline': async () => {
    const a = core.findAlbum(core.albums.open);
    if (!a) return;
    const tracks = a.tracks.map(core.find).filter(Boolean);
    const all = tracks.length && tracks.every((t) => offline.has(t.video_id) === 'pin');
    if (all) {
      for (const t of tracks) await offline.unpin(t.video_id);
      toast(`«${a.name}» больше не хранится на телефоне — место освободится по мере надобности`, 'info', 4200);
      return;
    }
    saveTracks(tracks, `«${a.name}»`);
  },
});

/** Пункт меню трека: «Сохранить на телефон» или «Убрать с телефона». */
export function sheetItem(t) {
  const kind = offline.has(t.video_id);
  if (kind === 'pin') return { act: 'offline-remove', icon: 'i-phone', label: 'Убрать с телефона' };
  if (offline.pending(t.video_id)) return { act: 'offline-none', icon: 'i-phone', label: 'Сохраняется на телефон…' };
  return { act: 'offline-save', icon: 'i-phone', label: 'Сохранить на телефон' };
}

export function sheetAction(act, t) {
  if (act === 'offline-save') saveTracks([t], `«${t.title}»`);
  else if (act === 'offline-remove') removeTrack(t);
}

// ============ Настройки ============
export function settingsHtml() {
  const caps = [100, 300, 1000, 3000];
  const insecure = !window.isSecureContext;
  return `<section class="set-sec" aria-labelledby="s-offline">
      <h3 id="s-offline">Музыка на телефоне</h3>
      <p class="hint">Сохранённые треки играют, даже когда компьютер выключен или вы вышли из дома. Сохранить можно трек (долгое нажатие), альбом или «Любимое».</p>
      <div class="off-stats" data-off-stats><p class="hint">Считаю место…</p></div>
      <label class="switch-row">
        <span class="switch-text"><span>Умный кэш</span><small>В Wi‑Fi держать на телефоне текущий и 3 следующих трека — короткий обрыв связи музыку не остановит</small></span>
        <input type="checkbox" class="switch" data-set="offlineAuto"${settings.offlineAuto ? ' checked' : ''}>
      </label>
      <label class="field">
        <span class="field-label">Предел умного кэша</span>
        <select class="eq-preset" data-off-cap>${caps.map((c) => `<option value="${c}"${c === settings.offlineAutoMB ? ' selected' : ''}>${c >= 1000 ? `${c / 1000} ГБ` : `${c} МБ`}</option>`).join('')}</select>
      </label>
      <div class="row-btns">
        <button type="button" class="btn" data-off-act="liked"><svg><use href="#i-heart"/></svg>Сохранить «Любимое»</button>
        <button type="button" class="btn" data-off-act="free"><svg><use href="#i-erase"/></svg>Освободить место</button>
        <button type="button" class="btn btn-danger" data-off-act="all">Удалить всё с телефона</button>
      </div>
      ${insecure ? `<p class="hint">Плеер открыт по <b>http://${esc(location.host)}</b>: браузер разрешает офлайн-режим целиком только на HTTPS или localhost.
        Сохранённое всё равно играет, пока вкладка открыта, но открыть плеер заново без компьютера не выйдет.
        Chrome на Android: откройте <b>chrome://flags/#unsafely-treat-insecure-origin-as-secure</b>, впишите <b>${esc(location.origin)}</b>, включите и перезапустите Chrome.</p>` : ''}
    </section>`;
}

async function refreshSettings() {
  const box = document.querySelector('#settings-dialog [data-off-stats]');
  if (!box || !document.getElementById('settings-dialog').open) return;
  const t = offline.totals();
  const est = await offline.estimate();
  const busy = offline.progress.total ? `<p class="off-busy">Сохраняю: ${offline.progress.done} из ${offline.progress.total}${offline.progress.failed ? ` · не вышло: ${offline.progress.failed}` : ''}</p>` : '';
  const cap = (settings.offlineAutoMB || 300) * 1048576;
  const quota = est && est.quota ? `<div class="off-meter" style="--p:${Math.min(1, est.usage / est.quota)}" role="img" aria-label="Занято ${mb(est.usage)} из ${mb(est.quota)}"><i></i></div>
      <p class="hint">Браузер отвёл плееру ${mb(est.quota)}, занято ${mb(est.usage)}.</p>` : '';
  box.innerHTML = `<dl class="off-dl">
      <div><dt>Сохранено вами</dt><dd>${t.pinN ? `${nTracks(t.pinN)} · ${mb(t.pin)}` : 'ничего'}</dd></div>
      <div><dt>Умный кэш</dt><dd>${t.autoN ? `${nTracks(t.autoN)} · ${mb(t.auto)}` : 'пусто'} из ${mb(cap)}</dd></div>
    </dl>${busy}${quota}`;
  const free = document.querySelector('#settings-dialog [data-off-act="free"]');
  if (free) free.disabled = !t.autoN;
  const all = document.querySelector('#settings-dialog [data-off-act="all"]');
  if (all) all.disabled = !(t.pinN + t.autoN);
}

const settingsBody = document.getElementById('settings-body');
let confirmAll = 0;
settingsBody.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-off-act]');
  if (!b || b.disabled) return;
  switch (b.dataset.offAct) {
    case 'liked':
      saveTracks(state.library.filter((t) => t.liked), '«Любимое»');
      break;
    case 'free': {
      const { auto, autoN } = offline.totals();
      await offline.clearAuto();
      toast(autoN ? `Освобождено ${mb(auto)}. Сохранённое вами осталось` : 'Кэш уже пуст', 'ok');
      break;
    }
    case 'all':
      // Два нажатия: случайно стереть всю музыку с телефона не хочется.
      if (Date.now() - confirmAll > 4000) {
        confirmAll = Date.now();
        b.textContent = 'Точно удалить? Нажмите ещё раз';
        setTimeout(() => { if (b.isConnected) b.textContent = 'Удалить всё с телефона'; }, 4000);
        return;
      }
      confirmAll = 0;
      b.textContent = 'Удалить всё с телефона';
      await offline.clearAll();
      toast('Вся музыка с телефона удалена', 'info');
      break;
  }
  refreshSettings();
});
settingsBody.addEventListener('change', (e) => {
  if (e.target.matches('[data-off-cap]')) {
    settings.offlineAutoMB = Number(e.target.value) || 300;
    save();
    core.smartCache();
    refreshSettings();
  } else if (e.target.matches('[data-set="offlineAuto"]')) {
    // Сохранение — в общем обработчике настроек; здесь только запускаем кэш.
    setTimeout(() => core.smartCache(), 0);
  }
});
// Окно настроек перерисовывается целиком — заполняем раздел после каждой отрисовки.
new MutationObserver(() => { if (settingsBody.querySelector('[data-off-stats] .hint')) refreshSettings(); })
  .observe(settingsBody, { childList: true });

renderConn();
