//! HTTP API и раздача встроенного веб-интерфейса.

use std::convert::Infallible;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, Request, State};
use axum::http::{header, HeaderValue, StatusCode, Uri};
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use futures::Stream;
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tower::ServiceExt;
use tower_http::services::ServeFile;

use crate::db::{Playlist, Track, TrackPatch};
use crate::jobs::{self, Job};
use crate::state::{AppState, Event, LibraryAction};
use crate::util::{content_disposition, is_valid_id, sanitize_filename};
use crate::{waveform, ytdlp};

type AppResult<T> = Result<T, ApiError>;
type St = State<Arc<AppState>>;

pub enum ApiError {
    NotFound(&'static str),
    BadRequest(String),
    Conflict(String),
    Internal(anyhow::Error),
}

impl<E: Into<anyhow::Error>> From<E> for ApiError {
    fn from(e: E) -> Self {
        Self::Internal(e.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (code, msg) = match self {
            Self::NotFound(m) => (StatusCode::NOT_FOUND, m.to_owned()),
            Self::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            Self::Conflict(m) => (StatusCode::CONFLICT, m),
            Self::Internal(e) => {
                tracing::error!("{e:#}");
                (StatusCode::INTERNAL_SERVER_ERROR, format!("{e:#}"))
            }
        };
        (code, Json(json!({ "error": msg }))).into_response()
    }
}

fn check_id(id: &str) -> AppResult<()> {
    if is_valid_id(id) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "некорректный идентификатор трека".into(),
        ))
    }
}

pub fn router(state: Arc<AppState>) -> Router {
    let api = Router::new()
        .route(
            "/health",
            get(|| async { Json(json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") })) }),
        )
        .route("/stats", get(stats))
        .route("/library", get(library))
        .route("/add", post(add))
        .route(
            "/tracks/{id}",
            get(track).patch(patch_track).delete(delete_track),
        )
        // Совместимость со старым API.
        .route("/track/{id}", delete(delete_track))
        .route("/tracks/{id}/play", post(played))
        .route("/tracks/{id}/restore", post(restore))
        .route("/tracks/{id}/waveform", get(track_waveform))
        .route("/tracks/{id}/download", get(download))
        .route("/stream/{id}", get(stream))
        .route("/thumbnail/{id}", get(thumbnail))
        .route("/jobs", get(list_jobs).delete(clear_jobs))
        .route("/jobs/{id}", delete(cancel_job))
        .route("/events", get(events))
        .route("/playlists", get(playlists).post(create_playlist))
        .route(
            "/playlists/{id}",
            axum::routing::patch(rename_playlist).delete(delete_playlist),
        )
        .route(
            "/playlists/{id}/tracks",
            post(add_to_playlist).put(set_playlist_tracks),
        )
        .route(
            "/playlists/{id}/tracks/{video_id}",
            delete(remove_from_playlist),
        )
        .fallback(|| async { ApiError::NotFound("неизвестный метод API") });

    Router::new()
        .nest("/api", api)
        .fallback(static_file)
        .with_state(state)
}

// ---------- Библиотека ----------

#[derive(Serialize)]
struct TrackView {
    #[serde(flatten)]
    track: Track,
    file_exists: bool,
    thumbnail_api: String,
}

impl TrackView {
    fn new(state: &AppState, track: Track) -> Self {
        Self {
            file_exists: ytdlp::audio_path(&state.cfg, &track.video_id).exists(),
            thumbnail_api: format!("/api/thumbnail/{}", track.video_id),
            track,
        }
    }
}

async fn library(State(s): St) -> AppResult<Json<Vec<TrackView>>> {
    let tracks = s.db.tracks().await?;
    let s2 = s.clone();
    let views = tokio::task::spawn_blocking(move || {
        tracks.into_iter().map(|t| TrackView::new(&s2, t)).collect()
    })
    .await?;
    Ok(Json(views))
}

async fn track(State(s): St, Path(id): Path<String>) -> AppResult<Json<TrackView>> {
    check_id(&id)?;
    let t =
        s.db.track(&id)
            .await?
            .ok_or(ApiError::NotFound("трек не найден"))?;
    Ok(Json(TrackView::new(&s, t)))
}

async fn patch_track(
    State(s): St,
    Path(id): Path<String>,
    Json(p): Json<TrackPatch>,
) -> AppResult<Json<TrackView>> {
    check_id(&id)?;
    let t =
        s.db.patch_track(&id, p)
            .await?
            .ok_or(ApiError::NotFound("трек не найден"))?;
    s.write_sidecar(&t).await;
    s.emit(Event::Library {
        video_id: id,
        action: LibraryAction::Updated,
    });
    Ok(Json(TrackView::new(&s, t)))
}

async fn delete_track(State(s): St, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    check_id(&id)?;
    if !s.db.delete_track(&id).await? {
        return Err(ApiError::NotFound("трек не найден"));
    }
    for path in [
        ytdlp::audio_path(&s.cfg, &id),
        ytdlp::cover_path(&s.cfg, &id),
        ytdlp::sidecar_path(&s.cfg, &id),
    ] {
        if let Err(e) = tokio::fs::remove_file(&path).await {
            if e.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!("не удалось удалить {}: {e}", path.display());
            }
        }
    }
    s.emit(Event::Library {
        video_id: id,
        action: LibraryAction::Deleted,
    });
    Ok(Json(json!({ "success": true })))
}

async fn played(State(s): St, Path(id): Path<String>) -> AppResult<StatusCode> {
    check_id(&id)?;
    if s.db.mark_played(&id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound("трек не найден"))
    }
}

async fn restore(State(s): St, Path(id): Path<String>) -> AppResult<Json<Job>> {
    check_id(&id)?;
    jobs::restore(&s, &id)
        .await?
        .map(Json)
        .ok_or(ApiError::NotFound("трек не найден"))
}

async fn track_waveform(State(s): St, Path(id): Path<String>) -> AppResult<Response> {
    check_id(&id)?;
    let peaks = match s.db.waveform(&id).await? {
        Some(p) if !p.is_empty() => p,
        _ => {
            let audio = ytdlp::audio_path(&s.cfg, &id);
            if !audio.exists() {
                return Err(ApiError::NotFound("аудиофайл отсутствует"));
            }
            let p = waveform::compute(&s.cfg.ffmpeg(), &audio).await?;
            s.db.set_waveform(&id, p.clone()).await?;
            p
        }
    };
    let mut resp = Json(json!({ "bars": peaks })).into_response();
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=86400"),
    );
    Ok(resp)
}

