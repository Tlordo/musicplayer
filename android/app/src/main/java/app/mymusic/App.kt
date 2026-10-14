package app.mymusic

import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.system.Os
import android.util.Log
import java.io.File
import java.util.concurrent.CountDownLatch

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        YtDlp.init(this)
        Server.start(this)
    }
}

/** Сервер запускается один раз на процесс, в фоне; активность ждёт его через [await]. */
object Server {
    private const val TAG = "MkServer"
    private const val PREFERRED_PORT = 3000
    private val ready = CountDownLatch(1)

    @Volatile var port = -1
        private set
    @Volatile var error: String? = null
        private set
    lateinit var root: File
        private set

    fun start(context: Context) {
        // Папка приложения на общем хранилище: её видно с компьютера по USB (Android/data/app.mymusic).
        root = File(context.getExternalFilesDir(null) ?: context.filesDir, "library")
        Thread({
            try {
                root.mkdirs()
                syncAssets(context)
                ffmpegEnv(context)
                port = Native.start(root.absolutePath, PREFERRED_PORT)
                if (port < 0) error = "Сервер не запустился. Подробности: ${File(root, "Data/logs/app.log")}"
            } catch (e: Throwable) {
                Log.e(TAG, "start", e)
                error = e.toString()
            } finally {
                ready.countDown()
            }
        }, "mk-start").start()
    }

    fun await(): Int {
        ready.await()
        return port
    }

    /** Интерфейс из APK → root/public, заново после каждой установки/обновления приложения. */
    private fun syncAssets(context: Context) {
        val stamp = installStamp(context)
        val marker = File(root, "public/.version")
        if (marker.isFile && marker.readText() == stamp) return
        val target = File(root, "public")
        target.deleteRecursively()
        copyAssetDir(context, "public", target)
        marker.writeText(stamp)
    }

    private fun copyAssetDir(context: Context, path: String, target: File) {
        val names = context.assets.list(path).orEmpty()
        if (names.isEmpty()) {
            target.parentFile?.mkdirs()
            context.assets.open(path).use { input -> target.outputStream().use { input.copyTo(it) } }
            return
        }
        target.mkdirs()
        for (name in names) copyAssetDir(context, "$path/$name", File(target, name))
    }

    private fun installStamp(context: Context): String {
        val info = if (Build.VERSION.SDK_INT >= 33) {
            context.packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(context.packageName, 0)
        }
        return "${info.versionName}-${info.lastUpdateTime}"
    }

    /**
     * ffmpeg из youtubedl-android нужен и самому серверу (форма волны).
     * Бинарник лежит среди нативных библиотек, его библиотеки — в распакованном пакете.
     */
    private fun ffmpegEnv(context: Context) {
        val lib = File(context.applicationInfo.nativeLibraryDir)
        val packages = File(context.noBackupFilesDir, "youtubedl-android/packages")
        val ldPath = listOf(File(packages, "ffmpeg/usr/lib"), File(packages, "python/usr/lib"))
            .joinToString(":") { it.absolutePath }
        Os.setenv("FFMPEG_PATH", File(lib, "libffmpeg.so").absolutePath, true)
        Os.setenv("LD_LIBRARY_PATH", ldPath, true)
    }
}
