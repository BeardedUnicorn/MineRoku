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
 │   │  MUI v7        │                      │     JNI exports, app builder)  │      │
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
| `BottomNavBar.tsx` | Mobile-only Remote/Apps toggle |
| `MediaPlayerModal.tsx` (lazy) | Detail view for current media (position, format, plugin) |
| `RemoteButtonSpecs.tsx` | Declarative button-group metadata (system/volume/playback/power) |
| `remoteStyleTokens.ts` | Design tokens for the four remote presets (Classic, Studio, Glass, High Contrast) |

**Hooks** ([src/hooks/usePlatform.ts](src/hooks/usePlatform.ts)) — caches Tauri's `platform()` promise so any consumer can synchronously branch on Android vs desktop after first await.

**Services** ([src/services/rokuClient.ts](src/services/rokuClient.ts)) — every `invoke()` call lives here. It also implements request deduplication (one in-flight `discover_roku_devices`, one per device for `list_roku_apps`) and a concurrency-6 queue for icon fetches. Treat this file as the *only* place commands are named on the frontend; renaming a command should touch exactly one TS file.

**Caches.** [src/iconCache.ts](src/iconCache.ts) is an in-memory LRU (~1h TTL, ~100 items) layered over the backend's SQLite icon cache — first the React component checks memory, then asks the backend, which either returns its row or fetches from the Roku.

**Styling.** MUI v7 dark theme in [src/theme.ts](src/theme.ts) with Emotion. The four remote style presets come from design tokens, not separate component trees.

**Tests.** Vitest + Testing Library (jsdom). Specs sit beside the file under test (`Foo.test.tsx`). [src/setupTests.ts](src/setupTests.ts) installs the Tauri invoke/event mocks every test inherits; [src/testUtils.tsx](src/testUtils.tsx) provides shared render helpers. Don't ad-hoc-mock Tauri inside individual tests — extend the setup file instead.

## Backend (`src-tauri/src/`)

Files:

- [main.rs](src-tauri/src/main.rs) — entrypoint; picks `android_logger` vs `env_logger` and calls `roku_controller_lib::run()`.
- [lib.rs](src-tauri/src/lib.rs) — Tauri app builder, command wrappers, tray, JNI exports.
- [commands.rs](src-tauri/src/commands.rs) — all network/business logic as `_impl` async functions.
- [background.rs](src-tauri/src/background.rs) — `DatabaseManager`, an async actor over `rusqlite`. The app sends jobs via an mpsc channel; the actor owns the connection and runs them serially.
- [background_discovery.rs](src-tauri/src/background_discovery.rs) — periodic SSDP loop and subnet-scan fallback; emits frontend events.

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
| Android-only (no-op on desktop) | `ensure_android_discovery_permissions`, `ensure_android_notification_permission`, `open_android_app_settings`, `update_media_notification`, `hide_media_notification` |

**Events to the frontend** (emitted from the discovery loop): `discovery_cycle_start`, `device_discovered`, `device_lost`, `discovery_cycle_end`. The frontend subscribes with `@tauri-apps/api/event`'s `listen()` in `App.tsx`.

## Native crates (`crates/`)

