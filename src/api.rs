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
use crate::{archive, jobs};

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<Config>,
    pub db: Arc<Db>,
    pub dl: Arc<Downloader>,
    pub recs: Arc<Recommender>,
    pub jobs: Arc<jobs::Jobs>,
    pub port: u16,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/add", post(add_track))
        .route("/api/library", get(library))
        .route("/api/stream/:video_id", get(stream))
        .route("/api/thumbnail/:video_id", get(thumbnail))
        .route("/api/peaks/:video_id", get(peaks))
        .route("/api/recommendations", get(recommendations))
        .route("/api/albums", get(list_albums).post(create_album))
        .route("/api/albums/:id", axum::routing::patch(update_album).delete(delete_album))
        .route("/api/albums/:id/tracks", post(add_album_track))
        .route("/api/albums/:id/tracks/:video_id", delete(remove_album_track))
        .route("/api/albums/:id/export", get(export_album))
        .route("/api/export", get(export_tracks))
        .route("/api/import", post(import_album).layer(axum::extract::DefaultBodyLimit::disable()))
        .route("/api/add-playlist", post(add_playlist))
        .route("/api/jobs", get(list_jobs))
        .route("/api/info", get(info))
        .route("/api/qr", get(qr))
        .route("/api/ytdlp", get(ytdlp_version))
        .route("/api/ytdlp/update", post(ytdlp_update))
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

// ============ Альбомы ============

fn bad(msg: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, msg)
}

fn clean_album_name(name: Option<String>) -> ApiResult<String> {
    let name = name.unwrap_or_default().trim().chars().take(80).collect::<String>();
    if name.is_empty() {
        return Err(bad("Нужно название альбома"));
    }
    Ok(name)
}

fn check_ids(ids: &[String]) -> ApiResult<()> {
    if ids.len() > 5000 {
        return Err(bad("Слишком много треков"));
    }
    ids.iter().try_for_each(|id| check_id(id))
}

async fn list_albums(State(s): State<AppState>) -> ApiResult<impl IntoResponse> {
    Ok(Json(s.db.albums()?))
}

#[derive(Deserialize)]
struct AlbumBody {
    name: Option<String>,
    tracks: Option<Vec<String>>,
}

async fn create_album(State(s): State<AppState>, Json(b): Json<AlbumBody>) -> ApiResult<impl IntoResponse> {
    let name = clean_album_name(b.name)?;
    let id = s.db.create_album(&name, None)?;
    if let Some(t) = b.tracks {
        check_ids(&t)?;
        s.db.set_album_tracks(id, &t)?;
    }
    Ok(Json(s.db.album(id)?))
}

async fn update_album(State(s): State<AppState>, Path(id): Path<i64>, Json(b): Json<AlbumBody>) -> ApiResult<impl IntoResponse> {
    if s.db.album(id)?.is_none() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Альбом не найден"));
    }
    if b.name.is_some() {
        s.db.rename_album(id, &clean_album_name(b.name)?)?;
    }
    if let Some(t) = b.tracks {
        check_ids(&t)?;
        s.db.set_album_tracks(id, &t)?;
    }
    Ok(Json(s.db.album(id)?))
}

async fn delete_album(State(s): State<AppState>, Path(id): Path<i64>) -> ApiResult<impl IntoResponse> {
    if !s.db.delete_album(id)? {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Альбом не найден"));
    }
    Ok(Json(json!({ "success": true })))
}

#[derive(Deserialize)]
struct TrackRef {
    video_id: String,
}

async fn add_album_track(State(s): State<AppState>, Path(id): Path<i64>, Json(b): Json<TrackRef>) -> ApiResult<impl IntoResponse> {
    check_id(&b.video_id)?;
    if s.db.album(id)?.is_none() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Альбом не найден"));
    }
    if !s.db.has_track(&b.video_id)? {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Трека нет в библиотеке"));
    }
    s.db.add_to_album(id, &b.video_id)?;
    Ok(Json(s.db.album(id)?))
}

async fn remove_album_track(State(s): State<AppState>, Path((id, vid)): Path<(i64, String)>) -> ApiResult<impl IntoResponse> {
    check_id(&vid)?;
    s.db.remove_from_album(id, &vid)?;
    Ok(Json(s.db.album(id)?))
}

/// `attachment; filename="..."; filename*=UTF-8''...` — имя файла с кириллицей во всех браузерах.
fn content_disposition(name: &str) -> String {
    let ascii: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || " -_.()".contains(c) { c } else { '_' }).collect();
    let encoded: String = name
        .bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect();
    format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}")
}

async fn export_zip(s: &AppState, name: String, ids: Vec<String>, req: Request) -> ApiResult<Response> {
    let (cfg, db, n) = (s.cfg.clone(), s.db.clone(), name.clone());
    let path = tokio::task::spawn_blocking(move || archive::export(&cfg, &db, &n, &ids))
        .await
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map_err(|e| bad(format!("{e:#}")))?;
    let mut res = serve_file(path, req).await?;
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, header::HeaderValue::from_static("application/zip"));
    if let Ok(v) = header::HeaderValue::from_str(&content_disposition(&format!("{}.zip", archive::safe_name(&name, 80)))) {
        h.insert(header::CONTENT_DISPOSITION, v);
    }
    Ok(res)
}

async fn export_album(State(s): State<AppState>, Path(id): Path<i64>, req: Request) -> ApiResult<Response> {
    let album = s.db.album(id)?.ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Альбом не найден"))?;
    export_zip(&s, album.name, album.tracks, req).await
}

#[derive(Deserialize)]
struct ExportQuery {
    name: Option<String>,
    ids: String,
}

