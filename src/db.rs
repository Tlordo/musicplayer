//! Хранилище медиатеки на SQLite.

use std::path::Path;
use std::sync::{Arc, Mutex};

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::util::{now_unix, parse_duration};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Track {
    pub video_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub track: Option<String>,
    /// Дата публикации в формате YYYY-MM-DD.
    pub release_date: Option<String>,
    pub duration: f64,
    pub view_count: Option<i64>,
    pub like_count: Option<i64>,
    pub thumbnail_url: Option<String>,
    pub original_url: Option<String>,
    pub format_id: Option<String>,
    pub extension: Option<String>,
    pub audio_codec: Option<String>,
    pub abr: Option<f64>,
    pub filesize: Option<i64>,
    pub added_at: i64,
    #[serde(default)]
    pub play_count: i64,
    pub last_played_at: Option<i64>,
    #[serde(default)]
    pub favorite: bool,
}

const TRACK_COLUMNS: &str = "video_id, title, artist, album, track, release_date, duration, \
    view_count, like_count, thumbnail_url, original_url, format_id, extension, audio_codec, \
    abr, filesize, added_at, play_count, last_played_at, favorite";

impl Track {
    fn from_row(r: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            video_id: r.get(0)?,
            title: r.get(1)?,
            artist: r.get(2)?,
            album: r.get(3)?,
            track: r.get(4)?,
            release_date: r.get(5)?,
            duration: r.get(6)?,
            view_count: r.get(7)?,
            like_count: r.get(8)?,
            thumbnail_url: r.get(9)?,
            original_url: r.get(10)?,
            format_id: r.get(11)?,
            extension: r.get(12)?,
            audio_codec: r.get(13)?,
            abr: r.get(14)?,
            filesize: r.get(15)?,
            added_at: r.get(16)?,
            play_count: r.get(17)?,
            last_played_at: r.get(18)?,
            favorite: r.get(19)?,
        })
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub track_ids: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct TrackPatch {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub favorite: Option<bool>,
}

#[derive(Clone)]
pub struct Db(Arc<Mutex<Connection>>);

