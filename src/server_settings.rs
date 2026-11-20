//! Настройки, которые живут на сервере (а не в браузере): они влияют на скачивание,
//! поэтому общие для всех устройств. Хранятся в `Data/settings.json`.

use std::path::PathBuf;
use std::sync::Mutex;

use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct ServerSettings {
    /// Вырезать из клипов не-музыку (разговоры, вступления, тишину) по данным SponsorBlock.
    pub sponsorblock: bool,
    /// Сам обновлять yt-dlp: при запуске, раз в сутки и когда скачивание сломалось.
    pub auto_update_ytdlp: bool,
}

impl Default for ServerSettings {
    fn default() -> Self {
        Self { sponsorblock: false, auto_update_ytdlp: true }
    }
}

/// Частичное изменение: `PATCH /api/settings` присылает только то, что поменялось.
#[derive(Debug, Default, Deserialize)]
pub struct Patch {
    pub sponsorblock: Option<bool>,
    pub auto_update_ytdlp: Option<bool>,
}

pub struct Settings {
    path: PathBuf,
    cur: Mutex<ServerSettings>,
}

impl Settings {
    pub fn load(path: PathBuf) -> Self {
        let cur = std::fs::read(&path)
            .ok()
            .and_then(|b| match serde_json::from_slice::<ServerSettings>(&b) {
                Ok(s) => Some(s),
                Err(e) => {
                    tracing::warn!("{}: {e} — беру настройки по умолчанию", path.display());
                    None
                }
            })
            .unwrap_or_default();
        Self { path, cur: Mutex::new(cur) }
    }

    pub fn get(&self) -> ServerSettings {
        self.lock().clone()
    }

    pub fn apply(&self, patch: Patch) -> Result<ServerSettings> {
        let mut cur = self.lock();
        let mut next = cur.clone();
        if let Some(v) = patch.sponsorblock {
            next.sponsorblock = v;
        }
        if let Some(v) = patch.auto_update_ytdlp {
            next.auto_update_ytdlp = v;
        }
        if next != *cur {
            // Атомарно: сначала во временный файл, потом rename — без битого файла при сбое.
            let tmp = self.path.with_extension("json.part");
            std::fs::write(&tmp, serde_json::to_vec_pretty(&next)?)?;
            std::fs::rename(&tmp, &self.path)?;
            *cur = next.clone();
        }
        Ok(next)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, ServerSettings> {
        self.cur.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_partial_file() {
        let s: ServerSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(s, ServerSettings::default());
        assert!(s.auto_update_ytdlp && !s.sponsorblock);
        let s: ServerSettings = serde_json::from_str(r#"{"sponsorblock":true}"#).unwrap();
        assert!(s.sponsorblock && s.auto_update_ytdlp);
    }

    #[test]
    fn patch_is_saved() {
        let dir = std::env::temp_dir().join(format!("mk-settings-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        let s = Settings::load(path.clone());
        s.apply(Patch { sponsorblock: Some(true), ..Default::default() }).unwrap();
        assert!(Settings::load(path).get().sponsorblock);
        let _ = std::fs::remove_dir_all(dir);
    }
}