#[derive(Deserialize)]
struct AddBody {
    url: Option<String>,
    urls: Option<Vec<String>>,
}

/// Принимает одну ссылку, массив ссылок или текст с несколькими ссылками.
async fn add(
    State(s): St,
    Json(body): Json<AddBody>,
) -> AppResult<(StatusCode, Json<serde_json::Value>)> {
    let mut urls: Vec<String> = body
        .url
        .iter()
        .chain(body.urls.iter().flatten())
        .flat_map(|u| u.split_whitespace())
        .filter(|u| u.starts_with("http://") || u.starts_with("https://"))
        .map(str::to_owned)
        .collect();
    let mut seen = std::collections::HashSet::new();
    urls.retain(|u| seen.insert(u.clone()));
    if urls.is_empty() {
        return Err(ApiError::BadRequest(
            "нужна хотя бы одна ссылка http(s)".into(),
        ));
    }
    let jobs: Vec<Job> = urls
        .into_iter()
        .map(|u| jobs::enqueue(&s, u, false))
        .collect();
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({ "success": true, "jobs": jobs })),
    ))
}

async fn stats(State(s): St) -> AppResult<Json<serde_json::Value>> {
    let tracks = s.db.tracks().await?;
    let playlists = s.db.playlists().await?.len();
    let jobs = s.jobs.list();
    Ok(Json(json!({
        "tracks": tracks.len(),
        "duration": tracks.iter().map(|t| t.duration).sum::<f64>(),
        "size": tracks.iter().filter_map(|t| t.filesize).sum::<i64>(),
        "favorites": tracks.iter().filter(|t| t.favorite).count(),
        "plays": tracks.iter().map(|t| t.play_count).sum::<i64>(),
        "artists": tracks.iter().map(|t| t.artist.to_lowercase()).collect::<std::collections::HashSet<_>>().len(),
        "playlists": playlists,
        "active_jobs": jobs.iter().filter(|j| !j.status.is_finished()).count(),
        "version": env!("CARGO_PKG_VERSION"),
    })))
}

