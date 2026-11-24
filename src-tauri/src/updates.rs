//! Updates from Roku Remote's GitHub releases (modeled on TaskMint's).
//!
//! The webview decides when to check and asks the user before anything
//! downloads. Every release has a `latest.json` (scripts/release.mjs writes
//! it), and the latest release's copy is the update feed.
//!
//! - A desktop reads the feed with tauri-plugin-updater (plugins.updater in
//!   tauri.conf.json), which checks the update's signature, installs it, and
//!   then the app restarts into it. Progress goes to the page as
//!   UPDATE_PROGRESS events.
//! - Android has no store to update through: the app is sideloaded. It reads
//!   the same feed here, and for a newer version the page asks AppUpdate.kt to
//!   download that release's APK and open Android's installer on it. Where it
//!   can't, the browser downloads the APK instead (`apk_url`).

use serde::Serialize;

/// Where the releases are. The repository is public, so its files download
/// without signing in.
#[cfg(any(mobile, test))]
pub const RELEASES_URL: &str = "https://github.com/BeardedUnicorn/MineRoku/releases";

/// The latest release's latest.json. A desktop's updater reads the same
/// address from tauri.conf.json.
#[cfg(mobile)]
pub const FEED_URL: &str =
    "https://github.com/BeardedUnicorn/MineRoku/releases/latest/download/latest.json";

/// The event a desktop's install sends as it downloads (`Progress`).
#[cfg(desktop)]
pub const UPDATE_PROGRESS: &str = "update-progress";

/// A newer release the feed announced.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    pub version: String,
    /// The version running now.
    pub current_version: String,
    /// The release's notes: its CHANGELOG section, as Markdown.
    pub notes: Option<String>,
    /// Every release's notes, newest first (the CHANGELOG's sections). The
    /// page shows the ones since the version running now.
    pub changelog: Option<String>,
    /// When it was published (RFC 3339).
    pub date: Option<String>,
}

// ── A desktop's download progress ───────────────────────────────────────────

/// How far a download of unknown size gets between progress events.
#[cfg(any(desktop, test))]
const UNKNOWN_SIZE_STEP: u64 = 512 * 1024;

/// UPDATE_PROGRESS's payload.
#[cfg(any(desktop, test))]
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// Bytes downloaded so far.
    pub downloaded: u64,
    /// The download's size, when the server says.
    pub total: Option<u64>,
    /// The download is done and the update is being installed.
    pub installing: bool,
}

/// What the updater reports of a download.
#[cfg(any(desktop, test))]
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DownloadEvent {
    /// `bytes` more arrived, of `total` (when the server says).
    Chunk { bytes: u64, total: Option<u64> },
    /// The download is complete and verified; installing comes next.
    Downloaded,
}

/// Turns the updater's chunks into progress events: one per whole percent
/// (or per UNKNOWN_SIZE_STEP of a download of unknown size) rather than one
/// per chunk, which would be thousands.
#[cfg(any(desktop, test))]
#[derive(Debug, Default)]
pub struct Reporter {
    downloaded: u64,
    total: Option<u64>,
    /// The step the last event was sent at.
    sent: Option<u64>,
}

#[cfg(any(desktop, test))]
impl Reporter {
    /// The event to send for `event`, if any.
    pub fn next(&mut self, event: DownloadEvent) -> Option<Progress> {
        match event {
            DownloadEvent::Chunk { bytes, total } => {
                self.downloaded += bytes;
                self.total = total.or(self.total);
                let step = match self.total {
                    Some(total) if total > 0 => self.downloaded.min(total) * 100 / total,
                    _ => self.downloaded / UNKNOWN_SIZE_STEP,
                };
                if self.sent == Some(step) {
                    return None;
                }
                self.sent = Some(step);
                Some(self.progress(false))
            }
            DownloadEvent::Downloaded => Some(self.progress(true)),
        }
    }

    fn progress(&self, installing: bool) -> Progress {
        Progress {
            downloaded: self.downloaded,
            total: self.total,
            installing,
        }
    }
}

// ── A phone's check ─────────────────────────────────────────────────────────

/// The parts of latest.json a phone reads.
#[cfg(any(mobile, test))]
#[derive(Debug, serde::Deserialize)]
struct Feed {
    version: String,
    notes: Option<String>,
    changelog: Option<String>,
    pub_date: Option<String>,
}

