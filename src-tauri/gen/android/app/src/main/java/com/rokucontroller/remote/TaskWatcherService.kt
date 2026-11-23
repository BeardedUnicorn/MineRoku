package com.rokucontroller.remote

import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.IBinder

/**
 * Bound by [MainActivity] for as long as it exists, purely so the app is told when the user swipes
 * the task away and can remove the media notification. It is never started and is not a
 * foreground service, so the system never restarts it on its own.
 */
class TaskWatcherService : Service() {
    private val binder = Binder()

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onTaskRemoved(rootIntent: Intent?) {
        MediaSessionManager.peek()?.hide()
        super.onTaskRemoved(rootIntent)
    }
}
