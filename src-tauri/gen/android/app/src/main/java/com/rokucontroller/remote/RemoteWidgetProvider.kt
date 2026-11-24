package com.rokucontroller.remote

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import androidx.core.net.toUri
import java.util.concurrent.Executors

/**
 * The home-screen remote: one resizable widget that is a row of TV controls when small and the
 * full remote when enlarged. Each widget controls the Roku chosen in
 * [RemoteWidgetConfigActivity]; button presses go to [WidgetActionReceiver].
 *
 * Nothing here needs the app to be running, and nothing runs in the background between presses.
 */
class RemoteWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, widgetIds: IntArray) {
        widgetIds.forEach { render(context, manager, it) }
        // Then follow anything that changed in the app since the widgets were last drawn.
        val pendingResult = goAsync()
        refreshAll(context) { pendingResult.finish() }
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        widgetId: Int,
        newOptions: Bundle,
    ) {
        render(context, manager, widgetId)
    }

    override fun onDeleted(context: Context, widgetIds: IntArray) {
        widgetIds.forEach { WidgetStore.remove(context, it) }
    }

    override fun onRestored(context: Context, oldWidgetIds: IntArray, newWidgetIds: IntArray) {
        WidgetStore.remap(context, oldWidgetIds, newWidgetIds)
    }

    companion object {
        private const val TAG = "RokuWidget"
        const val ACTION_BUTTON = "com.rokucontroller.remote.WIDGET_BUTTON"

        private val executor = Executors.newSingleThreadExecutor()

        private const val IMMUTABLE_UPDATE =
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT

        /** Draws one widget from what is stored. [status] briefly replaces the Roku's name. */
        fun render(context: Context, manager: AppWidgetManager, widgetId: Int, status: String? = null) {
            try {
                val device = WidgetStore.get(context, widgetId)
                val views = when {
                    device == null -> message(
                        context,
                        R.string.widget_tap_to_set_up,
                        configureIntent(context, widgetId),
                    )
                    // Without it every press would only time out.
                    !LocalNetworkAccess.granted(context) -> message(
                        context,
                        R.string.widget_needs_local_network,
                        openAppIntent(context),
                    )
                    else -> remote(context, manager, widgetId, device, status)
                }
                manager.updateAppWidget(widgetId, views)
            } catch (e: Throwable) {
                android.util.Log.e(TAG, "Failed to draw widget $widgetId: ${e.message}", e)
            }
        }

        /**
         * Redraws every widget after following changes made in the app: a Roku that moved or was
         * renamed, one that was forgotten, a permission that was granted. Runs off the caller's
         * thread; [done] is called when it has finished.
         */
        fun refreshAll(context: Context, done: () -> Unit = {}) {
            val appContext = context.applicationContext
            executor.execute {
                try {
                    val manager = AppWidgetManager.getInstance(appContext)
                    val widgetIds = manager.getAppWidgetIds(
                        ComponentName(appContext, RemoteWidgetProvider::class.java),
                    )
                    if (widgetIds.isNotEmpty()) {
                        val saved = WidgetStore.savedDevices(appContext)
                        for (widgetId in widgetIds) {
                            WidgetStore.refresh(appContext, widgetId, saved)
                            render(appContext, manager, widgetId)
                        }
                    }
                } catch (e: Throwable) {
                    android.util.Log.e(TAG, "Failed to refresh widgets: ${e.message}", e)
                } finally {
                    done()
                }
            }
        }

        private fun remote(
            context: Context,
            manager: AppWidgetManager,
            widgetId: Int,
            device: WidgetDevice,
            status: String?,
        ): RemoteViews {
            fun build(layout: WidgetLayout) = buildRemote(context, widgetId, device, status, layout)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // The launcher picks the largest one that fits, including while resizing.
                return RemoteViews(
                    mapOf(
                        SizeF(100f, 40f) to build(WidgetLayout.STRIP),
                        SizeF(100f, WidgetSizing.TITLED_MIN_HEIGHT_DP.toFloat()) to
                            build(WidgetLayout.STRIP_TITLED),
                        SizeF(
                            WidgetSizing.FULL_MIN_WIDTH_DP.toFloat(),
                            WidgetSizing.FULL_MIN_HEIGHT_DP.toFloat(),
                        ) to build(WidgetLayout.FULL),
                    ),
                )
            }

            val options = manager.getAppWidgetOptions(widgetId)
            val portrait =
                context.resources.configuration.orientation != Configuration.ORIENTATION_LANDSCAPE
            // The launcher reports the widget's size in both orientations as a min/max pair.
            val widthDp = options.getInt(
                if (portrait) AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH
                else AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH,
            )
            val heightDp = options.getInt(
                if (portrait) AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT
                else AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,
            )
            return build(WidgetSizing.layoutFor(widthDp, heightDp))
        }

        private fun buildRemote(
            context: Context,
            widgetId: Int,
            device: WidgetDevice,
            status: String?,
            layout: WidgetLayout,
        ): RemoteViews {
            val views = RemoteViews(context.packageName, layoutResource(layout))

            for (button in WidgetButton.buttonsFor(layout)) {
                views.setOnClickPendingIntent(viewId(button), buttonIntent(context, widgetId, button))
            }

            if (layout == WidgetLayout.STRIP) {
                // No title to borrow, so the status covers the buttons for a moment.
                views.setViewVisibility(R.id.widget_status, if (status == null) View.GONE else View.VISIBLE)
                views.setTextViewText(R.id.widget_status, status ?: "")
            } else {
                views.setTextViewText(R.id.widget_title, status ?: device.name)
                views.setOnClickPendingIntent(R.id.widget_title, openAppIntent(context))
            }
            return views
        }

        private fun message(context: Context, text: Int, onTap: PendingIntent?): RemoteViews =
            RemoteViews(context.packageName, R.layout.widget_remote_unconfigured).apply {
                setTextViewText(R.id.widget_message, context.getString(text))
                onTap?.let { setOnClickPendingIntent(android.R.id.background, it) }
            }

        private fun layoutResource(layout: WidgetLayout): Int = when (layout) {
            WidgetLayout.STRIP -> R.layout.widget_remote_strip
            WidgetLayout.STRIP_TITLED -> R.layout.widget_remote_strip_titled
            WidgetLayout.FULL -> R.layout.widget_remote_full
        }

        private fun viewId(button: WidgetButton): Int = when (button) {
            WidgetButton.POWER -> R.id.btn_power
            WidgetButton.VOLUME_DOWN -> R.id.btn_vol_down
            WidgetButton.PLAY_PAUSE -> R.id.btn_play_pause
            WidgetButton.VOLUME_UP -> R.id.btn_vol_up
            WidgetButton.MUTE -> R.id.btn_mute
            WidgetButton.REWIND -> R.id.btn_rev
            WidgetButton.FORWARD -> R.id.btn_fwd
            WidgetButton.UP -> R.id.btn_up
            WidgetButton.DOWN -> R.id.btn_down
            WidgetButton.LEFT -> R.id.btn_left
            WidgetButton.RIGHT -> R.id.btn_right
            WidgetButton.OK -> R.id.btn_ok
            WidgetButton.BACK -> R.id.btn_back
            WidgetButton.HOME -> R.id.btn_home
            WidgetButton.INFO -> R.id.btn_info
        }

        private fun buttonIntent(context: Context, widgetId: Int, button: WidgetButton): PendingIntent {
            val intent = Intent(context, WidgetActionReceiver::class.java)
                .setAction(ACTION_BUTTON)
                .setData(WidgetUris.action(widgetId, button.command).toUri())
                // A remote should feel immediate: don't queue behind background broadcasts.
                .addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
            return PendingIntent.getBroadcast(context, 0, intent, IMMUTABLE_UPDATE)
        }

        private fun configureIntent(context: Context, widgetId: Int): PendingIntent {
            val intent = Intent(context, RemoteWidgetConfigActivity::class.java)
                .setAction(AppWidgetManager.ACTION_APPWIDGET_CONFIGURE)
                .setData(WidgetUris.configure(widgetId).toUri())
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            return PendingIntent.getActivity(context, 0, intent, IMMUTABLE_UPDATE)
        }

        private fun openAppIntent(context: Context): PendingIntent? {
            val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?: return null
            return PendingIntent.getActivity(context, 0, intent, IMMUTABLE_UPDATE)
        }
    }
}
