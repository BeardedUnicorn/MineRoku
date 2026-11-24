package com.rokucontroller.remote

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread
import org.json.JSONObject

/**
 * The app's own update (modeled on TaskMint's). It downloads a release's APK
 * from GitHub into its cache and hands it to Android's installer. The
 * installer asks before replacing the app, and the first time it asks for
 * Roku Remote to be allowed to install apps.
 *
 * The download belongs to the app, not to the screen that asked for it. It
 * carries on with the app in the background, and when Android recreates the
 * activity in the meantime, the new activity's page hears the rest. Android
 * lets an app open another screen only while its own is in front, and
 * otherwise refuses without a word. So the installer opens while the
 * activity is resumed: at once, or as soon as it next is. The APK stays in
 * the cache, and asking for that version again opens the installer on it
 * with no download.
 *
 * Android cuts a backgrounded app off the network shortly after it leaves
 * the screen. A download that's cut off keeps what it has, and the next try
 * asks GitHub only for the rest. That try starts by itself once the app is
 * in front again, when being in the background is what cut it off.
 * Otherwise it starts when the user tries again.
 */
object AppUpdate {
    private const val APK_TYPE = "application/vnd.android.package-archive"
    private const val RANGE_NOT_SATISFIABLE = 416
    private const val TIMEOUT_MS = 30_000
    private const val REPORT_EVERY_MS = 250L

    /** Android gives an app its network back a moment after it's in front again. */
    private const val SETTLE_MS = 1_000L

    /**
     * A failure that another try wouldn't change: GitHub's answer, or what
     * the download turned out to be. Anything else that stops a download (an
     * IOException) comes from the connection or the phone.
     */
    private class Refused(message: String) : Exception(message)

    private val main = Handler(Looper.getMainLooper())

    /** The app's activity, and how its page hears a report (window.__rokuUpdate). */
    private class Screen(val activity: Activity, val report: (JSONObject) -> Unit)

    // Everything below is touched on the main thread only
    /** The most recently created activity, until it's destroyed (detach clears it, so it doesn't leak). */
    @SuppressLint("StaticFieldLeak")
    private var screen: Screen? = null

    /** Whether `screen` is resumed: only then will Android let it open the installer. */
    private var inFront = false

    /** The version being downloaded, and the last progress it reported. */
    private var fetching: String? = null
    private var progress: JSONObject? = null

    /** Whether the app has left the front since this try at the download began. */
    private var away = false

    /** The next try at a download that was cut off in the background, for when the app is back. */
    private var stalled: (() -> Unit)? = null

    /** A downloaded and checked APK whose installer waits for the activity to be resumed. */
    private var waiting: File? = null

    /** A new activity (onCreate): its page hears the reports from now on. */
    fun attach(activity: Activity, report: (JSONObject) -> Unit) {
        screen = Screen(activity, report)
        left()
    }

    /**
     * The activity is in front (onResume): an installer that waited for it
     * opens, and a download that was cut off in the meantime carries on.
     */
    fun resumed(activity: Activity) {
        if (screen?.activity !== activity) return
        inFront = true
        waiting?.let(::open)
        stalled?.let {
            stalled = null
            main.postDelayed(it, SETTLE_MS)
        }
    }

    /** It no longer is (onPause). */
    fun paused(activity: Activity) {
        if (screen?.activity === activity) left()
    }

    /** It's gone (onDestroy). A download carries on, for the next activity. */
    fun detach(activity: Activity) {
        if (screen?.activity !== activity) return
        screen = null
        left()
    }

    private fun left() {
        inFront = false
        away = true
    }

    /**
     * Downloads `version` and opens the installer on it, unless an earlier
     * download of it is still in the cache. As it goes the page hears
     * `{"downloaded", "total"}` (in bytes; `total` is null when GitHub
     * doesn't say). Then it hears `{"done": true}` once the installer is
     * open, or `{"error"}`. Asking again for the version that's downloading
     * joins that download. Can be called from any thread.
     */
    fun download(context: Context, version: String) {
        val app = context.applicationContext
        main.post {
            val busy = fetching
            when {
                !UpdateRelease.isVersion(version) -> report(failure("$version isn't a version."))
                // For example, the page of an activity created since it started: it hears the rest
                busy == version -> progress?.let(::report)
                busy != null -> report(failure("Roku Remote $busy is still downloading."))
                else -> {
                    fetching = version
                    progress = null
                    // This download's installer is the one to open
                    waiting = null
                    go(app, version)
                }
            }
        }
    }

    /**
     * One try at `version`'s download, on a thread of its own. If the
     * connection fails and the app was in the background in the meantime,
     * the background is taken to be the cause (Android cuts a backgrounded
     * app off) and the failure isn't reported. Another try follows once the
     * app is in front, from where this one stopped. Each of those needs the
     * app to leave the front again, so they end.
     */
    private fun go(app: Context, version: String) {
        away = !inFront
        thread(name = "roku-update") {
            val apk = runCatching { kept(app, version) ?: fetch(app, version) }
            main.post {
                val cutOff = apk.exceptionOrNull() is IOException && away
                when {
                    cutOff && !inFront -> stalled = { go(app, version) }
                    cutOff -> main.postDelayed({ go(app, version) }, SETTLE_MS)
                    else -> {
                        fetching = null
                        progress = null
                        apk.fold(::open) { report(failure(it)) }
                    }
                }
            }
        }
    }

    /** Sent to the current activity's page; when there is none (between two activities), dropped. */
    private fun report(said: JSONObject) {
        screen?.report?.invoke(said)
    }

    private fun failure(message: String) = JSONObject().put("error", message)

    private fun failure(error: Throwable) = failure(error.message ?: error.javaClass.simpleName)

