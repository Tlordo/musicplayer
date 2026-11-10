// Виртуальный список: в DOM лежат только видимые строки и запас вокруг них, остальное место
// держат отступы списка. Так библиотека в тысячи треков стоит столько же памяти, сколько в сотню:
// нет тысяч узлов и тысяч раскодированных обложек.
//
// Короткие списки (до SMALL строк) рисуются целиком, как раньше.
// Договор со строкой: rowAt(i) возвращает ровно один элемент верхнего уровня (<li>…</li>).

const SMALL = 120;
const BUF = 12;       // строк запаса сверху и снизу
const ALIGN = 6;      // окно начинается с кратного 6 — у кассеты наклон обложек зависит от nth-child(3n)

const lists = new WeakMap();

function scrollerOf(el) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === 'auto' || o === 'scroll') return p;
  }
  return null;
}

/** Где список относительно прокрутки: верх видимой части в координатах списка и её высота. */
function viewport(v) {
  const sc = v.scroller;
  const r = v.list.getBoundingClientRect();
  if (sc) {
    const s = sc.getBoundingClientRect();
    return { top: s.top - r.top, h: sc.clientHeight };
  }
  return { top: -r.top, h: window.innerHeight };
}

function bind(v) {
  if (v.bound) return;
  v.bound = true;
  v.scroller = scrollerOf(v.list);
  // scroll не всплывает, но ловится на документе в фазе захвата — так список слышит и окно,
  // и любой прокручиваемый родитель, даже если тот стал прокручиваемым позже (догрузились стили).
  // Браузер шлёт scroll не чаще раза за кадр, а лишние вызовы draw() сразу выходят.
  v.onScroll = (e) => {
    const t = e.target;
    if (!v.list.isConnected) { unbind(v); return; }
    if (t !== document && !(t.nodeType === 1 && t.contains(v.list))) return;
    if (t !== document && t !== v.scroller) v.scroller = scrollerOf(v.list);
    draw(v, false);
  };
  document.addEventListener('scroll', v.onScroll, { capture: true, passive: true });
  // Список стал видимым (вкладка, смена вида), поменялась раскладка или размер окна — окно пересчитать.
  v.ro = new ResizeObserver(() => {
    if (!v.list.isConnected) { unbind(v); return; }
    v.scroller = scrollerOf(v.list);
    draw(v, false);
  });
  v.ro.observe(v.list);
  v.ro.observe(document.documentElement);
}

function unbind(v) {
  if (!v.bound) return;
  document.removeEventListener('scroll', v.onScroll, { capture: true });
  v.ro.disconnect();
  v.bound = false;
}

/** Строка уходит из DOM — её недогруженная обложка больше не нужна: запрос отменяется. */
function drop(row) {
  for (const img of row.getElementsByTagName('img')) {
    if (!img.complete) img.removeAttribute('src');
  }
  row.remove();
}

function html(v, from, to) {
  let out = '';
  for (let i = from; i < to; i++) out += v.rowAt(i);
  return out;
}

function draw(v, force) {
  if (!v.list.isConnected) { unbind(v); return; }
  const { list, count } = v;
  let from = 0;
  let to = count;
  if (count > SMALL) {
    const vp = viewport(v);
    const h = vp.h || 800;   // список спрятан: рисуем начало, пересчитаем, когда покажется
    const first = Math.max(0, Math.floor(vp.top / v.rowH) - BUF);
    const last = Math.min(count, Math.ceil((vp.top + h) / v.rowH) + BUF);
    if (!force && first >= v.from && last <= v.to) return;
    from = Math.floor(Math.max(0, first - BUF) / ALIGN) * ALIGN;
    to = Math.min(count, last + BUF);
  }
  if (!force && from === v.from && to === v.to) return;

  if (force || from >= v.to || to <= v.from || list.children.length !== v.to - v.from) {
    // Строка в фокусе переживает полную перерисовку (Tab по списку, контекстное меню).
    const active = document.activeElement;
    const focusId = active && list.contains(active) ? active.closest('[data-id]')?.dataset.id : null;
    if (count > SMALL) while (list.firstElementChild) drop(list.firstElementChild);
    list.innerHTML = html(v, from, to);
    if (focusId) list.querySelector(`[data-id="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
  } else {
    // Прокрутка: строки, оставшиеся в окне, не трогаем (обложки не мигают, фокус и наведение
    // на месте) — убираем ушедшие и дорисовываем новые с нужного края.
    for (let n = from - v.from; n > 0; n--) drop(list.firstElementChild);
    for (let n = v.to - to; n > 0; n--) drop(list.lastElementChild);
    if (from < v.from) list.insertAdjacentHTML('afterbegin', html(v, from, v.from));
    if (to > v.to) list.insertAdjacentHTML('beforeend', html(v, v.to, to));
  }
  v.from = from;
  v.to = to;
  list.style.paddingTop = from ? `${from * v.rowH}px` : '';
  list.style.paddingBottom = to < count ? `${(count - to) * v.rowH}px` : '';
  v.after?.(list);

  // Высота строки зависит от дизайна и ширины экрана — меряем по нарисованным строкам.
  const kids = list.children;
  if (count > SMALL && kids.length > 1) {
    const h = (kids[kids.length - 1].offsetTop - kids[0].offsetTop) / (kids.length - 1);
    if (h > 8 && Math.abs(h - v.rowH) > 0.5) {
      v.rowH = h;
      draw(v, true);
    }
  }
}

/**
 * Нарисовать список из count строк; rowAt(i) возвращает HTML строки i,
 * after(list) вызывается после каждой перерисовки (отметки, подсветка).
 */
export function renderVirtual(list, count, rowAt, after) {
  let v = lists.get(list);
  if (!v) {
    v = { list, rowH: 64, from: -1, to: -1, bound: false };
    lists.set(list, v);
  }
  v.count = count;
  v.rowAt = rowAt;
  v.after = after;
  if (count > SMALL) { bind(v); v.scroller = scrollerOf(list); } else unbind(v);
  draw(v, true);
}

/** Прокрутить к строке i (она дорисуется сама). */
export function scrollToRow(list, i, smooth = true) {
  const v = lists.get(list);
  if (!v || i < 0) return;
  if (v.count <= SMALL) {
    list.children[i]?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    return;
  }
  bind(v);
  v.scroller = scrollerOf(v.list);
  const vp = viewport(v);
  const delta = i * v.rowH - (vp.h - v.rowH) / 2 - vp.top;
  // Далёкую строку показываем сразу: плавный проезд через тысячи строк идёт секунды.
  if (Math.abs(delta) > vp.h * 3) smooth = false;
  (v.scroller || window).scrollBy({ top: delta, behavior: smooth ? 'smooth' : 'auto' });
  draw(v, false);
}
