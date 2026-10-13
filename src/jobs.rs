//! Очередь загрузок с ограничением параллелизма, прогрессом и отменой.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::Context;
use serde::Serialize;
use tokio::sync::{Notify, Semaphore};

use crate::state::{AppState, Event, LibraryAction};
use crate::util::{now_unix, youtube_id_from_url};
use crate::{waveform, ytdlp};

/// Сколько завершённых задач хранить в списке.
const KEEP_FINISHED: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Resolving,
    Downloading,
    Processing,
    Done,
    Failed,
    Cancelled,
}

impl JobStatus {
    pub fn is_finished(self) -> bool {
        matches!(self, Self::Done | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Job {
    pub id: u64,
    pub url: String,
    pub restore: bool,
    pub status: JobStatus,
    pub progress: f32,
    pub video_id: Option<String>,
    pub title: Option<String>,
    pub message: Option<String>,
    pub created_at: i64,
}

struct Entry {
    job: Job,
    cancel: Arc<Notify>,
}

pub struct JobQueue {
    next_id: AtomicU64,
    jobs: Mutex<BTreeMap<u64, Entry>>,
    permits: Semaphore,
}

impl JobQueue {
    pub fn new(parallel: usize) -> Self {
        Self {
            next_id: AtomicU64::new(1),
            jobs: Mutex::new(BTreeMap::new()),
            permits: Semaphore::new(parallel),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, BTreeMap<u64, Entry>> {
        self.jobs.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn list(&self) -> Vec<Job> {
        self.lock().values().rev().map(|e| e.job.clone()).collect()
    }

    pub fn get(&self, id: u64) -> Option<Job> {
        self.lock().get(&id).map(|e| e.job.clone())
    }

    fn active_for(&self, video_id: &str) -> Option<Job> {
        self.lock()
            .values()
            .find(|e| !e.job.status.is_finished() && e.job.video_id.as_deref() == Some(video_id))
            .map(|e| e.job.clone())
    }

    /// Отменяет задачу. Возвращает `false`, если задача не найдена или уже завершена.
    pub fn cancel(&self, id: u64) -> bool {
        match self.lock().get(&id) {
            Some(e) if !e.job.status.is_finished() => {
                e.cancel.notify_one();
                true
            }
            _ => false,
        }
    }

    /// Удаляет завершённые задачи из списка.
    pub fn clear_finished(&self) -> Vec<u64> {
        let mut jobs = self.lock();
        let ids: Vec<u64> = jobs
            .iter()
            .filter(|(_, e)| e.job.status.is_finished())
            .map(|(id, _)| *id)
            .collect();
        for id in &ids {
            jobs.remove(id);
        }
        ids
    }

    fn update(&self, state: &AppState, id: u64, f: impl FnOnce(&mut Job)) {
        let job = {
            let mut jobs = self.lock();
            let Some(e) = jobs.get_mut(&id) else { return };
            f(&mut e.job);
            e.job.clone()
        };
        state.emit(Event::Job(job));
    }

    fn trim(&self) {
        let mut jobs = self.lock();
        let finished: Vec<u64> = jobs
            .iter()
            .filter(|(_, e)| e.job.status.is_finished())
            .map(|(id, _)| *id)
            .collect();
        for id in finished
            .iter()
            .take(finished.len().saturating_sub(KEEP_FINISHED))
        {
            jobs.remove(id);
        }
    }
}

/// Ставит ссылку в очередь. Если тот же трек уже скачивается — возвращает существующую задачу.
pub fn enqueue(state: &Arc<AppState>, url: String, restore: bool) -> Job {
    let video_id = youtube_id_from_url(&url);
    if let Some(existing) = video_id.as_deref().and_then(|v| state.jobs.active_for(v)) {
        return existing;
    }
    let queue = &state.jobs;
    let id = queue.next_id.fetch_add(1, Ordering::Relaxed);
    let job = Job {
        id,
        url,
        restore,
        status: JobStatus::Queued,
        progress: 0.0,
        video_id,
        title: None,
        message: None,
        created_at: now_unix(),
    };
    let cancel = Arc::new(Notify::new());
    queue.lock().insert(
        id,
        Entry {
            job: job.clone(),
            cancel: cancel.clone(),
        },
    );
    queue.trim();
    state.emit(Event::Job(job.clone()));

    let state = state.clone();
    tokio::spawn(async move {
        let _permit = tokio::select! {
            p = state.jobs.permits.acquire() => p.expect("semaphore is never closed"),
            _ = cancel.notified() => {
                state.jobs.update(&state, id, |j| j.status = JobStatus::Cancelled);
                return;
            }
        };
        // Прерывание future убивает дочерний процесс yt-dlp (kill_on_drop).
        let result = tokio::select! {
            r = run(&state, id) => r.map(Some),
            _ = cancel.notified() => Ok(None),
        };
        match result {
            Ok(Some(message)) => state.jobs.update(&state, id, |j| {
                j.status = JobStatus::Done;
                j.progress = 1.0;
                j.message = message;
            }),
            Ok(None) => {
                state
                    .jobs
                    .update(&state, id, |j| j.status = JobStatus::Cancelled);
            }
            Err(e) => {
                tracing::warn!("задача {id} завершилась ошибкой: {e:#}");
                state.jobs.update(&state, id, |j| {
                    j.status = JobStatus::Failed;
                    j.message = Some(format!("{e:#}"));
                });
            }
        }
    });
    job
}

/// Выполняет задачу. Возвращает необязательное итоговое сообщение.
async fn run(state: &Arc<AppState>, id: u64) -> anyhow::Result<Option<String>> {
    let cfg = &state.cfg;
    let queue = &state.jobs;
    let (url, restore) = queue
        .get(id)
        .map(|j| (j.url, j.restore))
        .context("задача удалена")?;
    queue.update(state, id, |j| j.status = JobStatus::Resolving);

    let info = match ytdlp::resolve(cfg, &url).await? {
        ytdlp::Resolved::Playlist { title, urls } => {
            let n = urls.len();
            queue.update(state, id, |j| j.title = Some(title.clone()));
            for u in urls {
                enqueue(state, u, false);
            }
            return Ok(Some(format!(
                "Плейлист «{title}»: в очередь добавлено треков — {n}"
            )));
        }
        ytdlp::Resolved::Single(info) => info,
    };

    let mut track = ytdlp::track_from_info(&info, &url)?;
    let vid = track.video_id.clone();
    let audio = ytdlp::audio_path(cfg, &vid);
    queue.update(state, id, |j| {
        j.video_id = Some(vid.clone());
        j.title = Some(format!("{} — {}", track.artist, track.title));
    });
    if let Some(other) = state.jobs.active_for(&vid).filter(|j| j.id < id) {
        return Ok(Some(format!("Трек уже загружается (задача #{})", other.id)));
    }
    if !restore && audio.exists() && state.db.track(&vid).await?.is_some() {
        return Ok(Some("Трек уже есть в библиотеке".into()));
    }

    // Сохраняем info-JSON, чтобы yt-dlp не запрашивал метаданные повторно.
    let info_json = cfg.info_dir().join(format!("{vid}.info.json"));
    tokio::fs::write(&info_json, serde_json::to_vec(&info)?).await?;
    queue.update(state, id, |j| j.status = JobStatus::Downloading);
    let mut last = -1.0f32;
    let downloaded = ytdlp::download_audio(cfg, &info_json, |p| match p {
        ytdlp::Progress::Downloading(f) if f - last >= 0.01 || f >= 1.0 => {
            last = f;
            queue.update(state, id, |j| j.progress = f);
        }
        ytdlp::Progress::Processing => queue.update(state, id, |j| {
            if j.status != JobStatus::Processing {
                j.status = JobStatus::Processing;
                j.progress = 1.0;
            }
        }),
        _ => {}
    })
    .await;
    let _ = tokio::fs::remove_file(&info_json).await;
    downloaded?;
    if !audio.exists() {
        anyhow::bail!("yt-dlp завершился, но файл {} не найден", audio.display());
    }
    queue.update(state, id, |j| j.status = JobStatus::Processing);

    track.filesize = tokio::fs::metadata(&audio)
        .await
        .ok()
        .map(|m| m.len() as i64);
    if let Some(thumb) = track.thumbnail_url.clone() {
        if let Err(e) = state.fetch_cover(&vid, &thumb).await {
            tracing::warn!("не удалось скачать обложку {vid}: {e:#}");
        }
    }
    let existed = state.db.track(&vid).await?.is_some();
    state.db.upsert_track(track.clone()).await?;
    if let Some(saved) = state.db.track(&vid).await? {
        state.write_sidecar(&saved).await;
    }
    match waveform::compute(&cfg.ffmpeg(), &audio).await {
        Ok(peaks) => state.db.set_waveform(&vid, peaks).await?,
        Err(e) => tracing::warn!("волновая форма для {vid}: {e:#}"),
    }
    state.emit(Event::Library {
        video_id: vid,
        action: if existed {
            LibraryAction::Updated
        } else {
            LibraryAction::Added
        },
    });
    Ok(restore.then(|| "Файл восстановлен".to_owned()))
}

/// Ставит в очередь восстановление пропавших аудиофайлов.
pub async fn restore(state: &Arc<AppState>, video_id: &str) -> anyhow::Result<Option<Job>> {
    if let Some(job) = state.jobs.active_for(video_id) {
        return Ok(Some(job));
    }
    let Some(track) = state.db.track(video_id).await? else {
        return Ok(None);
    };
    let url = track
        .original_url
        .unwrap_or_else(|| format!("https://music.youtube.com/watch?v={video_id}"));
    let job = enqueue(state, url, true);
    // Для ссылок не с YouTube ID заранее неизвестен — помечаем задачу, чтобы не плодить дубликаты.
    if job.video_id.is_none() {
        state
            .jobs
            .update(state, job.id, |j| j.video_id = Some(video_id.to_owned()));
    }
    Ok(state.jobs.get(job.id))
}