impl Db {
    pub fn open(path: &Path) -> anyhow::Result<Self> {
        let conn = Connection::open(path)
            .with_context(|| format!("не удалось открыть {}", path.display()))?;
        Self::init(conn)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> anyhow::Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut conn: Connection) -> anyhow::Result<Self> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;",
        )?;
        migrate(&mut conn)?;
        Ok(Self(Arc::new(Mutex::new(conn))))
    }

    /// Выполняет функцию с соединением в пуле блокирующих потоков.
    pub async fn call<F, R>(&self, f: F) -> anyhow::Result<R>
    where
        F: FnOnce(&mut Connection) -> rusqlite::Result<R> + Send + 'static,
        R: Send + 'static,
    {
        let conn = self.0.clone();
        let res = tokio::task::spawn_blocking(move || {
            let mut guard = conn.lock().unwrap_or_else(|e| e.into_inner());
            f(&mut guard)
        })
        .await?;
        Ok(res?)
    }

    pub async fn tracks(&self) -> anyhow::Result<Vec<Track>> {
        self.call(|c| {
            let mut stmt = c.prepare(&format!(
                "SELECT {TRACK_COLUMNS} FROM tracks ORDER BY added_at DESC, rowid DESC"
            ))?;
            let rows = stmt.query_map([], Track::from_row)?;
            rows.collect()
        })
        .await
    }

    pub async fn track(&self, id: &str) -> anyhow::Result<Option<Track>> {
        let id = id.to_owned();
        self.call(move |c| {
            c.query_row(
                &format!("SELECT {TRACK_COLUMNS} FROM tracks WHERE video_id = ?1"),
                [id],
                Track::from_row,
            )
            .optional()
        })
        .await
    }

    /// Добавляет или обновляет трек, сохраняя пользовательские поля
    /// (дата добавления, прослушивания, избранное).
    pub async fn upsert_track(&self, t: Track) -> anyhow::Result<()> {
        self.call(move |c| upsert_track(c, &t)).await
    }

    pub async fn patch_track(&self, id: &str, patch: TrackPatch) -> anyhow::Result<Option<Track>> {
        let id = id.to_owned();
        self.call(move |c| {
            let tx = c.transaction()?;
            let fields = [
                ("title", patch.title),
                ("artist", patch.artist),
                ("album", patch.album),
            ];
            for (col, val) in fields {
                if let Some(v) = val.map(|v| v.trim().to_owned()).filter(|v| !v.is_empty()) {
                    tx.execute(
                        &format!("UPDATE tracks SET {col} = ?1 WHERE video_id = ?2"),
                        params![v, id],
                    )?;
                }
            }
            if let Some(f) = patch.favorite {
                tx.execute(
                    "UPDATE tracks SET favorite = ?1 WHERE video_id = ?2",
                    params![f, id],
                )?;
            }
            let t = tx
                .query_row(
                    &format!("SELECT {TRACK_COLUMNS} FROM tracks WHERE video_id = ?1"),
                    [&id],
                    Track::from_row,
                )
                .optional()?;
            tx.commit()?;
            Ok(t)
        })
        .await
    }

    pub async fn mark_played(&self, id: &str) -> anyhow::Result<bool> {
        let id = id.to_owned();
        self.call(move |c| {
            let n = c.execute(
                "UPDATE tracks SET play_count = play_count + 1, last_played_at = ?1 WHERE video_id = ?2",
                params![now_unix(), id],
            )?;
            Ok(n > 0)
        })
        .await
    }

    pub async fn delete_track(&self, id: &str) -> anyhow::Result<bool> {
        let id = id.to_owned();
        self.call(move |c| Ok(c.execute("DELETE FROM tracks WHERE video_id = ?1", [id])? > 0))
            .await
    }

    pub async fn waveform(&self, id: &str) -> anyhow::Result<Option<Vec<u8>>> {
        let id = id.to_owned();
        self.call(move |c| {
            c.query_row(
                "SELECT waveform FROM tracks WHERE video_id = ?1",
                [id],
                |r| r.get::<_, Option<Vec<u8>>>(0),
            )
            .optional()
            .map(Option::flatten)
        })
        .await
    }

    pub async fn set_waveform(&self, id: &str, peaks: Vec<u8>) -> anyhow::Result<()> {
        let id = id.to_owned();
        self.call(move |c| {
            c.execute(
                "UPDATE tracks SET waveform = ?1 WHERE video_id = ?2",
                params![peaks, id],
            )?;
            Ok(())
        })
        .await
    }

    // ---------- Плейлисты ----------

    pub async fn playlists(&self) -> anyhow::Result<Vec<Playlist>> {
        self.call(|c| {
            let mut stmt = c.prepare(
                "SELECT id, name, created_at FROM playlists ORDER BY name COLLATE NOCASE",
            )?;
            let mut lists: Vec<Playlist> = stmt
                .query_map([], |r| {
                    Ok(Playlist {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        created_at: r.get(2)?,
                        track_ids: vec![],
                    })
                })?
                .collect::<Result<_, _>>()?;
            let mut items = c.prepare(
                "SELECT video_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position",
            )?;
            for p in &mut lists {
                p.track_ids = items
                    .query_map([p.id], |r| r.get(0))?
                    .collect::<Result<_, _>>()?;
            }
            Ok(lists)
        })
        .await
    }

    pub async fn create_playlist(&self, name: String) -> anyhow::Result<Playlist> {
        self.call(move |c| {
            let now = now_unix();
            c.execute(
                "INSERT INTO playlists (name, created_at) VALUES (?1, ?2)",
                params![name, now],
            )?;
            Ok(Playlist {
                id: c.last_insert_rowid(),
                name,
                created_at: now,
                track_ids: vec![],
            })
        })
        .await
    }

    pub async fn rename_playlist(&self, id: i64, name: String) -> anyhow::Result<bool> {
        self.call(move |c| {
            Ok(c.execute(
                "UPDATE playlists SET name = ?1 WHERE id = ?2",
                params![name, id],
            )? > 0)
        })
        .await
    }

    pub async fn delete_playlist(&self, id: i64) -> anyhow::Result<bool> {
        self.call(move |c| Ok(c.execute("DELETE FROM playlists WHERE id = ?1", [id])? > 0))
            .await
    }

    /// Полностью заменяет содержимое плейлиста (используется и для сортировки).
    /// Возвращает `false`, если плейлиста нет.
    pub async fn set_playlist_tracks(&self, id: i64, ids: Vec<String>) -> anyhow::Result<bool> {
        self.call(move |c| {
            let tx = c.transaction()?;
            let exists: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM playlists WHERE id = ?1)",
                [id],
                |r| r.get(0),
            )?;
            if !exists {
                return Ok(false);
            }
            tx.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1", [id])?;
            {
                let mut ins = tx.prepare(
                    "INSERT OR IGNORE INTO playlist_tracks (playlist_id, video_id, position)
                     SELECT ?1, video_id, ?3 FROM tracks WHERE video_id = ?2",
                )?;
                for (pos, vid) in ids.iter().enumerate() {
                    ins.execute(params![id, vid, pos as i64])?;
                }
            }
            tx.commit()?;
            Ok(true)
        })
        .await
    }

    pub async fn add_to_playlist(&self, id: i64, video_id: String) -> anyhow::Result<bool> {
        self.call(move |c| {
            let n = c.execute(
                "INSERT OR IGNORE INTO playlist_tracks (playlist_id, video_id, position)
                 SELECT p.id, t.video_id,
                        (SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_id = p.id)
                 FROM playlists p, tracks t WHERE p.id = ?1 AND t.video_id = ?2",
                params![id, video_id],
            )?;
            Ok(n > 0)
        })
        .await
    }

    pub async fn remove_from_playlist(&self, id: i64, video_id: String) -> anyhow::Result<bool> {
        self.call(move |c| {
            Ok(c.execute(
                "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND video_id = ?2",
                params![id, video_id],
            )? > 0)
        })
        .await
    }
}

