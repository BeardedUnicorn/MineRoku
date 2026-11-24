package com.rokucontroller.remote

/**
 * What AppUpdate needs to know about a release's APK and GitHub's answers,
 * apart from Android so that unit tests can run it (AppUpdateTest).
 */
internal object UpdateRelease {
    /** Where the releases' files download from (updates.rs's RELEASES_URL). */
    private const val RELEASES = "https://github.com/BeardedUnicorn/MineRoku/releases/download"

    private val VERSION = Regex("""\d+\.\d+\.\d+""")

    /** `Content-Range: bytes 100-999/1000`: where what's sent starts, and the whole's size. */
    private val CONTENT_RANGE = Regex("""bytes (\d+)-\d+/(\d+)""")

    /** Whether `version` is a release's version ("0.2.0"). */
    fun isVersion(version: String): Boolean = VERSION.matches(version)

    /** The release's APK, as scripts/release/lib.mjs names it. */
    fun apkName(version: String): String = "RokuRemote-$version-android-arm64.apk"

    /** Where it downloads from (updates.rs's apk_url builds the same). */
    fun apkUrl(version: String): String = "$RELEASES/v$version/${apkName(version)}"

    /** A Content-Range header's start and total, or null for one it can't read. */
    fun contentRange(header: String?): Pair<Long, Long>? {
        val match = CONTENT_RANGE.matchEntire(header.orEmpty()) ?: return null
        val start = match.groupValues[1].toLongOrNull() ?: return null
        val total = match.groupValues[2].toLongOrNull() ?: return null
        return start to total
    }

    /**
     * What tells one build of a release's APK from another: GitHub's tag for
     * the file (or its date) and its size. Null when either is missing, and
     * a part download can't then be carried on with.
     */
    fun stamp(etag: String?, lastModified: String?, total: Long?): String? {
        if (total == null) return null
        val tag = etag ?: lastModified ?: return null
        return "$tag $total"
    }
}
