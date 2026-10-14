package app.mymusic

/**
 * Сервер «Моя музыка» на Rust (libmk60_android.so).
 * Rust сам вызывает [runYtDlp], когда ему нужен yt-dlp.
 */
object Native {
    init {
        System.loadLibrary("mk60_android")
    }

    /** Запустить сервер с медиатекой в [root]. Вернёт занятый порт или -1. */
    @JvmStatic external fun start(root: String, port: Int): Int

    @JvmStatic external fun stop()

    /** Вызывается из Rust: аргументы yt-dlp → {код выхода, stdout, stderr}. */
    @JvmStatic
    fun runYtDlp(args: Array<String>): Array<String> = YtDlp.run(args)
}
