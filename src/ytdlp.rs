//! Обёртка над yt-dlp: получение метаданных и скачивание аудио.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use anyhow::{anyhow, bail, Context};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::config::Config;
use crate::db::Track;
use crate::util::{is_valid_id, now_unix};

/// Результат разбора ссылки.
pub enum Resolved {
    Single(Box<Value>),
    Playlist { title: String, urls: Vec<String> },
}

/// Этапы скачивания, о которых сообщает yt-dlp.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Progress {
    Downloading(f32),
    Processing,
}

fn base_command(cfg: &Config) -> Command {
    let mut cmd = Command::new(&cfg.ytdlp);
    cmd.arg("--no-warnings")
        .arg("--ffmpeg-location")
        .arg(cfg.ffmpeg());
    if let Some(cookies) = &cfg.cookies {
        cmd.arg("--cookies").arg(cookies);
    }
    cmd.stdin(Stdio::null()).kill_on_drop(true);
    cmd
}

fn spawn_error(cfg: &Config, e: std::io::Error) -> anyhow::Error {
    if e.kind() == std::io::ErrorKind::NotFound {
        anyhow!(
            "yt-dlp не найден ({}). Установите его или укажите путь через --ytdlp",
            cfg.ytdlp.display()
        )
    } else {
        anyhow!("не удалось запустить yt-dlp: {e}")
    }
}

/// Последняя строка `ERROR:` из вывода yt-dlp — самое информативное сообщение.
fn ytdlp_error(stderr: &str) -> anyhow::Error {
    let line = stderr
        .lines()
        .rev()
        .find(|l| l.starts_with("ERROR:"))
        .or_else(|| stderr.lines().rev().find(|l| !l.trim().is_empty()))
        .unwrap_or("yt-dlp завершился с ошибкой");
    anyhow!("{}", line.trim_start_matches("ERROR:").trim())
}

pub async fn resolve(cfg: &Config, url: &str) -> anyhow::Result<Resolved> {
    let out = base_command(cfg)
        .args(["-J", "--flat-playlist", "--no-playlist", "--", url])
        .output()
        .await
        .map_err(|e| spawn_error(cfg, e))?;
    if !out.status.success() {
        return Err(ytdlp_error(&String::from_utf8_lossy(&out.stderr)));
    }
    let info: Value =
        serde_json::from_slice(&out.stdout).context("yt-dlp вернул некорректный JSON")?;
    if info["_type"] == "playlist" {
        let title = info["title"].as_str().unwrap_or("Плейлист").to_owned();
        let urls = info["entries"]
            .as_array()
            .map(|entries| entries.iter().filter_map(entry_url).collect())
            .unwrap_or_default();
        return Ok(Resolved::Playlist { title, urls });
    }
    Ok(Resolved::Single(Box::new(info)))
}

fn entry_url(e: &Value) -> Option<String> {
    if let Some(u) = e["url"].as_str().filter(|u| u.starts_with("http")) {
        return Some(u.to_owned());
    }
    let id = e["id"].as_str()?;
    is_valid_id(id).then(|| format!("https://www.youtube.com/watch?v={id}"))
}

/// Скачивает аудио по уже полученному info-JSON (без повторного запроса метаданных).
pub async fn download_audio(
    cfg: &Config,
    info_json: &Path,
    mut on_progress: impl FnMut(Progress),
) -> anyhow::Result<()> {
    let mut child = base_command(cfg)
        .arg("--load-info-json")
        .arg(info_json)
        .args(["-f", "bestaudio/best", "-x", "--audio-format", "opus", "--audio-quality", "0"])
        .args(["--embed-metadata", "--embed-thumbnail", "--newline", "--no-part"])
        .args(["--progress-template", "download:@@%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s"])
        .arg("-P")
        .arg(cfg.music_dir())
        .args(["-o", "%(id)s.%(ext)s"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| spawn_error(cfg, e))?;

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut tail = String::new();
        while let Ok(Some(l)) = lines.next_line().await {
            tracing::debug!(target: "yt-dlp", "{l}");
            tail.push_str(&l);
            tail.push('\n');
            if tail.len() > 16 * 1024 {
                tail.drain(..tail.len() - 8 * 1024);
            }
        }
        tail
    });

    let mut lines = BufReader::new(stdout).lines();
    while let Some(line) = lines.next_line().await? {
        if let Some(p) = parse_progress_line(&line) {
            on_progress(p);
        } else {
            tracing::debug!(target: "yt-dlp", "{line}");
        }
    }
    let status = child.wait().await?;
    let stderr = stderr_task.await.unwrap_or_default();
    if !status.success() {
        return Err(ytdlp_error(&stderr));
    }
    Ok(())
}

