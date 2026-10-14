package app.mymusic

import android.content.Context
import com.yausername.youtubedl_common.utils.ZipUtils
import java.io.EOFException
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.Inflater
import java.util.zip.InflaterInputStream

/**
 * Библиотеки ffmpeg для «лёгкой» сборки APK (собрана с -Pmk.lite=true): в APK остаётся
 * только сам ffmpeg (libffmpeg.so), а архив его библиотек (~35 МБ) докачивается при первом
 * скачивании музыки — из того же AAR youtubedl-android на Maven Central. Из AAR (~140 МБ)
 * берётся только нужный файл: читаем оглавление zip и сам файл запросами Range.
 */
object FfmpegPack {
    private const val VERSION = "0.18.1"
    private val MIRRORS = listOf(
        "https://repo1.maven.org/maven2",
        "https://maven-central.storage-download.googleapis.com/maven2",
    )
    private const val PATH = "io/github/junkfood02/youtubedl-android/ffmpeg/$VERSION/ffmpeg-$VERSION.aar"

    /** Библиотеки ffmpeg лежат в APK — тогда всё делает FFmpeg.init. */
    fun bundled(context: Context): Boolean =
        File(context.applicationInfo.nativeLibraryDir, "libffmpeg.zip.so").isFile

    private fun dir(context: Context) = File(context.noBackupFilesDir, "youtubedl-android/packages/ffmpeg")
    private fun marker(context: Context) = File(dir(context), ".mk-version")

    fun ready(context: Context): Boolean = marker(context).let { it.isFile && it.readText() == VERSION }

    @Synchronized
    fun ensure(context: Context) {
        if (ready(context)) return
        val entry = "jni/${abi(context)}/libffmpeg.zip.so"
        val tmp = File(context.cacheDir, "libffmpeg.zip")
        var failure: Exception? = null
        // Каждое зеркало — по два раза: мобильная сеть обрывается.
        for (mirror in MIRRORS + MIRRORS) {
            try {
                fetchEntry("$mirror/$PATH", entry, tmp)
                failure = null
                break
            } catch (e: Exception) {
                failure = e
            }
        }
        failure?.let { throw IOException("не удалось скачать ffmpeg: ${it.message}", it) }
        val target = dir(context)
        target.deleteRecursively()
        target.mkdirs()
        try {
            ZipUtils.unzip(tmp, target)
        } finally {
            tmp.delete()
        }
        marker(context).writeText(VERSION)
    }

    /** Папка нативных библиотек …/lib/arm64 → имя ABI внутри AAR. */
    private fun abi(context: Context): String = when (File(context.applicationInfo.nativeLibraryDir).name) {
        "arm64" -> "arm64-v8a"
        "arm" -> "armeabi-v7a"
        "x86" -> "x86"
        else -> "x86_64"
    }

    private fun fetchEntry(url: String, name: String, out: File) {
        // Конец файла: там оглавление (End Of Central Directory).
        val (tail, total) = range(url, null, 65_536)
        val eocd = (tail.size - 22 downTo 0).firstOrNull { le32(tail, it) == 0x06054b50 }
            ?: throw IOException("оглавление архива не найдено")
        val cdSize = le32(tail, eocd + 12).toLong() and 0xffffffffL
        val cdOffset = le32(tail, eocd + 16).toLong() and 0xffffffffL
        val cd = if (cdOffset >= total - tail.size) {
            tail.copyOfRange((cdOffset - (total - tail.size)).toInt(), (cdOffset - (total - tail.size) + cdSize).toInt())
        } else {
            range(url, cdOffset, cdSize.toInt()).first
        }

        var p = 0
        while (p + 46 <= cd.size && le32(cd, p) == 0x02014b50) {
            val method = le16(cd, p + 10)
            val compSize = le32(cd, p + 20).toLong() and 0xffffffffL
            val size = le32(cd, p + 24).toLong() and 0xffffffffL
            val nameLen = le16(cd, p + 28)
            val extraLen = le16(cd, p + 30)
            val commentLen = le16(cd, p + 32)
            val local = le32(cd, p + 42).toLong() and 0xffffffffL
            val entryName = String(cd, p + 46, nameLen, Charsets.UTF_8)
            if (entryName == name) {
                val header = range(url, local, 30).first
                val dataStart = local + 30 + le16(header, 26) + le16(header, 28)
                download(url, dataStart, compSize, method, size, out)
                return
            }
            p += 46 + nameLen + extraLen + commentLen
        }
        throw IOException("в архиве нет $name")
    }

    private fun download(url: String, start: Long, length: Long, method: Int, size: Long, out: File) {
        val conn = open(url, "bytes=$start-${start + length - 1}")
        try {
            if (conn.responseCode != 206) throw IOException("сервер не отдаёт части файла (${conn.responseCode})")
            conn.inputStream.use { raw ->
                val input: InputStream = when (method) {
                    0 -> raw
                    8 -> InflaterInputStream(raw, Inflater(true), 64 * 1024)
                    else -> throw IOException("неизвестное сжатие $method")
                }
                out.outputStream().use { input.copyTo(it, 64 * 1024) }
            }
        } finally {
            conn.disconnect()
        }
        if (out.length() != size) throw IOException("файл скачан не полностью")
    }

    /** Range-запрос: [start] = null — последние [length] байт. Вернёт байты и полный размер. */
    private fun range(url: String, start: Long?, length: Int): Pair<ByteArray, Long> {
        val conn = open(url, if (start == null) "bytes=-$length" else "bytes=$start-${start + length - 1}")
        try {
            if (conn.responseCode != 206) throw IOException("сервер не отдаёт части файла (${conn.responseCode})")
            val total = conn.getHeaderField("Content-Range")?.substringAfter('/')?.toLongOrNull()
                ?: throw IOException("нет Content-Range")
            val bytes = conn.inputStream.use { it.readBytes() }
            if (start != null && bytes.size < length) throw EOFException("ответ оборвался")
            return bytes to total
        } finally {
            conn.disconnect()
        }
    }

    private fun open(url: String, range: String): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 20_000
            readTimeout = 60_000
            setRequestProperty("Range", range)
            setRequestProperty("Accept-Encoding", "identity")
        }

    private fun le16(b: ByteArray, i: Int) = ByteBuffer.wrap(b, i, 2).order(ByteOrder.LITTLE_ENDIAN).short.toInt() and 0xffff
    private fun le32(b: ByteArray, i: Int) = ByteBuffer.wrap(b, i, 4).order(ByteOrder.LITTLE_ENDIAN).int
}
