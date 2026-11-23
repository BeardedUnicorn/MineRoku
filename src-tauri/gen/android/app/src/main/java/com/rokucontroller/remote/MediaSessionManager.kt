package com.rokucontroller.remote

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.media.app.NotificationCompat.MediaStyle
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Owns the media session and the remote-control notification.
 *
 * The notification is a plain (non-foreground-service) MediaStyle notification: it is posted by
 * [show] while the activity is visible and removed by [hide]. Its buttons are explicit broadcasts
 * to [MediaControlReceiver], which work whether or not this object exists.
 *
 * All mutable state is confined to the main thread; only the native calls run on IO.
 */
class MediaSessionManager private constructor(context: Context) {
    private val appContext: Context = context.applicationContext

    companion object {
        const val CHANNEL_ID = "roku_media_controls"
        const val NOTIFICATION_ID = 1001
        const val ACTION_PREFIX = "com.rokucontroller.remote.MEDIA_ACTION."
        const val ACTION_DISMISSED = "com.rokucontroller.remote.MEDIA_DISMISSED"
        private const val TAG = "RokuMediaSession"

        @Volatile
        private var instance: MediaSessionManager? = null
        private val appIconCache = ConcurrentHashMap<String, Bitmap>()

        @JvmStatic
        private external fun nativeSendRokuCommand(ip: String, port: Int, command: String): Boolean

        @JvmStatic
        private external fun nativeGetAppIconDataUrl(ip: String, port: Int, appId: String): String?

        init {
            System.loadLibrary("roku_controller_lib")
        }

        /** Must be called on the main thread. */
        fun getInstance(context: Context): MediaSessionManager {
            return instance ?: synchronized(this) {
                instance ?: MediaSessionManager(context.applicationContext).also { instance = it }
            }
        }

        /** The manager if one has been created in this process; never creates one. */
        fun peek(): MediaSessionManager? = instance

        /** Blocking; call from a background thread. Needs no manager instance. */
        fun sendCommandBlocking(ip: String, port: Int, command: String): Boolean {
            val actualCommand = if (command == "play_pause") "play" else command
            return nativeSendRokuCommand(ip, port, actualCommand)
        }
    }

    private val notificationManager =
        appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private val mediaSession: MediaSessionCompat
    private var active = false
    private var currentDeviceName: String = "Roku"
    private var currentDeviceIp: String = ""
    private var currentDevicePort: Int = 8060
    private var currentAppName: String = "Ready"
    private var currentAppIcon: Bitmap? = null
    private var isPlaying: Boolean = false
    private var lastActionLabel: String? = null
    private var clearActionJob: Job? = null
    private val coroutineScope = CoroutineScope(Dispatchers.Main.immediate + SupervisorJob())

