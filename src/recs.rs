//! Рекомендации: YouTube-микс («радио») по трекам из библиотеки.
//!
//! Для каждого трека-«семени» yt-dlp быстро (без скачивания, `--flat-playlist`) читает
//! плейлист `RD<id>` — это тот же микс, что YouTube показывает справа от видео.
//! Результаты нескольких семян сливаются: треки, которые встречаются в нескольких миксах,
//! идут выше. Уже скачанное в библиотеку отфильтровывается.

use std::collections::{HashMap, HashSet};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use serde::Serialize;
use serde_json::Value;
use tokio::process::Command;
use tokio::sync::Semaphore;

use crate::config::Config;
use crate::downloader::is_valid_video_id;

const CACHE_TTL: Duration = Duration::from_secs(30 * 60);
const MIX_TIMEOUT: Duration = Duration::from_secs(45);
const MIX_LEN: usize = 40;

#[derive(Debug, Clone, Serialize)]
pub struct Rec {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub duration: Option<f64>,
    pub url: String,
    pub thumb: String,
}

pub struct Recommender {
    cfg: Arc<Config>,
    cache: Mutex<HashMap<String, (Instant, Vec<Rec>)>>,
    slots: Semaphore,
}

impl Recommender {
    pub fn new(cfg: Arc<Config>) -> Self {
        Self { cfg, cache: Mutex::new(HashMap::new()), slots: Semaphore::new(2) }
    }

    fn cached(&self, seed: &str) -> Option<Vec<Rec>> {
        let cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        cache
            .get(seed)
            .filter(|(at, _)| at.elapsed() < CACHE_TTL)
            .map(|(_, v)| v.clone())
    }

    /// Микс по одному треку (из кэша, если он свежий).
    pub async fn mix(&self, seed: &str, fresh: bool) -> Result<Vec<Rec>> {
        if !fresh {
            if let Some(v) = self.cached(seed) {
                return Ok(v);
            }
        }
        let _slot = self.slots.acquire().await?;
        let url = format!("https://www.youtube.com/watch?v={seed}&list=RD{seed}");

        let mut cmd = Command::new(&self.cfg.ytdlp);
        cmd.args(["--flat-playlist", "--dump-single-json", "--yes-playlist", "--no-warnings", "--encoding", "utf-8"])
            .args(["--playlist-end", &MIX_LEN.to_string()]);
        if let Some(cookies) = &self.cfg.cookies {
            cmd.arg("--cookies").arg(cookies);
        }
        cmd.arg("--").arg(&url).stdin(Stdio::null()).kill_on_drop(true);

        let out = tokio::time::timeout(MIX_TIMEOUT, cmd.output())
            .await
            .context("YouTube не ответил вовремя")?
            .with_context(|| format!("не удалось запустить {}", self.cfg.ytdlp.display()))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            let msg = err.lines().filter(|l| l.contains("ERROR")).last().unwrap_or(err.trim());
            bail!("yt-dlp: {msg}");
        }
        let json: Value = serde_json::from_str(&String::from_utf8_lossy(&out.stdout)).context("не удалось разобрать ответ yt-dlp")?;
        let list = parse_mix(&json, seed);

        let mut cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        cache.insert(seed.to_owned(), (Instant::now(), list.clone()));
        Ok(list)
    }
}

/// Записи плейлиста → рекомендации (без самого семени и без мусорных записей).
pub fn parse_mix(json: &Value, seed: &str) -> Vec<Rec> {
    json["entries"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|e| {
            let id = e["id"].as_str().filter(|id| is_valid_video_id(id) && *id != seed)?;
            let title = e["title"].as_str().filter(|t| !t.is_empty() && !t.starts_with('['))?;
            let artist = ["artist", "channel", "uploader"]
                .iter()
                .find_map(|k| e[*k].as_str().filter(|s| !s.is_empty()))
                .map(|s| s.trim_end_matches(" - Topic").to_owned())
                .unwrap_or_default();
            Some(Rec {
                id: id.to_owned(),
                title: title.to_owned(),
                artist,
                duration: e["duration"].as_f64(),
                url: format!("https://music.youtube.com/watch?v={id}"),
                thumb: format!("https://i.ytimg.com/vi/{id}/mqdefault.jpg"),
            })
        })
        .collect()
}

/// Слить миксы нескольких семян: чаще встречающиеся — выше, порядок внутри — как у YouTube.
pub fn merge(mixes: Vec<Vec<Rec>>, exclude: &HashSet<String>, limit: usize) -> Vec<Rec> {
    let mut score: HashMap<String, (usize, usize, Rec)> = HashMap::new();
    let mut order = 0;
    for mix in mixes {
        for r in mix {
            if exclude.contains(&r.id) {
                continue;
            }
            order += 1;
            score
                .entry(r.id.clone())
                .and_modify(|e| e.0 += 1)
                .or_insert((1, order, r));
        }
    }
    let mut all: Vec<_> = score.into_values().collect();
    all.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    all.into_iter().take(limit).map(|(_, _, r)| r).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rec(id: &str) -> Rec {
        Rec { id: id.into(), title: id.into(), artist: String::new(), duration: None, url: String::new(), thumb: String::new() }
    }

    #[test]
    fn parses_flat_mix() {
        let j = json!({ "entries": [
            { "id": "seedSEEDsee", "title": "Seed" },
            { "id": "aaaaaaaaaaa", "title": "Песня", "channel": "Кино - Topic", "duration": 210.0 },
            { "id": "bbbbbbbbbbb", "title": "[Deleted video]" },
            { "id": "../bad", "title": "x" }
        ]});
        let r = parse_mix(&j, "seedSEEDsee");
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].artist, "Кино");
        assert_eq!(r[0].duration, Some(210.0));
        assert!(r[0].thumb.contains("aaaaaaaaaaa"));
    }

    #[test]
    fn merge_ranks_repeats_and_excludes_library() {
        let lib: HashSet<String> = ["c".to_string()].into();
        let out = merge(vec![vec![rec("a"), rec("b"), rec("c")], vec![rec("b"), rec("d")]], &lib, 10);
        let ids: Vec<_> = out.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, ["b", "a", "d"]);
    }
}
