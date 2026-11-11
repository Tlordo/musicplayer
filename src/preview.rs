//! Прослушивание трека с YouTube до скачивания: найденный в поиске или в рекомендациях
//! трек играет сразу, а не через минуту загрузки.
//!
//! yt-dlp один раз узнаёт прямую ссылку на аудиопоток (`-g`), она кэшируется на пару часов
//! (у ссылок YouTube срок жизни ~6 ч). Сервер проксирует поток как есть, вместе с Range —
//! перемотка работает, а в памяти держится только текущий кусок, а не весь файл.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};

use crate::config::Config;

const TTL: Duration = Duration::from_secs(2 * 3600);
const MAX_CACHED: usize = 64;

pub struct Preview {
    cfg: Arc<Config>,
    http: reqwest::Client,
    urls: Mutex<HashMap<String, (Instant, String)>>,
    /// Не запускать два yt-dlp ради одного и того же трека.
    resolving: tokio::sync::Mutex<()>,
}

impl Preview {
    pub fn new(cfg: Arc<Config>) -> Self {
        Self {
            cfg,
            // Без общего таймаута: поток может идти долго. Ограничиваем только соединение.
            http: reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")
                .connect_timeout(Duration::from_secs(15))
                .build()
                .expect("не удалось создать HTTP-клиент"),
            urls: Mutex::new(HashMap::new()),
            resolving: tokio::sync::Mutex::new(()),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, (Instant, String)>> {
        self.urls.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn cached(&self, id: &str) -> Option<String> {
        self.lock().get(id).filter(|(at, _)| at.elapsed() < TTL).map(|(_, u)| u.clone())
    }

    pub fn forget(&self, id: &str) {
        self.lock().remove(id);
    }

    /// Прямая ссылка на аудио. m4a (AAC) играет везде, включая Safari на iPhone; иначе — что есть.
    pub async fn resolve(&self, id: &str) -> Result<String> {
        if let Some(u) = self.cached(id) {
            return Ok(u);
        }
        let _one = self.resolving.lock().await;
        if let Some(u) = self.cached(id) {
            return Ok(u);
        }
        let mut args = crate::ytdlp::base_args(&self.cfg);
        args.extend(["-g", "--no-playlist", "-f", "bestaudio[ext=m4a]/bestaudio/best", "--"].map(String::from));
        args.push(format!("https://www.youtube.com/watch?v={id}"));
        let out = crate::ytdlp::run_ok(&self.cfg, args, Duration::from_secs(60)).await?;
        let url = out
            .lines()
            .map(str::trim)
            .find(|l| l.starts_with("http"))
            .context("yt-dlp не вернул ссылку на поток")?
            .to_owned();

        let mut map = self.lock();
        if map.len() >= MAX_CACHED {
            map.retain(|_, (at, _)| at.elapsed() < TTL);
            if map.len() >= MAX_CACHED {
                if let Some(oldest) = map.iter().min_by_key(|(_, (at, _))| *at).map(|(k, _)| k.clone()) {
                    map.remove(&oldest);
                }
            }
        }
        map.insert(id.to_owned(), (Instant::now(), url.clone()));
        Ok(url)
    }

    /// Запрос к YouTube с тем же Range, что прислал браузер.
    pub async fn fetch(&self, url: &str, range: Option<&str>) -> Result<reqwest::Response> {
        let mut req = self.http.get(url);
        if let Some(r) = range {
            req = req.header(reqwest::header::RANGE, r);
        }
        let res = req.send().await?;
        if !(res.status().is_success() || res.status().as_u16() == 206) {
            bail!("YouTube ответил {}", res.status());
        }
        Ok(res)
    }
}
