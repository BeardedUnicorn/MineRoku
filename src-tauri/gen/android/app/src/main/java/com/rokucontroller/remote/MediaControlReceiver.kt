package com.rokucontroller.remote

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.*

class MediaControlReceiver : BroadcastReceiver() {
    
    companion object {
        private const val TAG = "MediaControlReceiver"
    }
    
    private val coroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    
    override fun onReceive(context: Context, intent: Intent) {
        val pendingResult = goAsync()
        val action = intent.action
        if (action == null) {
            pendingResult.finish()
            return
        }
        
        android.util.Log.d(TAG, "Received broadcast: $action")
        
        if (!action.startsWith("com.rokucontroller.remote.MEDIA_ACTION.")) {
            android.util.Log.w(TAG, "Unknown action: $action")
            pendingResult.finish()
            return
        }
        
        val command = intent.getStringExtra("command")
        if (command.isNullOrEmpty()) {
            pendingResult.finish()
            return
        }
        val ip = intent.getStringExtra("ip")
        val port = intent.getIntExtra("port", 8060)
        
        android.util.Log.d(TAG, "Processing command: $command for ${ip ?: "unknown"}:$port")
        
        // Handle action and send command asynchronously
        coroutineScope.launch {
            try {
                val mediaManager = MediaSessionManager.getInstance(context)
                val job = mediaManager.handleNotificationAction(command, ip, port)
                job?.join()
            } catch (e: Exception) {
                android.util.Log.e(TAG, "Failed to handle command $command: ${e.message}", e)
            } finally {
                pendingResult.finish()
            }
        }
    }
}
