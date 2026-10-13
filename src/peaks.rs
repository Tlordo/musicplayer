use std::path::Path;
use std::process::Stdio;

use anyhow::{bail, Context, Result};
use tokio::process::Command;

/// Сколько столбиков в форме волны отдаём клиенту.
pub const BUCKETS: usize = 160;

/// Форма волны трека: громкость (RMS) по `BUCKETS` равным отрезкам, нормированная к 0..1.
///
/// ffmpeg декодирует аудио в моно 16 бит с низкой частотой дискретизации —
/// для огибающей этого достаточно, а данных получается мало (≈1 МБ на 4 минуты).
pub async fn compute(ffmpeg: &Path, audio: &Path) -> Result<Vec<f64>> {
    let out = Command::new(ffmpeg)
        .args(["-v", "error", "-nostdin", "-i"])
        .arg(audio)
        .args(["-ac", "1", "-ar", "2000", "-f", "s16le", "-"])
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
        .with_context(|| format!("не удалось запустить {}", ffmpeg.display()))?;
    if !out.status.success() {
        bail!("ffmpeg: {}", String::from_utf8_lossy(&out.stderr).trim());
    }

    let samples: Vec<i16> = out
        .stdout
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]))
        .collect();
    if samples.is_empty() {
        bail!("ffmpeg не вернул ни одного сэмпла");
    }
    Ok(envelope(&samples, BUCKETS))
}

fn envelope(samples: &[i16], buckets: usize) -> Vec<f64> {
    let per = (samples.len() as f64 / buckets as f64).max(1.0);
    let mut rms: Vec<f64> = (0..buckets)
        .map(|i| {
            let from = ((i as f64 * per) as usize).min(samples.len());
            let to = (((i + 1) as f64 * per) as usize).clamp(from, samples.len());
            let chunk = &samples[from..to];
            if chunk.is_empty() {
                return 0.0;
            }
            let sum: f64 = chunk.iter().map(|&s| (s as f64 / 32768.0).powi(2)).sum();
            (sum / chunk.len() as f64).sqrt()
        })
        .collect();

    let max = rms.iter().cloned().fold(0.0f64, f64::max);
    if max > 0.0 {
        for v in &mut rms {
            // Корень делает тихие места заметнее, как на привычных «волнах» плееров.
            *v = ((*v / max).sqrt() * 1000.0).round() / 1000.0;
        }
    }
    rms
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_is_normalized() {
        let mut s = vec![0i16; 1000];
        s.extend(std::iter::repeat(16000).take(1000));
        let e = envelope(&s, 4);
        assert_eq!(e.len(), 4);
        assert_eq!(e[0], 0.0);
        assert_eq!(e[3], 1.0);
    }

    #[test]
    fn envelope_handles_short_input() {
        let e = envelope(&[100, -100], 8);
        assert_eq!(e.len(), 8);
        assert!(e.iter().all(|v| (0.0..=1.0).contains(v)));
    }
}
