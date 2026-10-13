use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

/// Техническая информация о выбранном аудиоформате.
#[derive(Debug, Default)]
pub struct TechData {
    pub format_id: Option<String>,
    pub extension: Option<String>,
    pub audio_codec: Option<String>,
    pub abr: Option<f64>,
    pub filesize_mb: Option<f64>,
    pub direct_url: Option<String>,
}

/// Пользовательские метаданные трека (они же пишутся в *_user_info.json).
#[derive(Debug, Default, Serialize)]
pub struct UserData {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub track: String,
    pub release_date: String,
    pub duration: Option<String>,
    pub view_count: Option<i64>,
    pub like_count: Option<i64>,
    pub thumbnail_url: String,
}

/// Трек в том виде, в котором его отдаёт API.
#[derive(Debug, Serialize)]
pub struct Track {
    pub video_id: String,
    pub json_file: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track: Option<String>,
    pub release_date: Option<String>,
    pub duration: Option<String>,
    pub view_count: Option<i64>,
    pub like_count: Option<i64>,
    pub thumbnail_url: Option<String>,
    pub abr: Option<f64>,
    pub filesize_mb: Option<f64>,
    pub extension: Option<String>,
    pub original_url: Option<String>,
    /// Порядок добавления (rowid техзаписи): больше — новее.
    pub added: i64,
    pub file_exists: bool,
    pub thumbnail_api: String,
}

impl Track {
    fn from_row(r: &Row) -> rusqlite::Result<Self> {
        let video_id: String = r.get("video_id")?;
        Ok(Self {
            thumbnail_api: format!("/api/thumbnail/{video_id}"),
            json_file: r.get("json_file")?,
            title: r.get("title")?,
            artist: r.get("artist")?,
            album: r.get("album")?,
            track: r.get("track")?,
            release_date: r.get("release_date")?,
            // sql.js мог сохранить длительность как число — читаем гибко.
            duration: r.get::<_, rusqlite::types::Value>("duration").map(value_to_string)?,
            view_count: r.get("view_count")?,
            like_count: r.get("like_count")?,
            thumbnail_url: r.get("thumbnail_url")?,
            abr: r.get("abr")?,
            filesize_mb: r.get("filesize_mb")?,
            extension: r.get("extension")?,
            original_url: r.get("original_url")?,
            added: r.get("added")?,
            file_exists: false,
            video_id,
        })
    }
}

fn value_to_string(v: rusqlite::types::Value) -> Option<String> {
    use rusqlite::types::Value::*;
    match v {
        Null => None,
        Integer(i) => Some(i.to_string()),
        Real(f) => Some(f.to_string()),
        Text(s) => Some(s),
        Blob(_) => None,
    }
}

const TRACK_SELECT: &str = "
    SELECT u.*, t.abr, t.filesize_mb, t.extension, t.original_url, t.rowid AS added
    FROM userData u JOIN techData t ON u.video_id = t.video_id";

