package com.rokucontroller.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetModelTest {
    private val tv = WidgetDevice("roku:A", "Living Room TV", "10.0.0.2", 8060)

    @Test
    fun aShortWidgetIsTheStripAndATallOneTheFullRemote() {
        assertEquals(WidgetLayout.STRIP, WidgetSizing.layoutFor(300, 40))
        assertEquals(WidgetLayout.STRIP, WidgetSizing.layoutFor(300, 75))
        assertEquals(WidgetLayout.STRIP_TITLED, WidgetSizing.layoutFor(300, 76))
        assertEquals(WidgetLayout.STRIP_TITLED, WidgetSizing.layoutFor(300, 279))
        assertEquals(WidgetLayout.FULL, WidgetSizing.layoutFor(300, 280))
    }

    @Test
    fun aTallButNarrowWidgetStaysAStrip() {
        assertEquals(WidgetLayout.STRIP_TITLED, WidgetSizing.layoutFor(199, 400))
        assertEquals(WidgetLayout.FULL, WidgetSizing.layoutFor(200, 400))
    }

    @Test
    fun theStripHasTheTvControlsAndTheFullRemoteHasEveryButton() {
        val strip = WidgetButton.buttonsFor(WidgetLayout.STRIP).map { it.command }
        assertEquals(listOf("power_toggle", "VolumeDown", "play_pause", "VolumeUp", "VolumeMute"), strip)
        assertEquals(strip, WidgetButton.buttonsFor(WidgetLayout.STRIP_TITLED).map { it.command })

        val full = WidgetButton.buttonsFor(WidgetLayout.FULL)
        assertEquals(WidgetButton.entries.toList(), full)
        assertTrue(full.map { it.command }.containsAll(listOf("up", "down", "left", "right", "select", "back", "home")))
    }

    @Test
    fun aButtonIsFoundByItsCommandAndNothingElseIs() {
        assertEquals(WidgetButton.OK, WidgetButton.fromCommand("select"))
        assertNull(WidgetButton.fromCommand("Lit_a"))
        assertNull(WidgetButton.fromCommand(""))
    }

    @Test
    fun aDeviceSurvivesBeingStored() {
        assertEquals(tv, WidgetDevice.decode(tv.encode()))

        val odd = WidgetDevice("roku:eth:AABBCC", "Kids' TV / \"den\" \u001F 2", "192.168.1.50", 8061)
        assertEquals(odd, WidgetDevice.decode(odd.encode()))
    }

    @Test
    fun aDamagedEntryIsNoDevice() {
        assertNull(WidgetDevice.decode(null))
        assertNull(WidgetDevice.decode(""))
        assertNull(WidgetDevice.decode("roku:A\u001F10.0.0.2\u001Fnot-a-port\u001FTV"))
        assertNull(WidgetDevice.decode("roku:A\u001F10.0.0.2\u001F0\u001FTV"))
        assertNull(WidgetDevice.decode("\u001F10.0.0.2\u001F8060\u001FTV"))
    }

    @Test
    fun aWidgetFollowsItsRokuToANewAddressAndName() {
        val moved = WidgetDevice("roku:A", "Den TV", "10.0.0.9", 8060)
        val other = WidgetDevice("roku:B", "Bedroom", "10.0.0.2", 8060)

        assertEquals(moved, WidgetDevices.reconcile(tv, listOf(other, moved)))
    }

    @Test
    fun aForgottenRokuLeavesTheWidgetWithNone() {
        assertNull(WidgetDevices.reconcile(tv, emptyList()))
        assertNull(WidgetDevices.reconcile(tv, listOf(WidgetDevice("roku:B", "Bedroom", "10.0.0.2", 8060))))
    }

    @Test
    fun anUnreadableDeviceListChangesNothing() {
        assertEquals(tv, WidgetDevices.reconcile(tv, null))
    }

    @Test
    fun restoredWidgetsKeepTheirRokuUnderTheNewId() {
        val entries = mapOf(1 to "a", 2 to "b", 7 to "c")

        val remapped = WidgetDevices.remapIds(entries, intArrayOf(1, 2), intArrayOf(11, 1))

        assertEquals(mapOf(7 to "c", 11 to "a", 1 to "b"), remapped)
    }

    @Test
    fun aButtonPressRoundTripsThroughItsUri() {
        val uri = WidgetUris.action(42, "VolumeUp")

        assertEquals("rokuwidget://action/42/VolumeUp", uri)
        assertEquals(42 to "VolumeUp", WidgetUris.parseAction(uri))
    }

    @Test
    fun otherUrisAreNotButtonPresses() {
        assertNull(WidgetUris.parseAction(null))
        assertNull(WidgetUris.parseAction(WidgetUris.configure(42)))
        assertNull(WidgetUris.parseAction("rokuwidget://action/abc/VolumeUp"))
        assertNull(WidgetUris.parseAction("rokuwidget://action/42/"))
        assertNull(WidgetUris.parseAction("rokuwidget://action/42/a/b"))
    }
}