/// A version's numbers ("0.4.1", or "v0.4.1"); None for anything else.
#[cfg(any(mobile, test))]
fn numbers(version: &str) -> Option<(u64, u64, u64)> {
    let mut parts = version.trim_start_matches('v').split('.');
    let mut next = || parts.next()?.parse::<u64>().ok();
    let found = (next()?, next()?, next()?);
    parts.next().is_none().then_some(found)
}

/// The release `feed` (latest.json's text) announces, if it's newer than
/// `current`.
#[cfg(any(mobile, test))]
pub fn newer(feed: &str, current: &str) -> Result<Option<AvailableUpdate>, String> {
    let feed: Feed = serde_json::from_str(feed)
        .map_err(|error| format!("the release feed couldn't be read ({error})"))?;
    let latest = numbers(&feed.version).ok_or_else(|| {
        format!(
            "the release feed names a version Roku Remote can't read ({})",
            feed.version
        )
    })?;
    let running =
        numbers(current).ok_or_else(|| format!("this version ({current}) can't be compared"))?;
    let version = feed.version.trim_start_matches('v').to_string();
    Ok((latest > running).then(|| AvailableUpdate {
        version,
        current_version: current.to_string(),
        notes: feed.notes,
        changelog: feed.changelog,
        date: feed.pub_date,
    }))
}

/// Where a release's APK downloads from. scripts/release/lib.mjs names the
/// file, and AppUpdate.kt builds the same address.
#[cfg(any(mobile, test))]
pub fn apk_url(version: &str) -> String {
    format!("{RELEASES_URL}/download/v{version}/RokuRemote-{version}-android-arm64.apk")
}

// ── What the last check found ───────────────────────────────────────────────

/// Kept between check_for_update and the install (or, on a phone, the
/// browser download) that follows it.
#[derive(Default)]
pub struct UpdateState {
    #[cfg(desktop)]
    pub found: std::sync::Mutex<Option<tauri_plugin_updater::Update>>,
    #[cfg(mobile)]
    pub found: std::sync::Mutex<Option<String>>,
}

#[cfg(desktop)]
pub mod desktop {
    use super::{AvailableUpdate, DownloadEvent, Reporter, UpdateState, UPDATE_PROGRESS};
    use std::sync::Mutex;
    use tauri::{AppHandle, Emitter, Manager};
    use tauri_plugin_updater::UpdaterExt;

    /// Asks the feed whether there's a newer version, and keeps what it
    /// found for `install`. None: this is the newest.
    pub async fn check(app: &AppHandle) -> Result<Option<AvailableUpdate>, String> {
        let updater = app.updater().map_err(|e| e.to_string())?;
        let found = updater.check().await.map_err(|e| e.to_string())?;
        let available = found.as_ref().map(|update| AvailableUpdate {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
            notes: update.body.clone(),
            changelog: update.raw_json["changelog"].as_str().map(str::to_string),
            date: update.raw_json["pub_date"].as_str().map(str::to_string),
        });
        let state = app.state::<UpdateState>();
        *state.found.lock().unwrap_or_else(|e| e.into_inner()) = found;
        Ok(available)
    }

    /// Downloads the update the last check found, verifies its signature
    /// and installs it, sending UPDATE_PROGRESS as it goes, then restarts
    /// into it. Only comes back on failure.
    pub async fn install(app: &AppHandle) -> Result<(), String> {
        // A development build's executable isn't an installed app, so the
        // updater would replace the wrong thing
        if cfg!(debug_assertions) {
            return Err(
                "A development build can't install updates. Build the app to try one."
                    .to_string(),
            );
        }
        let update = app
            .state::<UpdateState>()
            .found
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .ok_or("Check for updates first.")?;

        let reporter = Mutex::new(Reporter::default());
        let report = |event| {
            let next = reporter.lock().unwrap_or_else(|e| e.into_inner()).next(event);
            if let Some(progress) = next {
                let _ = app.emit(UPDATE_PROGRESS, progress);
            }
        };
        update
            .download_and_install(
                |bytes, total| {
                    report(DownloadEvent::Chunk {
                        bytes: bytes as u64,
                        total,
                    })
                },
                || report(DownloadEvent::Downloaded),
            )
            .await
            .map_err(|e| e.to_string())?;

        log::info!("Installed update {}; restarting into it", update.version);
        app.restart();
    }
}