fn upsert_track(c: &Connection, t: &Track) -> rusqlite::Result<()> {
    c.execute(
        &format!(
            "INSERT INTO tracks ({TRACK_COLUMNS})
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
             ON CONFLICT(video_id) DO UPDATE SET
               title = excluded.title, artist = excluded.artist, album = excluded.album,
               track = excluded.track, release_date = excluded.release_date, duration = excluded.duration,
               view_count = excluded.view_count, like_count = excluded.like_count,
               thumbnail_url = excluded.thumbnail_url,
               original_url = COALESCE(excluded.original_url, tracks.original_url),
               format_id = excluded.format_id, extension = excluded.extension,
               audio_codec = excluded.audio_codec, abr = excluded.abr, filesize = excluded.filesize"
        ),
        params![
            t.video_id,
            t.title,
            t.artist,
            t.album,
            t.track,
            t.release_date,
            t.duration,
            t.view_count,
            t.like_count,
            t.thumbnail_url,
            t.original_url,
            t.format_id,
            t.extension,
            t.audio_codec,
            t.abr,
            t.filesize,
            t.added_at,
            t.play_count,
            t.last_played_at,
            t.favorite,
        ],
    )?;
    Ok(())
}

fn migrate(conn: &mut Connection) -> anyhow::Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 1 {
        let tx = conn.transaction()?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS tracks (
                video_id       TEXT PRIMARY KEY,
                title          TEXT NOT NULL,
                artist         TEXT NOT NULL,
                album          TEXT NOT NULL,
                track          TEXT,
                release_date   TEXT,
                duration       REAL NOT NULL DEFAULT 0,
                view_count     INTEGER,
                like_count     INTEGER,
                thumbnail_url  TEXT,
                original_url   TEXT,
                format_id      TEXT,
                extension      TEXT,
                audio_codec    TEXT,
                abr            REAL,
                filesize       INTEGER,
                added_at       INTEGER NOT NULL,
                play_count     INTEGER NOT NULL DEFAULT 0,
                last_played_at INTEGER,
                favorite       INTEGER NOT NULL DEFAULT 0,
                waveform       BLOB
             );
             CREATE TABLE IF NOT EXISTS playlists (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL,
                created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS playlist_tracks (
                playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                video_id    TEXT NOT NULL REFERENCES tracks(video_id) ON DELETE CASCADE,
                position    INTEGER NOT NULL,
                PRIMARY KEY (playlist_id, video_id)
             );",
        )?;
        let imported = import_legacy(&tx)?;
        tx.execute_batch("PRAGMA user_version = 1")?;
        tx.commit()?;
        if imported > 0 {
            tracing::info!("импортировано из базы старой версии, треков: {imported}");
        }
    }
    Ok(())
}

