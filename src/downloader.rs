use std::collections::HashSet;
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use anyhow::{bail, Context, Result};
use serde_json::Value;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::Semaphore;

use crate::config::Config;
use crate::db::{Db, TechData, UserData};

pub struct Downloader {
    cfg: Arc<Config>,
    db: Arc<Db>,
    http: reqwest::Client,
    slots: Semaphore,
    /// video_id треков, которые прямо сейчас восстанавливаются.
    restoring: Mutex<HashSet<String>>,
}

impl Downloader {
    pub fn new(cfg: Arc<Config>, db: Arc<Db>) -> Self {
        Self {
            slots: Semaphore::new(cfg.max_parallel_downloads),
            http: reqwest::Client::builder()
                .user_agent("Mozilla/5.0 music-player")
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("не удалось создать HTTP-клиент"),
            restoring: Mutex::new(HashSet::new()),
            cfg,
            db,
        }
    }

    /// Скачивает трек, сохраняет обложку, метаданные и запись в БД. Возвращает video_id.
    pub async fn download(&self, url: &str) -> Result<String> {
        let _slot = self.slots.acquire().await?;
        let info = self.run_ytdlp(url).await?;

        let video_id = info["id"]
            .as_str()
            .filter(|id| is_valid_video_id(id))
            .context("yt-dlp не вернул корректный id видео")?
            .to_owned();

        if !self.cfg.audio_path(&video_id).is_file() {
            bail!("yt-dlp завершился, но файл {video_id}.opus не появился");
        }
        tracing::info!("аудио сохранено: {video_id}.opus");
        // Файл новый — старая форма волны (если была) больше не соответствует ему.
        let _ = tokio::fs::remove_file(self.cfg.peaks_path(&video_id)).await;

        let tech = tech_data(&info);
        let user = user_data(&info);

        let mut user = user;
        let mut saved = false;
        for url in thumbnail_candidates(&info) {
            match self.fetch_to_file(&url, &self.cfg.thumb_path(&video_id)).await {
                Ok(()) => {
                    user.thumbnail_url = url;
                    saved = true;
                    break;
                }
                Err(e) => tracing::debug!("обложка {url}: {e:#}"),
            }
        }
        if !saved {
            tracing::warn!("не удалось скачать обложку {video_id}");
        }

        let json_file = format!("{} [{video_id}]_user_info.json", sanitize_file_name(&user.title));
        tokio::fs::write(
            self.cfg.info_dir.join(&json_file),
            serde_json::to_vec_pretty(&user)?,
        )
        .await?;

        self.db.upsert(&video_id, &tech, &user, &json_file, url)?;
        tracing::info!("[БД] запись для {video_id} обновлена");
        Ok(video_id)
    }

    /// Запускает фоновое восстановление удалённого аудиофайла (не чаще одного на трек).
    pub fn restore(self: &Arc<Self>, video_id: String, url: String) {
        if !self.lock_restoring().insert(video_id.clone()) {
            return;
        }
        let this = Arc::clone(self);
        tokio::spawn(async move {
            tracing::info!("восстановление трека {video_id}...");
            match this.download(&url).await {
                Ok(_) => tracing::info!("трек {video_id} восстановлен"),
                Err(e) => tracing::error!("ошибка восстановления {video_id}: {e:#}"),
            }
            this.lock_restoring().remove(&video_id);
        });
    }

