//! «Моя музыка» — сервер библиотеки. Его запускают и консольный `music-player`,
//! и приложение с окном `mk60-desktop` (а дальше — мобильные оболочки).

mod api;
mod archive;
pub mod config;
mod db;
mod downloader;
mod jobs;
mod peaks;
mod recs;

use std::future::Future;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::sync::Arc;

use anyhow::{Context, Result};
use axum::http::{header, HeaderValue};
use axum::Router;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

pub use crate::config::Config;
use crate::api::AppState;
use crate::db::Db;
use crate::downloader::Downloader;
use crate::recs::Recommender;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Создать папки данных.
pub fn prepare(cfg: &Config) -> Result<()> {
    for dir in [&cfg.music_dir, &cfg.info_dir, &cfg.tmp_dir] {
        std::fs::create_dir_all(dir).with_context(|| format!("не удалось создать {}", dir.display()))?;
    }
    Ok(())
}

/// Слушать на всех интерфейсах (чтобы подключались телефоны). Если порт занят — любой свободный.
pub async fn bind(port: u16) -> Result<TcpListener> {
    match TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port))).await {
        Ok(l) => Ok(l),
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            tracing::warn!("порт {port} занят — беру свободный");
            Ok(TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], 0))).await?)
        }
        Err(e) => Err(e).with_context(|| format!("не удалось открыть порт {port}")),
    }
}

/// Собрать приложение: API + статический интерфейс из `public/`.
pub fn app(cfg: Arc<Config>, port: u16) -> Result<Router> {
    let db = Arc::new(Db::open(&cfg.db_path).context("не удалось открыть базу данных")?);
    tracing::info!("база данных: {}", cfg.db_path.display());
    tracing::info!("yt-dlp: {}", cfg.ytdlp.display());
    tracing::info!("ffmpeg: {}", cfg.ffmpeg.as_deref().map_or("из PATH".into(), |p| p.display().to_string()));
    if cfg.cookies.is_none() {
        tracing::info!("cookies.txt не найден — закрытый контент скачать не получится");
    }

    let state = AppState {
        dl: Arc::new(Downloader::new(cfg.clone(), db.clone())),
        recs: Arc::new(Recommender::new(cfg.clone())),
        jobs: Arc::new(jobs::Jobs::default()),
        cfg: cfg.clone(),
        port,
        db,
    };

    Ok(api::router(state)
        // Интерфейс обновляется часто: браузер должен перепроверять файлы (ETag) при каждом заходе,
        // иначе после обновления может смешать новый index.html со старыми модулями.
        .fallback_service(
            tower::ServiceBuilder::new()
                .layer(SetResponseHeaderLayer::if_not_present(header::CACHE_CONTROL, HeaderValue::from_static("no-cache")))
                .service(ServeDir::new(&cfg.public_dir)),
        )
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http()))
}

pub async fn serve(listener: TcpListener, app: Router, shutdown: impl Future<Output = ()> + Send + 'static) -> Result<()> {
    axum::serve(listener, app).with_graceful_shutdown(shutdown).await?;
    Ok(())
}

/// Насколько адрес похож на домашнюю сеть: 192.168.* лучше всего, затем 10.* и 172.16–31.*.
/// Адаптеры VPN и прокси (198.18.0.0/15 у TUN-режимов, 100.64.0.0/10 у CGNAT/Tailscale) — в конце.
fn lan_rank(ip: &Ipv4Addr) -> Option<u8> {
    let o = ip.octets();
    if ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() {
        return None;
    }
    Some(match o {
        [192, 168, ..] => 0,
        [10, ..] => 1,
        [172, b, ..] if (16..=31).contains(&b) => 2,
        [198, 18 | 19, ..] => 9,
        [100, b, ..] if (64..=127).contains(&b) => 8,
        _ => 5,
    })
}

fn is_virtual(name: &str) -> bool {
    let n = name.to_lowercase();
    ["vethernet", "vmware", "virtualbox", "vbox", "hyper-v", "wsl", "docker", "br-", "virbr", "tun", "tap", "wireguard", "zerotier", "tailscale", "loopback"]
        .iter()
        .any(|v| n.contains(v))
}

/// Адреса этого компьютера в локальной сети, лучшие первыми.
pub fn lan_ips() -> Vec<IpAddr> {
    let mut found: Vec<(u8, Ipv4Addr)> = local_ip_address::list_afinet_netifas()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(name, ip)| match ip {
            // Виртуальные адаптеры (Hyper-V, WSL, VMware, VirtualBox, Docker, VPN) — после настоящих.
            IpAddr::V4(v4) => lan_rank(&v4).map(|r| (r + if is_virtual(&name) { 10 } else { 0 }, v4)),
            IpAddr::V6(_) => None,
        })
        .collect();
    if found.is_empty() {
        // Запасной путь: адрес маршрута по умолчанию (UDP «connect» не отправляет пакетов).
        if let Some(IpAddr::V4(v4)) = UdpSocket::bind("0.0.0.0:0")
            .and_then(|s| s.connect("192.0.2.1:9").and(s.local_addr()))
            .ok()
            .map(|a| a.ip())
        {
            if let Some(r) = lan_rank(&v4) {
                found.push((r, v4));
            }
        }
    }
    found.sort();
    found.dedup_by_key(|(_, ip)| *ip);
    found.into_iter().map(|(_, ip)| IpAddr::V4(ip)).collect()
}

pub fn lan_urls(port: u16) -> Vec<String> {
    lan_ips().into_iter().take(3).map(|ip| format!("http://{ip}:{port}/")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_home_network_over_vpn() {
        assert_eq!(lan_rank(&Ipv4Addr::new(192, 168, 1, 5)), Some(0));
        assert!(lan_rank(&Ipv4Addr::new(198, 18, 0, 1)) > lan_rank(&Ipv4Addr::new(10, 0, 0, 2)));
        assert_eq!(lan_rank(&Ipv4Addr::new(127, 0, 0, 1)), None);
        assert_eq!(lan_rank(&Ipv4Addr::new(169, 254, 3, 4)), None);
    }
}