    private fun apkFor(context: Context, version: String) =
        File(File(context.cacheDir, "updates"), UpdateRelease.apkName(version))

    /** The APK an earlier download left for `version`, if it still checks out. */
    private fun kept(context: Context, version: String): File? =
        apkFor(context, version).takeIf { it.isFile && runCatching { check(context, it, version) }.isSuccess }

    /**
     * Runs on the download's thread. Each try writes to a `.part` file until
     * the APK is whole, and the file stays when the try fails. A `.stamp`
     * file beside it records which build of the APK the part belongs to.
     * The next try asks for the rest.
     */
    private fun fetch(context: Context, version: String): File {
        val apk = apkFor(context, version)
        val folder = apk.parentFile ?: throw Refused("The download has nowhere to go.")
        val part = File(folder, "${apk.name}.part")
        val stamp = File(folder, "${apk.name}.stamp")
        // Other versions' downloads are deleted: each APK is tens of MB
        folder.listFiles()?.forEach { if (it != part && it != stamp) it.deleteRecursively() }
        if (!folder.isDirectory) {
            folder.delete()
            if (!folder.mkdirs()) throw Refused("The download has nowhere to go.")
        }

        val url = UpdateRelease.apkUrl(version)
        val build = runCatching { stamp.readText() }.getOrNull()
        val have = if (build.isNullOrEmpty()) 0L else part.length()
        if (have == 0L || !receive(url, part, stamp, have, build)) receive(url, part, stamp, 0L, null)

        stamp.delete()
        if (!part.renameTo(apk)) throw Refused("The download couldn't be kept.")
        try {
            check(context, apk, version)
        } catch (e: Refused) {
            apk.delete()
            throw e
        }
        return apk
    }

    /**
     * Asks GitHub for the APK from byte `from` on, and appends what arrives
     * to `part`, which already holds that many bytes. From 0 it asks for the
     * whole APK, and `part` starts over. Returns false when `part` can't be
     * continued: GitHub now has a different build of the APK than `build`,
     * or sends nothing from there. In that case nothing is written.
     */
    private fun receive(url: String, part: File, stamp: File, from: Long, build: String?): Boolean {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = TIMEOUT_MS
        connection.readTimeout = TIMEOUT_MS
        // Unencoded, so that a byte's place in the response is its place in the APK
        connection.setRequestProperty("Accept-Encoding", "identity")
        if (from > 0) connection.setRequestProperty("Range", "bytes=$from-")
        try {
            val status = connection.responseCode
            val total: Long?
            if (from > 0) {
                // GitHub sent the whole APK instead, or the APK has no such byte
                if (status == HttpURLConnection.HTTP_OK || status == RANGE_NOT_SATISFIABLE) return false
                if (status != HttpURLConnection.HTTP_PARTIAL) throw Refused("GitHub answered $status.")
                val (start, size) = UpdateRelease.contentRange(connection.getHeaderField("Content-Range"))
                    ?: return false
                if (start != from) return false
                total = size
                if (stampOf(connection, total) != build) return false
            } else {
                if (status != HttpURLConnection.HTTP_OK) throw Refused("GitHub answered $status.")
                total = connection.contentLengthLong.takeIf { it > 0 }
                // A stamp is never left beside a part from a different build
                stamp.delete()
                part.delete()
                stampOf(connection, total)?.let { stamp.writeText(it) }
            }
            var downloaded = from
            var reportedAt = 0L
            connection.inputStream.use { input ->
                FileOutputStream(part, from > 0).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        downloaded += read
                        val now = System.currentTimeMillis()
                        if (now - reportedAt >= REPORT_EVERY_MS) {
                            reportedAt = now
                            tell(downloaded, total)
                        }
                    }
                }
            }
            if (total != null && downloaded != total) throw IOException("The download stopped early.")
            tell(downloaded, total)
            return true
        } finally {
            connection.disconnect()
        }
    }

    private fun stampOf(connection: HttpURLConnection, total: Long?): String? =
        UpdateRelease.stamp(connection.getHeaderField("ETag"), connection.getHeaderField("Last-Modified"), total)

    /** Download progress, sent from the download's thread: kept for a page that joins later, and reported. */
    private fun tell(downloaded: Long, total: Long?) {
        val soFar = JSONObject().put("downloaded", downloaded).put("total", total ?: JSONObject.NULL)
        main.post {
            progress = soFar
            report(soFar)
        }
    }

    /**
     * Checks that the download is this app, at that version, and complete.
     * Asked for its signature, Android reads the whole file and refuses one
     * whose bytes don't match what was signed, as a wrongly assembled
     * download wouldn't. (Android itself also refuses an update signed with
     * a different key.)
     */
    private fun check(context: Context, apk: File, version: String) {
        @Suppress("DEPRECATION")
        val signed =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES
            else PackageManager.GET_SIGNATURES
        val info = context.packageManager.getPackageArchiveInfo(apk.path, signed)
            ?: throw Refused("The download isn't an app.")
        if (info.packageName != context.packageName) throw Refused("The download isn't Roku Remote.")
        if (info.versionName != version) throw Refused("The download isn't Roku Remote $version.")
    }

    /**
     * Opens the installer on a checked APK and reports `done`, if the
     * activity is in front. Otherwise it waits until the activity next is
     * (`resumed`), because Android would silently drop the request from the
     * background.
     */
    private fun open(apk: File) {
        val activity = screen?.activity?.takeIf { inFront }
        if (activity == null) {
            waiting = apk
            return
        }
        waiting = null
        try {
            // The system may have emptied the cache while the installer waited
            if (!apk.isFile) throw IOException("The download is no longer on the phone.")
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", apk)
            activity.startActivity(
                Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, APK_TYPE)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            )
            report(JSONObject().put("done", true))
        } catch (e: Exception) {
            report(failure(e))
        }
    }
}