    fn lock_restoring(&self) -> std::sync::MutexGuard<'_, HashSet<String>> {
        self.restoring.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Один вызов yt-dlp: и метаданные (JSON в stdout), и скачивание с конвертацией в opus.
    async fn run_ytdlp(&self, url: &str) -> Result<Value> {
        let mut cmd = Command::new(&self.cfg.ytdlp);
        cmd.args(["--dump-json", "--no-simulate", "--no-playlist", "--no-warnings", "--no-progress", "--encoding", "utf-8"])
            .args(["-f", "bestaudio/best", "-x", "--audio-format", "opus", "--audio-quality", "0"])
            .args(["--embed-metadata", "--embed-thumbnail"])
            .arg("-P")
            .arg(&self.cfg.music_dir)
            .args(["-o", "%(id)s.%(ext)s"]);
        if let Some(ffmpeg) = &self.cfg.ffmpeg {
            cmd.arg("--ffmpeg-location").arg(ffmpeg);
        }
        if let Some(cookies) = &self.cfg.cookies {
            cmd.arg("--cookies").arg(cookies);
        }
        // "--" защищает от URL, начинающихся с "-", которые yt-dlp принял бы за опции.
        cmd.arg("--").arg(url);
        cmd.stdin(Stdio::null()).kill_on_drop(true);

        tracing::info!("yt-dlp: скачиваю {url}");
        let out = cmd
            .output()
            .await
            .with_context(|| format!("не удалось запустить {}", self.cfg.ytdlp.display()))?;

        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let msg = stderr
                .lines()
                .filter(|l| l.contains("ERROR"))
                .last()
                .unwrap_or_else(|| stderr.trim());
            bail!("yt-dlp: {msg}");
        }

        let stdout = String::from_utf8_lossy(&out.stdout);
        let line = stdout
            .lines()
            .find(|l| l.trim_start().starts_with('{'))
            .context("yt-dlp не вернул метаданные")?;
        Ok(serde_json::from_str(line).context("не удалось разобрать JSON от yt-dlp")?)
    }

    /// Скачивает файл по URL атомарно: сначала во временный файл, затем rename.
    pub async fn fetch_to_file(&self, url: &str, dest: &std::path::Path) -> Result<()> {
        let mut resp = self.http.get(url).send().await?.error_for_status()?;
        let tmp = dest.with_extension("part");
        let mut file = tokio::fs::File::create(&tmp).await?;
        while let Some(chunk) = resp.chunk().await? {
            file.write_all(&chunk).await?;
        }
        file.flush().await?;
        drop(file);
        tokio::fs::rename(&tmp, dest).await?;
        Ok(())
    }
}

/// ID YouTube: только латиница, цифры, "-" и "_". Защищает от path traversal.
pub fn is_valid_video_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn tech_data(info: &Value) -> TechData {
    let best = info["formats"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|f| f["vcodec"].as_str() == Some("none") && f["abr"].as_f64().is_some())
        .max_by(|a, b| a["abr"].as_f64().partial_cmp(&b["abr"].as_f64()).unwrap())
        .unwrap_or(info);

    let size = best["filesize"].as_f64().or_else(|| best["filesize_approx"].as_f64());
    TechData {
        format_id: str_field(best, "format_id"),
        extension: str_field(best, "ext"),
        audio_codec: str_field(best, "acodec"),
        abr: best["abr"].as_f64(),
        filesize_mb: size.map(|s| (s / (1024.0 * 1024.0) * 100.0).round() / 100.0),
        direct_url: str_field(best, "url"),
    }
}

fn user_data(info: &Value) -> UserData {
    let or = |key: &str, default: &str| str_field(info, key).unwrap_or_else(|| default.to_owned());
    // У треков YouTube Music есть настоящие поля «трек» и «исполнитель»; у обычных видео —
    // только «Исполнитель - Песня (Official Video)» от канала, их чистим.
    let (title, artist) = match (str_field(info, "track"), str_field(info, "artist")) {
        (Some(track), Some(artist)) => (track, artist.split(", ").next().unwrap_or(&artist).to_owned()),
        _ => {
            let channel = str_field(info, "artist")
                .or_else(|| str_field(info, "channel"))
                .or_else(|| str_field(info, "uploader"))
                .map(|c| crate::names::clean_artist(&c))
                .unwrap_or_default();
            let (t, a) = crate::names::clean_title(&or("title", "Unknown"), &channel);
            (t, if a.is_empty() { "Unknown".into() } else { a })
        }
    };
    UserData {
        title,
        artist,
        album: or("album", "Single"),
        track: or("track", "Unknown"),
        release_date: str_field(info, "upload_date")
            .as_deref()
            .and_then(format_date)
            .unwrap_or_else(|| "Unknown".into()),
        duration: str_field(info, "duration_string"),
        view_count: info["view_count"].as_i64(),
        like_count: info["like_count"].as_i64(),
        thumbnail_url: best_thumbnail(info).unwrap_or_default(),
    }
}

