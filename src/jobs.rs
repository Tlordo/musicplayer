//! Фоновые задачи: загрузка одного трека или целого альбома / плейлиста с YouTube.
//!
//! Одиночный трек тоже идёт фоном: интерфейс получает задачу сразу и не ждёт минуту,
//! пока yt-dlp скачает и перекодирует файл.
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
    /// playlist | track
    pub kind: &'static str,
    pub name: String,
    pub album_id: i64,
    pub total: usize,
    pub done: usize,
    pub failed: usize,
    pub current: Option<String>,
    /// running | done
    pub state: &'static str,
    /// Трек: какой video_id получился (или известен заранее из ссылки).
    pub video_id: Option<String>,
    /// Трек: почему не скачался.
    pub error: Option<String>,
    /// Исходная ссылка — чтобы не ставить одно и то же дважды.
    #[serde(skip)]
    pub url: String,
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

    fn create(&self, kind: &'static str, name: &str, album_id: i64, total: usize, url: &str, video_id: Option<String>) -> u64 {
        let id = self.seq.fetch_add(1, Ordering::Relaxed) + 1;
        let mut list = self.lock();
        // Храним только последние задачи — это журнал для интерфейса, а не история.
        while list.iter().filter(|j| j.state == "done").count() > 12 {
            match list.iter().position(|j| j.state == "done") {
                Some(pos) => {
                    list.remove(pos);
                }
                None => break,
            }
        }
        list.push(Job {
            id,
            kind,
            name: name.to_owned(),
            album_id,
            total,
            done: 0,
            failed: 0,
            current: None,
            state: "running",
            video_id,
            error: None,
            url: url.to_owned(),
        });
        id
    }

    fn get(&self, id: u64) -> Option<Job> {
        self.lock().iter().find(|j| j.id == id).cloned()
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
    let id = jobs.create("playlist", &list.title, album_id, list.entries.len(), url, None);
    let job = jobs.get(id).context("задача не создалась")?;

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

/// video_id из ссылки YouTube, если его видно без yt-dlp (watch?v=, youtu.be/, shorts/, live/).
pub fn video_id_from_url(url: &str) -> Option<String> {
    let u = reqwest::Url::parse(url).ok()?;
    let host = u.host_str()?;
    let host = host.strip_prefix("www.").unwrap_or(host);
    let host = host.strip_prefix("m.").or_else(|| host.strip_prefix("music.")).unwrap_or(host);
    let id = match host {
        "youtu.be" => u.path_segments()?.next()?.to_owned(),
        "youtube.com" | "youtube-nocookie.com" => {
            let mut seg = u.path_segments()?;
            match seg.next()? {
                "watch" => u.query_pairs().find(|(k, _)| k == "v")?.1.into_owned(),
                "shorts" | "live" | "embed" | "v" => seg.next()?.to_owned(),
                _ => return None,
            }
        }
        _ => return None,
    };
    is_valid_video_id(&id).then_some(id)
}

/// Поставить один трек в очередь загрузки. Ответ — сразу; файл появится, когда задача станет `done`.
/// Та же ссылка, уже стоящая в очереди, второй раз не скачивается.
pub fn start_track(jobs: Arc<Jobs>, db: Arc<Db>, dl: Arc<Downloader>, url: &str, title: Option<&str>) -> Job {
    let known = video_id_from_url(url);
    {
        let list = jobs.lock();
        let same = |j: &&Job| j.kind == "track" && j.state == "running" && (j.url == url || (known.is_some() && j.video_id == known));
        if let Some(j) = list.iter().find(same) {
            return j.clone();
        }
    }
    let name: String = title.map(str::trim).filter(|t| !t.is_empty()).unwrap_or("Новый трек").chars().take(120).collect();
    let id = jobs.create("track", &name, 0, 1, url, known.clone());

    // Уже в библиотеке и файл на месте — ничего не качаем.
    if let Some(vid) = known.as_deref() {
        if db.has_track(vid).unwrap_or(false) && dl.has_file(vid) {
            jobs.update(id, |j| {
                j.done = 1;
                j.state = "done";
            });
            return jobs.get(id).expect("задача только что создана");
        }
    }

    jobs.update(id, |j| j.current = Some("в очереди".into()));
    let job = jobs.get(id).expect("задача только что создана");
    let url = url.to_owned();
    tokio::spawn(async move {
        let started = {
            let jobs = jobs.clone();
            move || jobs.update(id, |j| j.current = Some("скачиваю".into()))
        };
        match dl.download_with(&url, started).await {
            Ok(vid) => {
                let title = db.track(&vid).ok().flatten().and_then(|t| t.title);
                jobs.update(id, |j| {
                    j.done = 1;
                    j.video_id = Some(vid);
                    if let Some(t) = title {
                        j.name = t;
                    }
                });
            }
            Err(e) => {
                tracing::warn!("загрузка {url}: {e:#}");
                jobs.update(id, |j| {
                    j.failed = 1;
                    j.error = Some(short_error(&format!("{e:#}")));
                });
            }
        }
        jobs.update(id, |j| {
            j.state = "done";
            j.current = None;
        });
    });
    job
}

/// Сообщение yt-dlp без служебных префиксов и не длиннее строки.
fn short_error(e: &str) -> String {
    let e = e.rsplit("ERROR: ").next().unwrap_or(e).trim();
    let e = match e.split_once("] ") {
        Some((head, tail)) if head.starts_with('[') => tail.split_once(": ").map_or(tail, |(_, msg)| msg),
        _ => e,
    };
    e.chars().take(160).collect()
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

    #[test]
    fn video_ids_from_links() {
        let id = |u: &str| video_id_from_url(u);
        assert_eq!(id("https://youtu.be/dQw4w9WgXcQ?si=abc").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(id("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(id("https://www.youtube.com/shorts/dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(id("https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(id("https://www.youtube.com/playlist?list=PL123"), None);
        assert_eq!(id("https://example.com/watch?v=dQw4w9WgXcQ"), None);
    }

    #[test]
    fn trims_ytdlp_errors() {
        assert_eq!(short_error("yt-dlp: ERROR: [youtube] abc: Video unavailable"), "Video unavailable");
        assert_eq!(short_error("сеть упала"), "сеть упала");
    }
}
