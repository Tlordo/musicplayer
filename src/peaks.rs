use std::path::Path;
use std::process::Stdio;

use anyhow::{bail, Context, Result};
use tokio::process::Command;

/// Сколько столбиков в форме волны отдаём клиенту.
pub const BUCKETS: usize = 160;

/// Форма волны и громкость трека.
pub struct Analysis {
    /// Громкость (RMS) по `BUCKETS` равным отрезкам, нормированная к 0..1.
    pub peaks: Vec<f64>,
    /// Интегральная громкость по EBU R128, LUFS — для выравнивания громкости в плеере.
    pub loudness: Option<f64>,
}

/// ffmpeg декодирует аудио в моно 16 бит с низкой частотой дискретизации —
/// для огибающей этого достаточно, а данных получается мало (≈1 МБ на 4 минуты).
/// Попутно фильтр ebur128 меряет громкость исходного звука (до понижения частоты).
pub async fn compute(ffmpeg: &Path, audio: &Path) -> Result<Analysis> {
    let out = Command::new(ffmpeg)
        .args(["-hide_banner", "-nostats", "-v", "info", "-nostdin", "-i"])
        .arg(audio)
        .args(["-af", "ebur128=framelog=quiet", "-ac", "1", "-ar", "2000", "-f", "s16le", "-"])
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
    Ok(Analysis {
        peaks: envelope(&samples, BUCKETS),
        loudness: integrated_loudness(&String::from_utf8_lossy(&out.stderr)),
    })
}

/// Строка «I: -14.2 LUFS» из итоговой сводки ebur128.
fn integrated_loudness(log: &str) -> Option<f64> {
    log.lines()
        .rev()
        .filter_map(|l| l.trim().strip_prefix("I:"))
        .find_map(|rest| rest.trim().strip_suffix("LUFS")?.trim().parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v > -70.0)
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
    fn reads_integrated_loudness() {
        let log = "[Parsed_ebur128_0] Summary:\n\n  Integrated loudness:\n    I:         -14.2 LUFS\n    Threshold: -24.4 LUFS\n";
        assert_eq!(integrated_loudness(log), Some(-14.2));
        assert_eq!(integrated_loudness("    I:         -inf LUFS"), None);
        assert_eq!(integrated_loudness("nothing"), None);
    }

    #[test]
    fn envelope_handles_short_input() {
        let e = envelope(&[100, -100], 8);
        assert_eq!(e.len(), 8);
        assert!(e.iter().all(|v| (0.0..=1.0).contains(v)));
    }
}