/// The client a phone reads the feed with. Its HTTPS trusts Mozilla's
/// roots (webpki-root-certs), as TaskMint's ureq does. reqwest's default,
/// the platform verifier, panics on Android unless it's set up over JNI with
/// its own Kotlin library, which this app doesn't have.
#[cfg(any(target_os = "android", test))]
fn feed_client(version: &str) -> Result<reqwest::Client, String> {
    let roots = webpki_root_certs::TLS_SERVER_ROOT_CERTS
        .iter()
        .filter_map(|der| reqwest::Certificate::from_der(der).ok());
    reqwest::Client::builder()
        .tls_certs_only(roots)
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(format!("RokuRemote/{version}"))
        .build()
        .map_err(|e| e.to_string())
}

/// iOS isn't built, but its verifier needs no setup.
#[cfg(all(mobile, not(target_os = "android")))]
fn feed_client(version: &str) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(format!("RokuRemote/{version}"))
        .build()
        .map_err(|e| e.to_string())
}

#[cfg(mobile)]
pub mod mobile {
    use super::{apk_url, feed_client, newer, AvailableUpdate, UpdateState, FEED_URL};
    use tauri::{AppHandle, Manager};
    use tauri_plugin_opener::OpenerExt;

    /// Reads the feed and keeps the version it found for `open_download`.
    pub async fn check(app: &AppHandle) -> Result<Option<AvailableUpdate>, String> {
        let current = app.package_info().version.to_string();
        let client = feed_client(&current)?;
        let body = client
            .get(FEED_URL)
            .send()
            .await
            .and_then(|response| response.error_for_status())
            .map_err(|e| format!("the release feed couldn't be fetched ({e})"))?
            .text()
            .await
            .map_err(|e| format!("the release feed couldn't be fetched ({e})"))?;
        let found = newer(&body, &current)?;
        let state = app.state::<UpdateState>();
        *state.found.lock().unwrap_or_else(|e| e.into_inner()) =
            found.as_ref().map(|update| update.version.clone());
        Ok(found)
    }

