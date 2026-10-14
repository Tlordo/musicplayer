package app.mymusic

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import android.widget.Toast
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder

/** Файлы со своего сервера → «Загрузки/Моя музыка» (на Android 9 и старше — папка приложения). */
object Downloads {
    private const val FOLDER = "Моя музыка"

    fun saveUrl(context: Context, url: String, name: String, disposition: String?, mime: String?) {
        val app = context.applicationContext
        Thread({
            try {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 15_000
                conn.readTimeout = 15 * 60_000 // архив альбома собирается не мгновенно
                try {
                    if (conn.responseCode !in 200..299) throw IOException("сервер ответил ${conn.responseCode}")
                    val fileName = name.ifBlank {
                        fileNameFrom(conn.getHeaderField("Content-Disposition") ?: disposition)
                            ?: decodeName(url.substringBefore('?').substringAfterLast('/'))
                    }.let(::safeName)
                    val type = typeOf(fileName) ?: conn.contentType?.substringBefore(';') ?: mime ?: "application/octet-stream"
                    val where = conn.inputStream.use { write(app, fileName, type, it) }
                    toast(app, "Сохранено: $where")
                } finally {
                    conn.disconnect()
                }
            } catch (e: Exception) {
                toast(app, "Не удалось сохранить: ${e.message}")
            }
        }, "mk-download").start()
    }

    fun saveText(context: Context, name: String, mime: String, text: String) {
        val app = context.applicationContext
        Thread({
            try {
                val where = text.byteInputStream().use { write(app, safeName(name), mime, it) }
                toast(app, "Сохранено: $where")
            } catch (e: Exception) {
                toast(app, "Не удалось сохранить: ${e.message}")
            }
        }, "mk-save").start()
    }

    private fun write(context: Context, name: String, mime: String, input: InputStream): String {
        if (Build.VERSION.SDK_INT >= 29) {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/$FOLDER")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IOException("нет доступа к «Загрузкам»")
            try {
                resolver.openOutputStream(uri)?.use { input.copyTo(it) } ?: throw IOException("нет доступа к «Загрузкам»")
                resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            } catch (e: Exception) {
                resolver.delete(uri, null, null)
                throw e
            }
            return "Загрузки/$FOLDER/$name"
        }
        val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.filesDir, FOLDER)
        dir.mkdirs()
        var file = File(dir, name)
        var n = 1
        while (file.exists()) file = File(dir, "${name.substringBeforeLast('.')} ($n).${name.substringAfterLast('.', "")}".trimEnd('.')).also { n++ }
        file.outputStream().use { input.copyTo(it) }
        return file.absolutePath
    }

    /** attachment; filename="…"; filename*=UTF-8''… — предпочитаем UTF-8 вариант. */
    private fun fileNameFrom(disposition: String?): String? {
        if (disposition.isNullOrBlank()) return null
        Regex("""filename\*\s*=\s*UTF-8''([^;]+)""", RegexOption.IGNORE_CASE).find(disposition)?.let {
            return decodeName(it.groupValues[1].trim())
        }
        Regex("""filename\s*=\s*"?([^";]+)"?""", RegexOption.IGNORE_CASE).find(disposition)?.let {
            return it.groupValues[1].trim()
        }
        return null
    }

    private fun typeOf(name: String): String? =
        MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())

    private fun safeName(name: String): String =
        name.replace(Regex("""[\\/:*?"<>|\u0000-\u001f]"""), " ").trim().ifBlank { "file" }.take(150)

    private fun toast(context: Context, text: String) {
        Handler(Looper.getMainLooper()).post { Toast.makeText(context, text, Toast.LENGTH_LONG).show() }
    }

    private fun decodeName(s: String): String =
        runCatching { URLDecoder.decode(s.replace("+", "%2B"), "UTF-8") }.getOrDefault(s)
}