pub struct Db(Mutex<Connection>);

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             CREATE TABLE IF NOT EXISTS techData (
                 video_id TEXT PRIMARY KEY,
                 format_id TEXT,
                 extension TEXT,
                 audio_codec TEXT,
                 abr REAL,
                 filesize_mb REAL,
                 direct_url TEXT,
                 original_url TEXT
             );
             CREATE TABLE IF NOT EXISTS userData (
                 video_id TEXT PRIMARY KEY,
                 json_file TEXT,
                 title TEXT,
                 artist TEXT,
                 album TEXT,
                 track TEXT,
                 release_date TEXT,
                 duration TEXT,
                 view_count INTEGER,
                 like_count INTEGER,
                 thumbnail_url TEXT,
                 FOREIGN KEY (video_id) REFERENCES techData(video_id)
             );",
        )?;

        // Миграция для старых баз без колонки original_url.
        let has_original_url = conn
            .prepare("SELECT 1 FROM pragma_table_info('techData') WHERE name = 'original_url'")?
            .exists([])?;
        if !has_original_url {
            conn.execute("ALTER TABLE techData ADD COLUMN original_url TEXT", [])?;
        }

        Ok(Self(Mutex::new(conn)))
    }

    fn conn(&self) -> MutexGuard<'_, Connection> {
        // Паника в другом потоке не должна навсегда блокировать БД.
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn upsert(
        &self,
        video_id: &str,
        tech: &TechData,
        user: &UserData,
        json_file: &str,
        original_url: &str,
    ) -> Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT OR REPLACE INTO techData
                 (video_id, format_id, extension, audio_codec, abr, filesize_mb, direct_url, original_url)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                video_id,
                tech.format_id,
                tech.extension,
                tech.audio_codec,
                tech.abr,
                tech.filesize_mb,
                tech.direct_url,
                original_url
            ],
        )?;
        tx.execute(
            "INSERT OR REPLACE INTO userData
                 (video_id, json_file, title, artist, album, track, release_date, duration,
                  view_count, like_count, thumbnail_url)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                video_id,
                json_file,
                user.title,
                user.artist,
                user.album,
                user.track,
                user.release_date,
                user.duration,
                user.view_count,
                user.like_count,
                user.thumbnail_url
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn track(&self, video_id: &str) -> Result<Option<Track>> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached(&format!("{TRACK_SELECT} WHERE u.video_id = ?1"))?;
        Ok(stmt.query_row([video_id], Track::from_row).optional()?)
    }

    pub fn library(&self) -> Result<Vec<Track>> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached(&format!(
            "{TRACK_SELECT} ORDER BY u.artist COLLATE NOCASE, u.title COLLATE NOCASE"
        ))?;
        let rows = stmt.query_map([], Track::from_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// video_id последних добавленных треков (новые первыми).
    pub fn recent_ids(&self, n: usize) -> Result<Vec<String>> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached("SELECT video_id FROM techData ORDER BY rowid DESC LIMIT ?1")?;
        let rows = stmt.query_map([n as i64], |r| r.get(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn all_ids(&self) -> Result<std::collections::HashSet<String>> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached("SELECT video_id FROM techData")?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// URL, по которому трек можно скачать заново (None — трека нет в базе).
    pub fn source_url(&self, video_id: &str) -> Result<Option<String>> {
        let conn = self.conn();
        let url: Option<Option<String>> = conn
            .query_row(
                "SELECT original_url FROM techData WHERE video_id = ?1",
                [video_id],
                |r| r.get(0),
            )
            .optional()?;
        Ok(url.map(|u| {
            u.filter(|u| !u.is_empty())
                .unwrap_or_else(|| format!("https://music.youtube.com/watch?v={video_id}"))
        }))
    }

    pub fn thumbnail_url(&self, video_id: &str) -> Result<Option<String>> {
        let conn = self.conn();
        let url: Option<Option<String>> = conn
            .query_row(
                "SELECT thumbnail_url FROM userData WHERE video_id = ?1",
                [video_id],
                |r| r.get(0),
            )
            .optional()?;
        Ok(url.flatten().filter(|u| !u.is_empty()))
    }

    /// Удаляет трек и возвращает имя его json-файла (если был).
    pub fn delete(&self, video_id: &str) -> Result<Option<Option<String>>> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let json_file: Option<Option<String>> = tx
            .query_row(
                "SELECT json_file FROM userData WHERE video_id = ?1",
                [video_id],
                |r| r.get(0),
            )
            .optional()?;
        tx.execute("DELETE FROM userData WHERE video_id = ?1", [video_id])?;
        let removed = tx.execute("DELETE FROM techData WHERE video_id = ?1", [video_id])?;
        tx.commit()?;
        Ok(if removed > 0 || json_file.is_some() {
            Some(json_file.flatten())
        } else {
            None
        })
    }
}