fn parse_progress_line(line: &str) -> Option<Progress> {
    if let Some(rest) = line.strip_prefix("@@") {
        let mut it = rest.split('|').map(|s| s.trim().parse::<f64>().ok());
        let done = it.next()??;
        let total = it.next().flatten().or(it.next().flatten())?;
        if total <= 0.0 {
            return None;
        }
        return Some(Progress::Downloading((done / total).clamp(0.0, 1.0) as f32));
    }
    const POST: [&str; 4] = [
        "[ExtractAudio]",
        "[EmbedThumbnail]",
        "[Metadata]",
        "[ThumbnailsConvertor]",
    ];
    POST.iter()
        .any(|p| line.starts_with(p))
        .then_some(Progress::Processing)
}

/// Собирает запись медиатеки из info-JSON yt-dlp.
pub fn track_from_info(info: &Value, original_url: &str) -> anyhow::Result<Track> {
    let id = info["id"]
        .as_str()
        .ok_or_else(|| anyhow!("в ответе yt-dlp нет id"))?;
    if !is_valid_id(id) {
        bail!("неподдерживаемый идентификатор трека: {id}");
    }
    let s = |k: &str| {
        info[k]
            .as_str()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_owned)
    };
    let best = best_audio_format(info);
    let f = |k: &str| best.and_then(|b| b[k].as_str()).map(str::to_owned);

    let release_date = s("release_date")
        .or_else(|| s("upload_date"))
        .and_then(|d| {
            (d.len() == 8 && d.bytes().all(|b| b.is_ascii_digit()))
                .then(|| format!("{}-{}-{}", &d[..4], &d[4..6], &d[6..]))
        });
    let artist = s("artist")
        .or_else(|| s("creator"))
        .or_else(|| s("uploader"))
        .or_else(|| s("channel"))
        .map(|a| a.trim_end_matches(" - Topic").to_owned())
        .unwrap_or_else(|| "Unknown".into());

    Ok(Track {
        video_id: id.to_owned(),
        title: s("track")
            .or_else(|| s("title"))
            .unwrap_or_else(|| id.to_owned()),
        artist,
        album: s("album").unwrap_or_else(|| "Single".into()),
        track: s("track"),
        release_date,
        duration: info["duration"].as_f64().unwrap_or(0.0),
        view_count: info["view_count"].as_i64(),
        like_count: info["like_count"].as_i64(),
        thumbnail_url: best_thumbnail(info),
        original_url: Some(s("webpage_url").unwrap_or_else(|| original_url.to_owned())),
        format_id: f("format_id"),
        extension: Some("opus".into()),
        audio_codec: f("acodec"),
        abr: best.and_then(|b| b["abr"].as_f64()),
        filesize: None,
        added_at: now_unix(),
        ..Default::default()
    })
}

