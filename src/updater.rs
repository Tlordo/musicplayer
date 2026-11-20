//! Самообновление yt-dlp. YouTube меняется часто, и через пару недель старый yt-dlp
//! перестаёт скачивать. Поэтому сервер обновляет его сам: при запуске, раз в сутки
//! и сразу, если скачивание сломалось (тогда — и повторяет загрузку).

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::Result;
use serde::Serialize;

use crate::config::Config;
use crate::server_settings::Settings;

/// Как часто фоновая проверка смотрит, не пора ли обновиться.
const BACKGROUND_PERIOD: Duration = Duration::from_secs(6 * 3600);
/// Плановое обновление — не чаще раза в сутки (с запасом на неточность таймера).
const SCHEDULED_GAP: Duration = Duration::from_secs(20 * 3600);
/// После сломанного скачивания — не чаще раза в час, чтобы не долбить GitHub на каждой ошибке.
pub const ON_FAILURE_GAP: Duration = Duration::from_secs(3600);

#[derive(Debug, Clone, Serialize)]
pub struct UpdateResult {
    pub ok: bool,
    pub output: String,
    pub before: String,
    pub after: String,
    /// Unix-время проверки, секунды.
    pub at: i64,
}

impl UpdateResult {
    pub fn changed(&self) -> bool {
        self.ok && !self.after.is_empty() && self.before != self.after
    }
}

pub struct Updater {
    cfg: Arc<Config>,
    /// Время последней попытки; заодно не даёт двум обновлениям идти одновременно.
    last_try: tokio::sync::Mutex<Option<Instant>>,
    last: Mutex<Option<UpdateResult>>,
}

impl Updater {
    pub fn new(cfg: Arc<Config>) -> Self {
        Self { cfg, last_try: tokio::sync::Mutex::new(None), last: Mutex::new(None) }
    }

    /// Итог последней проверки — для настроек.
    pub fn last(&self) -> Option<UpdateResult> {
        self.last.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub async fn version(&self) -> String {
        match crate::ytdlp::run(&self.cfg, vec!["--version".into()], Duration::from_secs(20)).await {
            Ok(o) if o.ok => o.stdout.lines().next().unwrap_or("").trim().to_owned(),
            _ => String::new(),
        }
    }

    /// Обновить yt-dlp, если с прошлой попытки прошло не меньше `min_gap`.
    /// `None` — пропущено: пробовали недавно.
    pub async fn update(&self, min_gap: Duration) -> Result<Option<UpdateResult>> {
        let mut last_try = self.last_try.lock().await;
        if matches!(*last_try, Some(t) if t.elapsed() < min_gap) {
            return Ok(None);
        }
        *last_try = Some(Instant::now());

        let before = self.version().await;
        let out = crate::ytdlp::run(&self.cfg, vec!["-U".into()], Duration::from_secs(180)).await?;
        let after = self.version().await;
        let res = UpdateResult {
            ok: out.ok,
            output: format!("{}{}", out.stdout, out.stderr).trim().to_owned(),
            before,
            after,
            at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_secs() as i64),
        };
        if res.changed() {
            tracing::info!("yt-dlp обновлён: {} → {}", res.before, res.after);
        } else if res.ok {
            tracing::info!("yt-dlp {} — свежий", res.after);
        } else {
            tracing::warn!("не удалось обновить yt-dlp: {}", res.output);
        }
        *self.last.lock().unwrap_or_else(|e| e.into_inner()) = Some(res.clone());
        Ok(Some(res))
    }

    /// Фоновая проверка: вскоре после запуска и дальше раз в сутки (если включено в настройках).
    pub fn spawn_background(self: &Arc<Self>, settings: Arc<Settings>) {
        let Ok(rt) = tokio::runtime::Handle::try_current() else { return };
        let this = Arc::clone(self);
        rt.spawn(async move {
            // Не мешаем запуску: сначала пусть откроется интерфейс.
            tokio::time::sleep(Duration::from_secs(15)).await;
            loop {
                if settings.get().auto_update_ytdlp {
                    if let Err(e) = this.update(SCHEDULED_GAP).await {
                        tracing::warn!("проверка обновлений yt-dlp: {e:#}");
                    }
                }
                tokio::time::sleep(BACKGROUND_PERIOD).await;
            }
        });
    }
}

/// Ошибка, которую обновление yt-dlp не исправит: видео закрыто, удалено, ссылка неверная.
/// На остальное (YouTube что-то поменял — «Unable to extract», «Sign in to confirm», 403…) стоит попробовать.
pub fn is_content_error(msg: &str) -> bool {
    let m = msg.to_lowercase();
    [
        "private video",
        "video unavailable",
        "this video is not available",
        "has been removed",
        "members-only",
        "join this channel",
        "unsupported url",
        "is not a valid url",
        "copyright",
        "premieres in",
        "live event will begin",
        "не ответил вовремя",
    ]
    .iter()
    .any(|p| m.contains(p))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_errors() {
        assert!(is_content_error("yt-dlp: ERROR: [youtube] abc: Private video. Sign in if you've been granted access"));
        assert!(is_content_error("ERROR: [youtube] abc: Video unavailable"));
        assert!(!is_content_error("ERROR: [youtube] abc: Unable to extract uploader id"));
        assert!(!is_content_error("ERROR: unable to download video data: HTTP Error 403: Forbidden"));
    }

    #[test]
    fn changed_only_when_version_moves() {
        let r = |b: &str, a: &str| UpdateResult { ok: true, output: String::new(), before: b.into(), after: a.into(), at: 0 };
        assert!(r("2026.10.01", "2026.11.15").changed());
        assert!(!r("2026.11.15", "2026.11.15").changed());
        assert!(!r("2026.11.15", "").changed());
    }
}
