use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, Query, Request, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use tower::ServiceExt;
use tower_http::services::ServeFile;

use crate::config::Config;
use crate::db::Db;
use crate::downloader::{is_valid_video_id, Downloader};
use crate::recs::{merge, Recommender};

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<Config>,
    pub db: Arc<Db>,
    pub dl: Arc<Downloader>,
    pub recs: Arc<Recommender>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/add", post(add_track))
        .route("/api/library", get(library))
        .route("/api/stream/:video_id", get(stream))
        .route("/api/thumbnail/:video_id", get(thumbnail))
        .route("/api/peaks/:video_id", get(peaks))
        .route("/api/recommendations", get(recommendations))
        .route("/api/track/:video_id", delete(delete_track))
        .with_state(state)
}

/// Ошибка API: отдаётся клиенту как `{ "error": "..." }`.
pub struct ApiError(StatusCode, String);

impl ApiError {
    fn new(code: StatusCode, msg: impl Into<String>) -> Self {
        Self(code, msg.into())
    }
}

impl<E: Into<anyhow::Error>> From<E> for ApiError {
    fn from(e: E) -> Self {
        let e = e.into();
        tracing::error!("{e:#}");
        Self(StatusCode::INTERNAL_SERVER_ERROR, format!("{e:#}"))
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

type ApiResult<T> = Result<T, ApiError>;

fn check_id(id: &str) -> ApiResult<()> {
    if is_valid_video_id(id) {
        Ok(())
    } else {
        Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid video id"))
    }
}

/// Отдаёт файл с поддержкой Range (перемотка в <audio>), ETag и Last-Modified.
async fn serve_file(path: std::path::PathBuf, req: Request) -> ApiResult<Response> {
    let res = ServeFile::new(path).oneshot(req).await?;
    Ok(res.map(Body::new))
}

#[derive(Deserialize)]
struct AddRequest {
    url: Option<String>,
}

async fn add_track(State(s): State<AppState>, Json(body): Json<AddRequest>) -> ApiResult<impl IntoResponse> {
    let url = body.url.as_deref().map(str::trim).unwrap_or_default();
    if url.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "URL is required"));
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "URL must start with http:// or https://"));
    }

    let video_id = s.dl.download(url).await?;
    let mut track = s.db.track(&video_id)?;
    if let Some(t) = track.as_mut() {
        t.file_exists = true;
    }
    Ok(Json(json!({ "success": true, "track": track })))
}

async fn library(State(s): State<AppState>) -> ApiResult<impl IntoResponse> {
    let mut tracks = s.db.library()?;
    for t in &mut tracks {
        t.file_exists = s.cfg.audio_path(&t.video_id).is_file();
    }
    Ok(Json(tracks))
}

async fn stream(State(s): State<AppState>, Path(id): Path<String>, req: Request) -> ApiResult<Response> {
    check_id(&id)?;
    let path = s.cfg.audio_path(&id);
    if path.is_file() {
        return serve_file(path, req).await;
    }

    match s.db.source_url(&id)? {
        Some(url) => {
            s.dl.restore(id, url);
            Ok((
                StatusCode::NOT_FOUND,
                Json(json!({
                    "restoring": true,
                    "message": "Track is being restored. Please try again in a few seconds."
                })),
            )
                .into_response())
        }
        None => Err(ApiError::new(StatusCode::NOT_FOUND, "Track not found in library")),
    }
}

async fn thumbnail(State(s): State<AppState>, Path(id): Path<String>, req: Request) -> ApiResult<Response> {
    check_id(&id)?;
    let path = s.cfg.thumb_path(&id);
    if !path.is_file() {
        let url = s
            .db
            .thumbnail_url(&id)?
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Thumbnail not found"))?;
        if let Err(e) = s.dl.fetch_to_file(&url, &path).await {
            tracing::warn!("не удалось загрузить обложку {id}: {e:#}");
            return Err(ApiError::new(StatusCode::NOT_FOUND, "Thumbnail not available"));
        }
    }
    serve_file(path, req).await
}

/// Форма волны трека для полосы перемотки. Считается один раз и кэшируется рядом с обложкой.
async fn peaks(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Response> {
    check_id(&id)?;
    let cache = s.cfg.peaks_path(&id);
    if let Ok(bytes) = tokio::fs::read(&cache).await {
        return Ok(([(header::CONTENT_TYPE, "application/json")], bytes).into_response());
    }
    let audio = s.cfg.audio_path(&id);
    if !audio.is_file() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Track file not found"));
    }
    let data = crate::peaks::compute(&s.cfg.ffmpeg_cmd(), &audio).await?;
    let body = serde_json::to_vec(&json!({ "peaks": data }))?;
    if let Err(e) = tokio::fs::write(&cache, &body).await {
        tracing::warn!("не удалось сохранить форму волны {id}: {e}");
    }
    Ok(([(header::CONTENT_TYPE, "application/json")], body).into_response())
}

#[derive(Deserialize)]
struct RecsQuery {
    /// Трек, от которого строить микс; без него — несколько последних добавленных.
    seed: Option<String>,
    /// `1` — не брать из кэша (кнопка «обновить»).
    fresh: Option<u8>,
}

async fn recommendations(State(s): State<AppState>, Query(q): Query<RecsQuery>) -> ApiResult<impl IntoResponse> {
    let seeds: Vec<String> = match q.seed.filter(|id| !id.is_empty()) {
        Some(id) => {
            check_id(&id)?;
            vec![id]
        }
        None => s.db.recent_ids(3)?,
    };
    if seeds.is_empty() {
        return Ok(Json(json!({ "seeds": [], "items": [] })));
    }
    let fresh = q.fresh == Some(1);

    let mut jobs = tokio::task::JoinSet::new();
    for (i, seed) in seeds.iter().cloned().enumerate() {
        let recs = s.recs.clone();
        jobs.spawn(async move { (i, seed.clone(), recs.mix(&seed, fresh).await) });
    }
    let mut mixes = vec![Vec::new(); seeds.len()];
    let mut errors = Vec::new();
    while let Some(done) = jobs.join_next().await {
        match done {
            Ok((i, _, Ok(list))) => mixes[i] = list,
            Ok((_, seed, Err(e))) => {
                tracing::warn!("рекомендации по {seed}: {e:#}");
                errors.push(format!("{e:#}"));
            }
            Err(e) => errors.push(e.to_string()),
        }
    }
    if errors.len() == seeds.len() {
        return Err(ApiError::new(StatusCode::BAD_GATEWAY, errors.join("; ")));
    }

    let mut exclude = s.db.all_ids()?;
    exclude.extend(seeds.iter().cloned());
    Ok(Json(json!({ "seeds": seeds, "items": merge(mixes, &exclude, 40) })))
}

async fn delete_track(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<impl IntoResponse> {
    check_id(&id)?;
    let json_file = s
        .db
        .delete(&id)?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Track not found in library"))?;

    let mut files = vec![s.cfg.audio_path(&id), s.cfg.thumb_path(&id), s.cfg.peaks_path(&id)];
    if let Some(name) = json_file.filter(|n| !n.contains(['/', '\\']) && n != ".." && !n.is_empty()) {
        files.push(s.cfg.info_dir.join(name));
    }
    for f in files {
        match tokio::fs::remove_file(&f).await {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => tracing::warn!("не удалось удалить {}: {e}", f.display()),
        }
    }
    Ok(Json(json!({ "success": true })))
}
