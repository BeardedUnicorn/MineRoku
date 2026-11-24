# Architecture

Roku Remote is a Tauri 2 application: a React + TypeScript UI runs in a webview, a Rust core runs in the host process, and the two communicate over Tauri IPC. The Rust core talks to Roku boxes on the local network via SSDP (discovery) and the Roku External Control Protocol over HTTP (control + status). A small SQLite file caches devices, app lists, and app icons across launches. On Android, a Kotlin layer mirrors part of the UI as a MediaSession so transport controls work from the lock screen and notification shade.

This document is the map. The [README](README.md) covers what the app *does*; this covers how it's wired.

## Runtime topology

```
 ┌──────────────────────────── desktop / Android process ────────────────────────────┐
 │                                                                                   │
 │   ┌────────────────┐    invoke / emit     ┌────────────────────────────────┐      │
 │   │  React webview │ ───────────────────▶ │  Rust core (src-tauri/src/)    │      │
 │   │  (src/)        │ ◀─────────────────── │   • commands.rs (logic)        │      │
 │   │  Zustand store │       events         │   • lib.rs (cmd wrappers,      │      │
 │   │  MUI v9        │                      │     JNI exports, app builder)  │      │
 │   └────────────────┘                      │   • background.rs (SQLite)     │      │
 │                                           │   • background_discovery.rs    │      │
 │            ▲                              └──────────────┬─────────────────┘      │
 │            │  (Android only) JNI                         │                        │
 │            │                                  HTTP / UDP │                        │
 │   ┌────────┴─────────────────┐                           │                        │
 │   │  Kotlin (gen/android/…)  │                           │                        │
 │   │  MediaSession +          │                           ▼                        │
 │   │  notification + perms    │              ┌──────────────────────────┐          │
 │   └──────────────────────────┘              │ Roku devices on LAN      │          │
 │                                             │  • SSDP M-SEARCH (UDP)   │          │
 │                                             │  • ECP (HTTP :8060)      │          │
 │                                             └──────────────────────────┘          │
 │                                                                                   │
 │                            roku_cache.db (SQLite, in app data dir)                │
 └───────────────────────────────────────────────────────────────────────────────────┘
```

- The webview never reaches a device directly. Everything device-facing goes through Tauri commands so platform quirks (Android permissions, multicast locks) stay in Rust.
- Background work — periodic SSDP, SQLite writes — runs on Tokio tasks owned by the Rust core, not in the UI thread.
- The Android MediaSession can issue commands without a visible UI by calling Rust through JNI, reusing the same `_impl` functions as Tauri commands.

## Frontend (`src/`)

Entry path: [src/main.tsx](src/main.tsx) mounts [src/App.tsx](src/App.tsx), which owns the responsive layout (sidebar + main pane + mobile bottom nav), the discovery lifecycle (event listeners + initial scan), and the 10-second connectivity poll.

**Startup.** Native window colors (`backgroundColor` in `tauri.conf.json`, `windowBackground` in the Android theme) are dark so launch doesn't flash white. [index.html](index.html) then inlines the first-paint CSS and the `#app-splash` loading screen, because `src/*.css` only arrives with the JS bundle. A small inline script reads the saved `remoteStyle` to choose the splash accent; those colors mirror `remoteStyleTokens.ts`, and a test fails if they drift. `App` calls `dismissSplash` ([src/splash.ts](src/splash.ts)) on mount to fade it out over the real UI.

**State.** A single Zustand store at [src/store.ts](src/store.ts) (`useAppStore`) with `persist` middleware writes to `localStorage`. Persisted slices: `devices`, `selectedDevice`, `favoriteApps`, `preferences` (remote style + last-used). Devices are keyed by `hardware_id`; the store includes a migration that rewrites legacy IP-keyed entries.

**Components** ([src/components/](src/components/)):

