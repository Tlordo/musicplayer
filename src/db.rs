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
    /// Сколько раз прослушан (см. `Db::record_play`).
    pub plays: i64,
    /// Время последнего прослушивания, unix-секунды.
    pub last_played: Option<i64>,
    /// В избранном.
    pub liked: bool,
    /// Когда добавлен в избранное, unix-секунды.
    pub liked_at: Option<i64>,
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
            plays: r.get("plays")?,
            last_played: r.get("last_played")?,
            liked: r.get::<_, i64>("liked")? != 0,
            liked_at: r.get("liked_at")?,
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
    SELECT u.*, t.abr, t.filesize_mb, t.extension, t.original_url, t.rowid AS added,
           COALESCE(st.plays, 0) AS plays, st.last_played, COALESCE(st.liked, 0) AS liked, st.liked_at
    FROM userData u JOIN techData t ON u.video_id = t.video_id
    LEFT JOIN stats st ON st.video_id = u.video_id";

/// Сводка прослушиваний за период (или за всё время).
#[derive(Debug, Serialize)]
pub struct Stats {
    pub plays: i64,
    pub seconds: f64,
    pub tracks: i64,
    /// [(video_id, прослушиваний, секунд)] — самые слушаемые треки.
    pub top_tracks: Vec<(String, i64, f64)>,
    /// [(исполнитель, прослушиваний, секунд)].
    pub top_artists: Vec<(String, i64, f64)>,
    /// Последние прослушанные треки, без повторов, новые первыми.
    pub recent: Vec<String>,
    /// По дням: [(дата YYYY-MM-DD, прослушиваний, секунд)].
    pub days: Vec<(String, i64, f64)>,
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Своя подборка: имя и упорядоченный список треков.
#[derive(Debug, Clone, Serialize)]
pub struct Album {
    pub id: i64,
    pub name: String,
    pub created: i64,
    pub source_url: Option<String>,
    pub tracks: Vec<String>,
}

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
             );
             CREATE TABLE IF NOT EXISTS albums (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 name TEXT NOT NULL,
                 created INTEGER NOT NULL,
                 source_url TEXT
             );
             CREATE TABLE IF NOT EXISTS album_tracks (
                 album_id INTEGER NOT NULL,
                 video_id TEXT NOT NULL,
                 position INTEGER NOT NULL,
                 PRIMARY KEY (album_id, video_id)
             );
             CREATE TABLE IF NOT EXISTS stats (
                 video_id TEXT PRIMARY KEY,
                 plays INTEGER NOT NULL DEFAULT 0,
                 last_played INTEGER,
                 liked INTEGER NOT NULL DEFAULT 0,
                 liked_at INTEGER
             );
             CREATE TABLE IF NOT EXISTS history (
                 video_id TEXT NOT NULL,
                 at INTEGER NOT NULL,
                 seconds REAL NOT NULL
             );
             CREATE INDEX IF NOT EXISTS history_at ON history(at);",
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

    pub fn has_track(&self, video_id: &str) -> Result<bool> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached("SELECT 1 FROM techData WHERE video_id = ?1")?;
        let found = stmt.exists([video_id])?;
        Ok(found)
    }

    // ============ Альбомы (свои подборки) ============

    pub fn albums(&self) -> Result<Vec<Album>> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached("SELECT id, name, created, source_url FROM albums ORDER BY created DESC, id DESC")?;
        let mut list: Vec<Album> = stmt
            .query_map([], |r| {
                Ok(Album { id: r.get(0)?, name: r.get(1)?, created: r.get(2)?, source_url: r.get(3)?, tracks: Vec::new() })
            })?
            .collect::<rusqlite::Result<_>>()?;
        let mut tracks = conn.prepare_cached(
            "SELECT a.album_id, a.video_id FROM album_tracks a JOIN techData t ON t.video_id = a.video_id
             ORDER BY a.album_id, a.position",
        )?;
        let rows = tracks.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
        for row in rows {
            let (aid, vid) = row?;
            if let Some(a) = list.iter_mut().find(|a| a.id == aid) {
                a.tracks.push(vid);
            }
        }
        Ok(list)
    }

    pub fn album(&self, id: i64) -> Result<Option<Album>> {
        Ok(self.albums()?.into_iter().find(|a| a.id == id))
    }

    pub fn create_album(&self, name: &str, source_url: Option<&str>) -> Result<i64> {
        let conn = self.conn();
        let now = now_secs();
        conn.execute(
            "INSERT INTO albums (name, created, source_url) VALUES (?1, ?2, ?3)",
            params![name, now, source_url],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn rename_album(&self, id: i64, name: &str) -> Result<bool> {
        Ok(self.conn().execute("UPDATE albums SET name = ?2 WHERE id = ?1", params![id, name])? > 0)
    }

    pub fn delete_album(&self, id: i64) -> Result<bool> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM album_tracks WHERE album_id = ?1", [id])?;
        let n = tx.execute("DELETE FROM albums WHERE id = ?1", [id])?;
        tx.commit()?;
        Ok(n > 0)
    }

    /// Добавить трек в конец альбома (повторное добавление ничего не меняет).
    pub fn add_to_album(&self, id: i64, video_id: &str) -> Result<()> {
        self.conn().execute(
            "INSERT OR IGNORE INTO album_tracks (album_id, video_id, position)
             VALUES (?1, ?2, (SELECT COALESCE(MAX(position), 0) + 1 FROM album_tracks WHERE album_id = ?1))",
            params![id, video_id],
        )?;
        Ok(())
    }

    pub fn remove_from_album(&self, id: i64, video_id: &str) -> Result<()> {
        self.conn().execute("DELETE FROM album_tracks WHERE album_id = ?1 AND video_id = ?2", params![id, video_id])?;
        Ok(())
    }

    /// Заменить состав и порядок треков альбома.
    pub fn set_album_tracks(&self, id: i64, ids: &[String]) -> Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM album_tracks WHERE album_id = ?1", [id])?;
        for (i, vid) in ids.iter().enumerate() {
            tx.execute(
                "INSERT OR IGNORE INTO album_tracks (album_id, video_id, position) VALUES (?1, ?2, ?3)",
                params![id, vid, i as i64 + 1],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Все данные треков для экспорта (обе таблицы), в порядке `ids`.
    pub fn export_rows(&self, ids: &[String]) -> Result<Vec<serde_json::Map<String, serde_json::Value>>> {
        use rusqlite::types::ValueRef;
        let conn = self.conn();
        let mut stmt = conn.prepare_cached(
            "SELECT t.format_id, t.extension, t.audio_codec, t.abr, t.filesize_mb, t.original_url,
                    u.title, u.artist, u.album, u.track, u.release_date, u.duration, u.view_count, u.like_count, u.thumbnail_url
             FROM techData t JOIN userData u ON u.video_id = t.video_id WHERE t.video_id = ?1",
        )?;
        let mut out = Vec::new();
        for id in ids {
            let row = stmt
                .query_row([id], |r| {
                    let mut m = serde_json::Map::new();
                    m.insert("video_id".into(), id.clone().into());
                    for (i, name) in r.as_ref().column_names().iter().enumerate() {
                        let v = match r.get_ref(i)? {
                            ValueRef::Null => serde_json::Value::Null,
                            ValueRef::Integer(n) => n.into(),
                            ValueRef::Real(f) => serde_json::Number::from_f64(f).map(Into::into).unwrap_or(serde_json::Value::Null),
                            ValueRef::Text(t) => String::from_utf8_lossy(t).into_owned().into(),
                            ValueRef::Blob(_) => serde_json::Value::Null,
                        };
                        m.insert((*name).to_owned(), v);
                    }
                    Ok(m)
                })
                .optional()?;
            if let Some(m) = row {
                out.push(m);
            }
        }
        Ok(out)
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
        tx.execute("DELETE FROM album_tracks WHERE video_id = ?1", [video_id])?;
        tx.execute("DELETE FROM stats WHERE video_id = ?1", [video_id])?;
        tx.execute("DELETE FROM history WHERE video_id = ?1", [video_id])?;
        let removed = tx.execute("DELETE FROM techData WHERE video_id = ?1", [video_id])?;
        tx.commit()?;
        Ok(if removed > 0 || json_file.is_some() {
            Some(json_file.flatten())
        } else {
            None
        })
    }

    // ============ Прослушивания и избранное ============

    /// Трек прослушан: `seconds` — сколько он реально звучал. false — такого трека нет.
    pub fn record_play(&self, video_id: &str, seconds: f64) -> Result<bool> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        if !tx.prepare_cached("SELECT 1 FROM techData WHERE video_id = ?1")?.exists([video_id])? {
            return Ok(false);
        }
        let now = now_secs();
        tx.execute(
            "INSERT INTO stats (video_id, plays, last_played) VALUES (?1, 1, ?2)
             ON CONFLICT(video_id) DO UPDATE SET plays = plays + 1, last_played = ?2",
            params![video_id, now],
        )?;
        tx.execute(
            "INSERT INTO history (video_id, at, seconds) VALUES (?1, ?2, ?3)",
            params![video_id, now, seconds.max(0.0)],
        )?;
        tx.commit()?;
        Ok(true)
    }

    pub fn set_liked(&self, video_id: &str, liked: bool) -> Result<bool> {
        let conn = self.conn();
        if !conn.prepare_cached("SELECT 1 FROM techData WHERE video_id = ?1")?.exists([video_id])? {
            return Ok(false);
        }
        conn.execute(
            "INSERT INTO stats (video_id, liked, liked_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(video_id) DO UPDATE SET liked = ?2, liked_at = ?3",
            params![video_id, liked as i64, if liked { Some(now_secs()) } else { None }],
        )?;
        Ok(true)
    }

    /// Сводка за последние `days` дней (`None` — за всё время).
    /// `tz_offset_min` — смещение часового пояса устройства, чтобы дни делились по местной полуночи.
    pub fn stats(&self, days: Option<i64>, tz_offset_min: i64) -> Result<Stats> {
        let conn = self.conn();
        let since = days.map(|d| now_secs() - d * 86_400).unwrap_or(0);
        // Только треки, которые ещё в библиотеке.
        let base = "FROM history h JOIN userData u ON u.video_id = h.video_id WHERE h.at >= ?1";

        let (plays, seconds, tracks): (i64, f64, i64) = conn.query_row(
            &format!("SELECT COUNT(*), COALESCE(SUM(h.seconds), 0), COUNT(DISTINCT h.video_id) {base}"),
            [since],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        let triples = |sql: String, arg: i64| -> Result<Vec<(String, i64, f64)>> {
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![since, arg], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            Ok(rows.collect::<rusqlite::Result<_>>()?)
        };
        let top_tracks = triples(
            format!("SELECT h.video_id, COUNT(*) AS n, SUM(h.seconds) {base} GROUP BY h.video_id ORDER BY n DESC, MAX(h.at) DESC LIMIT ?2"),
            20,
        )?;
        let top_artists = triples(
            format!("SELECT COALESCE(NULLIF(u.artist, ''), '—'), COUNT(*) AS n, SUM(h.seconds) {base} GROUP BY 1 ORDER BY n DESC LIMIT ?2"),
            10,
        )?;
        let days = triples(
            format!("SELECT date(h.at + ?2 * 60, 'unixepoch') AS d, COUNT(*), SUM(h.seconds) {base} GROUP BY d ORDER BY d"),
            tz_offset_min,
        )?;
        let mut stmt = conn.prepare(&format!("SELECT h.video_id {base} GROUP BY h.video_id ORDER BY MAX(h.at) DESC LIMIT 30"))?;
        let recent = stmt.query_map([since], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        Ok(Stats { plays, seconds, tracks, top_tracks, top_artists, recent, days })
    }
}
