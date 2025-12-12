package com.roku_controller.app

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Bundle
import android.os.Build
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.net.Inet4Address
import java.net.NetworkInterface

class MainActivity : TauriActivity() {
    private var multicastLock: WifiManager.MulticastLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    companion object {
        private const val PERMISSION_REQUEST_CODE = 1001
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestPermissionsIfNeeded()
    }

    override fun onResume() {
        super.onResume()
        acquireLocks()
    }

    override fun onPause() {
        super.onPause()
        // Keep locks active briefly after pause for discovery to complete
    }

    override fun onDestroy() {
        releaseLocks()
        super.onDestroy()
    }

    private fun requestPermissionsIfNeeded() {
        val permissionsNeeded = mutableListOf<String>()

        // Location permission is needed for WiFi scanning on Android 10+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) 
                != PackageManager.PERMISSION_GRANTED) {
                permissionsNeeded.add(Manifest.permission.ACCESS_FINE_LOCATION)
            }
        }

        // For Android 12+ (API 31+), we need NEARBY_WIFI_DEVICES
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.NEARBY_WIFI_DEVICES) 
                != PackageManager.PERMISSION_GRANTED) {
                permissionsNeeded.add(Manifest.permission.NEARBY_WIFI_DEVICES)
            }
        }

        if (permissionsNeeded.isNotEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                permissionsNeeded.toTypedArray(),
                PERMISSION_REQUEST_CODE
            )
        } else {
            // Permissions already granted, acquire locks immediately
            acquireLocks()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
                android.util.Log.d("RokuRemote", "All permissions granted, acquiring locks")
                acquireLocks()
            } else {
                android.util.Log.e("RokuRemote", "Some permissions were denied")
            }
        }
    }

    private fun acquireLocks() {
        try {
            val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            
            // Acquire WiFi lock to prevent WiFi from going to sleep
            if (wifiLock == null || wifiLock?.isHeld != true) {
                wifiLock = wifiManager.createWifiLock(
                    WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                    "roku_remote_wifi_lock"
                )
                wifiLock?.setReferenceCounted(false)
                wifiLock?.acquire()
                android.util.Log.d("RokuRemote", "WiFi lock acquired")
            }

            // Acquire multicast lock
            if (multicastLock == null || multicastLock?.isHeld != true) {
                multicastLock = wifiManager.createMulticastLock("roku_ssdp_multicast")
                multicastLock?.setReferenceCounted(false)
                multicastLock?.acquire()
                android.util.Log.d("RokuRemote", "Multicast lock acquired")
            }

            // Log WiFi state for debugging
            val wifiInfo = wifiManager.connectionInfo
            android.util.Log.d("RokuRemote", "WiFi SSID: ${wifiInfo?.ssid}, IP: ${intToIp(wifiInfo?.ipAddress ?: 0)}")

            // Log network interfaces
            logNetworkInterfaces()

        } catch (e: Exception) {
            android.util.Log.e("RokuRemote", "Failed to acquire locks: ${e.message}", e)
        }
    }

    private fun releaseLocks() {
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
            android.util.Log.e("RokuRemote", "Failed to release locks: ${e.message}", e)
        }
    }

    private fun intToIp(ip: Int): String {
        return "${ip and 0xFF}.${ip shr 8 and 0xFF}.${ip shr 16 and 0xFF}.${ip shr 24 and 0xFF}"
    }

    private fun logNetworkInterfaces() {
        try {
            android.util.Log.d("RokuRemote", "=== Network Interfaces ===")
            val networkInterfaces = NetworkInterface.getNetworkInterfaces()
            while (networkInterfaces.hasMoreElements()) {
                val netInterface = networkInterfaces.nextElement()
                if (netInterface.isUp && !netInterface.isLoopback) {
                    android.util.Log.d("RokuRemote", "Interface: ${netInterface.displayName}")
                    
                    val addresses = netInterface.inetAddresses
                    while (addresses.hasMoreElements()) {
                        val addr = addresses.nextElement()
                        if (addr is Inet4Address) {
                            val ipStr = addr.hostAddress ?: "unknown"
                            val isVpn = isVpnAddress(ipStr)
                            val marker = if (netInterface.name.startsWith("wlan")) "[WiFi]" else ""
                            val vpnMarker = if (isVpn) "[VPN]" else ""
                            android.util.Log.d("RokuRemote", "  $marker$vpnMarker IPv4: $ipStr")
                        }
                    }
                    
                    try {
                        val supportsMulticast = netInterface.supportsMulticast()
                        android.util.Log.d("RokuRemote", "  Supports Multicast: $supportsMulticast")
                    } catch (e: Exception) {
                        android.util.Log.d("RokuRemote", "  Multicast check failed: ${e.message}")
                    }
                }
            }
            android.util.Log.d("RokuRemote", "=== End Network Interfaces ===")
        } catch (e: Exception) {
            android.util.Log.e("RokuRemote", "Failed to enumerate network interfaces: ${e.message}")
        }
    }

    private fun isVpnAddress(ip: String): Boolean {
        // Common VPN IP ranges
        return ip.startsWith("100.6") ||  // CGNAT range used by many VPNs
               ip.startsWith("100.7") ||
               ip.startsWith("10.0.") ||  // Some VPNs use 10.0.x.x
               ip.startsWith("10.1.") ||
               ip.startsWith("10.8.")     // OpenVPN default
    }
}