| File | Role |
| --- | --- |
| `RemoteControl.tsx` | Dpad, system/volume/playback buttons, keyboard shortcuts, active-app polling, Android media-notification updates |
| `AppLauncher.tsx` (lazy) | Installed-app grid with search, favorites, responsive pagination, icon caching |
| `Sidebar.tsx` | Device list with online/offline, settings dialog, data deletion |
| `UpdatePrompt.tsx` | The update dialog; also runs the automatic checks (10 s after launch, then daily) |
| `UpdatesSection.tsx` | Settings → Updates: version, Check for updates, automatic checks on/off |
| `UpdateNotes.tsx` | Release notes since the running version, from the feed's CHANGELOG sections |
| `BottomNavBar.tsx` | Mobile-only Remote/Apps toggle |
| `MediaPlayerModal.tsx` (lazy) | Detail view for current media (position, format, plugin) |
| `RemoteButtonSpecs.tsx` | Declarative button-group metadata (system/volume/playback/power) |
| `remoteStyleTokens.ts` | Design tokens for the four remote presets (Classic, Studio, Glass, High Contrast) |

**Hooks** ([src/hooks/usePlatform.ts](src/hooks/usePlatform.ts)) — caches Tauri's `platform()` promise so any consumer can synchronously branch on Android vs desktop after first await.

**Services** ([src/services/rokuClient.ts](src/services/rokuClient.ts)) — every `invoke()` call lives here. It also implements request deduplication (one in-flight `discover_roku_devices`, one per device for `list_roku_apps`) and a concurrency-6 queue for icon fetches. Treat this file as the *only* place commands are named on the frontend; renaming a command should touch exactly one TS file.

**Updates.** [src/services/updates.ts](src/services/updates.ts) is a separate Zustand store (`useUpdates`) for the update dialog's state machine: `idle`, `checking`, `upToDate`, `checkFailed`, `available`, `installing` and `installFailed`. Desktop installs go through `install_update` and `update-progress` events. A phone downloads through `window.RokuApp` ([src/services/androidUpdate.ts](src/services/androidUpdate.ts), see [Android platform layer](#android-platform-layer)), with `open_update_download` (the browser) as its fallback. Whether checks are automatic, and when the last one ran, are kept in `localStorage` under `rokuUpdate*` keys, which Delete All Data clears.

**Caches.** [src/iconCache.ts](src/iconCache.ts) is an in-memory LRU (~1h TTL, ~100 items) layered over the backend's SQLite icon cache — first the React component checks memory, then asks the backend, which either returns its row or fetches from the Roku.

**Styling.** MUI v9 dark theme in [src/theme.ts](src/theme.ts) with Emotion. The four remote style presets come from design tokens, not separate component trees.

**Tests.** Vitest + Testing Library (jsdom). Specs sit beside the file under test (`Foo.test.tsx`). [src/setupTests.ts](src/setupTests.ts) installs the Tauri invoke/event mocks every test inherits; [src/testUtils.tsx](src/testUtils.tsx) provides shared render helpers. Don't ad-hoc-mock Tauri inside individual tests — extend the setup file instead.

## Backend (`src-tauri/src/`)

Files:

- [main.rs](src-tauri/src/main.rs) — entrypoint; picks `android_logger` vs `env_logger` and calls `roku_controller_lib::run()`.
- [lib.rs](src-tauri/src/lib.rs) — Tauri app builder, command wrappers, tray, JNI exports.
- [commands.rs](src-tauri/src/commands.rs) — all network/business logic as `_impl` async functions.
- [background.rs](src-tauri/src/background.rs) — `DatabaseManager`, an async actor over `rusqlite`. The app sends jobs via an mpsc channel; the actor owns the connection and runs them serially.
- [background_discovery.rs](src-tauri/src/background_discovery.rs) — periodic SSDP loop and subnet-scan fallback; emits frontend events.
- [updates.rs](src-tauri/src/updates.rs) — updates from GitHub releases. On desktop it uses `tauri-plugin-updater` (signature check, install, restart). On Android it reads `latest.json` with reqwest, compares versions and builds the APK's address. It holds the `UpdateState` that keeps what the last check found.

**Command wrappers vs `_impl` split.** This is the most important convention to know. Command wrappers (decorated with `#[command]`) live in [lib.rs](src-tauri/src/lib.rs) and are just thin shims — they handle Android permission/lock dances if needed, then call the `_impl` function defined in [commands.rs](src-tauri/src/commands.rs). The `_impl` functions are also reused from JNI on Android (see [lib.rs:211](src-tauri/src/lib.rs:211) and [lib.rs:238](src-tauri/src/lib.rs:238)), which is why the split exists. When adding a command, add the logic as `xxx_impl` in `commands.rs` and the `#[command] async fn xxx(...)` wrapper in `lib.rs`, then register it in the `generate_handler!` block.

