// Сохранение файлов в Android-приложении: у WebView нет своего «Скачать как»,
// поэтому файлы сохраняет приложение (в «Загрузки/Моя музыка»). В браузере — false.

const host = window.MkAndroid || null;

/** Скачать файл с сервера по ссылке; name — имя файла (пусто — как предложит сервер). */
export function saveUrl(url, name = '') {
  if (!host) return false;
  try { host.download(new URL(url, location.href).href, name); return true; } catch { return false; }
}

/** Сохранить текст (например, экспорт тем) файлом. */
export function saveText(name, mime, text) {
  if (!host) return false;
  try { host.saveText(name, mime, text); return true; } catch { return false; }
}
