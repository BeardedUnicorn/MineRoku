package com.rokucontroller.remote

import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.SparseArray
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Handles a press on a home-screen widget button. Not exported: only the widget's own
 * PendingIntents reach it, so no other app can send keys to the TV.
 *
 * Like [MediaControlReceiver] it works in a process that has no activity: the key goes straight
 * through the native bridge.
 */
class WidgetActionReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "RokuWidget"

        // Kept well inside the 10 s a broadcast is allowed to run.
        private const val SEND_TIMEOUT_MS = 8_000L
        private const val STATUS_MS = 2_500L

        private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        private val mainHandler = Handler(Looper.getMainLooper())

        // Main thread only: the pending "put the name back" of each widget showing a status.
        private val statusResets = SparseArray<Runnable>()
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != RemoteWidgetProvider.ACTION_BUTTON) {
            return
        }
        val (widgetId, command) = WidgetUris.parseAction(intent.dataString) ?: return
        val button = WidgetButton.fromCommand(command) ?: return

        val appContext = context.applicationContext
        val manager = AppWidgetManager.getInstance(appContext)
        if (WidgetStore.get(appContext, widgetId) == null || !LocalNetworkAccess.granted(appContext)) {
            // Stale buttons: redraw so the widget says what it needs.
            RemoteWidgetProvider.render(appContext, manager, widgetId)
            return
        }

        val pendingResult = goAsync()
        scope.launch {
            try {
                // The Roku may have moved, been renamed or been forgotten since the last draw.
                val device = WidgetStore.refresh(appContext, widgetId, WidgetStore.savedDevices(appContext))
                if (device == null) {
                    RemoteWidgetProvider.render(appContext, manager, widgetId)
                    return@launch
                }

                // The native call blocks and cannot be cancelled, so it runs detached and only
                // the wait is bounded.
                val send = scope.async { send(appContext, device, button) }
                val status = withTimeoutOrNull(SEND_TIMEOUT_MS) { send.await() }
                    ?: Outcome(appContext.getString(R.string.widget_unreachable, device.name))
                status.message?.let { showStatus(appContext, manager, widgetId, it) }
            } catch (e: Exception) {
                android.util.Log.e(TAG, "Failed to handle $command: ${e.message}", e)
            } finally {
                pendingResult.finish()
            }
        }
    }

    /** What to tell the user, if anything. A key that simply worked says nothing. */
    private class Outcome(val message: String?)

    private fun send(context: Context, device: WidgetDevice, button: WidgetButton): Outcome {
        val unreachable = Outcome(context.getString(R.string.widget_unreachable, device.name))

        if (button == WidgetButton.POWER) {
            // A TV takes a few seconds to react to power, so say which way it is going.
            return when (MediaSessionManager.togglePowerBlocking(device.ip, device.port)) {
                null -> unreachable
                "PowerOn" -> Outcome(context.getString(R.string.widget_power_on))
                "PowerOff" -> Outcome(context.getString(R.string.widget_power_off))
                else -> Outcome(context.getString(R.string.widget_power_toggled))
            }
        }

        val sent = MediaSessionManager.sendCommandBlocking(device.ip, device.port, button.command)
        if (!sent) {
            android.util.Log.w(TAG, "Roku command failed: ${button.command}")
        }
        return if (sent) Outcome(null) else unreachable
    }

    /** Shows [status] on the widget for a moment, then puts the Roku's name back. */
    private fun showStatus(context: Context, manager: AppWidgetManager, widgetId: Int, status: String) {
        mainHandler.post {
            statusResets.get(widgetId)?.let(mainHandler::removeCallbacks)
            RemoteWidgetProvider.render(context, manager, widgetId, status)

            val reset = Runnable {
                statusResets.remove(widgetId)
                RemoteWidgetProvider.render(context, manager, widgetId)
            }
            statusResets.put(widgetId, reset)
            mainHandler.postDelayed(reset, STATUS_MS)
        }
    }
}
