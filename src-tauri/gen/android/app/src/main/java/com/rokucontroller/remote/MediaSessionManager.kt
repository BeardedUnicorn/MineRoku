package com.rokucontroller.remote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MediaSessionManager private constructor(context: Context) {
    private val appContext: Context = context.applicationContext

    companion object {
        const val CHANNEL_ID = "roku_media_controls"
        const val NOTIFICATION_ID = 1001
        private const val TAG = "RokuMediaSession"

        private var instanceRef: WeakReference<MediaSessionManager>? = null
        private val appIconCache = ConcurrentHashMap<String, Bitmap>()

        @JvmStatic
        private external fun nativeSendRokuCommand(ip: String, port: Int, command: String): Boolean

        @JvmStatic
        private external fun nativeGetAppIconDataUrl(ip: String, port: Int, appId: String): String?

        init {
            System.loadLibrary("roku_controller_lib")
        }

        fun getInstance(context: Context): MediaSessionManager {
            val existing = instanceRef?.get()
            if (existing != null) {
                return existing
            }

            return synchronized(this) {
                val fromRef = instanceRef?.get()
                if (fromRef != null) {
                    fromRef
                } else {
                    MediaSessionManager(context.applicationContext).also {
                        instanceRef = WeakReference(it)
                    }
                }
            }
        }
    }

    private var mediaSession: MediaSessionCompat? = null
    private var notificationManager: NotificationManager? = null
    private var currentDeviceName: String = "Roku"
    private var currentDeviceIp: String = ""
    private var currentDevicePort: Int = 8060
    private var currentAppName: String = "Ready"
    private var currentAppIcon: Bitmap? = null
    private var isPlaying: Boolean = false
    private var lastActionLabel: String? = null
    private var clearActionJob: Job? = null
    private val coroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    init {
        createNotificationChannel()
        initMediaSession()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Roku Media Controls",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Media playback controls for Roku"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }

            notificationManager = appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager?.createNotificationChannel(channel)
        } else {
            notificationManager = appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        }
    }

    private fun initMediaSession() {
        mediaSession = MediaSessionCompat(appContext, TAG).apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() {
                    sendRokuCommand("play")
                    isPlaying = true
                    updatePlaybackState()
                    updateNotification()
                }

                override fun onPause() {
                    sendRokuCommand("play") // Roku uses toggle for play/pause
                    isPlaying = false
                    updatePlaybackState()
                    updateNotification()
                }

                override fun onStop() {
                    sendRokuCommand("home")
                    isPlaying = false
                    updatePlaybackState()
                    updateNotification()
                }

                override fun onSkipToNext() {
                    sendRokuCommand("fwd")
                }

                override fun onSkipToPrevious() {
                    sendRokuCommand("rev")
                }

                override fun onFastForward() {
                    sendRokuCommand("fwd")
                }

                override fun onRewind() {
                    sendRokuCommand("rev")
                }
            })

            isActive = true
        }
    }

    fun updateDevice(name: String, ip: String, port: Int) {
        currentDeviceName = if (name.isBlank()) "Roku" else name
        currentDeviceIp = ip
        currentDevicePort = port
        updateMetadata()
        updateNotification()
    }

    fun updateMediaInfo(appName: String, appId: String?, isPlaying: Boolean) {
        this.currentAppName = appName.ifBlank { "Ready" }
        this.isPlaying = isPlaying
        clearActionJob?.cancel()
        lastActionLabel = null

        val normalizedAppId = appId?.takeIf { it.isNotBlank() && it != "roku" }
        if (normalizedAppId == null || currentDeviceIp.isBlank()) {
            currentAppIcon = null
            updateMetadata()
            updatePlaybackState()
            updateNotification()
            return
        }

        val cacheKey = buildIconCacheKey(currentDeviceIp, currentDevicePort, normalizedAppId)
        val cached = appIconCache[cacheKey]
        if (cached != null) {
            currentAppIcon = cached
            updateMetadata()
            updatePlaybackState()
            updateNotification()
            return
        }

        val ipSnapshot = currentDeviceIp
        val portSnapshot = currentDevicePort
        val appSnapshot = currentAppName
        currentAppIcon = null
        updateMetadata()
        updatePlaybackState()
        updateNotification()

        coroutineScope.launch {
            try {
                val dataUrl = nativeGetAppIconDataUrl(ipSnapshot, portSnapshot, normalizedAppId)
                val bitmap = decodeDataUrlToBitmap(dataUrl)
                if (bitmap != null) {
                    appIconCache[cacheKey] = bitmap
                }

                withContext(Dispatchers.Main) {
                    if (
                        currentDeviceIp == ipSnapshot &&
                        currentDevicePort == portSnapshot &&
                        currentAppName == appSnapshot
                    ) {
                        currentAppIcon = bitmap
                        updateMetadata()
                        updateNotification()
                    }
                }
            } catch (e: Exception) {
                android.util.Log.e(TAG, "Failed to load app icon via native bridge: ${e.message}", e)
            }
        }
    }

    fun handleNotificationAction(command: String, ip: String?, port: Int?): Job? {
        if (!ip.isNullOrBlank()) {
            currentDeviceIp = ip
            if (port != null && port > 0) {
                currentDevicePort = port
            }
        }

        val label = when (command) {
            "play_pause" -> if (isPlaying) "Pause" else "Play"
            "rev" -> "Rewind"
            "fwd" -> "Forward"
            "home" -> "Home"
            "VolumeDown" -> "Vol -"
            "VolumeUp" -> "Vol +"
            else -> null
        }

        label?.let { setLastAction(it) }

        if (command == "play_pause") {
            isPlaying = !isPlaying
            updatePlaybackState()
        } else if (command == "home") {
            isPlaying = false
            updatePlaybackState()
        }

        updateNotification()
        return sendRokuCommand(command)
    }

    private fun setLastAction(label: String) {
        lastActionLabel = label
        clearActionJob?.cancel()
        clearActionJob = coroutineScope.launch {
            delay(1500)
            lastActionLabel = null
            updateNotification()
        }
    }

    private fun buildIconCacheKey(ip: String, port: Int, appId: String): String {
        return "$ip:$port:$appId"
    }

    private fun decodeDataUrlToBitmap(dataUrl: String?): Bitmap? {
        if (dataUrl.isNullOrBlank()) {
            return null
        }

        val marker = "base64,"
        val idx = dataUrl.indexOf(marker)
        if (idx < 0 || idx + marker.length >= dataUrl.length) {
            return null
        }

        return try {
            val base64Part = dataUrl.substring(idx + marker.length)
            val bytes = Base64.decode(base64Part, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (_: Exception) {
            null
        }
    }

    private fun updateMetadata() {
        val metadata = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentDeviceName)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentAppName)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "Roku Remote")

        currentAppIcon?.let {
            metadata.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it)
            metadata.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, it)
        }

        mediaSession?.setMetadata(metadata.build())
    }

    private fun updatePlaybackState() {
        val state = if (isPlaying) {
            PlaybackStateCompat.STATE_PLAYING
        } else {
            PlaybackStateCompat.STATE_PAUSED
        }

        val playbackState = PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY or
                    PlaybackStateCompat.ACTION_PAUSE or
                    PlaybackStateCompat.ACTION_PLAY_PAUSE or
                    PlaybackStateCompat.ACTION_STOP or
                    PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                    PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                    PlaybackStateCompat.ACTION_FAST_FORWARD or
                    PlaybackStateCompat.ACTION_REWIND,
            )
            .setState(state, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1f)
            .build()

        mediaSession?.setPlaybackState(playbackState)
    }

    private fun updateNotification() {
        notificationManager?.notify(NOTIFICATION_ID, buildNotification())
    }

    fun buildNotification(): Notification {
        val intent = appContext.packageManager.getLaunchIntentForPackage(appContext.packageName)
        val pendingIntent = PendingIntent.getActivity(
            appContext,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val mediaStyle = MediaStyle()
            .setMediaSession(mediaSession?.sessionToken)
            .setShowActionsInCompactView(0, 1, 2) // vol-, play/pause, vol+

        val title = if (currentDeviceName.isBlank()) "Roku" else currentDeviceName
        val contentText = if (lastActionLabel.isNullOrBlank()) {
            currentAppName
        } else {
            "${currentAppName} • ${lastActionLabel}"
        }

        val builder = NotificationCompat.Builder(appContext, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(pendingIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setStyle(mediaStyle)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)

        currentAppIcon?.let {
            builder.setLargeIcon(it)
        }

        builder.addAction(
            android.R.drawable.ic_lock_silent_mode,
            "Vol-",
            createMediaActionPendingIntent("VolumeDown"),
        )

        val playPauseIcon =
            if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        val playPauseTitle = if (isPlaying) "Pause" else "Play"
        builder.addAction(
            playPauseIcon,
            playPauseTitle,
            createMediaActionPendingIntent("play_pause"),
        )

        builder.addAction(
            android.R.drawable.ic_lock_silent_mode_off,
            "Vol+",
            createMediaActionPendingIntent("VolumeUp"),
        )

        builder.addAction(
            android.R.drawable.ic_media_rew,
            "Rewind",
            createMediaActionPendingIntent("rev"),
        )

        builder.addAction(
            android.R.drawable.ic_media_ff,
            "Forward",
            createMediaActionPendingIntent("fwd"),
        )

        builder.addAction(
            android.R.drawable.ic_delete,
            "Home",
            createMediaActionPendingIntent("home"),
        )

        return builder.build()
    }

    private fun createMediaActionPendingIntent(action: String): PendingIntent {
        val intent = Intent(appContext, MediaControlReceiver::class.java).apply {
            this.action = "com.rokucontroller.remote.MEDIA_ACTION.$action"
            putExtra("command", action)
            putExtra("ip", currentDeviceIp)
            putExtra("port", currentDevicePort)
        }

        return PendingIntent.getBroadcast(
            appContext,
            action.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun sendRokuCommand(command: String): Job? {
        if (currentDeviceIp.isBlank()) {
            android.util.Log.w(TAG, "Cannot send command: no device IP set")
            return null
        }

        val actualCommand = when (command) {
            "play_pause" -> "play"
            else -> command
        }

        return coroutineScope.launch {
            val success = nativeSendRokuCommand(currentDeviceIp, currentDevicePort, actualCommand)
            if (!success) {
                android.util.Log.w(TAG, "Native Roku command failed: $actualCommand")
            }
        }
    }

    fun hideNotification() {
        notificationManager?.cancel(NOTIFICATION_ID)
    }

    fun release() {
        coroutineScope.cancel()
        mediaSession?.release()
        hideNotification()
        instanceRef = null
    }
}
