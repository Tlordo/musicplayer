//! Построение настоящей волновой формы трека через ffmpeg.

use std::path::Path;
use std::process::Stdio;

use anyhow::{bail, Context};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

/// Количество столбиков волновой формы.
pub const BARS: usize = 160;
const SAMPLE_RATE: usize = 2000;

pub async fn compute(ffmpeg: &Path, audio: &Path) -> anyhow::Result<Vec<u8>> {
    let mut child = Command::new(ffmpeg)
        .args(["-v", "error", "-i"])
        .arg(audio)
        .args([
            "-ac",
            "1",
            "-ar",
            &SAMPLE_RATE.to_string(),
            "-f",
            "s16le",
            "-",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .context("не удалось запустить ffmpeg")?;
    let mut raw = Vec::new();
    child
        .stdout
        .take()
        .expect("stdout piped")
        .read_to_end(&mut raw)
        .await?;
    if !child.wait().await?.success() {
        bail!("ffmpeg не смог декодировать файл");
    }
    let samples: Vec<i16> = raw
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]))
        .collect();
    Ok(peaks(&samples, BARS))
}

/// Сводит сэмплы к `bars` значениям 0..=255 (RMS по корзине, нормированный по максимуму).
pub fn peaks(samples: &[i16], bars: usize) -> Vec<u8> {
    if samples.is_empty() || bars == 0 {
        return vec![0; bars];
    }
    let rms: Vec<f64> = (0..bars)
        .map(|i| {
            let start = i * samples.len() / bars;
            let end = ((i + 1) * samples.len() / bars)
                .max(start + 1)
                .min(samples.len());
            let chunk = &samples[start..end];
            let sum: f64 = chunk.iter().map(|&s| (s as f64).powi(2)).sum();
            (sum / chunk.len() as f64).sqrt()
        })
        .collect();
    let max = rms.iter().cloned().fold(0.0, f64::max);
    if max <= 0.0 {
        return vec![0; bars];
    }
    rms.iter()
        .map(|v| ((v / max) * 255.0).round() as u8)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes() {
        let mut s = vec![0i16; 1000];
        s.extend(std::iter::repeat_n(1000i16, 1000));
        let p = peaks(&s, 4);
        assert_eq!(p, vec![0, 0, 255, 255]);
        assert_eq!(peaks(&[], 3), vec![0, 0, 0]);
        assert_eq!(peaks(&[5, 5], 4).len(), 4);
    }
}
