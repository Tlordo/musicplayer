package app.mymusic

import android.content.Context
import android.util.Log
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * yt-dlp на телефоне: python и ffmpeg из youtubedl-android.
 * Первый запуск распаковывает python (несколько секунд), поэтому init — в фоне.
 */
object YtDlp {
    private const val TAG = "MkYtDlp"
    private val ready = CountDownLatch(1)
    @Volatile private var failure: String? = null
    private lateinit var app: Context

    fun init(context: Context) {
        app = context.applicationContext
        Thread({
            try {
                YoutubeDL.getInstance().init(app)
                installBundled()
                // В лёгкой сборке библиотек ffmpeg в APK нет — их докачает FfmpegPack.
                if (FfmpegPack.bundled(app)) FFmpeg.getInstance().init(app)
            } catch (e: Throwable) {
                failure = e.message ?: e.toString()
                Log.e(TAG, "init", e)
            } finally {
                ready.countDown()
            }
        }, "ytdlp-init").start()
    }

    fun run(args: Array<String>): Array<String> {
        if (!ready.await(5, TimeUnit.MINUTES)) return fail("yt-dlp ещё распаковывается, попробуйте позже")
        failure?.let { return fail("yt-dlp не запустился: $it") }
        return try {
            when {
                "-U" in args || "--update" in args -> update()
                else -> {
                    if (needsFfmpeg(args) && !FfmpegPack.bundled(app)) FfmpegPack.ensure(app)
                    val request = YoutubeDLRequest(emptyList<String>())
                    request.addCommands(args.toList())
                    val r = YoutubeDL.getInstance().execute(request)
                    arrayOf(r.exitCode.toString(), r.out, r.err)
                }
            }
        } catch (e: Throwable) {
            Log.w(TAG, "yt-dlp ${args.lastOrNull()}: ${e.message}")
            fail(e.message ?: e.toString())
        }
    }

    /**
     * yt-dlp из нашего APK (assets/ytdlp/yt-dlp) свежее вшитого в библиотеку — кладём его
     * на место библиотечного после каждой установки или обновления приложения.
     */
    private fun installBundled() {
        val target = File(app.noBackupFilesDir, "youtubedl-android/yt-dlp/yt-dlp")
        val marker = File(target.parentFile, ".mk-bundled")
        val stamp = Server.installStamp(app)
        if (marker.isFile && marker.readText() == stamp) return
        val asset = runCatching { app.assets.open("ytdlp/yt-dlp") }.getOrNull() ?: return
        target.parentFile?.mkdirs()
        val tmp = File(target.path + ".new")
        asset.use { input -> tmp.outputStream().use { input.copyTo(it) } }
        if (!tmp.renameTo(target)) {
            target.delete()
            tmp.renameTo(target)
        }
        marker.writeText(stamp)
    }

    private fun update(): Array<String> {
        val status = YoutubeDL.getInstance().updateYoutubeDL(app)
        val version = run(arrayOf("--version"))[1].trim()
        val text = when (status) {
            YoutubeDL.UpdateStatus.DONE -> "Updated yt-dlp to $version"
            YoutubeDL.UpdateStatus.ALREADY_UP_TO_DATE -> "yt-dlp is up to date ($version)"
            else -> "yt-dlp $version"
        }
        return arrayOf("0", text, "")
    }

    /** Скачивание с перекодированием — без ffmpeg не обойтись. Списки и рекомендации — обходятся. */
    private fun needsFfmpeg(args: Array<String>) =
        args.any { it == "-x" || it == "--extract-audio" || it == "--audio-format" || it == "--embed-metadata" }

    private fun fail(message: String): Array<String> {
        val text = message.trim()
        return arrayOf("1", "", if (text.contains("ERROR")) text else "ERROR: $text")
    }
}
