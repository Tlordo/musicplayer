// Послушать трек с YouTube, не скачивая: кнопка ▶ у результатов поиска и рекомендаций.
// Отдельный лёгкий <audio> (без эквалайзера и анализаторов) — основной плеер встаёт на паузу,
// а когда он снова заиграет, прослушивание само останавливается. Поток идёт через сервер
// (/api/preview/:id), поэтому работает и на телефоне, и с перемоткой.

import * as core from './core.js';
import { registerActions, toast } from './ui.js';

const $$ = (sel) => [...document.querySelectorAll(sel)];

let el = null;
let currentId = null;

function player() {
  if (el) return el;
  el = new Audio();
  el.preload = 'none';
  el.addEventListener('playing', () => mark('playing'));
  el.addEventListener('waiting', () => mark('loading'));
  el.addEventListener('pause', () => mark(null));
  el.addEventListener('ended', stop);
  el.addEventListener('timeupdate', () => {
    const p = el.duration ? el.currentTime / el.duration : 0;
    buttons(currentId).forEach((b) => b.style.setProperty('--pp', p.toFixed(3)));
  });
  el.addEventListener('error', () => {
    if (!currentId) return;
    toast('YouTube не отдал звук — попробуйте ещё раз или просто скачайте трек', 'error', 5000);
    stop();
  });
  return el;
}

const buttons = (id) => (id ? $$(`[data-preview-id="${CSS.escape(id)}"]`) : []);

function mark(stateName) {
  $$('[data-preview-id].playing, [data-preview-id].loading').forEach((b) => {
    if (b.dataset.previewId !== currentId || !stateName) b.classList.remove('playing', 'loading');
  });
  buttons(currentId).forEach((b) => {
    b.classList.toggle('playing', stateName === 'playing');
    b.classList.toggle('loading', stateName === 'loading');
    b.setAttribute('aria-pressed', String(!!stateName));
  });
}

export function stop() {
  if (!el) return;
  el.pause();
  el.removeAttribute('src');
  el.load(); // отпускает соединение и буфер
  const was = currentId;
  currentId = null;
  buttons(was).forEach((b) => { b.classList.remove('playing', 'loading'); b.setAttribute('aria-pressed', 'false'); b.style.removeProperty('--pp'); });
}

export function toggle(id) {
  const a = player();
  if (currentId === id) {
    if (a.paused) a.play().catch(() => {}); else a.pause();
    return;
  }
  stop();
  currentId = id;
  core.pause();
  a.src = `/api/preview/${encodeURIComponent(id)}`;
  mark('loading');
  a.play().catch((e) => {
    // Браузер не разрешил звук без нажатия (или запрос отменён) — не висим в «загрузке».
    if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError') && currentId === id) mark(null);
  });
}

export const previewing = () => currentId;

registerActions({ preview: (btn) => toggle(btn.dataset.previewId) });

// Основной плеер заиграл — прослушивание больше не нужно.
core.onAudio('play', () => { if (currentId) stop(); });
// Окно поиска закрыли — тишина.
document.getElementById('add-dialog')?.addEventListener('close', stop);
// Список перерисовался — вернуть отметку «играет» на новую кнопку.
core.on('recs', () => requestAnimationFrame(() => mark(el && !el.paused ? 'playing' : null)));
