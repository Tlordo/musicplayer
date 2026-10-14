//! Консольный сервер: библиотека доступна в браузере на этом компьютере и с телефонов в локальной сети.

use std::sync::Arc;

use anyhow::Result;
use music_player::{app, bind, lan_urls, prepare, serve, Config};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,tower_http=warn")))
        .init();

    let cfg = Arc::new(Config::from_env());
    prepare(&cfg)?;
    let listener = bind(cfg.port).await?;
    let port = listener.local_addr()?.port();
    let router = app(cfg, port)?;

    tracing::info!("сервер запущен на http://localhost:{port}");
    for url in lan_urls(port) {
        tracing::info!("с телефона в той же сети: {url}");
    }

    serve(listener, router, async {
        let _ = tokio::signal::ctrl_c().await;
        tracing::info!("остановка сервера...");
    })
    .await
}
