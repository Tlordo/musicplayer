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
        versionCode = 210
        versionName = "2.1.0"
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
        release {
            isMinifyEnabled = false
            // Подпись отладочным ключом: APK ставится «из файла», без магазина.
            signingConfig = signingConfigs.getByName("debug")
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
