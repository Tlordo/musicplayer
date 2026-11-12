import java.net.URI
import java.util.Base64
import javax.inject.Inject

plugins {
    id("com.android.application")
}

android {
    namespace = "app.mymusic"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.mymusic"
        minSdk = 26
        targetSdk = 36
        versionCode = 241
        versionName = "2.4.1"
    }

    // Постоянный ключ подписи релиза — иначе обновление не ставится поверх старой версии
    // (INSTALL_FAILED_UPDATE_INCOMPATIBLE). Берётся из переменных окружения или из
    // gradle-свойств (~/.gradle/gradle.properties): MK_KEYSTORE_B64 (keystore в base64)
    // или MK_KEYSTORE_FILE (путь к файлу), MK_KEYSTORE_PASSWORD, MK_KEY_ALIAS, MK_KEY_PASSWORD.
    // Без них релиз подписывается отладочным ключом — локальная сборка работает как раньше.
    // Как завести ключ — android/SIGNING.md.
    val releaseKey = releaseKeystore()
    signingConfigs {
        if (releaseKey != null) create("release") {
            storeFile = releaseKey
            storePassword = signingProp("MK_KEYSTORE_PASSWORD")
            keyAlias = signingProp("MK_KEY_ALIAS")
            keyPassword = signingProp("MK_KEY_PASSWORD") ?: signingProp("MK_KEYSTORE_PASSWORD")
        }
    }

    // Отдельный APK на архитектуру: телефонам — arm64-v8a, эмуляторам — x86_64.
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "x86_64")
            isUniversalApk = false
        }
    }

    buildTypes {
        // Тестовая сборка ставится рядом с обычной (своя библиотека, свой значок «dev»)
        // и даёт подключиться к WebView из Chrome/Playwright по adb.
        debug {
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
        }
        release {
            isMinifyEnabled = false
            // APK ставится «из файла», без магазина. Постоянный ключ, если он задан (см. выше).
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        // youtubedl-android запускает python и ffmpeg из папки нативных библиотек —
        // они должны лежать распакованными.
        jniLibs.useLegacyPackaging = true
        // Лёгкая сборка (-Pmk.lite=true, APK ~25 МБ): библиотеки ffmpeg приложение
        // докачает само при первом скачивании музыки (см. FfmpegPack.kt).
        if (providers.gradleProperty("mk.lite").orNull == "true") jniLibs.excludes += "**/libffmpeg.zip.so"
    }
}

/** Значение для подписи: переменная окружения, иначе gradle-свойство. Пустое — как нет. */
fun signingProp(name: String): String? =
    (providers.environmentVariable(name).orNull ?: providers.gradleProperty(name).orNull)?.takeIf { it.isNotBlank() }

/**
 * Файл keystore для релиза или null (тогда подпись отладочным ключом). MK_KEYSTORE_B64
 * раскодируется в build/ — так ключ из секрета CI не нужно класть в репозиторий.
 * Без пароля и псевдонима ключ не используется, и сборка об этом предупреждает.
 */
fun releaseKeystore(): File? {
    val b64 = signingProp("MK_KEYSTORE_B64")
    val path = signingProp("MK_KEYSTORE_FILE")
    if (b64 == null && path == null) return null
    if (signingProp("MK_KEYSTORE_PASSWORD") == null || signingProp("MK_KEY_ALIAS") == null) {
        logger.warn("MK_KEYSTORE_*: нет пароля или псевдонима ключа — релиз подписан отладочным ключом")
        return null
    }
    if (path != null) return file(path).also { if (!it.isFile) throw GradleException("MK_KEYSTORE_FILE: нет файла $it") }
    val out = layout.buildDirectory.file("signing/release.jks").get().asFile
    out.parentFile.mkdirs()
    out.writeBytes(Base64.getMimeDecoder().decode(b64))
    return out
}

/** Интерфейс (../../public) кладётся в APK как assets/public. Секреты (*.env) — нет. */
abstract class CopyWebAssets : DefaultTask() {
    @get:InputDirectory abstract val source: DirectoryProperty
    @get:OutputDirectory abstract val output: DirectoryProperty
    @get:Inject abstract val fs: FileSystemOperations

    @TaskAction
    fun run() {
        fs.sync {
            from(source) { exclude("**/*.env") }
            into(output.dir("public"))
        }
    }
}

/**
 * Свежий yt-dlp (zipapp для python) — в assets/ytdlp/yt-dlp. Вшитый в youtubedl-android
 * быстро устаревает, а YouTube меняется постоянно. Скачивается один раз и лежит в build/.
 */
abstract class FetchYtDlp : DefaultTask() {
    @get:Input abstract val url: Property<String>
    @get:OutputDirectory abstract val output: DirectoryProperty

    @TaskAction
    fun run() {
        val file = output.file("ytdlp/yt-dlp").get().asFile
        if (file.isFile && file.length() > 1_000_000) return
        file.parentFile.mkdirs()
        val tmp = File(file.path + ".part")
        URI(url.get()).toURL().openStream().use { input -> tmp.outputStream().use { input.copyTo(it) } }
        if (!tmp.renameTo(file)) throw GradleException("не удалось сохранить $file")
    }
}

/** Сервер на Rust собирается cargo-ndk в libmk60_android.so для каждой архитектуры. */
abstract class CargoNdk : DefaultTask() {
    @get:InputFiles abstract val sources: ConfigurableFileCollection
    @get:Input abstract val toolchain: Property<String>
    @get:Input abstract val targets: ListProperty<String>
    @get:Internal abstract val crateDir: DirectoryProperty
    @get:OutputDirectory abstract val output: DirectoryProperty
    @get:Inject abstract val exec: ExecOperations

    @TaskAction
    fun run() {
        val args = mutableListOf("cargo")
        toolchain.get().takeIf { it.isNotBlank() }?.let { args += "+$it" }
        args += "ndk"
        targets.get().forEach { args += listOf("-t", it) }
        args += listOf("-P", "26", "-o", output.get().asFile.absolutePath, "build", "--release")
        exec.exec {
            workingDir = crateDir.get().asFile
            commandLine(args)
        }
    }
}

val webAssets = tasks.register<CopyWebAssets>("copyWebAssets") {
    source.set(file("../../public"))
}

val ytdlp = tasks.register<FetchYtDlp>("fetchYtDlp") {
    url.set(providers.gradleProperty("mk.ytdlpUrl").orElse("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"))
}

val rustLibs = tasks.register<CargoNdk>("cargoNdk") {
    crateDir.set(file("../rust"))
    toolchain.set(providers.gradleProperty("mk.rustToolchain").orElse(""))
    targets.set(listOf("arm64-v8a", "x86_64"))
    sources.from(
        fileTree("../rust/src"), file("../rust/Cargo.toml"), file("../rust/Cargo.lock"),
        fileTree("../../src"), file("../../Cargo.toml"),
    )
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(webAssets, CopyWebAssets::output)
        variant.sources.assets?.addGeneratedSourceDirectory(ytdlp, FetchYtDlp::output)
        variant.sources.jniLibs?.addGeneratedSourceDirectory(rustLibs, CargoNdk::output)
    }
}

dependencies {
    implementation("io.github.junkfood02.youtubedl-android:library:0.18.1")
    implementation("io.github.junkfood02.youtubedl-android:ffmpeg:0.18.1")
    implementation("io.github.junkfood02.youtubedl-android:common:0.18.1")
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("androidx.media:media:1.8.0")
}
