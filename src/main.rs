mod api;
mod config;
mod db;
mod downloader;
mod peaks;

use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::{Context, Result};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use crate::api::AppState;
use crate::config::Config;
use crate::db::Db;
use crate::downloader::Downloader;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,tower_http=warn")),
        )
        .init();

    let cfg = Arc::new(Config::from_env());
    for dir in [&cfg.music_dir, &cfg.info_dir] {
        std::fs::create_dir_all(dir).with_context(|| format!("не удалось создать {}", dir.display()))?;
    }

    let db = Arc::new(Db::open(&cfg.db_path).context("не удалось открыть базу данных")?);
    tracing::info!("база данных: {}", cfg.db_path.display());
    tracing::info!("yt-dlp: {}", cfg.ytdlp.display());
    tracing::info!(
        "ffmpeg: {}",
        cfg.ffmpeg.as_deref().map_or("из PATH".into(), |p| p.display().to_string())
    );
    if cfg.cookies.is_none() {
        tracing::warn!("cookies.txt не найден — закрытый контент скачать не получится");
    }

    let state = AppState {
        dl: Arc::new(Downloader::new(cfg.clone(), db.clone())),
        cfg: cfg.clone(),
        db,
    };

    let app = api::router(state)
        .fallback_service(ServeDir::new(&cfg.public_dir))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    let addr = SocketAddr::from(([0, 0, 0, 0], cfg.port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("порт {} занят?", cfg.port))?;
    tracing::info!("сервер запущен на http://localhost:{}", cfg.port);

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
            tracing::info!("остановка сервера...");
        })
        .await?;
    Ok(())
}