**Shared state.** Lazy statics inside `commands.rs`:
- `HTTP_CLIENT: Lazy<reqwest::Client>` — 10s request / 5s connect / 30s idle timeouts, rustls.
- `ICON_CACHE: Lazy<Mutex<HashMap<…>>>` — in-process icon mirror.
- `LAST_SEEN: Lazy<Mutex<HashMap<…, Instant>>>` — keyed by `hardware_id`, drives `device_lost` emission.

**Tauri commands.** Registered in `generate_handler!` at [lib.rs:452](src-tauri/src/lib.rs:452):

| Group | Commands |
| --- | --- |
| Discovery | `discover_roku_devices`, `check_device_connectivity`, `get_cached_devices`, `test_network_connectivity` |
| Apps | `list_roku_apps`, `launch_roku_app`, `get_active_app`, `get_app_icon`, `get_cached_apps` |
| Control | `send_roku_command`, `get_media_player` |
| Lifecycle / data | `clear_all_data`, `restart_app` |
| Updates | `check_for_update`; `install_update` (desktop: emits `update-progress`, then restarts); `open_update_download` (Android: the APK in the browser) |
| Android-only (no-op on desktop) | `ensure_android_discovery_permissions`, `ensure_android_notification_permission`, `open_android_app_settings`, `update_media_notification`, `hide_media_notification` |

**Events to the frontend**: from the discovery loop, `discovery_cycle_start`, `device_discovered`, `device_lost` and `discovery_cycle_end`; from a desktop update's download, `update-progress` (`{downloaded, total, installing}`). The frontend subscribes with `@tauri-apps/api/event`'s `listen()` in `App.tsx`.

## Native crates (`crates/`)

