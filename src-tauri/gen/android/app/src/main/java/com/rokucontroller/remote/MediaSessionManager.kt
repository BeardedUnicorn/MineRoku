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
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.*

class MediaSessionManager(private val context: Context) {
    
    companion object {
        private const val CHANNEL_ID = "roku_media_controls"
        private const val NOTIFICATION_ID = 1001
        private const val TAG = "RokuMediaSession"
        
        @Volatile
        private var instance: MediaSessionManager? = null
        
        fun getInstance(context: Context): MediaSessionManager {
            return instance ?: synchronized(this) {
                instance ?: MediaSessionManager(context.applicationContext).also { instance = it }
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
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Media playback controls for Roku"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            
            notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager?.createNotificationChannel(channel)
        } else {
            notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        }
    }
    
    private fun initMediaSession() {
        mediaSession = MediaSessionCompat(context, TAG).apply {
            setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
            )
            
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() {
                    android.util.Log.d(TAG, "MediaSession: onPlay called")
                    sendRokuCommand("play")
                    isPlaying = true
                    updatePlaybackState()
                    updateNotification()
                }
                
                override fun onPause() {
                    android.util.Log.d(TAG, "MediaSession: onPause called")
                    sendRokuCommand("play") // Roku uses same command for play/pause toggle
                    isPlaying = false
                    updatePlaybackState()
                    updateNotification()
                }
                
                override fun onStop() {
                    android.util.Log.d(TAG, "MediaSession: onStop called")
                    sendRokuCommand("home")
                    isPlaying = false
                    updatePlaybackState()
                    updateNotification()
                }
                
                override fun onSkipToNext() {
                    android.util.Log.d(TAG, "MediaSession: onSkipToNext called")
                    sendRokuCommand("fwd")
                }
                
                override fun onSkipToPrevious() {
                    android.util.Log.d(TAG, "MediaSession: onSkipToPrevious called")
                    sendRokuCommand("rev")
                }
                
                override fun onFastForward() {
                    android.util.Log.d(TAG, "MediaSession: onFastForward called")
                    sendRokuCommand("fwd")
                }
                
                override fun onRewind() {
                    android.util.Log.d(TAG, "MediaSession: onRewind called")
                    sendRokuCommand("rev")
                }
            })
            
