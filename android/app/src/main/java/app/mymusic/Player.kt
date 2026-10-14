package app.mymusic

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.net.HttpURLConnection
import java.net.URL

/**
 * Уведомление плеера и экран блокировки. Звук играет WebView, здесь — только
 * отражение его состояния и кнопки, которые возвращаются в страницу как команды.
 * Все методы — на главном потоке.
 */
object Player {
    const val CHANNEL = "player"
    const val NOTIFICATION_ID = 1

    /** Команда для страницы: play / pause / next / prev / seek:<мс>. */
    @Volatile var commands: ((String) -> Unit)? = null

    private var session: MediaSessionCompat? = null
    private var title = ""
    private var artist = ""
    private var album = ""
    private var artUrl = ""
    private var art: Bitmap? = null
    private var duration = 0L
    var playing = false
        private set
    private var position = 0L
    private val main = Handler(Looper.getMainLooper())

    fun send(cmd: String) {
        commands?.invoke(cmd)
    }

    fun setMedia(context: Context, title: String, artist: String, album: String, artUrl: String, durationMs: Long) {
        this.title = title
        this.artist = artist
        this.album = album
        this.duration = durationMs
        if (artUrl != this.artUrl) {
            this.artUrl = artUrl
            art = null
            loadArt(context.applicationContext, artUrl)
        }
        refresh(context)
    }

    fun setPlaying(context: Context, playing: Boolean, positionMs: Long) {
        this.playing = playing
        this.position = positionMs
        refresh(context)
    }

    fun stop(context: Context) {
        title = ""
        playing = false
        session?.run { isActive = false; release() }
        session = null
        context.stopService(Intent(context, PlayerService::class.java))
    }

    private fun session(context: Context): MediaSessionCompat =
        session ?: MediaSessionCompat(context.applicationContext, "MyMusic").also { s ->
            s.setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() = send("play")
                override fun onPause() = send("pause")
                override fun onStop() = send("pause")
                override fun onSkipToNext() = send("next")
                override fun onSkipToPrevious() = send("prev")
                override fun onSeekTo(pos: Long) = send("seek:$pos")
            })
            s.setSessionActivity(openApp(context))
            session = s
        }

    private fun refresh(context: Context) {
        if (title.isEmpty()) return
        val s = session(context)
        s.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration)
                .apply { art?.let { putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it) } }
                .build()
        )
        s.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or
                        PlaybackStateCompat.ACTION_PLAY_PAUSE or PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or PlaybackStateCompat.ACTION_SEEK_TO
                )
                .setState(
                    if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                    position, if (playing) 1f else 0f, SystemClock.elapsedRealtime()
                )
                .build()
        )
        s.isActive = true
        val intent = Intent(context, PlayerService::class.java)
        if (PlayerService.running) context.startService(intent)
        else if (playing) ContextCompat.startForegroundService(context, intent)
    }

    fun notification(context: Context): android.app.Notification {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, context.getString(R.string.channel_player), NotificationManager.IMPORTANCE_LOW)
                    .apply { setShowBadge(false) }
            )
        }
        fun action(icon: Int, label: Int, cmd: String) = NotificationCompat.Action(
            icon, context.getString(label),
            PendingIntent.getService(
                context, cmd.hashCode(), Intent(context, PlayerService::class.java).setAction(cmd),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
        )
        return NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_note)
            .setContentTitle(title)
            .setContentText(artist)
            .setSubText(album.ifEmpty { null })
            .setLargeIcon(art)
            .setContentIntent(openApp(context))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setOngoing(playing)
            .addAction(action(R.drawable.ic_prev, R.string.action_prev, "prev"))
            .addAction(
                if (playing) action(R.drawable.ic_pause, R.string.action_pause, "pause")
                else action(R.drawable.ic_play, R.string.action_play, "play")
            )
            .addAction(action(R.drawable.ic_next, R.string.action_next, "next"))
            .setStyle(
                androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(session(context).sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
            .build()
    }

    private fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(
        context, 0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    private fun loadArt(context: Context, url: String) {
        if (url.isEmpty()) return
        Thread({
            val bitmap = runCatching {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 5_000
                conn.readTimeout = 10_000
                val bytes = conn.inputStream.use { it.readBytes() }
                conn.disconnect()
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                var sample = 1
                while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 512) sample *= 2
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
            }.getOrNull()
            main.post {
                if (url == artUrl && bitmap != null) {
                    art = bitmap
                    refresh(context)
                }
            }
        }, "mk-art").start()
    }
}

/** Держит процесс живым, пока играет музыка, и показывает уведомление плеера. */
class PlayerService : Service() {
    private var wake: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        running = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (val cmd = intent?.action) {
            "prev", "next", "play", "pause" -> Player.send(cmd)
        }
        ServiceCompat.startForeground(
            this, Player.NOTIFICATION_ID, Player.notification(this),
            if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0
        )
        holdWake(Player.playing)
        return START_NOT_STICKY
    }

    /** Между треками страница должна успеть включить следующий — процессор не засыпает. */
    private fun holdWake(on: Boolean) {
        if (on && wake == null) {
            wake = getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MyMusic:playback")
                .apply { setReferenceCounted(false); acquire(6 * 60 * 60 * 1000L) }
        } else if (!on) {
            wake?.let { if (it.isHeld) it.release() }
            wake = null
        }
    }

    override fun onDestroy() {
        running = false
        holdWake(false)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        @Volatile var running = false
    }
}