/// Экспорт произвольного набора треков (например, альбома из метаданных).
async fn export_tracks(State(s): State<AppState>, Query(q): Query<ExportQuery>, req: Request) -> ApiResult<Response> {
    let ids: Vec<String> = q.ids.split(',').filter(|x| !x.is_empty()).map(str::to_owned).collect();
    check_ids(&ids)?;
    if ids.is_empty() {
        return Err(bad("Нет треков для экспорта"));
    }
    let name = q.name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| "Моя музыка".into());
    export_zip(&s, name, ids, req).await
}

/// Импорт архива альбома: тело запроса — сам .zip, пишется на диск потоком.
async fn import_album(State(s): State<AppState>, req: Request) -> ApiResult<impl IntoResponse> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    archive::cleanup_tmp(&s.cfg.tmp_dir);
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let path = s.cfg.tmp_dir.join(format!("upload-{stamp}.zip"));
    let mut file = tokio::fs::File::create(&path).await?;
    let mut stream = req.into_body().into_data_stream();
    let mut size: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| bad(format!("Загрузка прервалась: {e}")))?;
        size += chunk.len() as u64;
        if size > 8 * 1024 * 1024 * 1024 {
            let _ = tokio::fs::remove_file(&path).await;
            return Err(bad("Архив больше 8 ГБ"));
        }
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    drop(file);

    let (cfg, db, p) = (s.cfg.clone(), s.db.clone(), path.clone());
    let report = tokio::task::spawn_blocking(move || archive::import(&cfg, &db, &p))
        .await
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let _ = tokio::fs::remove_file(&path).await;
    let report = report.map_err(|e| bad(format!("{e:#}")))?;
    tracing::info!("импорт «{}»: новых {}, уже было {}, ошибок {}", report.name, report.imported, report.skipped, report.failed);
    Ok(Json(report))
}

#[derive(Deserialize)]
struct PlaylistBody {
    url: Option<String>,
}

async fn add_playlist(State(s): State<AppState>, Json(b): Json<PlaylistBody>) -> ApiResult<impl IntoResponse> {
    let url = b.url.as_deref().map(str::trim).unwrap_or_default();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(bad("Нужна ссылка на альбом или плейлист"));
    }
    let list = jobs::read_playlist(&s.cfg, url).await.map_err(|e| bad(format!("{e:#}")))?;
    if list.entries.is_empty() {
        return Err(bad("В плейлисте не нашлось треков"));
    }
    let job = jobs::start(s.jobs.clone(), s.db.clone(), s.dl.clone(), list, url)?;
    Ok(Json(json!({ "job": job })))
}

async fn list_jobs(State(s): State<AppState>) -> ApiResult<impl IntoResponse> {
    Ok(Json(s.jobs.snapshot()))
}

// ============ Сведения, QR, yt-dlp ============

/// Версия, адреса для подключения телефона, где лежат данные.
async fn info(State(s): State<AppState>) -> ApiResult<impl IntoResponse> {
    Ok(Json(json!({
        "version": crate::VERSION,
        "port": s.port,
        "urls": crate::lan_urls(s.port),
        "data_dir": s.cfg.data_dir.display().to_string(),
    })))
}

#[derive(Deserialize)]
struct QrQuery {
    text: String,
}

/// QR-код (SVG) — чтобы открыть плеер на телефоне, наведя камеру.
async fn qr(Query(q): Query<QrQuery>) -> ApiResult<Response> {
    if q.text.len() > 512 {
        return Err(bad("Слишком длинный текст для QR-кода"));
    }
    let code = qrcode::QrCode::new(q.text.as_bytes()).map_err(|e| bad(e.to_string()))?;
    let svg = code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(240, 240)
        .quiet_zone(true)
        .dark_color(qrcode::render::svg::Color("#000000"))
        .light_color(qrcode::render::svg::Color("#ffffff"))
        .build();
    Ok(([(header::CONTENT_TYPE, "image/svg+xml")], svg).into_response())
}

async fn run_ytdlp(s: &AppState, args: &[&str], secs: u64) -> ApiResult<(bool, String)> {
    let mut cmd = tokio::process::Command::new(&s.cfg.ytdlp);
    cmd.args(args).stdin(std::process::Stdio::null()).kill_on_drop(true);
    let out = tokio::time::timeout(std::time::Duration::from_secs(secs), cmd.output())
        .await
        .map_err(|_| bad("yt-dlp не ответил вовремя"))?
        .map_err(|e| bad(format!("не удалось запустить yt-dlp ({}): {e}", s.cfg.ytdlp.display())))?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    Ok((out.status.success(), text.trim().to_owned()))
}

async fn ytdlp_version(State(s): State<AppState>) -> ApiResult<impl IntoResponse> {
    let (ok, text) = run_ytdlp(&s, &["--version"], 20).await?;
    Ok(Json(json!({ "ok": ok, "version": text.lines().next().unwrap_or(""), "path": s.cfg.ytdlp.display().to_string() })))
}

/// YouTube часто меняется — старый yt-dlp перестаёт скачивать. Это его самообновление.
async fn ytdlp_update(State(s): State<AppState>) -> ApiResult<impl IntoResponse> {
    let (ok, text) = run_ytdlp(&s, &["-U"], 180).await?;
    let (_, version) = run_ytdlp(&s, &["--version"], 20).await.unwrap_or((false, String::new()));
    tracing::info!("обновление yt-dlp: {text}");
    Ok(Json(json!({ "ok": ok, "output": text, "version": version.lines().next().unwrap_or("") })))
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