            isActive = true
        }
    }
    
    fun updateDevice(name: String, ip: String, port: Int) {
        android.util.Log.d(TAG, "Updating device: $name ($ip:$port)")
        currentDeviceName = name
        currentDeviceIp = ip
        currentDevicePort = port
        updateMetadata()
        updateNotification()
    }
    
    fun updateMediaInfo(appName: String, isPlaying: Boolean, appIconUrl: String? = null) {
        android.util.Log.d(TAG, "Updating media info: $appName, playing=$isPlaying, iconUrl=$appIconUrl")
        this.currentAppName = appName.ifEmpty { "Ready" }
        this.isPlaying = isPlaying
        clearActionJob?.cancel()
        lastActionLabel = null
        
        // Load app icon asynchronously
        if (!appIconUrl.isNullOrEmpty() && appIconUrl.startsWith("http")) {
            coroutineScope.launch {
                try {
                    val bitmap = loadBitmapFromUrl(appIconUrl)
                    withContext(Dispatchers.Main) {
                        currentAppIcon = bitmap
                        updateMetadata()
                        updateNotification()
                    }
                } catch (e: Exception) {
                    android.util.Log.e(TAG, "Failed to load app icon: ${e.message}")
                    withContext(Dispatchers.Main) {
                        updateMetadata()
                        updateNotification()
                    }
                }
            }
        } else {
            updateMetadata()
            updateNotification()
        }
        
        updatePlaybackState()
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
    
    private suspend fun loadBitmapFromUrl(urlString: String): Bitmap? {
        return withContext(Dispatchers.IO) {
            try {
                val url = URL(urlString)
                val connection = url.openConnection() as HttpURLConnection
                connection.doInput = true
                connection.connectTimeout = 5000
                connection.readTimeout = 5000
                connection.connect()
                val input = connection.inputStream
                val bitmap = BitmapFactory.decodeStream(input)
                connection.disconnect()
                bitmap
            } catch (e: Exception) {
                android.util.Log.e(TAG, "Error loading bitmap: ${e.message}")
                null
            }
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
        android.util.Log.d(TAG, "Metadata updated: device=$currentDeviceName, app=$currentAppName, hasIcon=${currentAppIcon != null}")
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
                PlaybackStateCompat.ACTION_REWIND
            )
            .setState(state, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1f)
            .build()
        
        mediaSession?.setPlaybackState(playbackState)
        android.util.Log.d(TAG, "Playback state updated: isPlaying=$isPlaying")
    }
    
    private fun updateNotification() {
        android.util.Log.d(TAG, "Building notification")
        val notification = buildNotification()
        notificationManager?.notify(NOTIFICATION_ID, notification)
        android.util.Log.d(TAG, "Notification posted")
    }
    
    private fun buildNotification(): Notification {
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val pendingIntent = PendingIntent.getActivity(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        
        val mediaStyle = MediaStyle()
            .setMediaSession(mediaSession?.sessionToken)
            .setShowActionsInCompactView(0, 1, 2) // rewind, play/pause, forward
        
        val title = if (currentDeviceName.isBlank()) "Roku" else currentDeviceName
        val contentText = if (lastActionLabel.isNullOrBlank()) {
            currentAppName
        } else {
            "${currentAppName} • ${lastActionLabel}"
        }

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(pendingIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setStyle(mediaStyle)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)
        
        // Set large icon and background
        currentAppIcon?.let {
            builder.setLargeIcon(it)
        }
        
        // Add media control actions
        // Rewind
        builder.addAction(
            android.R.drawable.ic_media_rew,
            "Rewind",
            createMediaActionPendingIntent("rev")
        )
        
        // Play/Pause
        val playPauseIcon = if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        val playPauseTitle = if (isPlaying) "Pause" else "Play"
        builder.addAction(
            playPauseIcon,
            playPauseTitle,
            createMediaActionPendingIntent("play_pause")
        )
        
        // Forward
        builder.addAction(
            android.R.drawable.ic_media_ff,
            "Forward",
            createMediaActionPendingIntent("fwd")
        )
        
        // Stop/Home
        builder.addAction(
            android.R.drawable.ic_delete,
            "Home",
            createMediaActionPendingIntent("home")
        )
        
        // Volume Down
        builder.addAction(
            android.R.drawable.ic_lock_silent_mode,
            "Vol-",
            createMediaActionPendingIntent("VolumeDown")
        )
        
        // Volume Up  
        builder.addAction(
            android.R.drawable.ic_lock_silent_mode_off,
            "Vol+",
            createMediaActionPendingIntent("VolumeUp")
        )
        
        return builder.build()
    }
    
    private fun createMediaActionPendingIntent(action: String): PendingIntent {
        val intent = Intent(context, MediaControlReceiver::class.java).apply {
            this.action = "com.rokucontroller.remote.MEDIA_ACTION.$action"
            putExtra("command", action)
            putExtra("ip", currentDeviceIp)
            putExtra("port", currentDevicePort)
        }
        return PendingIntent.getBroadcast(
            context,
            action.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
    
    private fun sendRokuCommand(command: String): Job? {
        if (currentDeviceIp.isEmpty()) {
            android.util.Log.w(TAG, "Cannot send command: no device IP set")
            return null
        }
        
        val actualCommand = when (command) {
            "play_pause" -> "play"
            else -> command
        }
        
        android.util.Log.d(TAG, "Sending command: $actualCommand to $currentDeviceIp:$currentDevicePort")
        
        return coroutineScope.launch {
            try {
                val url = URL("http://$currentDeviceIp:$currentDevicePort/keypress/$actualCommand")
                val connection = url.openConnection() as HttpURLConnection
                connection.requestMethod = "POST"
                connection.connectTimeout = 5000
                connection.readTimeout = 5000
                connection.doOutput = true
                connection.outputStream.write(ByteArray(0))
                val responseCode = connection.responseCode
                connection.disconnect()
                android.util.Log.d(TAG, "Command sent successfully: $actualCommand, response=$responseCode")
            } catch (e: Exception) {
                android.util.Log.e(TAG, "Failed to send command $actualCommand: ${e.message}", e)
            }
        }
    }
    
    fun showNotification() {
        android.util.Log.d(TAG, "showNotification called")
        updateNotification()
    }
    
    fun hideNotification() {
        android.util.Log.d(TAG, "hideNotification called")
        notificationManager?.cancel(NOTIFICATION_ID)
    }
    
    fun release() {
        android.util.Log.d(TAG, "Releasing MediaSessionManager")
        coroutineScope.cancel()
        mediaSession?.release()
        hideNotification()
        instance = null
    }
}
