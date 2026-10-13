//! Перенос альбомов между устройствами: архив .zip с музыкой, обложками и manifest.json.
//!
//! Внутри архива:
//!   manifest.json            — формат `mk-album`, имя альбома и данные каждого трека
//!   music/NN - Исполнитель - Название.opus
//!   covers/<video_id>.jpg
//! Файлы музыки уже сжаты (Opus), поэтому кладутся без сжатия — экспорт быстрый.
//! Тот же архив годится и «просто скачать себе»: его можно открыть проводником.

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use anyhow::{bail, Context, Result};
use serde::Serialize;
use serde_json::{json, Map, Value};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::config::Config;
use crate::db::{Db, TechData, UserData};
use crate::downloader::is_valid_video_id;

const FORMAT: &str = "mk-album";
const MANIFEST_LIMIT: u64 = 16 * 1024 * 1024;

/// Имя файла без символов, которые не любят Windows и архиваторы.
pub fn safe_name(s: &str, max: usize) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| if r#"\/:*?"<>|"#.contains(c) || c.is_control() { ' ' } else { c })
        .collect();
    let mut out: String = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if out.chars().count() > max {
        out = out.chars().take(max).collect();
    }
    let out = out.trim().trim_end_matches('.').to_owned();
    if out.is_empty() { "album".into() } else { out }
}

/// Удалить старые временные архивы (экспорт отдаётся файлом и потом не нужен).
pub fn cleanup_tmp(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let old = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| SystemTime::now().duration_since(t).ok())
            .is_some_and(|age| age > Duration::from_secs(3600));
        if old {
            let _ = fs::remove_file(e.path());
        }
    }
}

fn str_of(m: &Map<String, Value>, k: &str) -> Option<String> {
    m.get(k).and_then(Value::as_str).map(str::to_owned)
}

/// Собрать архив альбома во временный файл. Блокирующая работа — вызывать из spawn_blocking.
pub fn export(cfg: &Config, db: &Db, name: &str, ids: &[String]) -> Result<PathBuf> {
    cleanup_tmp(&cfg.tmp_dir);
    let rows = db.export_rows(ids)?;
    if rows.is_empty() {
        bail!("в альбоме нет треков");
    }
    let stamp = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let path = cfg.tmp_dir.join(format!("export-{stamp}.zip"));
    let mut zip = ZipWriter::new(File::create(&path).context("не удалось создать архив")?);
    let stored = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .large_file(true);

    let mut tracks = Vec::new();
    for (i, row) in rows.iter().enumerate() {
        let id = str_of(row, "video_id").unwrap_or_default();
        let audio = cfg.audio_path(&id);
        if !audio.is_file() {
            continue; // файла нет на этом устройстве — переносить нечего
        }
        let label = format!(
            "{:02} - {} - {}",
            i + 1,
            str_of(row, "artist").unwrap_or_default(),
            str_of(row, "title").unwrap_or_default()
        );
        let file = format!("music/{} [{id}].opus", safe_name(&label, 120));
        zip.start_file(file.as_str(), stored)?;
        io::copy(&mut File::open(&audio)?, &mut zip)?;

        let thumb = cfg.thumb_path(&id);
        let cover = if thumb.is_file() {
            let c = format!("covers/{id}.jpg");
            zip.start_file(c.as_str(), stored)?;
            io::copy(&mut File::open(&thumb)?, &mut zip)?;
            Value::String(c)
        } else {
            Value::Null
        };
        tracks.push(json!({ "video_id": id, "file": file, "cover": cover, "meta": row }));
    }
    if tracks.is_empty() {
        bail!("на этом устройстве нет файлов треков этого альбома");
    }

    let manifest = json!({
        "format": FORMAT,
        "version": 1,
        "name": name,
        "exported_at": SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
        "tracks": tracks,
    });
    zip.start_file("manifest.json", SimpleFileOptions::default().compression_method(CompressionMethod::Stored))?;
    zip.write_all(serde_json::to_string_pretty(&manifest)?.as_bytes())?;
    zip.finish()?;
    Ok(path)
}

#[derive(Debug, Serialize)]
pub struct ImportReport {
    pub name: String,
    pub album_id: i64,
    pub imported: usize,
    pub skipped: usize,
    pub failed: usize,
}