/// Самая крупная обложка, по возможности не webp (сохраняем как .jpg).
fn best_thumbnail(info: &Value) -> Option<String> {
    thumbnail_candidates(info).into_iter().next()
}

/// Обложки от лучшей к худшей. yt-dlp перечисляет и те, которых на деле нет
/// (maxresdefault у старых видео), поэтому пробуем по очереди; hqdefault есть всегда.
fn thumbnail_candidates(info: &Value) -> Vec<String> {
    let thumbs: Vec<&str> = info["thumbnails"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|t| t["url"].as_str())
        .collect();
    let mut out: Vec<String> = thumbs
        .iter()
        .rev()
        .filter(|u| !u.contains(".webp") && !u.contains("/vi_webp/"))
        .take(3)
        .map(|s| s.to_string())
        .collect();
    if let Some(t) = str_field(info, "thumbnail") {
        out.push(t);
    }
    if let Some(id) = info["id"].as_str() {
        out.push(fallback_thumbnail(id));
    }
    if let Some(last) = thumbs.last() {
        out.push(last.to_string());
    }
    let mut seen = HashSet::new();
    out.retain(|u| seen.insert(u.clone()));
    out
}

/// Обложка, которая есть у любого видео YouTube.
pub fn fallback_thumbnail(id: &str) -> String {
    format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg")
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v[key].as_str().filter(|s| !s.is_empty()).map(str::to_owned)
}

/// "20240131" -> "31.01.2024"
fn format_date(d: &str) -> Option<String> {
    (d.len() == 8 && d.bytes().all(|b| b.is_ascii_digit()))
        .then(|| format!("{}.{}.{}", &d[6..8], &d[4..6], &d[0..4]))
}

fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if r#"\/:*?"<>|"#.contains(c) || c.is_control() { ' ' } else { c })
        .take(100)
        .collect();
    // Windows не допускает точки и пробелы в конце имени.
    let trimmed = cleaned.trim().trim_end_matches(['.', ' ']);
    if trimmed.is_empty() { "track".into() } else { trimmed.into() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn video_id_validation() {
        assert!(is_valid_video_id("dQw4w9WgXcQ"));
        assert!(!is_valid_video_id("../database"));
        assert!(!is_valid_video_id(""));
    }

    #[test]
    fn dates_and_names() {
        assert_eq!(format_date("20240131").as_deref(), Some("31.01.2024"));
        assert_eq!(format_date("2024"), None);
        assert_eq!(sanitize_file_name("a/b:c?. "), "a b c");
        assert_eq!(sanitize_file_name("???"), "track");
    }

    #[test]
    fn picks_best_audio_format() {
        let info = json!({
            "formats": [
                {"format_id": "140", "vcodec": "none", "abr": 129.5, "ext": "m4a", "filesize": 2097152},
                {"format_id": "251", "vcodec": "none", "abr": 160.1, "ext": "webm", "acodec": "opus"},
                {"format_id": "18", "vcodec": "avc1", "abr": 400.0}
            ]
        });
        let t = tech_data(&info);
        assert_eq!(t.format_id.as_deref(), Some("251"));
        let info = json!({"formats": [{"format_id": "140", "vcodec": "none", "abr": 1.0, "filesize": 2097152}]});
        assert_eq!(tech_data(&info).filesize_mb, Some(2.0));
    }

    #[test]
    fn prefers_jpg_thumbnail() {
        let info = json!({"thumbnails": [
            {"url": "https://i.ytimg.com/vi/x/hq.jpg"},
            {"url": "https://i.ytimg.com/vi_webp/x/max.webp"}
        ]});
        assert_eq!(best_thumbnail(&info).as_deref(), Some("https://i.ytimg.com/vi/x/hq.jpg"));
    }
}
