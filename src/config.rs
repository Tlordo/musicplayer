use std::env;
use std::path::{Path, PathBuf};

/// Все пути и настройки приложения. Переопределяются переменными окружения.
#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub public_dir: PathBuf,
    pub music_dir: PathBuf,
    pub info_dir: PathBuf,
    pub db_path: PathBuf,
    pub ytdlp: PathBuf,
    pub ffmpeg: Option<PathBuf>,
    pub cookies: Option<PathBuf>,
    pub max_parallel_downloads: usize,
}

const EXE: &str = if cfg!(windows) { ".exe" } else { "" };

impl Config {
    pub fn from_env() -> Self {
        let root = env::var_os("MUSIC_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(find_root);

        let ytdlp = env_path("YTDLP_PATH")
            .or_else(|| {
                [
                    root.join(format!("yt-dlp{EXE}")),
                    root.join("bin").join(format!("yt-dlp{EXE}")),
                    root.join("node_modules/yt-dlp-exec/bin").join(format!("yt-dlp{EXE}")),
                ]
                .into_iter()
                .find(|p| p.is_file())
            })
            .unwrap_or_else(|| PathBuf::from("yt-dlp"));

        // Если ffmpeg не найден рядом с проектом — yt-dlp сам поищет его в PATH.
        let ffmpeg = env_path("FFMPEG_PATH")
            .or_else(|| Some(root.join("ffmpeg").join(format!("ffmpeg{EXE}"))).filter(|p| p.is_file()));

        let cookies = env_path("COOKIES_PATH")
            .or_else(|| Some(root.join("cookies.txt")))
            .filter(|p| p.is_file());

        Self {
            port: env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3000),
            public_dir: root.join("public"),
            music_dir: root.join("Data").join("Music"),
            info_dir: root.join("Data").join("Info"),
            db_path: root.join("database.db"),
            ytdlp,
            ffmpeg,
            cookies,
            max_parallel_downloads: env::var("MAX_DOWNLOADS")
                .ok()
                .and_then(|n| n.parse().ok())
                .filter(|&n| n > 0)
                .unwrap_or(2),
        }
    }

    pub fn audio_path(&self, video_id: &str) -> PathBuf {
        self.music_dir.join(format!("{video_id}.opus"))
    }

    pub fn thumb_path(&self, video_id: &str) -> PathBuf {
        self.info_dir.join(format!("{video_id}.jpg"))
    }
}

/// Корень проекта — первая папка с `public/`: текущая или выше неё,
/// затем папка exe и выше (так работает и запуск из target/release).
fn find_root() -> PathBuf {
    let cwd = env::current_dir().expect("не удалось получить текущую папку");
    let exe_dir = env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf));
    [Some(cwd.clone()), exe_dir]
        .into_iter()
        .flatten()
        .flat_map(|start| start.ancestors().map(Path::to_path_buf).collect::<Vec<_>>())
        .find(|dir| dir.join("public").is_dir())
        .unwrap_or(cwd)
}

fn env_path(name: &str) -> Option<PathBuf> {
    env::var_os(name).map(PathBuf::from).filter(|p| Path::new(p).exists())
}
