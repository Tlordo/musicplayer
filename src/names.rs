//! Чистка названий с YouTube: «Rick Astley - Never Gonna Give You Up (Official Video)»
//! от канала «RickAstleyVEVO» → название «Never Gonna Give You Up», исполнитель «Rick Astley».

/// Слова, по которым приписка в скобках считается мусором, а не частью названия.
const JUNK: &[&str] = &[
    "official", "video", "audio", "lyric", "lyrics", "visualizer", "visualiser", "mv", "m/v", "hd", "hq", "4k",
    "remaster", "music video", "clip", "клип", "премьера", "official music", "текст", "караоке", "live video",
];

fn is_junk(inner: &str) -> bool {
    let l = inner.to_lowercase();
    JUNK.iter().any(|j| l.split(|c: char| !c.is_alphanumeric() && c != '/').any(|w| w == *j) || l.contains(j) && j.contains(' '))
}

/// Убрать приписки вроде «(Official Video)», «[Lyrics]», «| 4K».
fn strip_junk(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find(['(', '[']) {
        let close = if rest.as_bytes()[start] == b'(' { ')' } else { ']' };
        match rest[start..].find(close) {
            Some(len) => {
                let inner = &rest[start + 1..start + len];
                out.push_str(&rest[..start]);
                if !is_junk(inner) {
                    out.push_str(&rest[start..=start + len]);
                }
                rest = &rest[start + len + 1..];
            }
            None => break,
        }
    }
    out.push_str(rest);
    // «Песня | Official Video» → «Песня»
    if let Some((left, right)) = out.split_once(" | ") {
        if is_junk(right) {
            out = left.to_owned();
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ").trim_matches(['-', '|', ' ']).to_owned()
}

/// Имя канала → имя исполнителя: без «- Topic», «VEVO», «(official)», «Offiziell».
pub fn clean_artist(channel: &str) -> String {
    let mut a = channel.trim().trim_end_matches(" - Topic").to_owned();
    for suffix in ["VEVO", "Vevo", " Official", " official", " Offiziell", " (official)", " (Official)", " TV"] {
        if a.len() > suffix.len() + 1 {
            if let Some(stripped) = a.strip_suffix(suffix) {
                a = stripped.trim().to_owned();
            }
        }
    }
    let a = strip_junk(&a);
    if a.is_empty() { channel.trim().to_owned() } else { a }
}

fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// Название трека без исполнителя в начале и без приписок.
/// Возвращает (название, исполнитель) — исполнитель уточняется из «Исполнитель - Название».
pub fn clean_title(title: &str, artist: &str) -> (String, String) {
    let cleaned = strip_junk(title);
    for sep in [" - ", " – ", " — "] {
        if let Some((left, right)) = cleaned.split_once(sep) {
            let (l, a) = (norm(left), norm(artist));
            // «Исполнитель - Песня» от канала этого исполнителя (или канала без имени)
            if !right.trim().is_empty() && (a.is_empty() || l == a || a.contains(&l) || l.contains(&a)) {
                let who = if a.is_empty() || l.len() > a.len() { left.trim().to_owned() } else { artist.to_owned() };
                return (right.trim().to_owned(), who);
            }
        }
    }
    let t = if cleaned.is_empty() { title.trim().to_owned() } else { cleaned };
    (t, artist.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_typical_titles() {
        let a = clean_artist("RickAstleyVEVO");
        assert_eq!(a, "RickAstley");
        assert_eq!(
            clean_title("Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)", "Rick Astley"),
            ("Never Gonna Give You Up".into(), "Rick Astley".into())
        );
        assert_eq!(clean_artist("Кино - Topic"), "Кино");
        assert_eq!(clean_artist("Alphaville (official)"), "Alphaville");
        assert_eq!(clean_title("Группа крови", "Кино"), ("Группа крови".into(), "Кино".into()));
        assert_eq!(clean_title("Песня (feat. Друг) [Lyrics]", "X"), ("Песня (feat. Друг)".into(), "X".into()));
        assert_eq!(clean_title("Modern Talking - Cheri Cheri Lady (Official Video)", "Modern Talking Offiziell").0, "Cheri Cheri Lady");
    }
}