// ---------- Файлы ----------

/// Отдаёт аудио с поддержкой HTTP Range — перемотка работает в любом браузере.
async fn stream(State(s): St, Path(id): Path<String>, req: Request) -> AppResult<Response> {
    check_id(&id)?;
    let path = ytdlp::audio_path(&s.cfg, &id);
    if !path.exists() {
        return match jobs::restore(&s, &id).await? {
            Some(job) => Ok((
                StatusCode::NOT_FOUND,
                Json(json!({ "restoring": true, "job": job, "message": "Файл восстанавливается, попробуйте через несколько секунд" })),
            )
                .into_response()),
            None => Err(ApiError::NotFound("трек не найден в библиотеке")),
        };
    }
    let mime = "audio/ogg; codecs=opus".parse().expect("valid mime");
    Ok(ServeFile::new_with_mime(path, &mime)
        .oneshot(req)
        .await?
        .map(Body::new))
}

async fn download(State(s): St, Path(id): Path<String>, req: Request) -> AppResult<Response> {
    check_id(&id)?;
    let t =
        s.db.track(&id)
            .await?
            .ok_or(ApiError::NotFound("трек не найден"))?;
    let path = ytdlp::audio_path(&s.cfg, &id);
    if !path.exists() {
        return Err(ApiError::NotFound("аудиофайл отсутствует"));
    }
    let mime = "audio/ogg".parse().expect("valid mime");
    let mut resp = ServeFile::new_with_mime(path, &mime)
        .oneshot(req)
        .await?
        .map(Body::new);
    let name = sanitize_filename(&format!("{} - {}.opus", t.artist, t.title));
    if let Ok(v) = HeaderValue::from_str(&content_disposition(&name)) {
        resp.headers_mut().insert(header::CONTENT_DISPOSITION, v);
    }
    Ok(resp)
}

async fn thumbnail(State(s): St, Path(id): Path<String>) -> AppResult<Response> {
    check_id(&id)?;
    let path = ytdlp::cover_path(&s.cfg, &id);
    if !path.exists() {
        let url =
            s.db.track(&id)
                .await?
                .and_then(|t| t.thumbnail_url)
                .ok_or(ApiError::NotFound("обложки нет"))?;
        if let Err(e) = s.fetch_cover(&id, &url).await {
            tracing::warn!("обложка {id}: {e:#}");
            return Err(ApiError::NotFound("обложка недоступна"));
        }
    }
    let bytes = tokio::fs::read(&path).await?;
    let mime = sniff_image(&bytes);
    Ok((
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, "public, max-age=604800"),
        ],
        bytes,
    )
        .into_response())
}

fn sniff_image(b: &[u8]) -> &'static str {
    match b {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "image/webp",
        [b'G', b'I', b'F', ..] => "image/gif",
        _ => "image/jpeg",
    }
}

// ---------- Очередь загрузок ----------

async fn list_jobs(State(s): St) -> Json<Vec<Job>> {
    Json(s.jobs.list())
}

async fn clear_jobs(State(s): St) -> StatusCode {
    let ids = s.jobs.clear_finished();
    s.emit(Event::JobsCleared { ids });
    StatusCode::NO_CONTENT
}

async fn cancel_job(State(s): St, Path(id): Path<u64>) -> AppResult<StatusCode> {
    if s.jobs.cancel(id) {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound("активная задача не найдена"))
    }
}

