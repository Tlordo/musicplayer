use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Идентификатор трека безопасен для использования в путях к файлам.
pub fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Разбирает `SS`, `M:SS` или `H:MM:SS` в секунды.
pub fn parse_duration(s: &str) -> Option<f64> {
    let mut total = 0.0;
    let mut parts = 0;
    for p in s.trim().split(':') {
        total = total * 60.0 + p.trim().parse::<f64>().ok()?;
        parts += 1;
    }
    (1..=3).contains(&parts).then_some(total)
}

/// Пытается извлечь ID видео YouTube из ссылки, не обращаясь к сети.
pub fn youtube_id_from_url(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url.trim()).ok()?;
    let host = parsed
        .host_str()?
        .trim_start_matches("www.")
        .trim_start_matches("m.");
    let id = match host {
        "youtu.be" => parsed.path_segments()?.next().map(str::to_owned),
        "youtube.com" | "music.youtube.com" => {
            let mut segs = parsed.path_segments()?;
            match segs.next()? {
                "watch" => parsed
                    .query_pairs()
                    .find(|(k, _)| k == "v")
                    .map(|(_, v)| v.into_owned()),
                "shorts" | "live" | "embed" => segs.next().map(str::to_owned),
                _ => None,
            }
        }
        _ => None,
    }?;
    is_valid_id(&id).then_some(id)
}

/// Значение заголовка Content-Disposition с именем файла в UTF-8 (RFC 6266 / 5987).
pub fn content_disposition(filename: &str) -> String {
    let ascii: String = filename
        .chars()
        .map(|c| {
            if c.is_ascii_graphic() && c != '"' && c != '\\' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let mut encoded = String::new();
    for b in filename.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
            encoded.push(b as char);
        } else {
            encoded.push_str(&format!("%{b:02X}"));
        }
    }
    format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}")
}

/// Удаляет из имени файла символы, запрещённые в Windows и Unix.
pub fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    cleaned.chars().take(150).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durations() {
        assert_eq!(parse_duration("45"), Some(45.0));
        assert_eq!(parse_duration("3:05"), Some(185.0));
        assert_eq!(parse_duration("1:00:01"), Some(3601.0));
        assert_eq!(parse_duration("abc"), None);
        assert_eq!(parse_duration("1:2:3:4"), None);
    }

    #[test]
    fn ids() {
        assert!(is_valid_id("dQw4w9WgXcQ"));
        assert!(!is_valid_id("../etc/passwd"));
        assert!(!is_valid_id(""));
    }

    #[test]
    fn youtube_urls() {
        let id = Some("dQw4w9WgXcQ".to_string());
        assert_eq!(
            youtube_id_from_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1"),
            id
        );
        assert_eq!(
            youtube_id_from_url("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RD"),
            id
        );
        assert_eq!(youtube_id_from_url("https://youtu.be/dQw4w9WgXcQ?si=x"), id);
        assert_eq!(
            youtube_id_from_url("https://youtube.com/shorts/dQw4w9WgXcQ"),
            id
        );
        assert_eq!(
            youtube_id_from_url("https://www.youtube.com/playlist?list=PL123"),
            None
        );
        assert_eq!(youtube_id_from_url("not a url"), None);
    }

    #[test]
    fn filenames() {
        assert_eq!(
            sanitize_filename("AC/DC: Back  in <Black>"),
            "AC DC Back in Black"
        );
        let cd = content_disposition("Кино - Группа крови.opus");
        assert!(cd.starts_with("attachment; filename=\""));
        assert!(cd.contains("filename*=UTF-8''%D0%9A"));
    }
}
