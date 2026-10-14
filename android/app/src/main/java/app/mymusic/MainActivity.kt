package app.mymusic

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private lateinit var frame: FrameLayout
    private var web: WebView? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val pickFile = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        fileCallback?.onReceiveValue(uri?.let { arrayOf(it) })
        fileCallback = null
    }
    private val pickFiles = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        fileCallback?.onReceiveValue(uris.takeIf { it.isNotEmpty() }?.toTypedArray())
        fileCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        frame = FrameLayout(this).apply { setBackgroundColor(getColor(R.color.bg)) }
        setContentView(frame)
        // Страница рисуется и под часами, и под полосой жестов (фон шапки и оттенок обложки
        // продолжаются без стыка), а отступы для кнопок узнаёт из --safe-t / --safe-b.
        // Клавиатура же просто поджимает страницу снизу.
        ViewCompat.setOnApplyWindowInsetsListener(frame) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val keyboard = ime.bottom > bars.bottom
            v.setPadding(bars.left, 0, bars.right, if (keyboard) ime.bottom else 0)
            val density = resources.displayMetrics.density
            safeTop = bars.top / density
            safeBottom = if (keyboard) 0f else bars.bottom / density
            sendInsets()
            WindowInsetsCompat.CONSUMED
        }

        createWeb()
        Player.commands = { cmd -> runOnUiThread { web?.evaluateJavascript("window.__mkMedia && window.__mkMedia(${JSONObject.quote(cmd)})", null) } }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val view = web ?: return finish()
                view.evaluateJavascript("window.__mkBack ? window.__mkBack() : false") { result ->
                    if (result != "true") moveTaskToBack(true)
                }
            }
        })

        Thread({
            val port = Server.await()
            runOnUiThread { load(port) }
        }, "mk-wait").start()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWeb() {
        // Отладочная сборка: страницу можно открыть в chrome://inspect.
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        val view = WebView(this)
        view.setBackgroundColor(getColor(R.color.bg))
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = true
        }
        // Музыка играет и с выключенным экраном: рендерер не должен считаться «фоновым».
        view.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        view.addJavascriptInterface(Bridge(this), "MkAndroid")
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == "127.0.0.1" || url.host == "localhost") return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                return true
            }

            override fun onRenderProcessGone(v: WebView, detail: RenderProcessGoneDetail): Boolean {
                // Система выгрузила движок страницы — пересоздаём, а не падаем.
                frame.removeView(v)
                v.destroy()
                web = null
                createWeb()
                load(Server.port)
                return true
            }
        }
        view.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(v: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val types = params.acceptTypes.flatMap { it.split(',') }.flatMap { mimesOf(it.trim()) }
                    .distinct().ifEmpty { listOf("*/*") }.toTypedArray()
                val multiple = params.mode == FileChooserParams.MODE_OPEN_MULTIPLE
                runCatching { if (multiple) pickFiles.launch(types) else pickFile.launch(types) }.onFailure {
                    fileCallback = null
                    callback.onReceiveValue(null)
                }
                return true
            }
        }
        view.setDownloadListener { url, _, disposition, mime, _ -> Downloads.saveUrl(this, url, "", disposition, mime) }
        frame.addView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        web = view
    }

    private fun load(port: Int) {
        val view = web ?: return
        if (port > 0) {
            view.loadUrl("http://127.0.0.1:$port/")
        } else {
            val msg = (Server.error ?: "неизвестная ошибка").replace("<", "&lt;")
            view.loadDataWithBaseURL(null, ERROR_PAGE.replace("{msg}", msg), "text/html", "utf-8", null)
        }
    }

    /** Отступы системных полос в CSS-пикселях — их читает public/js/android.js. */
    @Volatile var safeTop = 0f
        private set
    @Volatile var safeBottom = 0f
        private set

    private fun sendInsets() {
        web?.evaluateJavascript("window.__mkInsets && window.__mkInsets($safeTop, $safeBottom)", null)
    }

    /** Цвета страницы под полосами: на светлом фоне — тёмные значки, на тёмном — светлые. */
    fun setBars(top: Int, bottom: Int) {
        frame.setBackgroundColor(bottom)
        WindowCompat.getInsetsController(window, frame).apply {
            isAppearanceLightStatusBars = Color.luminance(top) > 0.5f
            isAppearanceLightNavigationBars = Color.luminance(bottom) > 0.5f
        }
    }

    override fun onDestroy() {
        Player.commands = null
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        web?.let { frame.removeView(it); it.destroy() }
        web = null
        if (isFinishing) Player.stop(this)
        super.onDestroy()
    }

    /** accept из страницы → MIME для системного выбора файлов (архивы бывают помечены по-разному). */
    private fun mimesOf(accept: String): List<String> = when {
        accept.isBlank() -> emptyList()
        accept.equals(".zip", true) || accept == "application/zip" ->
            listOf("application/zip", "application/x-zip-compressed", "application/octet-stream")
        accept.equals(".json", true) || accept == "application/json" ->
            listOf("application/json", "text/plain", "application/octet-stream")
        accept.contains('/') -> listOf(accept)
        else -> listOf("*/*")
    }

    companion object {
        private const val ERROR_PAGE = """<!doctype html><meta name="viewport" content="width=device-width">
<body style="background:#121212;color:#eee;font:16px sans-serif;padding:24px">
<h2 style="color:#1db954">Не удалось запустить</h2><p>{msg}</p>
<p style="color:#999">Закройте приложение и откройте снова. Если не помогает — переустановите его.</p></body>"""
    }
}

