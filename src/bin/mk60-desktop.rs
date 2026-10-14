//! «Моя музыка» для Windows и Linux: окно со встроенным сервером.
//!
//! Сервер слушает и локальную сеть, поэтому телефоны подключаются к этому компьютеру
//! так же, как к консольному `music-player`. Окно закрыли — сервер остановился.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use music_player::{app, bind, prepare, serve, Config};
use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::{Icon, WindowBuilder};
use wry::{WebContext, WebViewBuilder};

const ICON_RGBA: &[u8] = include_bytes!("../../assets/icon-64.rgba");

fn init_logging(dir: &Path) {
    // Если папку данных создать нельзя (нет прав), журнал пишется во временную папку.
    let open = |d: &Path| {
        std::fs::create_dir_all(d).and_then(|_| std::fs::OpenOptions::new().create(true).append(true).open(d.join("app.log")))
    };
    let file = open(dir).or_else(|_| open(&std::env::temp_dir().join("MyMusic")));
    let filter = tracing_subscriber::EnvFilter::new("info,tower_http=warn");
    match file {
        Ok(f) => tracing_subscriber::fmt().with_env_filter(filter).with_ansi(false).with_writer(std::sync::Mutex::new(f)).init(),
        Err(_) => tracing_subscriber::fmt().with_env_filter(filter).init(),
    }
}

/// Папка «Загрузки» пользователя — туда сохраняются скачанные треки и архивы альбомов.
fn downloads_dir() -> PathBuf {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
    #[cfg(target_os = "linux")]
    if let Some(home) = &home {
        // Локализованная папка из ~/.config/user-dirs.dirs, если она есть.
        if let Ok(dirs) = std::fs::read_to_string(home.join(".config/user-dirs.dirs")) {
            for line in dirs.lines() {
                if let Some(v) = line.strip_prefix("XDG_DOWNLOAD_DIR=") {
                    let v = v.trim_matches('"').replace("$HOME", &home.to_string_lossy());
                    return PathBuf::from(v);
                }
            }
        }
    }
    home.map(|h| h.join("Downloads")).unwrap_or_else(std::env::temp_dir)
}

/// Имя, которого ещё нет в папке: «Альбом.zip» → «Альбом (2).zip».
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() {
        return p;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s.to_owned(), format!(".{e}")),
        None => (name.to_owned(), String::new()),
    };
    (2..1000).map(|i| dir.join(format!("{stem} ({i}){ext}"))).find(|p| !p.exists()).unwrap_or(p)
}

/// Открыть ссылку в обычном браузере (всё, что не наш интерфейс).
fn open_external(url: &str) {
    #[cfg(windows)]
    let _ = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn();
    #[cfg(not(windows))]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}

fn error_page(msg: &str) -> String {
    let msg = msg.replace('&', "&amp;").replace('<', "&lt;");
    format!(
        r#"<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:grid;place-content:center;background:#0a0a0a;color:#fff;font:16px system-ui;padding:24px">
        <h1 style="font-size:22px">Не удалось запустить «Моя музыка»</h1><p style="color:#b3b3b3;max-width:60ch;line-height:1.5">{msg}</p>
        <p style="color:#8f8f8f">Подробности — в Data/logs/app.log рядом с программой.</p></body>"#
    )
}

fn main() {
    let cfg = Arc::new(Config::from_env());
    init_logging(&cfg.data_dir.join("logs"));
    tracing::info!("«Моя музыка» {} — данные в {}", music_player::VERSION, cfg.data_dir.display());

    // Сервер — в своём потоке со своим tokio; окно — в главном потоке (так требуют ОС).
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<u16, String>>();
    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
    let server_cfg = cfg.clone();
    let server = std::thread::spawn(move || {
        let rt = match tokio::runtime::Runtime::new() {
            Ok(rt) => rt,
            Err(e) => return ready_tx.send(Err(e.to_string())).unwrap_or(()),
        };
        rt.block_on(async move {
            let started = async {
                prepare(&server_cfg)?;
                let listener = bind(server_cfg.port).await?;
                let port = listener.local_addr()?.port();
                let router = app(server_cfg.clone(), port)?;
                anyhow::Ok((listener, router, port))
            }
            .await;
            match started {
                Ok((listener, router, port)) => {
                    let _ = ready_tx.send(Ok(port));
                    if let Err(e) = serve(listener, router, async { let _ = stop_rx.await; }).await {
                        tracing::error!("сервер остановился с ошибкой: {e:#}");
                    }
                }
                Err(e) => {
                    tracing::error!("сервер не запустился: {e:#}");
                    let _ = ready_tx.send(Err(format!("{e:#}")));
                }
            }
        });
    });
    let started = ready_rx.recv().unwrap_or_else(|_| Err("сервер завершился при запуске".into()));

    let event_loop = EventLoopBuilder::new().build();
    let window = WindowBuilder::new()
        .with_title("Моя музыка")
        .with_inner_size(LogicalSize::new(1280.0, 820.0))
        .with_min_inner_size(LogicalSize::new(380.0, 600.0))
        .with_window_icon(Icon::from_rgba(ICON_RGBA.to_vec(), 64, 64).ok())
        .build(&event_loop)
        .expect("не удалось создать окно");

    // Данные WebView (настройки интерфейса, localStorage) — рядом с данными программы.
    let mut context = WebContext::new(Some(cfg.data_dir.join("webview")));
    let downloads = downloads_dir();
    let mut builder = WebViewBuilder::with_web_context(&mut context)
        .with_background_color((10, 10, 10, 255))
        .with_devtools(cfg!(debug_assertions))
        .with_download_started_handler(move |_url, path| {
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "download".into());
            let _ = std::fs::create_dir_all(&downloads);
            *path = unique_path(&downloads, &name);
            tracing::info!("скачивание в {}", path.display());
            true
        })
        .with_download_completed_handler(|_url, path, ok| {
            if ok {
                if let Some(p) = path {
                    tracing::info!("сохранено: {}", p.display());
                }
            }
        });

    builder = match &started {
        Ok(port) => {
            let base = format!("http://127.0.0.1:{port}/");
            let own = base.clone();
            builder
                .with_url(&base)
                .with_navigation_handler(move |url| {
                    let ours = url.starts_with(&own) || url.starts_with("about:") || url.starts_with("blob:") || url.starts_with("data:");
                    if !ours {
                        open_external(&url);
                    }
                    ours
                })
                .with_new_window_req_handler(|url| {
                    open_external(&url);
                    false
                })
        }
        Err(msg) => builder.with_html(error_page(msg)),
    };
    let _webview = builder.build(&window).expect("не удалось создать WebView — установлен ли WebView2 / WebKitGTK?");

    let mut stop_tx = Some(stop_tx);
    let mut server = Some(server);
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent { event: WindowEvent::CloseRequested, .. } = event {
            if let Some(tx) = stop_tx.take() {
                let _ = tx.send(());
            }
            if let Some(h) = server.take() {
                let _ = h.join();
            }
            *control_flow = ControlFlow::Exit;
        }
    });
}
