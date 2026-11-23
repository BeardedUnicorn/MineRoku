package com.rokucontroller.remote

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Handles the media notification's buttons. Works in a process that has no activity and no
 * [MediaSessionManager]: the command is sent straight through the native bridge.
 */
class MediaControlReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "MediaControlReceiver"

        // Kept well inside the 10 s a background broadcast is allowed to run.
        private const val SEND_TIMEOUT_MS = 8_000L

        private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return

        if (action == MediaSessionManager.ACTION_DISMISSED) {
            MediaSessionManager.peek()?.hide()
            return
        }

        if (!action.startsWith(MediaSessionManager.ACTION_PREFIX)) {
            android.util.Log.w(TAG, "Unknown action: $action")
            return
        }

        val command = intent.getStringExtra("command")
        val ip = intent.getStringExtra("ip")
        val port = intent.getIntExtra("port", 8060)
        if (command.isNullOrEmpty() || ip.isNullOrBlank()) {
            android.util.Log.w(TAG, "Ignoring media action without a command or device address")
            return
        }

        // onReceive runs on the main thread, which is where the manager's state lives.
        MediaSessionManager.peek()?.onNotificationAction(command)

        val pendingResult = goAsync()
        scope.launch {
            try {
                // The native call blocks and cannot be cancelled, so it runs detached and only
                // the wait is bounded.
                val send = scope.async { MediaSessionManager.sendCommandBlocking(ip, port, command) }
                when (withTimeoutOrNull(SEND_TIMEOUT_MS) { send.await() }) {
                    true -> Unit
                    false -> android.util.Log.w(TAG, "Roku command failed: $command")
                    null -> android.util.Log.w(TAG, "Roku command timed out: $command")
                }
            } catch (e: Exception) {
                android.util.Log.e(TAG, "Failed to handle command $command: ${e.message}", e)
            } finally {
                pendingResult.finish()
            }
        }
    }
}
