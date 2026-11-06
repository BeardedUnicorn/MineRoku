package com.rokucontroller.remote

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.annotation.Keep
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
    private var multicastLock: WifiManager.MulticastLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    companion object {
        private const val DISCOVERY_PERMISSION_REQUEST_CODE = 1001
        private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 1002
    }

    private external fun nativeOnActivityCreated()
    private external fun nativeOnActivityDestroyed()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        nativeOnActivityCreated()
        keepContentClearOfSystemBars()
    }

    override fun onDestroy() {
        nativeOnActivityDestroyed()
        releaseDiscoveryLocks()
        super.onDestroy()
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

    @Keep
    fun updateMediaSession(
        deviceName: String,
        deviceIp: String,
        devicePort: Int,
        appName: String,
        appId: String?,
        isPlaying: Boolean,
    ) {
        val updateIntent = Intent(this, MediaControlService::class.java).apply {
            action = MediaControlService.ACTION_UPDATE
            putExtra(MediaControlService.EXTRA_DEVICE_NAME, deviceName)
            putExtra(MediaControlService.EXTRA_DEVICE_IP, deviceIp)
            putExtra(MediaControlService.EXTRA_DEVICE_PORT, devicePort)
            putExtra(MediaControlService.EXTRA_APP_NAME, appName)
            putExtra(MediaControlService.EXTRA_APP_ID, appId)
            putExtra(MediaControlService.EXTRA_IS_PLAYING, isPlaying)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ContextCompat.startForegroundService(this, updateIntent)
        } else {
            startService(updateIntent)
        }
    }

    @Keep
    fun hideMediaNotification() {
        val hideIntent = Intent(this, MediaControlService::class.java).apply {
            action = MediaControlService.ACTION_HIDE
        }
        startService(hideIntent)
    }

    @Keep
    fun ensureDiscoveryPermissions(): Boolean {
        val permissionsNeeded = mutableListOf<String>()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (!hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
                permissionsNeeded.add(Manifest.permission.ACCESS_FINE_LOCATION)
            }
            if (!hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)) {
                permissionsNeeded.add(Manifest.permission.ACCESS_COARSE_LOCATION)
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (!hasPermission(Manifest.permission.NEARBY_WIFI_DEVICES)) {
                permissionsNeeded.add(Manifest.permission.NEARBY_WIFI_DEVICES)
            }
        }

        if (permissionsNeeded.isNotEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                permissionsNeeded.toTypedArray(),
                DISCOVERY_PERMISSION_REQUEST_CODE,
            )
            return false
        }

        return true
    }

    @Keep
    fun ensureNotificationPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return true
        }

        if (hasPermission(Manifest.permission.POST_NOTIFICATIONS)) {
            return true
        }

        ActivityCompat.requestPermissions(
            this,
            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            NOTIFICATION_PERMISSION_REQUEST_CODE,
        )
        return false
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)

        val granted = grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        when (requestCode) {
            DISCOVERY_PERMISSION_REQUEST_CODE -> {
                if (granted) {
                    android.util.Log.d("RokuRemote", "Discovery permissions granted")
                } else {
                    android.util.Log.w("RokuRemote", "Discovery permissions denied")
                }
            }

            NOTIFICATION_PERMISSION_REQUEST_CODE -> {
                if (granted) {
                    android.util.Log.d("RokuRemote", "Notification permission granted")
                } else {
                    android.util.Log.w("RokuRemote", "Notification permission denied")
                }
            }
        }
    }

    @Keep
    fun acquireDiscoveryLocks() {
        try {
            val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

            if (wifiLock == null || wifiLock?.isHeld != true) {
                wifiLock = wifiManager.createWifiLock(
                    WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                    "roku_remote_wifi_lock",
                )
                wifiLock?.setReferenceCounted(false)
                wifiLock?.acquire()
                android.util.Log.d("RokuRemote", "WiFi lock acquired")
            }

            if (multicastLock == null || multicastLock?.isHeld != true) {
                multicastLock = wifiManager.createMulticastLock("roku_ssdp_multicast")
                multicastLock?.setReferenceCounted(false)
                multicastLock?.acquire()
                android.util.Log.d("RokuRemote", "Multicast lock acquired")
            }
        } catch (e: Exception) {
            android.util.Log.e("RokuRemote", "Failed to acquire discovery locks: ${e.message}", e)
        }
    }

    @Keep
    fun releaseDiscoveryLocks() {
        try {
            multicastLock?.let {
                if (it.isHeld) {
                    it.release()
                    android.util.Log.d("RokuRemote", "Multicast lock released")
                }
            }
            multicastLock = null

            wifiLock?.let {
                if (it.isHeld) {
                    it.release()
                    android.util.Log.d("RokuRemote", "WiFi lock released")
                }
            }
            wifiLock = null
        } catch (e: Exception) {
            android.util.Log.e("RokuRemote", "Failed to release discovery locks: ${e.message}", e)
        }
    }

    private fun hasPermission(permission: String): Boolean {
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
    }
}
