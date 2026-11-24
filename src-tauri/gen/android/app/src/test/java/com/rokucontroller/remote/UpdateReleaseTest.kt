package com.rokucontroller.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateReleaseTest {
    @Test
    fun onlyThreeNumberVersionsAreReleases() {
        assertTrue(UpdateRelease.isVersion("0.2.0"))
        assertTrue(UpdateRelease.isVersion("10.20.30"))
        assertFalse(UpdateRelease.isVersion("v0.2.0"))
        assertFalse(UpdateRelease.isVersion("0.2"))
        assertFalse(UpdateRelease.isVersion("0.2.0.1"))
        assertFalse(UpdateRelease.isVersion("0.2.0/../../x"))
    }

    @Test
    fun theApkDownloadsFromItsRelease() {
        // The same address as updates.rs's apk_url and the name the release script gives it
        assertEquals(
            "https://github.com/BeardedUnicorn/MineRoku/releases/download/v0.2.0/RokuRemote-0.2.0-android-arm64.apk",
            UpdateRelease.apkUrl("0.2.0"),
        )
    }

    @Test
    fun aContentRangeGivesItsStartAndTotal() {
        assertEquals(100L to 1000L, UpdateRelease.contentRange("bytes 100-999/1000"))
        assertNull(UpdateRelease.contentRange("bytes 100-999/*"))
        assertNull(UpdateRelease.contentRange("bytes */1000"))
        assertNull(UpdateRelease.contentRange(""))
        assertNull(UpdateRelease.contentRange(null))
    }

    @Test
    fun aStampNeedsATagAndASize() {
        assertEquals("\"abc\" 1000", UpdateRelease.stamp("\"abc\"", "Mon", 1000L))
        assertEquals("Mon 1000", UpdateRelease.stamp(null, "Mon", 1000L))
        assertNull(UpdateRelease.stamp(null, null, 1000L))
        assertNull(UpdateRelease.stamp("\"abc\"", "Mon", null))
    }
}
