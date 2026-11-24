package com.rokucontroller.remote

// The home-screen widget's rules, kept free of Android classes so they can be unit tested.

/** What the widget shows at a given size. */
enum class WidgetLayout {
    /** One row of TV controls. */
    STRIP,

    /** The Roku's name over the row of TV controls. */
    STRIP_TITLED,

    /** The full remote. */
    FULL,
}

object WidgetSizing {
    const val TITLED_MIN_HEIGHT_DP = 76

    // Title, five rows of buttons and padding: each row is then at least 48dp tall.
    const val FULL_MIN_HEIGHT_DP = 280
    const val FULL_MIN_WIDTH_DP = 200

    fun layoutFor(widthDp: Int, heightDp: Int): WidgetLayout = when {
        heightDp >= FULL_MIN_HEIGHT_DP && widthDp >= FULL_MIN_WIDTH_DP -> WidgetLayout.FULL
        heightDp >= TITLED_MIN_HEIGHT_DP -> WidgetLayout.STRIP_TITLED
        else -> WidgetLayout.STRIP
    }
}

/** A widget button and the command it sends (see [MediaSessionManager.sendCommandBlocking]). */
enum class WidgetButton(val command: String) {
    POWER(MediaSessionManager.CMD_POWER_TOGGLE),
    VOLUME_DOWN(MediaSessionManager.CMD_VOLUME_DOWN),
    PLAY_PAUSE(MediaSessionManager.CMD_PLAY_PAUSE),
    VOLUME_UP(MediaSessionManager.CMD_VOLUME_UP),
    MUTE(MediaSessionManager.CMD_VOLUME_MUTE),
    REWIND("rev"),
    FORWARD("fwd"),
    UP("up"),
    DOWN("down"),
    LEFT("left"),
    RIGHT("right"),
    OK("select"),
    BACK("back"),
    HOME("home"),
    INFO("info");

    companion object {
        private val STRIP_BUTTONS = listOf(POWER, VOLUME_DOWN, PLAY_PAUSE, VOLUME_UP, MUTE)

        fun fromCommand(command: String): WidgetButton? = entries.firstOrNull { it.command == command }

        /** The buttons a layout has. */
        fun buttonsFor(layout: WidgetLayout): List<WidgetButton> = when (layout) {
            WidgetLayout.STRIP, WidgetLayout.STRIP_TITLED -> STRIP_BUTTONS
            WidgetLayout.FULL -> entries
        }
    }
}

/** The Roku a widget controls, as the widget last knew it. */
data class WidgetDevice(
    val hardwareId: String,
    val name: String,
    val ip: String,
    val port: Int,
) {
    /** One line for the widget's preferences. The name comes last: it may hold anything. */
    fun encode(): String = listOf(hardwareId, ip, port.toString(), name).joinToString(SEPARATOR)

    companion object {
        private const val SEPARATOR = "\u001F"

        fun decode(encoded: String?): WidgetDevice? {
            val parts = encoded?.split(SEPARATOR, limit = 4) ?: return null
            if (parts.size != 4) {
                return null
            }
            val port = parts[2].toIntOrNull() ?: return null
            if (parts[0].isEmpty() || parts[1].isEmpty() || port !in 1..65535) {
                return null
            }
            return WidgetDevice(hardwareId = parts[0], name = parts[3], ip = parts[1], port = port)
        }
    }
}

object WidgetDevices {
    /**
     * Brings a widget's device up to date with the app's saved devices: a Roku that moved to a
     * new address or was renamed is followed by its hardware ID, and one that was forgotten
     * returns null. [saved] is null when the list couldn't be read, which changes nothing.
     */
    fun reconcile(stored: WidgetDevice, saved: List<WidgetDevice>?): WidgetDevice? {
        if (saved == null) {
            return stored
        }
        return saved.firstOrNull { it.hardwareId == stored.hardwareId }
    }

    /** The entries of restored widgets under their new IDs; the rest keep theirs. */
    fun <T> remapIds(entries: Map<Int, T>, oldIds: IntArray, newIds: IntArray): Map<Int, T> {
        val moved = oldIds.zip(newIds).toMap()
        val result = LinkedHashMap<Int, T>()
        for ((id, value) in entries) {
            if (id !in moved) {
                result[id] = value
            }
        }
        for ((oldId, newId) in moved) {
            entries[oldId]?.let { result[newId] = it }
        }
        return result
    }
}

/**
 * A button press as an intent's data URI. Everything the receiver needs is in the URI: it makes
 * each button's PendingIntent distinct and never carries an address that could go stale.
 */
object WidgetUris {
    private const val ACTION_PREFIX = "rokuwidget://action/"
    private const val CONFIGURE_PREFIX = "rokuwidget://configure/"

    fun action(widgetId: Int, command: String): String = "$ACTION_PREFIX$widgetId/$command"

    fun configure(widgetId: Int): String = "$CONFIGURE_PREFIX$widgetId"

    /** The widget ID and command of an action URI, or null for anything else. */
    fun parseAction(uri: String?): Pair<Int, String>? {
        if (uri == null || !uri.startsWith(ACTION_PREFIX)) {
            return null
        }
        val parts = uri.removePrefix(ACTION_PREFIX).split("/")
        if (parts.size != 2 || parts[1].isEmpty()) {
            return null
        }
        val widgetId = parts[0].toIntOrNull() ?: return null
        return widgetId to parts[1]
    }
}
