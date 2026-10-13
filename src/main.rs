mod api;
mod config;
mod db;
mod jobs;
mod state;
mod util;
mod waveform;
mod ytdlp;

use std::net::SocketAddr;

use anyhow::Context;
use clap::Parser;
use tower_http::compression::CompressionLayer;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("musicplayer=info,tower_http=warn")),
        )
        .init();

    let cfg = config::Config::parse().resolve();
    for dir in [cfg.music_dir(), cfg.info_dir()] {
        std::fs::create_dir_all(&dir)
            .with_context(|| format!("не удалось создать {}", dir.display()))?;
    }
    check_tools(&cfg).await;

    let db = db::Db::open(&cfg.db)?;
    let state = state::AppState::new(cfg.clone(), db)?;
    match state.import_sidecars().await {
        Ok(0) => {}
        Ok(n) => tracing::info!("восстановлено из резервных *.track.json, треков: {n}"),
        Err(e) => tracing::warn!("сканирование резервных метаданных: {e:#}"),
    }

    let app = api::router(state)
        .layer(CompressionLayer::new())
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    let addr = SocketAddr::new(cfg.host, cfg.port);
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("не удалось занять {addr}"))?;
    let shown = if cfg.host.is_unspecified() {
        format!("localhost:{}", cfg.port)
    } else {
        addr.to_string()
    };
    tracing::info!("плеер запущен: http://{shown}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await?;
    tracing::info!("сервер остановлен");
    Ok(())
}

/// Предупреждает заранее, если внешние утилиты недоступны.
async fn check_tools(cfg: &config::Config) {
    let checks = [(cfg.ytdlp.clone(), "--version"), (cfg.ffmpeg(), "-version")];
    for (bin, arg) in checks {
        let ok = tokio::process::Command::new(&bin)
            .arg(arg)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .is_ok_and(|s| s.success());
        if !ok {
            tracing::warn!(
                "{} не найден или не запускается — загрузка треков работать не будет",
                bin.display()
            );
        }
    }
    match &cfg.cookies {
        Some(c) => tracing::info!("cookies: {}", c.display()),
        None => tracing::info!("cookies.txt не найден — доступны только публичные треки"),
    }
}

async fn shutdown() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = term => {} }
}