    init {
        createNotificationChannel()
        mediaSession = MediaSessionCompat(appContext, TAG).apply {
            // An explicit main-looper handler: the default overload creates a Handler on the
            // calling thread and throws when that thread has no Looper.
            setCallback(
                object : MediaSessionCompat.Callback() {
                    override fun onPlay() = onTransportCommand("play", playing = true)

                    // Roku uses a single toggle for play/pause.
                    override fun onPause() = onTransportCommand("play", playing = false)

                    override fun onStop() = onTransportCommand("home", playing = false)

                    override fun onSkipToNext() = onTransportCommand("fwd", playing = null)

                    override fun onSkipToPrevious() = onTransportCommand("rev", playing = null)

                    override fun onFastForward() = onTransportCommand("fwd", playing = null)

                    override fun onRewind() = onTransportCommand("rev", playing = null)
                },
                Handler(Looper.getMainLooper()),
            )
        }
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
            notificationManager.createNotificationChannel(channel)
        }
    }

    /** Shows or refreshes the notification for the given device and app. Main thread only. */
    fun show(
        deviceName: String,
        deviceIp: String,
        devicePort: Int,
        appName: String,
        appId: String?,
        isPlaying: Boolean,
    ) {
        if (deviceIp.isBlank()) {
            hide()
            return
        }

        active = true
        mediaSession.isActive = true
        currentDeviceName = deviceName.ifBlank { "Roku" }
        currentDeviceIp = deviceIp
        currentDevicePort = devicePort
        currentAppName = appName.ifBlank { "Ready" }
        this.isPlaying = isPlaying
        clearActionJob?.cancel()
        lastActionLabel = null

        val normalizedAppId = appId?.takeIf { it.isNotBlank() && it != "roku" }
        val cacheKey = normalizedAppId?.let { "$deviceIp:$devicePort:$it" }
        currentAppIcon = cacheKey?.let { appIconCache[it] }
        refresh()

        if (normalizedAppId == null || cacheKey == null || currentAppIcon != null) {
            return
        }

        val appSnapshot = currentAppName
        coroutineScope.launch {
            val bitmap = try {
                withContext(Dispatchers.IO) {
                    decodeDataUrlToBitmap(
                        nativeGetAppIconDataUrl(deviceIp, devicePort, normalizedAppId),
                    )
                }
            } catch (e: Exception) {
                android.util.Log.e(TAG, "Failed to load app icon: ${e.message}", e)
                null
            } ?: return@launch

            appIconCache[cacheKey] = bitmap
            if (
                active &&
                currentDeviceIp == deviceIp &&
                currentDevicePort == devicePort &&
                currentAppName == appSnapshot
            ) {
                currentAppIcon = bitmap
                refresh()
            }
        }
    }

    /** Removes the notification and deactivates the session. Safe to call repeatedly. */
    fun hide() {
        active = false
        clearActionJob?.cancel()
        clearActionJob = null
        lastActionLabel = null
        coroutineScope.coroutineContext.cancelChildren()
        try {
            mediaSession.isActive = false
        } catch (e: Exception) {
            android.util.Log.w(TAG, "Failed to deactivate media session: ${e.message}")
        }
        notificationManager.cancel(NOTIFICATION_ID)
    }

    /**
     * Reflects a notification button press in the notification text. The command itself is sent by
     * [MediaControlReceiver]. Main thread only.
     */
    fun onNotificationAction(command: String) {
        if (!active) {
            return
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

        if (command == "play_pause") {
            isPlaying = !isPlaying
        } else if (command == "home") {
            isPlaying = false
        }

        if (label != null) {
            lastActionLabel = label
            clearActionJob?.cancel()
            clearActionJob = coroutineScope.launch {
                delay(1500)
                lastActionLabel = null
                refresh()
            }
        }

        refresh()
    }

    private fun onTransportCommand(command: String, playing: Boolean?) {
        if (!active || currentDeviceIp.isBlank()) {
            return
        }

        val ip = currentDeviceIp
        val port = currentDevicePort
        coroutineScope.launch {
            val success = withContext(Dispatchers.IO) { sendCommandBlocking(ip, port, command) }
            if (!success) {
                android.util.Log.w(TAG, "Roku command failed: $command")
            }
        }

        if (playing != null) {
            isPlaying = playing
            refresh()
        }
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
            val bytes = Base64.decode(dataUrl.substring(idx + marker.length), Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (_: Exception) {
            null
        }
    }

    private fun refresh() {
        if (!active) {
            return
        }

        try {
            updateMetadata()
            updatePlaybackState()
            if (canPostNotifications()) {
                notificationManager.notify(NOTIFICATION_ID, buildNotification())
            }
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Failed to update media notification: ${e.message}", e)
        }
    }

    private fun canPostNotifications(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return true
        }
        return ContextCompat.checkSelfPermission(appContext, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
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

        mediaSession.setMetadata(metadata.build())
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

        mediaSession.setPlaybackState(playbackState)
    }

    private fun buildNotification(): Notification {
        val launchIntent = appContext.packageManager.getLaunchIntentForPackage(appContext.packageName)
        val contentIntent = launchIntent?.let {
            PendingIntent.getActivity(
                appContext,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        val dismissIntent = PendingIntent.getBroadcast(
            appContext,
            ACTION_DISMISSED.hashCode(),
            Intent(appContext, MediaControlReceiver::class.java).apply { action = ACTION_DISMISSED },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val mediaStyle = MediaStyle()
            .setMediaSession(mediaSession.sessionToken)
            .setShowActionsInCompactView(0, 1, 2) // vol-, play/pause, vol+

        val contentText = if (lastActionLabel.isNullOrBlank()) {
            currentAppName
        } else {
            "$currentAppName • $lastActionLabel"
        }

        val builder = NotificationCompat.Builder(appContext, CHANNEL_ID)
            .setContentTitle(currentDeviceName)
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentIntent)
            .setDeleteIntent(dismissIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            // Not ongoing: no service backs this notification, so if the process is killed the
            // user must still be able to swipe a leftover away.
            .setOngoing(false)
            .setStyle(mediaStyle)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)

        currentAppIcon?.let { builder.setLargeIcon(it) }

        builder.addAction(
            android.R.drawable.ic_lock_silent_mode,
            "Vol-",
            createMediaActionPendingIntent("VolumeDown"),
        )
        builder.addAction(
            if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
            if (isPlaying) "Pause" else "Play",
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
            this.action = ACTION_PREFIX + action
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
}
