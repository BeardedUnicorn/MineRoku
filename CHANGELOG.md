# Changelog

What each Roku Remote release changed, newest first. Add changes under
"## Unreleased" as they land; `pnpm release <patch|minor|major>` turns that
heading into the new version's. Each section becomes that release's notes on
GitHub, and the in-app update dialog shows the sections since the installed
version (README's "Releasing").

## Unreleased

### Changed
- A new look: deep purple surfaces taken from the app icon, a lighter accent that is readable as text, a bundled typeface (Inter), rounder shapes and a visible keyboard focus ring. The remote keeps its layout, buttons and four styles; the Classic style is tinted to match.
- Settings opens from a gear in the top bar, and is a full screen on phones. Remote style is picked from four previews with one tap.
- Phones: the device list opens as a sheet from the device name in the top bar, replacing the side drawer behind a menu button.
- Apps are one scrolling grid instead of pages, under a search field that stays in view. Tap an app's artwork to launch it.
- Device scans are called "Scan" everywhere; "Refresh apps" reloads the app list.
- Desktop: the window can no longer be made smaller than the remote needs, and a short window scrolls the remote instead of cutting it off.
- Android: the widget's accent and its device picker use the app's colors (Android 12+ widgets still follow the wallpaper).

### Added
- Favorites on the remote screen: starred apps launch with one tap, without opening Apps.
- With devices saved but none selected, the app lists them to pick from instead of asking you to find the device list.
- A scan started from the device list says what it found.

### Fixed
- Android: after allowing local network access in system Settings, the remote appears when you come back, without tapping Allow again.
- The Settings button from the notification-permission message no longer appears on later, unrelated error messages.
- Keyboard shortcuts keep working on the Apps tab in a narrow desktop window.
- The mute button's icon reads as mute; the D-pad no longer shows keyboard hints on phones.
- About opens this project's GitHub page, where releases are published.

## 0.3.1 – 2026-11-24

### Fixed
- Android: the launcher icon is sharp on medium-density (hdpi) screens, where it used to be drawn from an undersized image, and launchers that use round icons get the proper adaptive icon.

## 0.3.0 – 2026-11-23

### Added
- Android home-screen widget: a remote you can use without opening the app. At its smallest it is a row of TV controls (power, volume down, play/pause, volume up, mute); make it taller for the full remote with the D-pad, OK, Back, Home, Info and rewind/fast-forward. Each widget is set up with its own Roku, so you can keep one per TV, and it follows that Roku if its address changes.
- The power button turns the TV on as well as off. It checks whether the TV is on and sends the right key, in the app, on the widget and on the lock screen.

### Changed
- Android lock-screen controls are now volume down, play/pause, volume up, mute and power. On Android 13 and newer the old volume and Home buttons never appeared there; only play/pause and rewind/forward did. Rewind and fast-forward are on the widget and in the app.
- The lock-screen controls have proper volume and power icons, show "Couldn't reach the Roku" when a press fails, and re-check whether something is playing after play/pause or power.

### Known limitations
- Turning a TV on only works if it stays on the network in standby (Roku's "Fast TV Start"). Streaming sticks and boxes have no power control.
- The widget's play/pause button doesn't show whether something is playing.
- Changing a widget's Roku needs Android 12 or newer; on older versions remove the widget and add it again.

## 0.2.0 – 2026-11-23

### Added
- The app updates itself from GitHub releases. On macOS and Windows it checks at launch and once a day, asks, then downloads, verifies, installs and restarts. On Android it downloads the new APK and opens Android's installer, which keeps your devices and settings. Settings → Updates shows the version, checks now, and turns automatic checks off.
- Releases are built, signed and published by CI from a version tag: macOS (Apple silicon and Intel), Windows and an arm64 Android APK.

### Fixed
- Forgetting a device, Delete All Data and caching app lists failed with "foreign key mismatch" on installs that predate hardware-id device keys. The stale app cache is rebuilt on startup.

## 0.1.0 – 2026-11-23

First tagged release.

### Android
- Targets Android 17 (API 37). On Android 17 the app asks for "Nearby devices" (local network) access before it talks to a Roku; without it nothing on the LAN is reachable.
- Fixed crashes while the app is in the background: the media notification no longer uses a sticky foreground service, and the process no longer aborts when the app is swiped out of Recents.
- The lock-screen / notification controls are shown while the app is open and removed on device switch, forget, Delete All Data and swipe-away.
- Native library is 16 KB page-size aligned.
- Adaptive launcher icon with a themed (monochrome) layer; haptic tick on key presses; the back gesture closes the drawer or an open dialog.
- Rust logs and panics now appear in logcat under `RokuRust`.

### All platforms
- Forget a single device from the device list. It is listed again if a later scan finds it.
- The remote stays the same size when the playback progress bar appears, so buttons no longer move under your finger.
- Rapid repeated presses are queued instead of dropped.
- Keyboard shortcuts no longer fire through open dialogs, with Ctrl/Cmd held, or on top of a focused button.
- Delete All Data reports failures instead of appearing to succeed.
- The app list no longer resets to page 1 or goes blank when a device's status changes.
- Discovery runs one subnet sweep instead of two and saves what it finds.
- Larger touch targets and better screen-reader labels.

### Known limitations
- Once Android freezes or kills the backgrounded app, lock-screen controls can go stale or disappear.
- Tested on an Android 17 emulator; not yet verified on a physical phone or on Android 16 and older.
