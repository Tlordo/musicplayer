//! Запуск yt-dlp. На компьютере — обычный процесс; на Android процессы из приложения
//! запускать нельзя, поэтому оболочка подставляет свой «исполнитель» (через youtubedl-android).

use std::sync::OnceLock;
use std::time::Duration;

use anyhow::{bail, Context, Result};

use crate::config::Config;

pub struct Output {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

impl Output {
    /// Последняя строка с ERROR — то, что стоит показать пользователю.
    pub fn error_line(&self) -> String {
        self.stderr
            .lines()
            .filter(|l| l.contains("ERROR"))
            .last()
            .unwrap_or_else(|| self.stderr.trim())
            .to_owned()
    }
}

type Runner = dyn Fn(Vec<String>) -> Result<Output> + Send + Sync;
static RUNNER: OnceLock<Box<Runner>> = OnceLock::new();

/// Подменить запуск yt-dlp (вызывается оболочкой Android до старта сервера).
pub fn set_runner(f: impl Fn(Vec<String>) -> Result<Output> + Send + Sync + 'static) {
    let _ = RUNNER.set(Box::new(f));
}

pub async fn run(cfg: &Config, args: Vec<String>, timeout: Duration) -> Result<Output> {
    if let Some(runner) = RUNNER.get() {
        let job = tokio::task::spawn_blocking(move || runner(args));
        return tokio::time::timeout(timeout, job).await.context("yt-dlp не ответил вовремя")??;
    }

    let mut cmd = tokio::process::Command::new(&cfg.ytdlp);
    cmd.args(&args).stdin(std::process::Stdio::null()).kill_on_drop(true);
    let out = tokio::time::timeout(timeout, cmd.output())
        .await
        .context("yt-dlp не ответил вовремя")?
        .with_context(|| format!("не удалось запустить {}", cfg.ytdlp.display()))?;
    Ok(Output {
        ok: out.status.success(),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

/// Запуск, при котором неудача — ошибка с понятным текстом.
pub async fn run_ok(cfg: &Config, args: Vec<String>, timeout: Duration) -> Result<String> {
    let out = run(cfg, args, timeout).await?;
    if !out.ok {
        bail!("yt-dlp: {}", out.error_line());
    }
    Ok(out.stdout)
}

/// Общие аргументы: UTF-8 в выводе и cookies, если они есть.
pub fn base_args(cfg: &Config) -> Vec<String> {
    let mut a = vec!["--no-warnings".into(), "--encoding".into(), "utf-8".into()];
    if let Some(c) = &cfg.cookies {
        a.push("--cookies".into());
        a.push(c.display().to_string());
    }
    a
}