/// Распаковать архив альбома: новые треки — в библиотеку, всё — в новый альбом.
/// Блокирующая работа — вызывать из spawn_blocking.
pub fn import(cfg: &Config, db: &Db, zip_path: &Path) -> Result<ImportReport> {
    let mut zip = ZipArchive::new(File::open(zip_path)?).context("это не zip-архив")?;
    let manifest: Value = {
        let entry = zip.by_name("manifest.json").context("в архиве нет manifest.json — это не альбом МК-60")?;
        if entry.size() > MANIFEST_LIMIT {
            bail!("manifest.json слишком большой");
        }
        let mut s = String::new();
        entry.take(MANIFEST_LIMIT).read_to_string(&mut s)?;
        serde_json::from_str(&s).context("manifest.json повреждён")?
    };
    if manifest["format"].as_str() != Some(FORMAT) {
        bail!("неизвестный формат архива");
    }
    let name = manifest["name"].as_str().filter(|s| !s.trim().is_empty()).unwrap_or("Импорт").trim().to_owned();
    let entries = manifest["tracks"].as_array().context("в manifest.json нет списка треков")?;

    let (mut imported, mut skipped, mut failed) = (0, 0, 0);
    let mut order = Vec::new();
    for t in entries {
        let Some(id) = t["video_id"].as_str().filter(|id| is_valid_video_id(id)) else {
            failed += 1;
            continue;
        };
        if db.has_track(id)? && cfg.audio_path(id).is_file() {
            skipped += 1;
            order.push(id.to_owned());
            continue;
        }
        match import_track(cfg, db, &mut zip, id, t) {
            Ok(()) => {
                imported += 1;
                order.push(id.to_owned());
            }
            Err(e) => {
                tracing::warn!("импорт {id}: {e:#}");
                failed += 1;
            }
        }
    }
    if order.is_empty() {
        bail!("ни один трек из архива не удалось импортировать");
    }
    // Повторный импорт того же альбома не плодит дубли: дополняем альбом с тем же именем.
    let album_id = match db.albums()?.into_iter().find(|a| a.name == name) {
        Some(a) => {
            for id in &order {
                db.add_to_album(a.id, id)?;
            }
            a.id
        }
        None => {
            let id = db.create_album(&name, None)?;
            db.set_album_tracks(id, &order)?;
            id
        }
    };
    Ok(ImportReport { name, album_id, imported, skipped, failed })
}

fn extract(zip: &mut ZipArchive<File>, name: &str, dest: &Path) -> Result<()> {
    let mut entry = zip.by_name(name).with_context(|| format!("в архиве нет {name}"))?;
    let tmp = dest.with_extension("part");
    let mut out = File::create(&tmp)?;
    io::copy(&mut entry, &mut out)?;
    out.flush()?;
    drop(out);
    fs::rename(&tmp, dest)?;
    Ok(())
}

fn import_track(cfg: &Config, db: &Db, zip: &mut ZipArchive<File>, id: &str, t: &Value) -> Result<()> {
    let file = t["file"].as_str().context("у трека нет файла")?;
    extract(zip, file, &cfg.audio_path(id))?;
    if let Some(cover) = t["cover"].as_str() {
        if let Err(e) = extract(zip, cover, &cfg.thumb_path(id)) {
            tracing::warn!("обложка {id}: {e:#}");
        }
    }
    let m = &t["meta"];
    let s = |k: &str| m[k].as_str().map(str::to_owned);
    let tech = TechData {
        format_id: s("format_id"),
        extension: s("extension"),
        audio_codec: s("audio_codec"),
        abr: m["abr"].as_f64(),
        filesize_mb: m["filesize_mb"].as_f64(),
        direct_url: None,
    };
    let user = UserData {
        title: s("title").unwrap_or_else(|| "Без названия".into()),
        artist: s("artist").unwrap_or_else(|| "Unknown".into()),
        album: s("album").unwrap_or_else(|| "Single".into()),
        track: s("track").unwrap_or_else(|| "Unknown".into()),
        release_date: s("release_date").unwrap_or_else(|| "Unknown".into()),
        duration: s("duration").or_else(|| m["duration"].as_i64().map(|d| d.to_string())),
        view_count: m["view_count"].as_i64(),
        like_count: m["like_count"].as_i64(),
        thumbnail_url: s("thumbnail_url").unwrap_or_default(),
    };
    let source = s("original_url").unwrap_or_else(|| format!("https://music.youtube.com/watch?v={id}"));
    db.upsert(id, &tech, &user, "", &source)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_names() {
        assert_eq!(safe_name("AC/DC: Back in Black?", 100), "AC DC Back in Black");
        assert_eq!(safe_name("...", 10), "album");
        assert_eq!(safe_name("Очень длинное имя", 5), "Очень");
    }
}
