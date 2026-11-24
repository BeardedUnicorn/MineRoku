# Changelog

What each Roku Remote release changed, newest first. Add changes under
"## Unreleased" as they land; `pnpm release <patch|minor|major>` turns that
heading into the new version's. Each section becomes that release's notes on
GitHub, and the in-app update dialog shows the sections since the installed
version (README's "Releasing").

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
