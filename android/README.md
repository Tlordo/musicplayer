# «Моя музыка» для Android

Самостоятельное приложение: сервер на Rust работает прямо в телефоне, yt-dlp и ffmpeg —
из [youtubedl-android](https://github.com/JunkFood02/youtubedl-android). Компьютер не нужен.

Как устроено:

- `rust/` — библиотека `libmk60_android.so`: тот же сервер, что на компьютере (`../src`),
  плюс мост JNI. yt-dlp сервер запускает через Kotlin (`Native.runYtDlp`).
- `app/` — оболочка на Kotlin: WebView с интерфейсом из `../public`, уведомление плеера
  и экран блокировки (`Player.kt`), сохранение файлов в «Загрузки/Моя музыка» (`Downloads.kt`).
- Медиатека лежит в `Android/data/app.mymusic/files/library` — её видно с компьютера по USB.
- Сервер слушает и локальную сеть (порт 3000): с компьютера можно открыть музыку телефона.

## Сборка

Нужны JDK 17+, Android SDK (platform 36, build-tools 36), NDK 29, Rust с целями
`aarch64-linux-android` и `x86_64-linux-android`, `cargo install cargo-ndk`.

```bash
cd android
echo "sdk.dir=/path/to/Android/Sdk" > local.properties
export ANDROID_NDK_HOME=/path/to/Android/Sdk/ndk/29.0.14206865
./gradlew :app:assembleRelease
```

На Windows без Visual Studio — с GNU-тулчейном Rust:
`gradlew.bat :app:assembleRelease -Pmk.rustToolchain=stable-x86_64-pc-windows-gnu`.

Лёгкая сборка (`-Pmk.lite=true`, ~27 МБ вместо ~60): без библиотек ffmpeg — приложение
докачает их само (~35 МБ с Maven Central) при первом скачивании музыки.

Свежий yt-dlp скачивается при сборке и кладётся в APK: вшитый в youtubedl-android устаревает.

Готовые APK: `app/build/outputs/apk/release/` — `app-arm64-v8a-release.apk` для телефонов,
`app-x86_64-release.apk` для эмулятора. Подписаны отладочным ключом: ставятся «из файла»
(разрешите установку из неизвестных источников).
