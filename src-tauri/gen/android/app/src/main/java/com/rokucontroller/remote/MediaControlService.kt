package com.rokucontroller.remote

import android.app.Notification
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class MediaControlService : Service() {
    private var mediaSessionManager: MediaSessionManager? = null

    companion object {
        const val ACTION_UPDATE = "com.rokucontroller.remote.MEDIA_SERVICE.UPDATE"
        const val ACTION_HIDE = "com.rokucontroller.remote.MEDIA_SERVICE.HIDE"

        const val EXTRA_DEVICE_NAME = "extra_device_name"
        const val EXTRA_DEVICE_IP = "extra_device_ip"
        const val EXTRA_DEVICE_PORT = "extra_device_port"
        const val EXTRA_APP_NAME = "extra_app_name"
        const val EXTRA_APP_ID = "extra_app_id"
        const val EXTRA_IS_PLAYING = "extra_is_playing"
    }

    override fun onCreate() {
        super.onCreate()
        mediaSessionManager = MediaSessionManager.getInstance(applicationContext)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action

        if (action == ACTION_HIDE) {
            mediaSessionManager?.hideNotification()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
            stopSelf()
            return START_NOT_STICKY
        }

        val deviceName = intent?.getStringExtra(EXTRA_DEVICE_NAME).orEmpty()
        val deviceIp = intent?.getStringExtra(EXTRA_DEVICE_IP).orEmpty()
        val devicePort = intent?.getIntExtra(EXTRA_DEVICE_PORT, 8060) ?: 8060
        val appName = intent?.getStringExtra(EXTRA_APP_NAME).orEmpty()
        val appId = intent?.getStringExtra(EXTRA_APP_ID)
        val isPlaying = intent?.getBooleanExtra(EXTRA_IS_PLAYING, false) == true

        mediaSessionManager?.updateDevice(deviceName.ifBlank { "Roku" }, deviceIp, devicePort)
        mediaSessionManager?.updateMediaInfo(appName.ifBlank { "Ready" }, appId, isPlaying)

        val notification: Notification = mediaSessionManager?.buildNotification()
            ?: return START_NOT_STICKY

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                MediaSessionManager.NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
            )
        } else {
            startForeground(MediaSessionManager.NOTIFICATION_ID, notification)
        }

        return START_STICKY
    }

    override fun onDestroy() {
        mediaSessionManager?.release()
        mediaSessionManager = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