fn best_audio_format(info: &Value) -> Option<&Value> {
    info["formats"]
        .as_array()?
        .iter()
        .filter(|f| f["vcodec"] == "none" && f["abr"].as_f64().is_some())
        .max_by(|a, b| {
            a["abr"]
                .as_f64()
                .partial_cmp(&b["abr"].as_f64())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
}

/// Самая большая обложка; JPEG предпочтительнее WebP — так её поймёт любой клиент.
fn best_thumbnail(info: &Value) -> Option<String> {
    let thumbs = info["thumbnails"].as_array();
    let pick = |want_jpg: bool| {
        thumbs?
            .iter()
            .filter(|t| {
                t["url"]
                    .as_str()
                    .is_some_and(|u| !want_jpg || u.contains(".jpg"))
            })
            .max_by_key(|t| {
                let area = t["width"].as_i64().unwrap_or(0) * t["height"].as_i64().unwrap_or(0);
                (t["preference"].as_i64().unwrap_or(i64::MIN), area)
            })
            .and_then(|t| t["url"].as_str())
            .map(str::to_owned)
    };
    pick(true)
        .or_else(|| pick(false))
        .or_else(|| info["thumbnail"].as_str().map(str::to_owned))
}

pub fn audio_path(cfg: &Config, id: &str) -> PathBuf {
    cfg.music_dir().join(format!("{id}.opus"))
}

pub fn cover_path(cfg: &Config, id: &str) -> PathBuf {
    cfg.info_dir().join(format!("{id}.jpg"))
}

pub fn sidecar_path(cfg: &Config, id: &str) -> PathBuf {
    cfg.info_dir().join(format!("{id}.track.json"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn progress_lines() {
        assert_eq!(
            parse_progress_line("@@50|100|NA"),
            Some(Progress::Downloading(0.5))
        );
        assert_eq!(
            parse_progress_line("@@25|NA|50"),
            Some(Progress::Downloading(0.5))
        );
        assert_eq!(parse_progress_line("@@25|NA|NA"), None);
        assert_eq!(
            parse_progress_line("[ExtractAudio] Destination: x.opus"),
            Some(Progress::Processing)
        );
        assert_eq!(
            parse_progress_line("[youtube] abc: Downloading webpage"),
            None
        );
    }

    #[test]
    fn builds_track() {
        let info = json!({
            "id": "dQw4w9WgXcQ",
            "title": "Rick Astley - Never Gonna Give You Up",
            "track": "Never Gonna Give You Up",
            "uploader": "Rick Astley - Topic",
            "upload_date": "20091025",
            "duration": 212.0,
            "webpage_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "formats": [
                {"format_id": "140", "vcodec": "none", "acodec": "mp4a", "abr": 129.5},
                {"format_id": "251", "vcodec": "none", "acodec": "opus", "abr": 135.2},
                {"format_id": "18", "vcodec": "avc1", "acodec": "mp4a", "abr": 96.0}
            ],
            "thumbnails": [
                {"url": "https://i.ytimg.com/a.webp", "preference": 0, "width": 1920, "height": 1080},
                {"url": "https://i.ytimg.com/b.jpg", "preference": -1, "width": 1280, "height": 720},
                {"url": "https://i.ytimg.com/c.jpg", "preference": -5, "width": 120, "height": 90}
            ]
        });
        let t = track_from_info(&info, "https://youtu.be/dQw4w9WgXcQ").unwrap();
        assert_eq!(t.title, "Never Gonna Give You Up");
        assert_eq!(t.artist, "Rick Astley");
        assert_eq!(t.album, "Single");
        assert_eq!(t.release_date.as_deref(), Some("2009-10-25"));
        assert_eq!(t.format_id.as_deref(), Some("251"));
        assert_eq!(
            t.thumbnail_url.as_deref(),
            Some("https://i.ytimg.com/b.jpg")
        );
    }

    #[test]
    fn rejects_unsafe_ids() {
        assert!(track_from_info(&json!({"id": "../../x"}), "u").is_err());
    }

    #[test]
    fn playlist_entries() {
        assert_eq!(
            entry_url(&json!({"id": "abc", "url": "abc"})).as_deref(),
            Some("https://www.youtube.com/watch?v=abc")
        );
        assert_eq!(
            entry_url(&json!({"url": "https://x.y/z"})).as_deref(),
            Some("https://x.y/z")
        );
    }
}
