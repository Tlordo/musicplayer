use std::net::IpAddr;
use std::path::PathBuf;

use clap::Parser;

/// Локальная медиатека и плеер для аудио с YouTube / YouTube Music.
#[derive(Parser, Debug, Clone)]
#[command(version, about)]
pub struct Config {
    /// Адрес для прослушивания. Используйте 0.0.0.0, чтобы открыть плеер в локальной сети.
    #[arg(long, env = "HOST", default_value = "127.0.0.1")]
    pub host: IpAddr,

    /// Порт HTTP-сервера.
    #[arg(long, short, env = "PORT", default_value_t = 3000)]
    pub port: u16,

    /// Каталог с данными (внутри создаются Music/ и Info/).
    #[arg(long, env = "MUSIC_DATA_DIR", default_value = "Data")]
    pub data_dir: PathBuf,

    /// Путь к файлу базы данных SQLite (совместим со старой версией на Node.js).
    #[arg(long, env = "MUSIC_DB", default_value = "database.db")]
    pub db: PathBuf,

    /// Исполняемый файл yt-dlp.
    #[arg(long, env = "YTDLP_PATH", default_value = "yt-dlp")]
    pub ytdlp: PathBuf,

    /// Исполняемый файл ffmpeg. По умолчанию — ./ffmpeg/ffmpeg(.exe), если есть, иначе из PATH.
    #[arg(long, env = "FFMPEG_PATH")]
    pub ffmpeg: Option<PathBuf>,

    /// Файл cookies.txt для yt-dlp. По умолчанию — ./cookies.txt, если он существует.
    #[arg(long, env = "COOKIES_PATH")]
    pub cookies: Option<PathBuf>,

    /// Открыть плеер в браузере после запуска.
    #[arg(long, env = "MUSIC_OPEN")]
    pub open: bool,

    /// Сколько треков скачивать одновременно.
    #[arg(long, env = "MUSIC_PARALLEL", default_value_t = 2)]
    pub parallel: usize,
}

impl Config {
    pub fn music_dir(&self) -> PathBuf {
        self.data_dir.join("Music")
    }

    pub fn info_dir(&self) -> PathBuf {
        self.data_dir.join("Info")
    }

    /// Разрешает значения по умолчанию, зависящие от файловой системы.
    pub fn resolve(mut self) -> Self {
        if self.ffmpeg.is_none() {
            let local = if cfg!(windows) {
                "ffmpeg/ffmpeg.exe"
            } else {
                "ffmpeg/ffmpeg"
            };
            let local = PathBuf::from(local);
            self.ffmpeg = Some(if local.exists() {
                local
            } else {
                PathBuf::from("ffmpeg")
            });
        }
        // yt-dlp, лежащий рядом с программой, важнее системного.
        if self.ytdlp.as_os_str() == "yt-dlp" {
            let local = PathBuf::from(if cfg!(windows) {
                "yt-dlp.exe"
            } else {
                "yt-dlp"
            });
            if local.is_file() {
                self.ytdlp = std::path::Path::new(".").join(local);
            }
        }
        if self.cookies.is_none() {
            let local = PathBuf::from("cookies.txt");
            if local.exists() {
                self.cookies = Some(local);
            }
        }
        self.parallel = self.parallel.max(1);
        self
    }

    pub fn ffmpeg(&self) -> PathBuf {
        self.ffmpeg
            .clone()
            .unwrap_or_else(|| PathBuf::from("ffmpeg"))
    }
}