    /// A phone's other way to update, when the app's own download
    /// (AppUpdate.kt) can't be used or failed: opens the APK of the release
    /// the last check found in the browser, for the user to install.
    pub fn open_download(app: &AppHandle) -> Result<(), String> {
        let version = app
            .state::<UpdateState>()
            .found
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .ok_or("Check for updates first.")?;
        app.opener()
            .open_url(apk_url(&version), None::<&str>)
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn chunk(bytes: u64, total: Option<u64>) -> DownloadEvent {
        DownloadEvent::Chunk { bytes, total }
    }

    #[test]
    fn progress_is_sent_once_per_percent() {
        let mut reporter = Reporter::default();
        // 1000 bytes in chunks of 4: 250 chunks, but 101 whole percents (0–100)
        let mut sent: Vec<Progress> = (0..250)
            .filter_map(|_| reporter.next(chunk(4, Some(1000))))
            .collect();
        sent.extend(reporter.next(DownloadEvent::Downloaded));
        assert_eq!(sent.len(), 101 + 1);
        assert_eq!(
            sent[0],
            Progress {
                downloaded: 4,
                total: Some(1000),
                installing: false
            }
        );
        assert_eq!(sent[100].downloaded, 1000);
        assert!(!sent[100].installing);
        assert!(sent[101].installing);
    }

    #[test]
    fn a_download_of_unknown_size_is_reported_every_half_megabyte() {
        let kb = 1024;
        let mut reporter = Reporter::default();
        let sent: Vec<(u64, bool)> = [
            chunk(100 * kb, None),
            chunk(300 * kb, None),
            chunk(200 * kb, None),
            chunk(200 * kb, Some(0)),
            DownloadEvent::Downloaded,
        ]
        .into_iter()
        .filter_map(|event| reporter.next(event))
        .map(|p| (p.downloaded, p.installing))
        .collect();
        // 100 KB (step 0), 600 KB (step 1), then the end
        assert_eq!(
            sent,
            [(100 * kb, false), (600 * kb, false), (800 * kb, true)]
        );
    }

    #[test]
    fn a_size_seen_once_is_kept_and_more_than_it_counts_as_done() {
        let mut reporter = Reporter::default();
        assert_eq!(
            reporter.next(chunk(50, Some(100))).map(|p| p.total),
            Some(Some(100))
        );
        assert_eq!(reporter.next(chunk(0, None)), None);
        // A server that sent more than it said stops at 100%
        assert_eq!(
            reporter.next(chunk(80, None)),
            Some(Progress {
                downloaded: 130,
                total: Some(100),
                installing: false
            })
        );
        assert_eq!(reporter.next(chunk(10, None)), None);
    }

    #[test]
    fn progress_serializes_for_the_page() {
        let progress = Progress {
            downloaded: 5,
            total: None,
            installing: true,
        };
        assert_eq!(
            serde_json::to_value(progress).unwrap(),
            json!({ "downloaded": 5, "total": null, "installing": true })
        );
    }

    fn feed(version: &str) -> String {
        json!({
            "version": version,
            "notes": "### Added\n- Updates",
            "changelog": "## 0.2.0\n\n### Added\n- Updates\n\n## 0.1.0\n\n- First",
            "pub_date": "2026-11-24T10:00:00Z",
            "platforms": { "darwin-aarch64": { "url": "x", "signature": "y" } }
        })
        .to_string()
    }

    #[test]
    fn a_newer_release_is_announced_with_its_notes() {
        assert_eq!(
            newer(&feed("0.2.0"), "0.1.0"),
            Ok(Some(AvailableUpdate {
                version: "0.2.0".to_string(),
                current_version: "0.1.0".to_string(),
                notes: Some("### Added\n- Updates".to_string()),
                changelog: Some(
                    "## 0.2.0\n\n### Added\n- Updates\n\n## 0.1.0\n\n- First".to_string()
                ),
                date: Some("2026-11-24T10:00:00Z".to_string()),
            }))
        );
        // A tag-style version, and a newer major with smaller minor numbers
        assert_eq!(
            newer(&feed("v0.1.1"), "0.1.0").unwrap().unwrap().version,
            "0.1.1"
        );
        assert!(newer(&feed("1.0.0"), "0.12.3").unwrap().is_some());
        // Numbers, not text: 0.10.0 is newer than 0.9.0
        assert!(newer(&feed("0.10.0"), "0.9.0").unwrap().is_some());
    }

    #[test]
    fn the_same_or_an_older_release_is_nothing_to_do() {
        assert_eq!(newer(&feed("0.1.0"), "0.1.0"), Ok(None));
        assert_eq!(newer(&feed("0.0.9"), "0.1.0"), Ok(None));
        // Notes and a date are optional
        assert_eq!(newer(r#"{"version":"0.1.0"}"#, "0.1.0"), Ok(None));
    }

    #[test]
    fn a_feed_without_a_changelog_still_announces_its_release() {
        let update = newer(r#"{"version":"0.2.0","notes":"- A fix"}"#, "0.1.0")
            .unwrap()
            .unwrap();
        assert_eq!(update.notes.as_deref(), Some("- A fix"));
        assert_eq!(update.changelog, None);
        assert_eq!(update.date, None);
    }

    #[test]
    fn a_feed_or_version_it_cant_read_is_an_error() {
        assert!(newer("not json", "0.1.0")
            .unwrap_err()
            .starts_with("the release feed couldn't be read"));
        assert_eq!(
            newer(&feed("0.2"), "0.1.0"),
            Err("the release feed names a version Roku Remote can't read (0.2)".to_string())
        );
        assert!(newer(&feed("0.2.0.1"), "0.1.0").is_err());
        assert!(newer(&feed("0.x.0"), "0.1.0").is_err());
        assert_eq!(
            newer(&feed("0.2.0"), "dev"),
            Err("this version (dev) can't be compared".to_string())
        );
    }

    #[test]
    fn the_phone_client_has_mozillas_roots() {
        assert!(webpki_root_certs::TLS_SERVER_ROOT_CERTS.len() > 100);
        assert!(feed_client("0.1.0").is_ok());
    }

    /// The phone's TLS, checked against GitHub for real: `cargo test -p
    /// roku-controller -- --ignored`.
    #[tokio::test]
    #[ignore = "reaches github.com"]
    async fn the_phone_client_trusts_github() {
        let response = feed_client("0.1.0")
            .unwrap()
            .get(RELEASES_URL)
            .send()
            .await
            .expect("an HTTPS request to GitHub with the bundled roots");
        assert!(response.status().is_success(), "{}", response.status());
    }

    #[test]
    fn the_apk_downloads_from_its_release() {
        assert_eq!(
            apk_url("0.2.0"),
            "https://github.com/BeardedUnicorn/MineRoku/releases/download/v0.2.0/RokuRemote-0.2.0-android-arm64.apk"
        );
    }
}
