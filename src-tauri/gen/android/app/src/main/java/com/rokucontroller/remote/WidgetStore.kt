package com.rokucontroller.remote

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import androidx.core.content.ContextCompat
import android.content.pm.PackageManager
import java.io.File
import org.json.JSONArray

/** Which Roku each home-screen widget controls. */
object WidgetStore {
    private const val TAG = "RokuWidget"
    private const val PREFS = "remote_widgets"
    private const val DATABASE = "roku_cache.db"

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun key(widgetId: Int) = "widget_$widgetId"

    fun get(context: Context, widgetId: Int): WidgetDevice? =
        WidgetDevice.decode(prefs(context).getString(key(widgetId), null))

    fun put(context: Context, widgetId: Int, device: WidgetDevice) {
        prefs(context).edit().putString(key(widgetId), device.encode()).apply()
    }

    fun remove(context: Context, widgetId: Int) {
        prefs(context).edit().remove(key(widgetId)).apply()
    }

    /** Moves widgets restored from a backup to their new IDs. */
    fun remap(context: Context, oldIds: IntArray, newIds: IntArray) {
        val entries = oldIds.toSet().union(newIds.toSet())
            .mapNotNull { id -> prefs(context).getString(key(id), null)?.let { id to it } }
            .toMap()
        val remapped = WidgetDevices.remapIds(entries, oldIds, newIds)
        prefs(context).edit().apply {
            entries.keys.forEach { remove(key(it)) }
            remapped.forEach { (id, value) -> putString(key(id), value) }
        }.apply()
    }

    /**
     * The devices the app has saved, newest first, or null when they couldn't be read. Read from
     * the app's database file, so it works in a process where the app itself never started.
     * Blocking; call from a background thread.
     */
    fun savedDevices(context: Context): List<WidgetDevice>? {
        return try {
            // Tauri's app data directory on Android is the app's data directory itself.
            val dbPath = File(context.applicationContext.dataDir, DATABASE).path
            val json = MediaSessionManager.savedDevicesJson(dbPath) ?: return null
            val array = JSONArray(json)
            (0 until array.length()).mapNotNull { index ->
                val item = array.getJSONObject(index)
                val hardwareId = item.optString("hardware_id")
                val ip = item.optString("ip")
                val port = item.optInt("port", 8060)
                if (hardwareId.isEmpty() || ip.isEmpty()) {
                    null
                } else {
                    WidgetDevice(hardwareId, item.optString("name").ifBlank { ip }, ip, port)
                }
            }
        } catch (e: Throwable) {
            android.util.Log.w(TAG, "Failed to read saved devices: ${e.message}")
            null
        }
    }

    /**
     * Brings the widget's device up to date with the saved devices and returns it, or null when
     * the widget has none (never set up, or its Roku was forgotten in the app). Blocking.
     */
    fun refresh(context: Context, widgetId: Int, saved: List<WidgetDevice>?): WidgetDevice? {
        val stored = get(context, widgetId) ?: return null
        val current = WidgetDevices.reconcile(stored, saved)
        when {
            current == null -> remove(context, widgetId)
            current != stored -> put(context, widgetId, current)
        }
        return current
    }
}

/** Android 17 made reaching the local network a runtime permission, granted in the app. */
object LocalNetworkAccess {
    private const val API_LOCAL_NETWORK_PERMISSION = 37
    private const val ACCESS_LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK"

    fun granted(context: Context): Boolean =
        Build.VERSION.SDK_INT < API_LOCAL_NETWORK_PERMISSION ||
            ContextCompat.checkSelfPermission(context, ACCESS_LOCAL_NETWORK) ==
            PackageManager.PERMISSION_GRANTED
}
