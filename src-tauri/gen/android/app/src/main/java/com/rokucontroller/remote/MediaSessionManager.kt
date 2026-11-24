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

        /** Not an ECP key: turns the TV on from standby and off when it is on. */
        const val CMD_POWER_TOGGLE = "power_toggle"
        const val CMD_PLAY_PAUSE = "play_pause"
        const val CMD_VOLUME_DOWN = "VolumeDown"
        const val CMD_VOLUME_UP = "VolumeUp"
        const val CMD_VOLUME_MUTE = "VolumeMute"

        // The session's custom actions, in the order the system media player lays them out
        // around play/pause: volume down, [play/pause], volume up, mute, power.
        private val CUSTOM_ACTIONS =
            listOf(CMD_VOLUME_DOWN, CMD_VOLUME_UP, CMD_VOLUME_MUTE, CMD_POWER_TOGGLE)

        private const val RESYNC_DELAY_MS = 1_500L
        private const val STATUS_LABEL_MS = 1_500L
        private const val FAILURE_LABEL_MS = 3_000L
        private const val TAG = "RokuMediaSession"

        @Volatile
        private var instance: MediaSessionManager? = null
        private val appIconCache = ConcurrentHashMap<String, Bitmap>()

        @JvmStatic
        private external fun nativeSendRokuCommand(ip: String, port: Int, command: String): Boolean

        @JvmStatic
        private external fun nativeGetAppIconDataUrl(ip: String, port: Int, appId: String): String?

        @JvmStatic
        private external fun nativeTogglePower(ip: String, port: Int): String?

        @JvmStatic
        private external fun nativeListSavedDevices(dbPath: String): String?

        @JvmStatic
        private external fun nativeQueryIsPlaying(ip: String, port: Int): Int

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
            if (command == CMD_POWER_TOGGLE) {
                return togglePowerBlocking(ip, port) != null
            }
            val actualCommand = if (command == CMD_PLAY_PAUSE) "play" else command
            return nativeSendRokuCommand(ip, port, actualCommand)
        }

        /**
         * Turns the TV on or off depending on its current state. Returns the key that was sent
         * ("PowerOn", "PowerOff" or "Power"), or null when the device couldn't be reached.
         * Blocking; needs no manager instance.
         */
        fun togglePowerBlocking(ip: String, port: Int): String? =
            nativeTogglePower(ip, port)?.takeIf { it.isNotEmpty() }

        /**
         * The saved devices as a JSON array, read from the app's database file, or null when it
         * couldn't be read. Blocking; works in a process where the app itself never started.
         */
        fun savedDevicesJson(dbPath: String): String? =
            nativeListSavedDevices(dbPath)?.takeIf { it.isNotEmpty() }

        /** Whether the device is playing, or null when it didn't answer. Blocking. */
        fun queryIsPlayingBlocking(ip: String, port: Int): Boolean? =
            when (nativeQueryIsPlaying(ip, port)) {
                1 -> true
                0 -> false
                else -> null
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
    private var resyncJob: Job? = null
    private val coroutineScope = CoroutineScope(Dispatchers.Main.immediate + SupervisorJob())

    init {
        createNotificationChannel()
        mediaSession = MediaSessionCompat(appContext, TAG).apply {
            // An explicit main-looper handler: the default overload creates a Handler on the
            // calling thread and throws when that thread has no Looper.
            setCallback(
                object : MediaSessionCompat.Callback() {
                    override fun onPlay() = onTransportCommand(CMD_PLAY_PAUSE, playing = true)

                    // Roku uses a single toggle for play/pause.
                    override fun onPause() = onTransportCommand(CMD_PLAY_PAUSE, playing = false)

                    // Volume, mute and power: the system media player's extra buttons.
                    override fun onCustomAction(action: String?, extras: android.os.Bundle?) {
                        if (action != null && action in CUSTOM_ACTIONS) {
                            onTransportCommand(action, playing = null)
                        }
                    }
                },
                Handler(Looper.getMainLooper()),
            )
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                appContext.getString(R.string.media_channel_name),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = appContext.getString(R.string.media_channel_description)
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
        resyncJob?.cancel()
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
        resyncJob = null
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

        // Labelled before the flip: the press did what the button said at the time.
        showStatus(actionLabel(command), STATUS_LABEL_MS)
        if (command == CMD_PLAY_PAUSE) {
            isPlaying = !isPlaying
        }
        if (command == CMD_PLAY_PAUSE || command == CMD_POWER_TOGGLE) {
            scheduleResync()
        }

        refresh()
    }

    /** Says in the notification that the last button press didn't reach the Roku. Main thread only. */
    fun onActionFailed() {
        if (!active) {
            return
        }
        showStatus(appContext.getString(R.string.status_unreachable), FAILURE_LABEL_MS)
        refresh()
    }

    private fun actionLabel(command: String): String? {
        val label = when (command) {
            CMD_PLAY_PAUSE -> if (isPlaying) R.string.action_pause else R.string.action_play
            CMD_VOLUME_DOWN -> R.string.action_volume_down
            CMD_VOLUME_UP -> R.string.action_volume_up
            CMD_VOLUME_MUTE -> R.string.action_mute
            CMD_POWER_TOGGLE -> R.string.action_power
            else -> return null
        }
        return appContext.getString(label)
    }

    /** Shows [label] next to the app name for [durationMs]. The caller refreshes. */
    private fun showStatus(label: String?, durationMs: Long) {
        if (label == null) {
            return
        }
        lastActionLabel = label
        clearActionJob?.cancel()
        clearActionJob = coroutineScope.launch {
            delay(durationMs)
            lastActionLabel = null
            refresh()
        }
    }

    /**
     * Play/pause is a toggle and power changes what is playing, so the state shown is a guess
     * until the Roku is asked. Nothing else corrects it while the app is in the background.
     */
    private fun scheduleResync() {
        val ip = currentDeviceIp
        val port = currentDevicePort
        resyncJob?.cancel()
        resyncJob = coroutineScope.launch {
            delay(RESYNC_DELAY_MS)
            val playing = withContext(Dispatchers.IO) { queryIsPlayingBlocking(ip, port) }
                ?: return@launch
            if (active && currentDeviceIp == ip && currentDevicePort == port && isPlaying != playing) {
                isPlaying = playing
                refresh()
            }
        }
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
                onActionFailed()
            }
        }

        if (playing != null) {
            isPlaying = playing
        } else {
            showStatus(actionLabel(command), STATUS_LABEL_MS)
        }
        if (command == CMD_PLAY_PAUSE || command == CMD_POWER_TOGGLE) {
            scheduleResync()
        }
        refresh()
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
            // The system media player shows this line, not the notification's text.
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, statusLine())
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, appContext.getString(R.string.app_name))

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

        // Only play/pause is a transport action. With no previous/next, the system media player
        // (Android 13+) gives those slots to the custom actions, in order.
        val builder = PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY or
                    PlaybackStateCompat.ACTION_PAUSE or
                    PlaybackStateCompat.ACTION_PLAY_PAUSE,
            )
            .setState(state, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1f)

        for (command in CUSTOM_ACTIONS) {
            builder.addCustomAction(
                PlaybackStateCompat.CustomAction.Builder(
                    command,
                    appContext.getString(commandLabel(command)),
                    commandIcon(command),
                ).build(),
            )
        }
        val playbackState = builder.build()

        mediaSession.setPlaybackState(playbackState)
    }

    private fun statusLine(): String =
        if (lastActionLabel.isNullOrBlank()) currentAppName else "$currentAppName • $lastActionLabel"

    private fun commandLabel(command: String): Int = when (command) {
        CMD_VOLUME_DOWN -> R.string.action_volume_down
        CMD_VOLUME_UP -> R.string.action_volume_up
        CMD_VOLUME_MUTE -> R.string.action_mute
        CMD_POWER_TOGGLE -> R.string.action_power
        else -> if (isPlaying) R.string.action_pause else R.string.action_play
    }

    private fun commandIcon(command: String): Int = when (command) {
        CMD_VOLUME_DOWN -> R.drawable.ic_remote_volume_down
        CMD_VOLUME_UP -> R.drawable.ic_remote_volume_up
        CMD_VOLUME_MUTE -> R.drawable.ic_remote_volume_mute
        CMD_POWER_TOGGLE -> R.drawable.ic_remote_power
        else -> if (isPlaying) R.drawable.ic_remote_pause else R.drawable.ic_remote_play
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
            .setShowActionsInCompactView(0, 1, 2) // volume down, play/pause, volume up

        val builder = NotificationCompat.Builder(appContext, CHANNEL_ID)
            .setContentTitle(currentDeviceName)
            .setContentText(statusLine())
            .setSmallIcon(R.drawable.ic_stat_remote)
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

        // The same five buttons as the session's actions, in the same order. This list is what
        // Android 12 and older show, and what still works once the process has been killed.
        for (command in listOf(
            CMD_VOLUME_DOWN,
            CMD_PLAY_PAUSE,
            CMD_VOLUME_UP,
            CMD_VOLUME_MUTE,
            CMD_POWER_TOGGLE,
        )) {
            builder.addAction(
                commandIcon(command),
                appContext.getString(commandLabel(command)),
                createMediaActionPendingIntent(command),
            )
        }

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
