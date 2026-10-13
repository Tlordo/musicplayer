use std::sync::Arc;

use anyhow::{bail, Context};
use serde::Serialize;
use tokio::sync::broadcast;

use crate::config::Config;
use crate::db::{Db, Track};
use crate::jobs::{Job, JobQueue};
use crate::util::is_valid_id;
use crate::ytdlp;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LibraryAction {
    Added,
    Updated,
    Deleted,
}

/// События, которые получают клиенты через `/api/events` (Server-Sent Events).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    Job(Job),
    JobsCleared {
        ids: Vec<u64>,
    },
    Library {
        video_id: String,
        action: LibraryAction,
    },
    Playlists,
}

pub struct AppState {
    pub cfg: Config,
    pub db: Db,
    pub http: reqwest::Client,
    pub jobs: JobQueue,
    events: broadcast::Sender<Event>,
}

impl AppState {
    pub fn new(cfg: Config, db: Db) -> anyhow::Result<Arc<Self>> {
        let http = reqwest::Client::builder()
            .user_agent(concat!("musicplayer/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(30))
            .build()?;
        let (events, _) = broadcast::channel(256);
        let jobs = JobQueue::new(cfg.parallel);
        Ok(Arc::new(Self {
            cfg,
            db,
            http,
            jobs,
            events,
        }))
    }

    pub fn emit(&self, e: Event) {
        // Ошибка означает лишь отсутствие подписчиков.
        let _ = self.events.send(e);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.events.subscribe()
    }

    /// Скачивает обложку трека в `Info/{id}.jpg`.
    pub async fn fetch_cover(&self, id: &str, url: &str) -> anyhow::Result<()> {
        let resp = self.http.get(url).send().await?.error_for_status()?;
        let bytes = resp.bytes().await?;
        if bytes.is_empty() {
            bail!("пустой ответ");
        }
        let path = ytdlp::cover_path(&self.cfg, id);
        let tmp = path.with_extension("jpg.part");
        tokio::fs::write(&tmp, &bytes).await?;
        tokio::fs::rename(&tmp, &path).await?;
        Ok(())
    }

    /// Резервная копия метаданных рядом с файлами: по ней библиотека
    /// восстанавливается, даже если база данных потеряна.
    pub async fn write_sidecar(&self, t: &Track) {
        let path = ytdlp::sidecar_path(&self.cfg, &t.video_id);
        match serde_json::to_vec_pretty(t) {
            Ok(json) => {
                if let Err(e) = tokio::fs::write(&path, json).await {
                    tracing::warn!("не удалось записать {}: {e}", path.display());
                }
            }
            Err(e) => tracing::warn!("сериализация {}: {e}", t.video_id),
        }
    }

    /// Возвращает в базу треки, для которых есть `*.track.json`, но нет записи.
    pub async fn import_sidecars(&self) -> anyhow::Result<usize> {
        let dir = self.cfg.info_dir();
        let mut rd = tokio::fs::read_dir(&dir)
            .await
            .with_context(|| format!("чтение {}", dir.display()))?;
        let mut n = 0;
        while let Some(entry) = rd.next_entry().await? {
            let name = entry.file_name();
            let Some(id) = name.to_str().and_then(|n| n.strip_suffix(".track.json")) else {
                continue;
            };
            if !is_valid_id(id) || self.db.track(id).await?.is_some() {
                continue;
            }
            let parsed = tokio::fs::read(entry.path())
                .await
                .ok()
                .and_then(|b| serde_json::from_slice::<Track>(&b).ok())
                .filter(|t| t.video_id == id);
            if let Some(t) = parsed {
                self.db.upsert_track(t).await?;
                n += 1;
            }
        }
        Ok(n)
    }
}
