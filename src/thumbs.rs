//! Маленькие обложки для списков. Оригинал с YouTube — 1280×720, а в строке списка он
//! занимает 48 пикселей: браузер раскодирует ~3,5 МБ на каждую строку. Поэтому для списков
//! ffmpeg один раз уменьшает обложку и кладёт её рядом с оригиналом (`<id>.s96.jpg`, квадрат).

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::OnceLock;

use tokio::process::Command;
use tokio::sync::Semaphore;

use crate::config::Config;

/// Размеры, которые умеем отдавать: строка списка и карточка альбома (с запасом на плотные экраны).
const SIZES: [u32; 2] = [96, 320];

/// Ближайший подходящий размер (не меньше запрошенного).
pub fn snap(size: u32) -> u32 {
    SIZES.iter().copied().find(|&s| s >= size).unwrap_or(SIZES[SIZES.len() - 1])
}

pub fn small_path(cfg: &Config, video_id: &str, size: u32) -> PathBuf {
    cfg.info_dir.join(format!("{video_id}.s{size}.jpg"))
}

/// Все уменьшенные копии трека — чтобы удалить их вместе с треком.
pub fn all_small(cfg: &Config, video_id: &str) -> Vec<PathBuf> {
    SIZES.iter().map(|&s| small_path(cfg, video_id, s)).collect()
}

fn modified(p: &Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

/// Временный файл, который исчезает вместе с запросом (успех, ошибка или отмена).
struct TmpFile(PathBuf);

impl Drop for TmpFile {
    fn drop(&mut self) {
        if !self.0.exists() || std::fs::remove_file(&self.0).is_ok() {
            return;
        }
        // Убитый ffmpeg ещё секунду держит файл открытым — пробуем ещё раз чуть позже.
        let path = std::mem::take(&mut self.0);
        if let Ok(rt) = tokio::runtime::Handle::try_current() {
            rt.spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                let _ = tokio::fs::remove_file(&path).await;
            });
        }
    }
}

/// Уменьшенная обложка; `None` — не получилось (нет ffmpeg), тогда отдаём оригинал.
pub async fn ensure(cfg: &Config, video_id: &str, size: u32) -> Option<PathBuf> {
    static NO_FFMPEG: AtomicBool = AtomicBool::new(false);
    static LIMIT: OnceLock<Semaphore> = OnceLock::new();
    static SEQ: AtomicU64 = AtomicU64::new(0);

    let orig = cfg.thumb_path(video_id);
    let small = small_path(cfg, video_id, size);
    // Копия свежее оригинала — готова (оригинал мог смениться при повторной загрузке трека).
    let fresh = |small: &Path| matches!((modified(small), modified(&orig)), (Some(s), Some(o)) if s >= o);
    if fresh(&small) {
        return Some(small);
    }
    if NO_FFMPEG.load(Ordering::Relaxed) {
        return None;
    }

    // При прокрутке большой библиотеки обложки просят десятками — ffmpeg запускаем не больше трёх сразу.
    let _permit = LIMIT.get_or_init(|| Semaphore::new(3)).acquire().await.ok()?;
    if fresh(&small) {
        return Some(small);
    }
    let tmp = cfg.info_dir.join(format!("{video_id}.s{size}.{}.tmp.jpg", SEQ.fetch_add(1, Ordering::Relaxed)));
    // Строка ушла с экрана — браузер отменяет запрос, ffmpeg убивается на полпути. Недописанный файл убираем.
    let _cleanup = TmpFile(tmp.clone());
    // Все маленькие слоты квадратные (object-fit: cover) — лишние поля 16:9 обрезаем сразу.
    let scale = format!("scale={size}:{size}:force_original_aspect_ratio=increase,crop={size}:{size}");
    let mut cmd = Command::new(cfg.ffmpeg_cmd());
    let res = crate::no_console(&mut cmd)
        .args(["-hide_banner", "-v", "error", "-nostdin", "-y", "-i"])
        .arg(&orig)
        .args(["-vf", &scale, "-frames:v", "1", "-q:v", "5"])
        .arg(&tmp)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .output()
        .await;
    match res {
        Ok(out) if out.status.success() => match tokio::fs::rename(&tmp, &small).await {
            Ok(()) => Some(small),
            Err(e) => {
                tracing::debug!("обложка {video_id}: {e}");
                let _ = tokio::fs::remove_file(&tmp).await;
                None
            }
        },
        Ok(out) => {
            tracing::debug!("обложка {video_id}: {}", String::from_utf8_lossy(&out.stderr).trim());
            let _ = tokio::fs::remove_file(&tmp).await;
            None
        }
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                tracing::info!("ffmpeg не найден — списки получат обложки в полном размере");
                NO_FFMPEG.store(true, Ordering::Relaxed);
            }
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snaps_to_known_sizes() {
        assert_eq!(snap(1), 96);
        assert_eq!(snap(96), 96);
        assert_eq!(snap(97), 320);
        // Любой запрос сводится к одному из двух файлов — кэш на диске не разрастается.
        assert_eq!(snap(100_000), 320);
    }
}
