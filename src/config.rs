use std::env;
use std::path::{Path, PathBuf};

/// Все пути и настройки приложения. Переопределяются переменными окружения.
#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub public_dir: PathBuf,
    pub music_dir: PathBuf,
    pub info_dir: PathBuf,
    pub tmp_dir: PathBuf,
    /// Папка Data: музыка, обложки, временные файлы, журнал.
    pub data_dir: PathBuf,
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
        Self::for_root(root)
    }

    /// Все пути — внутри `root` (на Android это папка приложения); переменные окружения по-прежнему действуют.
    pub fn for_root(root: PathBuf) -> Self {

        let ytdlp = env_path("YTDLP_PATH")
            .or_else(|| {
                [
                    root.join(format!("yt-dlp{EXE}")),
                    root.join("bin").join(format!("yt-dlp{EXE}")),
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
            tmp_dir: root.join("Data").join("tmp"),
            data_dir: root.join("Data"),
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

    pub fn peaks_path(&self, video_id: &str) -> PathBuf {
        self.info_dir.join(format!("{video_id}.peaks.json"))
    }

    /// ffmpeg для собственных нужд сервера (форма волны): рядом с проектом или из PATH.
    pub fn ffmpeg_cmd(&self) -> PathBuf {
        self.ffmpeg.clone().unwrap_or_else(|| PathBuf::from("ffmpeg"))
    }
}

/// Корень проекта — первая папка с интерфейсом `public/index.html`: сначала рядом с программой
/// (переносная версия, target/release), потом от текущей папки.
///
/// Признак — именно index.html, а не папка «public»: в Windows регистр не важен,
/// и иначе за проект сошла бы системная папка «Users/Public».
fn find_root() -> PathBuf {
    let has_ui = |d: &Path| d.join("public").join("index.html").is_file();
    let exe_dir = env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf));
    let cwd = env::current_dir().ok();
    exe_dir
        .iter()
        .chain(cwd.iter())
        .flat_map(|start| start.ancestors().map(Path::to_path_buf).collect::<Vec<_>>())
        .find(|d| has_ui(d))
        .or(exe_dir)
        .or(cwd)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn env_path(name: &str) -> Option<PathBuf> {
    env::var_os(name).map(PathBuf::from).filter(|p| Path::new(p).exists())
}