async fn events(State(s): St) -> Sse<impl Stream<Item = Result<SseEvent, Infallible>>> {
    let stream = BroadcastStream::new(s.subscribe()).map(|msg| {
        Ok(match msg {
            Ok(e) => SseEvent::default()
                .json_data(&e)
                .unwrap_or_else(|_| SseEvent::default().comment("skip")),
            // Клиент отстал — пусть перечитает состояние целиком.
            Err(_) => SseEvent::default().event("resync").data("{}"),
        })
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

// ---------- Плейлисты ----------

#[derive(Deserialize)]
struct NameBody {
    name: String,
}

#[derive(Deserialize)]
struct VideoIdBody {
    video_id: String,
}

#[derive(Deserialize)]
struct VideoIdsBody {
    video_ids: Vec<String>,
}

/// Проверяет название плейлиста: непустое, не длиннее 100 символов и не занятое другим плейлистом.
async fn clean_name(s: &AppState, name: &str, own_id: Option<i64>) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(ApiError::BadRequest(
            "название плейлиста: от 1 до 100 символов".into(),
        ));
    }
    let lower = name.to_lowercase();
    if s.db
        .playlists()
        .await?
        .iter()
        .any(|p| Some(p.id) != own_id && p.name.to_lowercase() == lower)
    {
        return Err(ApiError::Conflict(format!(
            "плейлист «{name}» уже существует"
        )));
    }
    Ok(name.to_owned())
}

async fn playlists(State(s): St) -> AppResult<Json<Vec<Playlist>>> {
    Ok(Json(s.db.playlists().await?))
}

async fn create_playlist(
    State(s): St,
    Json(b): Json<NameBody>,
) -> AppResult<(StatusCode, Json<Playlist>)> {
    let p =
        s.db.create_playlist(clean_name(&s, &b.name, None).await?)
            .await?;
    s.emit(Event::Playlists);
    Ok((StatusCode::CREATED, Json(p)))
}

async fn rename_playlist(
    State(s): St,
    Path(id): Path<i64>,
    Json(b): Json<NameBody>,
) -> AppResult<StatusCode> {
    if !s
        .db
        .rename_playlist(id, clean_name(&s, &b.name, Some(id)).await?)
        .await?
    {
        return Err(ApiError::NotFound("плейлист не найден"));
    }
    s.emit(Event::Playlists);
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_playlist(State(s): St, Path(id): Path<i64>) -> AppResult<StatusCode> {
    if !s.db.delete_playlist(id).await? {
        return Err(ApiError::NotFound("плейлист не найден"));
    }
    s.emit(Event::Playlists);
    Ok(StatusCode::NO_CONTENT)
}

async fn add_to_playlist(
    State(s): St,
    Path(id): Path<i64>,
    Json(b): Json<VideoIdBody>,
) -> AppResult<StatusCode> {
    check_id(&b.video_id)?;
    s.db.add_to_playlist(id, b.video_id).await?;
    s.emit(Event::Playlists);
    Ok(StatusCode::NO_CONTENT)
}

async fn set_playlist_tracks(
    State(s): St,
    Path(id): Path<i64>,
    Json(b): Json<VideoIdsBody>,
) -> AppResult<StatusCode> {
    if !s.db.set_playlist_tracks(id, b.video_ids).await? {
        return Err(ApiError::NotFound("плейлист не найден"));
    }
    s.emit(Event::Playlists);
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_from_playlist(
    State(s): St,
    Path((id, vid)): Path<(i64, String)>,
) -> AppResult<StatusCode> {
    s.db.remove_from_playlist(id, vid).await?;
    s.emit(Event::Playlists);
    Ok(StatusCode::NO_CONTENT)
}

// ---------- Веб-интерфейс ----------

#[derive(RustEmbed)]
#[folder = "public/"]
struct Assets;

async fn static_file(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    match Assets::get(path) {
        Some(file) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            let cache = if path == "index.html" {
                "no-cache"
            } else {
                "public, max-age=3600"
            };
            (
                [
                    (header::CONTENT_TYPE, mime.as_ref()),
                    (header::CACHE_CONTROL, cache),
                ],
                file.data,
            )
                .into_response()
        }
        None => (StatusCode::NOT_FOUND, "Not found").into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use crate::db::Db;
    use axum::http::Request as HttpRequest;
    use clap::Parser;
    use http_body_util::BodyExt;

    fn setup() -> (tempfile::TempDir, Arc<AppState>) {
        let dir = tempfile::tempdir().unwrap();
        let cfg = Config::parse_from(["musicplayer", "--data-dir", dir.path().to_str().unwrap()]);
        std::fs::create_dir_all(cfg.music_dir()).unwrap();
        std::fs::create_dir_all(cfg.info_dir()).unwrap();
        let state = AppState::new(cfg, Db::open_in_memory().unwrap()).unwrap();
        (dir, state)
    }

    async fn call(
        app: &Router,
        method: &str,
        uri: &str,
        body: Option<serde_json::Value>,
    ) -> (StatusCode, Vec<u8>, axum::http::HeaderMap) {
        let mut req = HttpRequest::builder().method(method).uri(uri);
        let body = match body {
            Some(b) => {
                req = req.header("content-type", "application/json");
                Body::from(b.to_string())
            }
            None => Body::empty(),
        };
        let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
        let status = resp.status();
        let headers = resp.headers().clone();
        (
            status,
            resp.into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes()
                .to_vec(),
            headers,
        )
    }

    async fn insert(state: &AppState, id: &str) {
        state
            .db
            .upsert_track(Track {
                video_id: id.into(),
                title: "Группа крови".into(),
                artist: "Кино".into(),
                album: "Single".into(),
                added_at: 1,
                ..Default::default()
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn library_and_patch() {
        let (_d, state) = setup();
        insert(&state, "abc").await;
        let app = router(state);
        let (st, body, _) = call(&app, "GET", "/api/library", None).await;
        assert_eq!(st, StatusCode::OK);
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v[0]["video_id"], "abc");
        assert_eq!(v[0]["file_exists"], false);

        let (st, body, _) = call(
            &app,
            "PATCH",
            "/api/tracks/abc",
            Some(json!({"favorite": true, "title": " New "})),
        )
        .await;
        assert_eq!(st, StatusCode::OK);
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["favorite"], true);
        assert_eq!(v["title"], "New");

        let (st, _, _) = call(&app, "GET", "/api/tracks/..%2F..%2Fetc", None).await;
        assert_eq!(st, StatusCode::BAD_REQUEST);

        let (st, _, _) = call(&app, "DELETE", "/api/track/abc", None).await;
        assert_eq!(st, StatusCode::OK);
        let (st, _, _) = call(&app, "GET", "/api/tracks/abc", None).await;
        assert_eq!(st, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn stream_supports_ranges_and_download_names() {
        let (_d, state) = setup();
        insert(&state, "abc").await;
        std::fs::write(ytdlp::audio_path(&state.cfg, "abc"), b"0123456789").unwrap();
        let app = router(state);

        let req = HttpRequest::get("/api/stream/abc")
            .header("range", "bytes=2-5")
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            resp.into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes()
                .as_ref(),
            b"2345"
        );

        let (st, _, headers) = call(&app, "GET", "/api/tracks/abc/download", None).await;
        assert_eq!(st, StatusCode::OK);
        let cd = headers[header::CONTENT_DISPOSITION].to_str().unwrap();
        assert!(cd.contains("filename*=UTF-8''"), "{cd}");
    }

    #[tokio::test]
    async fn playlists_api() {
        let (_d, state) = setup();
        insert(&state, "abc").await;
        let app = router(state);
        let (st, body, _) =
            call(&app, "POST", "/api/playlists", Some(json!({"name": "Рок"}))).await;
        assert_eq!(st, StatusCode::CREATED);
        let id = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["id"]
            .as_i64()
            .unwrap();
        let (st, _, _) = call(
            &app,
            "POST",
            &format!("/api/playlists/{id}/tracks"),
            Some(json!({"video_id": "abc"})),
        )
        .await;
        assert_eq!(st, StatusCode::NO_CONTENT);
        let (_, body, _) = call(&app, "GET", "/api/playlists", None).await;
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v[0]["track_ids"][0], "abc");
        let (st, _, _) = call(&app, "POST", "/api/playlists", Some(json!({"name": "   "}))).await;
        assert_eq!(st, StatusCode::BAD_REQUEST);
        let (st, _, _) = call(&app, "POST", "/api/playlists", Some(json!({"name": "рок"}))).await;
        assert_eq!(st, StatusCode::CONFLICT);
        let (st, _, _) = call(
            &app,
            "PATCH",
            &format!("/api/playlists/{id}"),
            Some(json!({"name": "РОК"})),
        )
        .await;
        assert_eq!(st, StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn add_requires_urls_and_serves_ui() {
        let (_d, state) = setup();
        let app = router(state);
        let (st, _, _) = call(&app, "POST", "/api/add", Some(json!({"url": "not a link"}))).await;
        assert_eq!(st, StatusCode::BAD_REQUEST);
        let (st, body, _) = call(&app, "GET", "/", None).await;
        assert_eq!(st, StatusCode::OK);
        assert!(String::from_utf8_lossy(&body).contains("<html"));
        let (st, _, _) = call(&app, "GET", "/api/nope", None).await;
        assert_eq!(st, StatusCode::NOT_FOUND);
    }
}