- [crates/roku/](crates/roku/) — vendored fork of Carlo Abelli's `roku` crate. Provides the typed ECP `Device` (apps, active_app, media_player, keypress/down/up, launch, device_info, input, search) and serde-xml-rs models. All HTTP to Roku boxes funnels through this crate; backend code that builds raw URLs itself is the exception, not the rule.
- [crates/ssdp-client/](crates/ssdp-client/) — vendored fork of [`jakobhellermann/ssdp-client`](https://github.com/jakobhellermann/ssdp-client) v2.1.0 (upstream commit `f143d09`). App discovery runs through it: `discover_roku_devices_impl` in [src-tauri/src/commands.rs](src-tauri/src/commands.rs) calls `run_discovery_once` in [src-tauri/src/background_discovery.rs](src-tauri/src/background_discovery.rs), which calls `ssdp_client::search`. The local changes make discovery work on Android (bind to `wlan0` to bypass VPNs, join multicast on the WiFi interface) and send M-SEARCH several times on every platform. `git log -p -- crates/ssdp-client` shows the exact difference from upstream.

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
4. If SSDP returns nothing (common on networks that block multicast), fall back to `scan_network_for_roku` which sweeps the local /24 with HTTP probes.
5. Persist seen devices to SQLite so cold launches show the last-known list immediately while a fresh scan runs.

## Android platform layer

Kotlin sources live under [src-tauri/gen/android/app/src/main/java/com/rokucontroller/remote/](src-tauri/gen/android/app/src/main/java/com/rokucontroller/remote/):

- `MainActivity.kt` — Tauri webview host; also exposes `ensureDiscoveryPermissions()` and friends that Rust calls back into.
- `MediaSessionManager.kt` — Android 13+ media controls on the lock screen and notification shade. Holds a `MediaSessionCompat`, dispatches transport callbacks (play/pause/forward/rewind/volume) into Rust via JNI, and caches app icons in a `ConcurrentHashMap`.
- `MediaControlService.kt` / `MediaControlReceiver.kt` — foreground service + broadcast receiver that keep the media session alive and route Intent actions.

**JNI bridge** (defined in [lib.rs](src-tauri/src/lib.rs)):

- `Java_…_MediaSessionManager_nativeSendRokuCommand` → `send_roku_command_impl`
- `Java_…_MediaSessionManager_nativeGetAppIconDataUrl` → `get_app_icon_impl`

This is *why* the `_impl`/wrapper split exists — both Tauri commands and Kotlin transport controls call the same underlying functions.

**Permissions.** Discovery needs nearby-devices / location; notifications need `POST_NOTIFICATIONS`; SSDP needs a held WiFi multicast lock for the duration of the scan. The Rust wrappers acquire and release these around `discover_roku_devices_impl` (see [lib.rs:248-276](src-tauri/src/lib.rs:248)).

**Background discovery is gated off at startup on Android** — it only runs when the user triggers a scan. Desktop spawns the periodic loop in the `setup` hook. This is intentional: continuous SSDP on a phone burns battery and conflicts with OS lifecycle management.

## Build, test, CI

Frontend / app:

- `npm run tauri dev` — full app, hot reload on both frontend and Rust.
- `npm run dev` — Vite only, useful when working on UI with the backend mocked.
- `npm run build` — `tsc` + Vite production build.
- `npm run tauri build` — desktop bundle.
- `npm test` — Vitest with v8 coverage.

Vite ([vite.config.ts](vite.config.ts)) splits `react` and `mui` into manual chunks (warning threshold 900KB) and serves over `TAURI_DEV_HOST` for device-over-LAN HMR.

Rust:

- Not a Cargo workspace — `src-tauri` consumes `crates/*` via path deps.
- `cargo check -p roku-controller` for backend lint.
- `cargo test -p roku` for the ECP crate.

Android:

- `npm run android:lint` → `./gradlew :app:lintArm64Debug -x rustBuildArm64Debug`
- `npm run android:test` → `./gradlew :app:testArm64DebugUnitTest -x rustBuildArm64Debug`
- CI: [.github/workflows/android-mobile.yml](.github/workflows/android-mobile.yml) runs both on push/PR. The Rust build is intentionally skipped in CI to keep the lane fast; locally, use `npm run tauri android dev` or the Gradle tasks without the `-x rustBuildArm64Debug` exclusion.
- Signing: copy `src-tauri/gen/android/keystore.properties.example` to `keystore.properties` and fill in local values. Do not commit the real file.

## Conventions worth knowing

- **Hardware-id is the identity.** Don't key persisted state on IP — DHCP will bite you. The frontend store has a one-shot migration for legacy IP keys; don't add new IP-keyed state.
- **One frontend call site per command.** New `invoke()` calls go in [src/services/rokuClient.ts](src/services/rokuClient.ts), not directly in components. This is how request deduplication and icon-queue throttling stay consistent.
- **One backend call site per behavior.** Logic goes in `commands.rs` as `xxx_impl`; the `#[command]` wrapper in `lib.rs` does platform glue only. Both Tauri IPC and JNI depend on this.
- **Mock Tauri in the setup file.** Per-test mocks of `invoke`/`listen` drift apart — extend [src/setupTests.ts](src/setupTests.ts) instead.
- **Gate Android-only Rust with `#[cfg(target_os = "android")]`** and provide a desktop fallback in the same file (see how `update_media_notification` is defined twice in [lib.rs](src-tauri/src/lib.rs)). The `generate_handler!` list must compile on every target.
- **Two `ssdp-client` versions are in the build.** The app uses the vendored 2.1.0 in `crates/ssdp-client/`, while `crates/roku` still depends on the published 1.0 for its own `search`. SSDP fixes for the app belong in the vendored crate and won't reach `roku`'s copy. From `src-tauri/`, Cargo needs the version to tell them apart (`cargo check -p ssdp-client@2.1.0`). Run the vendored crate's tests from `crates/ssdp-client/` instead, because Cargo won't test it with `-p` from outside its own package.