/// Переносит данные из таблиц `techData`/`userData` версии на Node.js.
fn import_legacy(c: &Connection) -> rusqlite::Result<usize> {
    let has_legacy: bool = c.query_row(
        "SELECT COUNT(*) = 2 FROM sqlite_master WHERE type = 'table' AND name IN ('techData', 'userData')",
        [],
        |r| r.get(0),
    )?;
    if !has_legacy {
        return Ok(0);
    }
    // В старой схеме колонки original_url могло не быть.
    let has_original_url = c
        .prepare("SELECT original_url FROM techData LIMIT 0")
        .is_ok();
    let original_url = if has_original_url {
        "t.original_url"
    } else {
        "NULL"
    };
    let mut stmt = c.prepare(&format!(
        "SELECT u.video_id, u.title, u.artist, u.album, u.track, u.release_date, u.duration,
                u.view_count, u.like_count, u.thumbnail_url, {original_url},
                t.format_id, t.extension, t.audio_codec, t.abr, t.filesize_mb
         FROM userData u LEFT JOIN techData t ON t.video_id = u.video_id"
    ))?;
    let base = now_unix();
    let rows: Vec<Track> = stmt
        .query_map([], |r| {
            let date: Option<String> = r.get(5)?;
            let dur: Option<String> = r.get(6)?;
            let size_mb: Option<f64> = r.get(15)?;
            Ok(Track {
                video_id: r.get(0)?,
                title: r
                    .get::<_, Option<String>>(1)?
                    .unwrap_or_else(|| "Без названия".into()),
                artist: r
                    .get::<_, Option<String>>(2)?
                    .unwrap_or_else(|| "Unknown".into()),
                album: r
                    .get::<_, Option<String>>(3)?
                    .unwrap_or_else(|| "Single".into()),
                track: r.get::<_, Option<String>>(4)?.filter(|s| s != "Unknown"),
                release_date: date.as_deref().and_then(legacy_date),
                duration: dur.as_deref().and_then(parse_duration).unwrap_or(0.0),
                view_count: r.get(7)?,
                like_count: r.get(8)?,
                thumbnail_url: r.get(9)?,
                original_url: r.get(10)?,
                format_id: r.get(11)?,
                extension: r.get(12)?,
                audio_codec: r.get(13)?,
                abr: r.get(14)?,
                filesize: size_mb.map(|mb| (mb * 1024.0 * 1024.0) as i64),
                ..Default::default()
            })
        })?
        .collect::<Result<_, _>>()?;
    let n = rows.len();
    for (i, mut t) in rows.into_iter().enumerate() {
        // Сохраняем исходный порядок: более ранние записи — «старше».
        t.added_at = base - (n - i) as i64;
        upsert_track(c, &t)?;
    }
    Ok(n)
}

