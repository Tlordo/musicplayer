package app.mymusic

import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface

/** window.MkAndroid в странице (см. public/js/android.js и native.js). */
class Bridge(private val activity: MainActivity) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun setMedia(title: String, artist: String, album: String, art: String, durationMs: Double) {
        main.post { Player.setMedia(activity, title, artist, album, art, durationMs.toLong()) }
    }

    @JavascriptInterface
    fun setPlaying(playing: Boolean, positionMs: Double) {
        main.post { Player.setPlaying(activity, playing, positionMs.toLong()) }
    }

    @JavascriptInterface
    fun clear() {
        main.post { Player.stop(activity) }
    }

    /** Фон страницы у верхнего и нижнего края (CSS-цвета). */
    @JavascriptInterface
    fun setBars(top: String, bottom: String) {
        val t = parseCssColor(top) ?: return
        val b = parseCssColor(bottom) ?: t
        main.post { activity.setBars(t, b) }
    }

    /** Текущие отступы системных полос: "верх,низ" в CSS-пикселях. */
    @JavascriptInterface
    fun insets(): String = "${activity.safeTop},${activity.safeBottom}"

    @JavascriptInterface
    fun download(url: String, name: String) {
        if (!isLocal(url)) return
        Downloads.saveUrl(activity, url, name, null, null)
    }

    @JavascriptInterface
    fun saveText(name: String, mime: String, text: String) {
        Downloads.saveText(activity, name, mime, text)
    }

    private fun isLocal(url: String): Boolean {
        val u = Uri.parse(url)
        return u.scheme == "http" && (u.host == "127.0.0.1" || u.host == "localhost")
    }

    /** "rgb(18, 18, 18)" / "rgba(…, a)" → цвет; прозрачный фон не трогаем. */
    private fun parseCssColor(css: String): Int? {
        val nums = Regex("""[\d.]+""").findAll(css).map { it.value.toFloat() }.toList()
        if (nums.size < 3) return null
        if (nums.size >= 4 && nums[3] < 0.5f) return null
        return Color.rgb(nums[0].toInt(), nums[1].toInt(), nums[2].toInt())
    }
}