- [crates/roku/](crates/roku/) — vendored fork of Carlo Abelli's `roku` crate. Provides the typed ECP `Device` (apps, active_app, media_player, keypress/down/up, launch, device_info, input, search) and serde-xml-rs models. All HTTP to Roku boxes funnels through this crate; backend code that builds raw URLs itself is the exception, not the rule.
- [crates/ssdp-client/](crates/ssdp-client/) — vendored fork of [`jakobhellermann/ssdp-client`](https://github.com/jakobhellermann/ssdp-client) v2.1.0 (upstream commit `f143d09`). App discovery runs through it: `discover_roku_devices_impl` in [src-tauri/src/commands.rs](src-tauri/src/commands.rs) calls `run_discovery_once` in [src-tauri/src/background_discovery.rs](src-tauri/src/background_discovery.rs), which calls `ssdp_client::search`. The local changes in [src/search.rs](crates/ssdp-client/src/search.rs) make discovery work on Android (bind to `wlan0` to bypass VPNs, join multicast on the WiFi interface) and send M-SEARCH several times on every platform. `search` returns the send error only when every attempt fails, so a search that never left the machine is reported instead of waiting out the timeout. Both `src-tauri` and `roku` use this copy through `[patch.crates-io]` in [src-tauri/Cargo.toml](src-tauri/Cargo.toml). `git show ef85274 -- crates/ssdp-client` shows the exact difference from upstream.

## Persistence: SQLite

File: `{app_data_dir}/roku_cache.db` (created on first run by the desktop `setup` hook in [lib.rs](src-tauri/src/lib.rs); Android uses the platform equivalent). Schema, managed by [background.rs](src-tauri/src/background.rs):

```
devices(hardware_id TEXT PRIMARY KEY, ip, name, port, url, last_seen)
apps   (device_ip TEXT, app_id TEXT, name, version, cached_at,
        PRIMARY KEY(device_ip, app_id))
icons  (device_ip TEXT, app_id TEXT, icon_data TEXT, cached_at,
        PRIMARY KEY(device_ip, app_id))
-- Indexes on devices(ip), apps(device_ip), icons(device_ip)
```

`hardware_id` is derived from device-info in this priority order: serial number → device id → ethernet MAC → wifi MAC → hash of name+url. That makes it stable across reboots and DHCP changes — use it, not IP, as the durable identity for anything persisted.

## Discovery and device identity

1. SSDP M-SEARCH with the custom search target `roku:ecp`. Timing differs by platform — desktop uses ~5s total / MX=2, Android uses ~10s total / MX=4 because multicast locks cost more.
2. For each LOCATION header, fetch `/query/device-info` and derive the `hardware_id`.
3. Dedupe responses within a 60s last-seen window. New device → emit `device_discovered`. No response for 60s → emit `device_lost`.
4. If SSDP returns nothing or cannot start (common on networks that block multicast), fall back to `scan_network_for_roku` which sweeps the local /24 with HTTP probes. Devices found this way are announced and persisted exactly like SSDP results. If SSDP could not send at all and the sweep finds nothing, the cycle returns an error saying the local network is unreachable (on macOS, pointing at the Local Network setting) instead of an empty list.
5. Persist seen devices to SQLite so cold launches show the last-known list immediately while a fresh scan runs.

Only one cycle runs at a time. `run_discovery_once` holds an async mutex for the whole cycle, and a caller that had to wait for a running cycle gets that cycle's result instead of starting another. At desktop launch the `setup` hook and the frontend's first scan both ask for discovery. Two overlapping M-SEARCHes compete for the same replies, and the frontend marks every device missing from its result as offline.

## macOS platform layer

**Local Network privacy.** Since macOS 15, an app launched from Finder or the Dock needs the user's permission for any LAN traffic: SSDP, the subnet sweep and every ECP request. Without it, sends fail with `EHOSTUNREACH` ("No route to host") and TCP connects are dropped with `reason: NECP` in the kernel log. Processes started from Terminal are exempt, which is why `pnpm tauri dev` works when the built app does not.

macOS remembers the decision per **code-signing identifier**, so the bundle must be signed with an identifier that equals the bundle ID and stays the same across builds:

- `bundle.macOS.signingIdentity` is `"-"` in [tauri.conf.json](src-tauri/tauri.conf.json): the bundler ad-hoc signs the whole `.app`, which gives it the identifier `com.rokucontroller.remote` and binds the Info.plist. Without it the binary keeps only the linker's ad-hoc signature, whose identifier is `roku_controller-<hash>` and changes with every build. The permission then never matches the running app and discovery silently finds nothing. Setting `APPLE_SIGNING_IDENTITY` to a real certificate overrides this.
- [src-tauri/Info.plist](src-tauri/Info.plist) is merged into the bundle's Info.plist and supplies `NSLocalNetworkUsageDescription`, the text of the permission prompt.

To check a build: `codesign -dv "Roku Remote.app"` should print `Identifier=com.rokucontroller.remote`. The setting lives in System Settings > Privacy & Security > Local Network.

## Android platform layer

Kotlin sources live under [src-tauri/gen/android/app/src/main/java/com/rokucontroller/remote/](src-tauri/gen/android/app/src/main/java/com/rokucontroller/remote/):

- `MainActivity.kt` — Tauri webview host; also exposes the permission, notification, haptic and multicast-lock methods that Rust calls back into. Every one of them catches its own exceptions and hops to the UI thread where needed, because Rust calls them from non-UI threads.
- `MediaSessionManager.kt` — media controls on the lock screen and notification shade. A process-wide singleton holding a `MediaSessionCompat`; `show(...)` posts the notification and `hide()` removes it. State is confined to the main thread; only the native calls run on IO.
- `MediaControlReceiver.kt` — broadcast receiver for the notification's buttons. Sends the key straight through the native bridge, so it works in a process that has no activity.
- `TaskWatcherService.kt` — bound-only service whose single job is `onTaskRemoved`: remove the notification when the app is swiped away.
- `AppUpdate.kt` — the app's own update. It downloads a release's APK into `cache/updates`, resuming with `Range` requests when Android cuts a backgrounded app off. It checks the APK's package and versionName, then opens Android's installer through the FileProvider. The installer only opens while the activity is resumed, because Android silently drops a launch from the background. `UpdateRelease.kt` holds its pure parts (the APK's name and address, header parsing), which `UpdateReleaseTest` covers.

**JavaScript bridge.** Unlike the rest of the Android layer, the update doesn't go through Rust. `MainActivity.onWebViewCreate` adds `window.RokuApp` with three methods: `downloadUpdate(version)`, `installsBlocked()` (Android 16+ Advanced Protection) and `openSecuritySettings()`. `AppUpdate` reports progress to `window.__rokuUpdate` with `evaluateJavascript`. ProGuard keeps `@JavascriptInterface` methods, because release builds are minified.

**No foreground service.** The media notification is a plain `MediaStyle` notification. It used to be backed by a `START_STICKY` `mediaPlayback` foreground service that was never stopped; after the process died in the background the system restarted it with no activity and it called `startForeground`, which Android rejects. The notification is now shown only while the activity is visible and removed on device switch, forget, Delete All Data, task removal and exit. The trade-off: once Android freezes or kills the backgrounded app the lock-screen controls can go stale or disappear. Do not reintroduce a sticky or media-typed foreground service to "fix" that.

**JNI bridge** (defined in [lib.rs](src-tauri/src/lib.rs)):

- `Java_…_MediaSessionManager_nativeSendRokuCommand` → `send_roku_command_impl`
- `Java_…_MediaSessionManager_nativeGetAppIconDataUrl` → `get_app_icon_impl`
- `Java_…_MainActivity_nativeOnActivityCreated` / `nativeOnActivityDestroyed` → keep the `CURRENT_ACTIVITY` reference that `with_activity` uses
- `Java_…_MainActivity_nativeOnPermissionResult` → wakes the command that is awaiting the user's answer to a permission dialog

This is *why* the `_impl`/wrapper split exists — both Tauri commands and Kotlin transport controls call the same underlying functions.

**Calling the activity from Rust.** Don't get it from `ndk_context::android_context().context()`: since tao 0.37 that is the Application context, so calls to `MainActivity` methods fail at runtime with "Method not found". Use `with_activity`, which works from any thread.

**Edge-to-edge.** Android draws behind the system bars for targetSdk 35+, so `MainActivity.keepContentClearOfSystemBars` pads the WebView's container for the status bar, navigation bar, display cutout, and keyboard. Because it consumes those insets, CSS `env(safe-area-inset-*)` resolves to 0 in the WebView.

**Permissions.** The app targets Android 17 (API 37), where *all* LAN traffic — SSDP, the subnet sweep and every ECP request, native sockets included — needs the runtime permission `ACCESS_LOCAL_NETWORK`. Without it requests time out rather than fail fast, so the frontend asks for it (`ensure_android_local_network_access`) as soon as a saved device exists and mounts nothing that polls a device until it is granted. On Android 13–16 discovery asks for nearby-devices / location instead. Notifications need `POST_NOTIFICATIONS`. The `ensure_*` commands are async and resolve with the user's actual answer. SSDP needs a held WiFi multicast lock for the duration of the scan; the Rust wrapper acquires and releases it around `discover_roku_devices_impl`.

**Process exit.** When the activity is destroyed (the app is swiped out of Recents) Tauri ends the process. `run()` handles `RunEvent::Exit` by calling `_exit` instead of letting `std::process::exit` run static destructors: those ran while Tokio and WebView threads were still alive, which intermittently aborted the already-backgrounded app with "pthread_mutex_lock called on a destroyed mutex".

**Logging.** `android::init_logging()` runs at the top of `run()` and routes Rust `log` output and panics (with backtrace) to logcat under the tag `RokuRust`. The binary's `main()` is never executed on Android, so logging must not be set up there. `MainActivity` also logs the previous process exit reasons on start, which is how to tell a crash from a low-memory kill.

**Background discovery is gated off at startup on Android** — it only runs when the user triggers a scan. Desktop runs one discovery cycle from the `setup` hook, which the frontend's first scan joins; there is no periodic loop on any platform.

**Forgetting a device.** `forget_device` deletes the device's SQLite row plus the app and icon caches stored under its IP, and the frontend removes it from the persisted store. Both are needed because each side re-seeds the other on launch. There is no blocklist: a later scan that finds the device lists it again.

## Build, test, CI

Frontend / app:

- `pnpm tauri dev` — full app, hot reload on both frontend and Rust.
- `pnpm dev` — Vite only, useful when working on UI with the backend mocked.
- `pnpm build` — `tsc` + Vite production build.
- `pnpm tauri build` — desktop bundle (ad-hoc signed on macOS; see [macOS platform layer](#macos-platform-layer)).
- `pnpm test` — Vitest with v8 coverage.

Vite ([vite.config.ts](vite.config.ts)) splits `react` and `mui` into chunks with Rolldown `codeSplitting` groups (warning threshold 900KB) and serves over `TAURI_DEV_HOST` for device-over-LAN HMR.

Rust:

- Not a Cargo workspace — `src-tauri` consumes `crates/*` via path deps.
- `cargo check -p roku-controller` for backend lint.
- `cargo test -p roku` for the ECP crate.

Android:

- `pnpm android:lint` → `./gradlew :app:lintArm64Debug -x rustBuildArm64Debug`
- `pnpm android:test` → `./gradlew :app:testArm64DebugUnitTest -x rustBuildArm64Debug`
- CI: [.github/workflows/android-mobile.yml](.github/workflows/android-mobile.yml) runs both on push/PR. Gradle's Rust build is skipped to keep the lane fast, so CI first runs `cargo check` for `aarch64-linux-android`: its build scripts generate the gitignored `tauri.settings.gradle` and `generated/*.kt` that Gradle needs. Locally, use `pnpm tauri android dev` or the Gradle tasks without the `-x rustBuildArm64Debug` exclusion.
- Signing: copy `src-tauri/gen/android/keystore.properties.example` to `keystore.properties` and fill in local values. Do not commit the real file. Release APKs must use the release key (README "Android signing").

Releases:

- `pnpm release <patch|minor|major>` bumps the version (package.json, Cargo.toml, Cargo.lock; `tauri.conf.json` reads package.json's), releases CHANGELOG.md's Unreleased section, commits and tags. `pnpm release publish` pushes the tag.
- [.github/workflows/release.yml](.github/workflows/release.yml) builds macOS arm64/x64, Windows x64 and the Android arm64 APK from the tag with `node scripts/release.mjs build --target …`, then `github-release` writes `latest.json` and publishes. The pure parts (asset names, bundle paths, the minisign and apksigner checks) are in [scripts/release/lib.mjs](scripts/release/lib.mjs), tested by `pnpm test:scripts`.

## Conventions worth knowing

- **Hardware-id is the identity.** Don't key persisted state on IP — DHCP will bite you. The frontend store has a one-shot migration for legacy IP keys; don't add new IP-keyed state.
- **One frontend call site per command.** New `invoke()` calls go in [src/services/rokuClient.ts](src/services/rokuClient.ts), not directly in components. This is how request deduplication and icon-queue throttling stay consistent.
- **One backend call site per behavior.** Logic goes in `commands.rs` as `xxx_impl`; the `#[command]` wrapper in `lib.rs` does platform glue only. Both Tauri IPC and JNI depend on this.
- **Mock Tauri in the setup file.** Per-test mocks of `invoke`/`listen` drift apart — extend [src/setupTests.ts](src/setupTests.ts) instead.
- **Gate Android-only Rust with `#[cfg(target_os = "android")]`** and provide a desktop fallback in the same file (see how `update_media_notification` is defined twice in [lib.rs](src-tauri/src/lib.rs)). The `generate_handler!` list must compile on every target.
- **`crates/ssdp-client/` is patched, not stock.** Replacing it with the crates.io release removes the Android `wlan0`/VPN handling. To upgrade it, re-apply those changes to the new upstream version. Run its tests from `crates/ssdp-client/`, because Cargo won't test it with `-p` from outside its own package.
- **Zustand selectors must return stable values.** A selector that builds a new object or array on each call causes an infinite render loop. Wrap object selectors in `useShallow`, and use a shared constant for empty fallbacks rather than `|| []`.
- **Use `color="textSecondary"` on `Typography`, not `color="text.secondary"`.** MUI 9 removed system props, and the dotted form still type-checks because `color` is also an HTML attribute, but it no longer applies any color. In `sx`, `color: 'text.secondary'` still works.
