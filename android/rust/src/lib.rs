//! Мост Android ↔ сервер «Моя музыка».
//!
//! Kotlin вызывает `Native.start(root, port)` — сервер запускается в своём потоке и слушает
//! localhost (и локальную сеть, чтобы к телефону могли подключиться другие устройства).
//! yt-dlp на Android запускает youtubedl-android, поэтому сервер просит Kotlin:
//! `Native.runYtDlp(String[]) -> String[]{код, stdout, stderr}`.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use anyhow::{anyhow, Context, Result};
use jni::objects::{GlobalRef, JClass, JObject, JObjectArray, JString, JValue};
use jni::sys::jint;
use jni::{JNIEnv, JavaVM};
use music_player::ytdlp::{self, Output};
use music_player::{app, bind, prepare, serve, Config};

static VM: OnceLock<JavaVM> = OnceLock::new();
static NATIVE_CLASS: OnceLock<GlobalRef> = OnceLock::new();
static STOP: Mutex<Option<tokio::sync::oneshot::Sender<()>>> = Mutex::new(None);
static LOGGING: OnceLock<()> = OnceLock::new();

fn init_logging(dir: PathBuf) {
    LOGGING.get_or_init(|| {
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("app.log")) {
            let _ = tracing_subscriber::fmt()
                .with_env_filter(tracing_subscriber::EnvFilter::new("info,tower_http=warn"))
                .with_ansi(false)
                .with_writer(Mutex::new(f))
                .try_init();
        }
    });
}

/// Запустить yt-dlp через Kotlin (youtubedl-android).
fn run_via_java(args: Vec<String>) -> Result<Output> {
    let vm = VM.get().context("JVM ещё не готова")?;
    let mut env = vm.attach_current_thread_permanently()?;
    let class = NATIVE_CLASS.get().context("класс Native не найден")?;
    let class: &JClass = class.as_obj().into();

    let string_class = env.find_class("java/lang/String")?;
    let array = env.new_object_array(args.len() as i32, &string_class, JObject::null())?;
    for (i, a) in args.iter().enumerate() {
        let s = env.new_string(a)?;
        env.set_object_array_element(&array, i as i32, s)?;
    }

    let result = env.call_static_method(class, "runYtDlp", "([Ljava/lang/String;)[Ljava/lang/String;", &[JValue::Object(&array)]);
    let result = match result {
        Ok(v) => v.l()?,
        Err(e) => {
            let _ = env.exception_describe();
            let _ = env.exception_clear();
            return Err(anyhow!("вызов yt-dlp из Kotlin не удался: {e}"));
        }
    };
    let result = JObjectArray::from(result);
    let mut part = |i: i32| -> Result<String> {
        let obj = env.get_object_array_element(&result, i)?;
        if obj.is_null() {
            return Ok(String::new());
        }
        Ok(env.get_string(&JString::from(obj))?.into())
    };
    let code = part(0)?;
    Ok(Output { ok: code.trim() == "0", stdout: part(1)?, stderr: part(2)? })
}

/// `Native.start(root, port)`: вернуть занятый порт или -1.
#[no_mangle]
pub extern "system" fn Java_app_mymusic_Native_start<'l>(mut env: JNIEnv<'l>, class: JClass<'l>, root: JString<'l>, port: jint) -> jint {
    let root: String = match env.get_string(&root) {
        Ok(s) => s.into(),
        Err(_) => return -1,
    };
    if let Ok(vm) = env.get_java_vm() {
        let _ = VM.set(vm);
    }
    if let Ok(g) = env.new_global_ref(&class) {
        let _ = NATIVE_CLASS.set(g);
    }
    let root = PathBuf::from(root);
    init_logging(root.join("Data").join("logs"));
    ytdlp::set_runner(run_via_java);

    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<i32>();
    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
    *STOP.lock().unwrap_or_else(|e| e.into_inner()) = Some(stop_tx);

    std::thread::Builder::new()
        .name("mk-server".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
                Ok(rt) => rt,
                Err(e) => {
                    tracing::error!("tokio: {e}");
                    let _ = ready_tx.send(-1);
                    return;
                }
            };
            rt.block_on(async move {
                let cfg = Arc::new(Config::for_root(root));
                let started = async {
                    prepare(&cfg)?;
                    let listener = bind(port as u16).await?;
                    let port = listener.local_addr()?.port();
                    let router = app(cfg.clone(), port)?;
                    anyhow::Ok((listener, router, port))
                }
                .await;
                match started {
                    Ok((listener, router, port)) => {
                        tracing::info!("сервер Android запущен на порту {port}");
                        let _ = ready_tx.send(port as i32);
                        if let Err(e) = serve(listener, router, async { let _ = stop_rx.await; }).await {
                            tracing::error!("сервер остановился: {e:#}");
                        }
                    }
                    Err(e) => {
                        tracing::error!("сервер не запустился: {e:#}");
                        let _ = ready_tx.send(-1);
                    }
                }
            });
        })
        .ok();

    ready_rx.recv().unwrap_or(-1)
}

#[no_mangle]
pub extern "system" fn Java_app_mymusic_Native_stop<'l>(_env: JNIEnv<'l>, _class: JClass<'l>) {
    if let Some(tx) = STOP.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = tx.send(());
    }
}
