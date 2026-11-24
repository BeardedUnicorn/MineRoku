package com.rokucontroller.remote

import android.Manifest
import android.app.ActivityManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.provider.Settings
import android.security.advancedprotection.AdvancedProtectionManager
import android.view.HapticFeedbackConstants
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.annotation.Keep
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
    private var multicastLock: WifiManager.MulticastLock? = null
    private var taskWatcherBound = false
    private var webView: WebView? = null

    @Volatile
    private var started = false

    private val taskWatcherConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) = Unit

        override fun onServiceDisconnected(name: ComponentName?) = Unit
    }

    companion object {
        private const val TAG = "RokuRemote"
        private const val DISCOVERY_PERMISSION_REQUEST_CODE = 1001
        private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 1002

        // Android 17. Local network access is a runtime permission for apps targeting it.
        private const val API_LOCAL_NETWORK_PERMISSION = 37
        private const val ACCESS_LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK"
    }

    private external fun nativeOnActivityCreated()
    private external fun nativeOnActivityDestroyed()
    private external fun nativeOnPermissionResult(requestCode: Int, granted: Boolean)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        nativeOnActivityCreated()
        // The page hears how the app's own update download is going (AppUpdate)
        AppUpdate.attach(this) { report ->
            webView?.evaluateJavascript("window.__rokuUpdate && window.__rokuUpdate($report)", null)
        }
        keepContentClearOfSystemBars()
        logPreviousExitReasons()

        try {
            taskWatcherBound = bindService(
                Intent(this, TaskWatcherService::class.java),
                taskWatcherConnection,
                Context.BIND_AUTO_CREATE,
            )
        } catch (e: Exception) {
            android.util.Log.w(TAG, "Failed to bind task watcher: ${e.message}")
        }
    }

    override fun onStart() {
        super.onStart()
        started = true
    }

    override fun onStop() {
        started = false
        super.onStop()
    }

    // Android opens the update's installer only while the app is in front (AppUpdate)
    override fun onResume() {
        super.onResume()
        AppUpdate.resumed(this)
    }

    override fun onPause() {
        AppUpdate.paused(this)
        super.onPause()
    }

    override fun onDestroy() {
        nativeOnActivityDestroyed()
        AppUpdate.detach(this)
        releaseDiscoveryLocks()
        if (isFinishing) {
            MediaSessionManager.peek()?.hide()
        }
        if (taskWatcherBound) {
            try {
                unbindService(taskWatcherConnection)
            } catch (e: Exception) {
                android.util.Log.w(TAG, "Failed to unbind task watcher: ${e.message}")
            }
            taskWatcherBound = false
        }
        super.onDestroy()
    }

    override fun onWebViewCreate(webView: WebView) {
        this.webView = webView
        webView.addJavascriptInterface(AppBridge(), "RokuApp")
    }

    /**
     * What the page calls as `window.RokuApp`: the app's own update. Call it
     * on the bridge object itself, because Android refuses a method that has
     * been taken off it. Its methods run on a WebView thread.
     */
    private inner class AppBridge {
        /**
         * Downloads a release and opens Android's installer on it (AppUpdate),
         * which reports progress to `window.__rokuUpdate`. The download
         * belongs to the app: it outlives this activity, and asking again while
         * it runs joins it.
         */
        @JavascriptInterface
        fun downloadUpdate(version: String) {
            AppUpdate.download(applicationContext, version)
        }

        /**
         * Whether the phone won't install an update: Android 16's Advanced
         * Protection blocks apps that don't come from a store, as this app's
         * updates don't.
         */
        @JavascriptInterface
        fun installsBlocked(): Boolean =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA &&
                runCatching {
                    getSystemService(AdvancedProtectionManager::class.java)?.isAdvancedProtectionEnabled == true
                }.getOrDefault(false)

        /** The phone's Security settings, where Advanced Protection is turned off. */
        @JavascriptInterface
        fun openSecuritySettings() {
            runOnUiThread {
                runCatching { startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS)) }
                    .onFailure { runCatching { startActivity(Intent(Settings.ACTION_SETTINGS)) } }
            }
        }
    }

    // Android draws edge-to-edge for targetSdk 35+, so the WebView would otherwise sit under the
    // status bar, navigation bar, and keyboard.
    private fun keepContentClearOfSystemBars() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            // The UI is always dark, whatever the system theme is.
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }

        ViewCompat.setOnApplyWindowInsetsListener(findViewById<View>(android.R.id.content)) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime()
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
    }

    /** Records why the process last died, so background kills and crashes show up in logcat. */
    private fun logPreviousExitReasons() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return
        }

        try {
            val activityManager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            activityManager.getHistoricalProcessExitReasons(packageName, 0, 5).forEach { info ->
                android.util.Log.i(
                    TAG,
                    "Previous exit: reason=${info.reason} status=${info.status} " +
                        "importance=${info.importance} at=${info.timestamp} " +
                        "description=${info.description}",
                )
            }
        } catch (e: Exception) {
            android.util.Log.w(TAG, "Failed to read previous exit reasons: ${e.message}")
        }
    }

    // The methods below are called from Rust over JNI, on threads that are not the UI thread.
    // None of them may throw: a Java exception would surface in Rust as a failed command at best.

    @Keep
    fun updateMediaSession(
        deviceName: String,
        deviceIp: String,
        devicePort: Int,
        appName: String,
        appId: String?,
        isPlaying: Boolean,
    ) {
        runOnUiThread {
            // A poll that was in flight when the app was backgrounded can land here late. The
            // notification is only refreshed while the activity is visible.
            if (!started) {
                return@runOnUiThread
            }
            try {
                MediaSessionManager.getInstance(applicationContext)
                    .show(deviceName, deviceIp, devicePort, appName, appId, isPlaying)
            } catch (e: Throwable) {
                android.util.Log.e(TAG, "Failed to update media notification: ${e.message}", e)
            }
        }
    }

    @Keep
    fun hideMediaNotification() {
        runOnUiThread {
            try {
                MediaSessionManager.peek()?.hide()
            } catch (e: Throwable) {
                android.util.Log.e(TAG, "Failed to hide media notification: ${e.message}", e)
            }
        }
    }

    @Keep
    fun performHapticTap() {
        runOnUiThread {
            try {
                window.decorView.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            } catch (e: Throwable) {
                android.util.Log.w(TAG, "Haptic feedback failed: ${e.message}")
            }
        }
    }

    /** True when reaching devices on the LAN needs a runtime permission on this OS version. */
    @Keep
    fun localNetworkPermissionRequired(): Boolean {
        return Build.VERSION.SDK_INT >= API_LOCAL_NETWORK_PERMISSION
    }

    private fun missingDiscoveryPermissions(): List<String> {
        // From Android 17 the single local-network permission covers SSDP and ECP traffic.
        if (Build.VERSION.SDK_INT >= API_LOCAL_NETWORK_PERMISSION) {
            return listOf(ACCESS_LOCAL_NETWORK).filterNot(::hasPermission)
        }

        val permissions = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            permissions.add(Manifest.permission.ACCESS_FINE_LOCATION)
            permissions.add(Manifest.permission.ACCESS_COARSE_LOCATION)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.NEARBY_WIFI_DEVICES)
        }
        return permissions.filterNot(::hasPermission)
    }

    @Keep
    fun discoveryPermissionsGranted(): Boolean {
        return try {
            missingDiscoveryPermissions().isEmpty()
        } catch (e: Throwable) {
            android.util.Log.e(TAG, "Failed to check discovery permissions: ${e.message}", e)
            false
        }
    }

    /** Asks for whatever is missing. The outcome arrives through [nativeOnPermissionResult]. */
    @Keep
    fun requestDiscoveryPermissions() {
        runOnUiThread {
            try {
                val missing = missingDiscoveryPermissions()
                if (missing.isEmpty()) {
                    nativeOnPermissionResult(DISCOVERY_PERMISSION_REQUEST_CODE, true)
                } else {
                    ActivityCompat.requestPermissions(
                        this,
                        missing.toTypedArray(),
                        DISCOVERY_PERMISSION_REQUEST_CODE,
                    )
                }
            } catch (e: Throwable) {
                android.util.Log.e(TAG, "Failed to request discovery permissions: ${e.message}", e)
                nativeOnPermissionResult(DISCOVERY_PERMISSION_REQUEST_CODE, false)
            }
        }
    }

    @Keep
    fun notificationPermissionGranted(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            hasPermission(Manifest.permission.POST_NOTIFICATIONS)
    }

    @Keep
    fun requestNotificationPermission() {
        runOnUiThread {
            try {
                if (notificationPermissionGranted()) {
                    nativeOnPermissionResult(NOTIFICATION_PERMISSION_REQUEST_CODE, true)
                } else {
                    ActivityCompat.requestPermissions(
                        this,
                        arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                        NOTIFICATION_PERMISSION_REQUEST_CODE,
                    )
                }
            } catch (e: Throwable) {
                android.util.Log.e(TAG, "Failed to request notification permission: ${e.message}", e)
                nativeOnPermissionResult(NOTIFICATION_PERMISSION_REQUEST_CODE, false)
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)

        // Re-check instead of trusting grantResults: it is empty when the request is interrupted.
        val granted = when (requestCode) {
            DISCOVERY_PERMISSION_REQUEST_CODE -> discoveryPermissionsGranted()
            NOTIFICATION_PERMISSION_REQUEST_CODE -> notificationPermissionGranted()
            else -> return
        }
        android.util.Log.i(TAG, "Permission request $requestCode granted=$granted")
        nativeOnPermissionResult(requestCode, granted)
    }

    @Keep
    fun acquireDiscoveryLocks() {
        try {
            val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            if (multicastLock?.isHeld != true) {
                multicastLock = wifiManager.createMulticastLock("roku_ssdp_multicast").apply {
                    setReferenceCounted(false)
                    acquire()
                }
                android.util.Log.d(TAG, "Multicast lock acquired")
            }
        } catch (e: Throwable) {
            android.util.Log.e(TAG, "Failed to acquire multicast lock: ${e.message}", e)
        }
    }

    @Keep
    fun releaseDiscoveryLocks() {
        try {
            multicastLock?.let {
                if (it.isHeld) {
                    it.release()
                    android.util.Log.d(TAG, "Multicast lock released")
                }
            }
        } catch (e: Throwable) {
            android.util.Log.e(TAG, "Failed to release multicast lock: ${e.message}", e)
        }
        multicastLock = null
    }

    private fun hasPermission(permission: String): Boolean {
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
    }
}