/// `DD.MM.YYYY` → `YYYY-MM-DD`.
fn legacy_date(s: &str) -> Option<String> {
    let mut it = s.split('.');
    let (d, m, y) = (it.next()?, it.next()?, it.next()?);
    (d.len() == 2 && m.len() == 2 && y.len() == 4).then(|| format!("{y}-{m}-{d}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str) -> Track {
        Track {
            video_id: id.into(),
            title: format!("Song {id}"),
            artist: "Artist".into(),
            album: "Album".into(),
            duration: 200.0,
            added_at: 1,
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn upsert_preserves_user_fields() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_track(sample("a")).await.unwrap();
        db.patch_track(
            "a",
            TrackPatch {
                favorite: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        db.mark_played("a").await.unwrap();
        let mut updated = sample("a");
        updated.title = "New".into();
        db.upsert_track(updated).await.unwrap();
        let t = db.track("a").await.unwrap().unwrap();
        assert_eq!(t.title, "New");
        assert!(t.favorite);
        assert_eq!(t.play_count, 1);
    }

    #[tokio::test]
    async fn playlists_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        for id in ["a", "b", "c"] {
            db.upsert_track(sample(id)).await.unwrap();
        }
        let p = db.create_playlist("Mix".into()).await.unwrap();
        assert!(db.add_to_playlist(p.id, "b".into()).await.unwrap());
        assert!(db.add_to_playlist(p.id, "a".into()).await.unwrap());
        assert!(!db.add_to_playlist(p.id, "missing".into()).await.unwrap());
        assert_eq!(db.playlists().await.unwrap()[0].track_ids, ["b", "a"]);

        db.set_playlist_tracks(p.id, vec!["c".into(), "a".into(), "zzz".into()])
            .await
            .unwrap();
        assert_eq!(db.playlists().await.unwrap()[0].track_ids, ["c", "a"]);

        db.delete_track("c").await.unwrap();
        assert_eq!(db.playlists().await.unwrap()[0].track_ids, ["a"]);
        assert!(db.delete_playlist(p.id).await.unwrap());
        assert!(db.playlists().await.unwrap().is_empty());
    }

    #[test]
    fn imports_legacy_schema() {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE techData (video_id TEXT PRIMARY KEY, format_id TEXT, extension TEXT, audio_codec TEXT,
                abr REAL, filesize_mb REAL, direct_url TEXT, original_url TEXT);
             CREATE TABLE userData (video_id TEXT PRIMARY KEY, json_file TEXT, title TEXT, artist TEXT, album TEXT,
                track TEXT, release_date TEXT, duration TEXT, view_count INTEGER, like_count INTEGER, thumbnail_url TEXT);
             INSERT INTO techData VALUES ('abc', '251', 'webm', 'opus', 130.5, 3.5, 'x', 'https://youtu.be/abc');
             INSERT INTO userData VALUES ('abc', 'f.json', 'T', 'A', 'Single', 'Unknown', '05.03.2021', '1:02:03', 10, 2, 'u');",
        )
        .unwrap();
        migrate(&mut c).unwrap();
        let t = c
            .query_row(
                &format!("SELECT {TRACK_COLUMNS} FROM tracks"),
                [],
                Track::from_row,
            )
            .unwrap();
        assert_eq!(t.video_id, "abc");
        assert_eq!(t.release_date.as_deref(), Some("2021-03-05"));
        assert_eq!(t.duration, 3723.0);
        assert_eq!(t.track, None);
        assert_eq!(t.filesize, Some((3.5 * 1024.0 * 1024.0) as i64));
        assert_eq!(t.original_url.as_deref(), Some("https://youtu.be/abc"));
        // Повторная миграция ничего не ломает.
        migrate(&mut c).unwrap();
    }
}
