//! Фоновые задачи: загрузка целого альбома / плейлиста с YouTube.
//!
//! Сначала yt-dlp быстро читает список треков (`--flat-playlist`), затем треки
//! скачиваются по одному тем же путём, что и одиночное добавление, и сразу
//! попадают в альбом, названный по плейлисту. Ход задачи виден в `/api/jobs`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::Value;

use crate::config::Config;
use crate::db::Db;
use crate::downloader::{is_valid_video_id, Downloader};

#[derive(Debug, Clone, Serialize)]
pub struct Job {
    pub id: u64,
    pub name: String,
    pub album_id: i64,
    pub total: usize,
    pub done: usize,
    pub failed: usize,
    pub current: Option<String>,
    /// running | done
    pub state: &'static str,
}

#[derive(Default)]
pub struct Jobs {
    list: Mutex<Vec<Job>>,
    seq: AtomicU64,
}

impl Jobs {
    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Job>> {
        self.list.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn snapshot(&self) -> Vec<Job> {
        self.lock().clone()
    }

    fn create(&self, name: &str, album_id: i64, total: usize) -> u64 {
        let id = self.seq.fetch_add(1, Ordering::Relaxed) + 1;
        let mut list = self.lock();
        // Храним только последние задачи — это журнал для интерфейса, а не история.
        let finished = list.iter().filter(|j| j.state == "done").count();
        if finished > 8 {
            if let Some(pos) = list.iter().position(|j| j.state == "done") {
                list.remove(pos);
            }
        }
        list.push(Job { id, name: name.to_owned(), album_id, total, done: 0, failed: 0, current: None, state: "running" });
        id
    }

    fn update(&self, id: u64, f: impl FnOnce(&mut Job)) {
        if let Some(j) = self.lock().iter_mut().find(|j| j.id == id) {
            f(j);
        }
    }
}

pub struct Playlist {
    pub title: String,
    pub entries: Vec<(String, String)>, // (video_id, название)
}

/// Прочитать состав плейлиста без скачивания.
pub async fn read_playlist(cfg: &Config, url: &str) -> Result<Playlist> {
    let mut args = crate::ytdlp::base_args(cfg);
    args.extend(["--flat-playlist", "--dump-single-json", "--yes-playlist", "--"].map(String::from));
    args.push(url.to_owned());
    let stdout = crate::ytdlp::run_ok(cfg, args, Duration::from_secs(90)).await?;
    let json: Value = serde_json::from_str(&stdout).context("не удалось разобрать ответ yt-dlp")?;
    Ok(parse_playlist(&json))
}

pub fn parse_playlist(json: &Value) -> Playlist {
    let title = json["title"]
        .as_str()
        .map(|t| t.trim_start_matches("Album - ").trim().to_owned())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "Плейлист".into());
    let mut entries: Vec<(String, String)> = json["entries"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|e| {
            let id = e["id"].as_str().filter(|id| is_valid_video_id(id))?;
            let name = e["title"].as_str().unwrap_or("").to_owned();
            if name.starts_with("[Deleted") || name.starts_with("[Private") {
                return None;
            }
            Some((id.to_owned(), name))
        })
        .collect();
    // Одиночное видео (не плейлист) yt-dlp отдаёт без entries.
    if entries.is_empty() {
        if let Some(id) = json["id"].as_str().filter(|id| is_valid_video_id(id)) {
            entries.push((id.to_owned(), json["title"].as_str().unwrap_or("").to_owned()));
        }
    }
    let mut seen = std::collections::HashSet::new();
    entries.retain(|(id, _)| seen.insert(id.clone()));
    Playlist { title, entries }
}

/// Создать альбом и запустить загрузку его треков в фоне. Возвращает задачу.
pub fn start(jobs: Arc<Jobs>, db: Arc<Db>, dl: Arc<Downloader>, list: Playlist, url: &str) -> Result<Job> {
    let album_id = db.create_album(&list.title, Some(url))?;
    let id = jobs.create(&list.title, album_id, list.entries.len());
    let job = jobs.snapshot().into_iter().find(|j| j.id == id).context("задача не создалась")?;

    tokio::spawn(async move {
        for (vid, name) in list.entries {
            jobs.update(id, |j| j.current = Some(name.clone()));
            let ok = if db.has_track(&vid).unwrap_or(false) {
                true
            } else {
                match dl.download(&format!("https://www.youtube.com/watch?v={vid}")).await {
                    Ok(_) => true,
                    Err(e) => {
                        tracing::warn!("плейлист «{}»: {vid}: {e:#}", list.title);
                        false
                    }
                }
            };
            if ok {
                if let Err(e) = db.add_to_album(album_id, &vid) {
                    tracing::warn!("альбом {album_id}: {e:#}");
                }
            }
            jobs.update(id, |j| if ok { j.done += 1 } else { j.failed += 1 });
        }
        jobs.update(id, |j| {
            j.state = "done";
            j.current = None;
        });
        tracing::info!("плейлист «{}» загружен", list.title);
    });
    Ok(job)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_album() {
        let p = parse_playlist(&json!({
            "title": "Album - Группа крови",
            "entries": [
                { "id": "aaaaaaaaaaa", "title": "Группа крови" },
                { "id": "aaaaaaaaaaa", "title": "дубль" },
                { "id": "bbbbbbbbbbb", "title": "[Deleted video]" },
                { "id": "ccccccccccc", "title": "Закрытая дверь" }
            ]
        }));
        assert_eq!(p.title, "Группа крови");
        assert_eq!(p.entries.len(), 2);
    }
}
