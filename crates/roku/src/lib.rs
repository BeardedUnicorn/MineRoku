use futures_util::stream::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use serde_xml_rs::from_str;
use ssdp_client::{search, SearchTarget};
use std::{fmt, time::Duration};
use thiserror::Error;
use url::Url;

#[derive(Debug, Error)]
pub enum Error {
    #[error("failed to send request")]
    Request(#[from] reqwest::Error),
    #[error("failed to send SSDP request")]
    SSDPRequest(#[from] ssdp_client::Error),
    #[error("failed to parse URL")]
    URLParse(#[from] url::ParseError),
    #[error("failed to parse XML")]
    XMLParse(#[from] serde_xml_rs::Error),
    #[error("argument error `{0}`")]
    Argument(String),
}

type Result<T> = std::result::Result<T, Error>;

#[derive(Debug)]
pub struct Device {
    url: Url,
    client: Client,
}

impl Device {
    pub fn new(url: Url) -> Device {
        // One client (and connection pool) for the whole process: callers build a `Device` per
        // request, and polling would otherwise open a new connection every time.
        static SHARED_CLIENT: std::sync::OnceLock<Client> = std::sync::OnceLock::new();
        let client = SHARED_CLIENT
            .get_or_init(|| {
                Client::builder()
                    .timeout(Duration::from_secs(5))
                    .connect_timeout(Duration::from_secs(3))
                    .build()
                    .unwrap_or_else(|_| Client::new())
            })
            .clone();
        Device { url, client }
    }

    pub async fn discover() -> Result<Vec<Device>> {
        let search_target = SearchTarget::Custom("roku".to_string(), "ecp".to_string());
        let mut responses = search(&search_target, Duration::from_secs(3), 2, None).await?;
        let mut devices = vec![];
        while let Some(response) = responses.next().await {
            let response = response?;
            if response.search_target() != &search_target {
                continue;
            }
            let url = Url::parse(response.location())?;
            devices.push(Device {
                url,
                client: Client::new(),
            });
        }
        Ok(devices)
    }

    pub async fn apps(&self) -> Result<Apps> {
        let url = self.url.join("query/apps")?;
        let res = self.client.get(url).send().await?.error_for_status()?;
        let text = res.text().await?;
        Ok(from_str(&text)?)
    }

    pub async fn active_app(&self) -> Result<ActiveApp> {
        let url = self.url.join("query/active-app")?;
        let res = self.client.get(url).send().await?.error_for_status()?;
        let text = res.text().await?;
        Ok(from_str(&text)?)
    }

    pub async fn media_player(&self) -> Result<MediaPlayer> {
        let url = self.url.join("query/media-player")?;
        let res = self.client.get(url).send().await?.error_for_status()?;
        let text = res.text().await?;
        Ok(from_str(&text)?)
    }

    pub async fn keydown(&self, key: &Key) -> Result<()> {
        let url = self.url.join(&format!("keydown/{}", key.to_string()))?;
        self.client.post(url).send().await?;
        Ok(())
    }

    pub async fn keyup(&self, key: &Key) -> Result<()> {
        let url = self.url.join(&format!("keyup/{}", key.to_string()))?;
        self.client.post(url).send().await?;
        Ok(())
    }

    pub async fn keypress(&self, key: &Key) -> Result<()> {
        let url = self.url.join(&format!("keypress/{}", key.to_string()))?;
        self.client.post(url).send().await?;
        Ok(())
    }

    pub async fn launch(&self, app: &App) -> Result<()> {
        let app_id = app
            .id
            .as_ref()
            .ok_or_else(|| Error::Argument("app.id required".to_string()))?;
        let url = self.url.join(&format!("launch/{}", app_id))?;
        self.client.post(url).send().await?;
        Ok(())
    }

    pub async fn install(&self, app: &App) -> Result<()> {
        let app_id = app
            .id
            .as_ref()
            .ok_or_else(|| Error::Argument("app.id required".to_string()))?;
        let url = self.url.join(&format!("install/{}", app_id))?;
        self.client.post(url).send().await?;
        Ok(())
    }

    pub async fn device_info(&self) -> Result<DeviceInfo> {
        let url = self.url.join("query/device-info")?;
        let res = self.client.get(url).send().await?;
        let text = res.text().await?;
        Ok(from_str(&text)?)
    }

    pub async fn input(&self, input: &[(String, String)]) -> Result<()> {
        let url = self.url.join("input")?;
        self.client.post(url).query(input).send().await?;
        Ok(())
    }

    pub async fn search(&self, search: Search) -> Result<()> {
        let search = search.build();
        let url = self.url.join("search")?;
        self.client.post(url).query(&search).send().await?;
        Ok(())
    }
}

/// Parses the body of a `query/media-player` response.
pub fn parse_media_player(xml: &str) -> Result<MediaPlayer> {
    Ok(from_str(xml)?)
}

#[derive(Debug, Deserialize)]
pub struct Apps {
    #[serde(rename = "app")]
    pub apps: Vec<App>,
}

#[derive(Debug, Deserialize)]
pub struct ActiveApp {
    pub app: App,
    pub screensaver: Option<Screensaver>,
}

#[derive(Debug, Deserialize)]
pub struct App {
    #[serde(rename = "@id")]
    pub id: Option<String>,
    #[serde(rename = "#text")]
    pub name: String,
    #[serde(rename = "@version")]
    pub version: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Screensaver {
    #[serde(rename = "@black")]
    pub black: Option<bool>,
    #[serde(rename = "@id")]
    pub id: String,
    #[serde(rename = "#text")]
    pub name: String,
    #[serde(rename = "@type")]
    pub screensaver_type: String,
    #[serde(rename = "@version")]
    pub version: String,
}

#[derive(Debug, Deserialize)]
pub struct MediaPlayer {
    pub buffering: Option<Buffering>,
    pub duration: Option<String>,
    #[serde(rename = "@error")]
    pub error: bool,
    pub format: Option<Format>,
    pub is_live: Option<bool>,
    pub new_stream: Option<NewStream>,
    pub plugin: Option<Plugin>,
    pub position: Option<String>,
    pub runtime: Option<String>,
    #[serde(rename = "@state")]
    pub state: String,
    pub stream_segment: Option<StreamSegment>,
}

#[derive(Debug, Deserialize)]
pub struct Plugin {
    #[serde(rename = "@bandwidth")]
    pub bandwidth: String,
    #[serde(rename = "@id")]
    pub id: String,
    #[serde(rename = "@name")]
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct Format {
    #[serde(rename = "@audio")]
    pub audio: String,
    #[serde(rename = "@captions")]
    pub captions: String,
    #[serde(rename = "@container")]
    pub container: String,
    #[serde(rename = "@drm")]
    pub drm: String,
    #[serde(rename = "@video")]
    pub video: String,
    #[serde(rename = "@video_res")]
    pub video_res: String,
}

#[derive(Debug, Deserialize)]
pub struct Buffering {
    #[serde(rename = "@current")]
    pub current: u32,
    #[serde(rename = "@max")]
    pub max: u32,
    #[serde(rename = "@target")]
    pub target: u32,
}

#[derive(Debug, Deserialize)]
pub struct NewStream {
    #[serde(rename = "@speed")]
    pub speed: String,
}

#[derive(Debug, Deserialize)]
pub struct StreamSegment {
    #[serde(rename = "@bitrate")]
    pub bitrate: u32,
    #[serde(rename = "@media_sequence")]
    pub media_sequence: u32,
    #[serde(rename = "@segment_type")]
    pub segment_type: String,
    #[serde(rename = "@time")]
    pub time: u32,
}

pub enum Key {
    Back,
    Backspace,
    ChannelDown,
    ChannelUp,
    Down,
    Enter,
    FindRemote,
    Fwd,
    Home,
    Info,
    InputAV1,
    InputHDMI1,
    InputHDMI2,
    InputHDMI3,
    InputHDMI4,
    InputTuner,
    InstantReplay,
    Left,
    Play,
    PowerOff,
    Rev,
    Right,
    Search,
    Select,
    Up,
    VolumeDown,
    VolumeMute,
    VolumeUp,
    Lit(char),
}

impl fmt::Display for Key {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match *self {
            Key::Back => write!(f, "Back"),
            Key::Backspace => write!(f, "Backspace"),
            Key::ChannelDown => write!(f, "ChannelDown"),
            Key::ChannelUp => write!(f, "ChannelUp"),
            Key::Down => write!(f, "Down"),
            Key::Enter => write!(f, "Enter"),
            Key::FindRemote => write!(f, "FindRemote"),
            Key::Fwd => write!(f, "Fwd"),
            Key::Home => write!(f, "Home"),
            Key::Info => write!(f, "Info"),
            Key::InputAV1 => write!(f, "InputAV1"),
            Key::InputHDMI1 => write!(f, "InputHDMI1"),
            Key::InputHDMI2 => write!(f, "InputHDMI2"),
            Key::InputHDMI3 => write!(f, "InputHDMI3"),
            Key::InputHDMI4 => write!(f, "InputHDMI4"),
            Key::InputTuner => write!(f, "InputTuner"),
            Key::InstantReplay => write!(f, "InstantReplay"),
            Key::Left => write!(f, "Left"),
            Key::Play => write!(f, "Play"),
            Key::PowerOff => write!(f, "PowerOff"),
            Key::Rev => write!(f, "Rev"),
            Key::Right => write!(f, "Right"),
            Key::Search => write!(f, "Search"),
            Key::Select => write!(f, "Select"),
            Key::Up => write!(f, "Up"),
            Key::VolumeDown => write!(f, "VolumeDown"),
            Key::VolumeMute => write!(f, "VolumeMute"),
            Key::VolumeUp => write!(f, "VolumeUp"),
            Key::Lit(c) => write!(f, "Lit_{}", c),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct DeviceInfo {
    pub advertising_id: String,
    pub build_number: String,
    pub can_use_wifi_extender: bool,
    pub clock_format: String,
    pub country: String,
    pub davinci_version: String,
    pub default_device_name: String,
    pub developer_enabled: bool,
    pub device_id: String,
    pub ethernet_mac: Option<String>,
    pub find_remote_is_possible: bool,
    pub friendly_device_name: String,
    pub friendly_model_name: String,
    pub grandcentral_version: String,
    pub has_mobile_screensaver: bool,
    pub has_play_on_roku: bool,
    #[serde(rename = "has-wifi-5G-support")]
    pub has_wifi_5g_support: bool,
    pub has_wifi_extender: bool,
    pub headphones_connected: bool,
    pub is_stick: bool,
    pub is_tv: bool,
    pub keyed_developer_id: String,
    pub language: String,
    pub locale: String,
    pub model_name: String,
    pub model_number: String,
    pub model_region: String,
    pub network_name: String,
    pub network_type: String,
    pub notifications_enabled: bool,
    pub notifications_first_use: bool,
    pub power_mode: String,
    pub search_channels_enabled: bool,
    pub search_enabled: bool,
    pub secure_device: bool,
    pub serial_number: String,
    pub software_build: String,
    pub software_version: String,
    pub support_url: String,
    pub supports_audio_guide: bool,
    pub supports_ecs_microphone: bool,
    pub supports_ecs_textedit: bool,
    pub supports_ethernet: bool,
    pub supports_find_remote: bool,
    pub supports_private_listening: bool,
    pub supports_rva: bool,
    pub supports_suspend: bool,
    pub supports_wake_on_wlan: bool,
    pub time_zone: String,
    pub time_zone_auto: bool,
    pub time_zone_name: String,
    pub time_zone_offset: i32,
    pub time_zone_tz: String,
    pub udn: String,
    pub uptime: u32,
    pub user_device_location: String,
    pub user_device_name: String,
    pub vendor_name: String,
    pub voice_search_enabled: bool,
    pub wifi_driver: String,
    pub wifi_mac: String,
}

pub struct Search {
    keyword: String,
    launch: Option<bool>,
    match_any: Option<bool>,
    providers: Option<Vec<String>>,
    provider_ids: Option<Vec<String>>,
    search_type: Option<SearchType>,
    season: Option<u32>,
    show_unavailable: Option<bool>,
    title: Option<String>,
    tmsid: Option<String>,
}

impl Search {
    pub fn new(keyword: String) -> Search {
        Search {
            keyword,
            launch: None,
            match_any: None,
            provider_ids: None,
            providers: None,
            search_type: None,
            season: None,
            show_unavailable: None,
            title: None,
            tmsid: None,
        }
    }

    fn build(self) -> Vec<(String, String)> {
        let mut ret = vec![("keyword", self.keyword)];
        if let Some(launch) = self.launch {
            ret.push(("launch", launch.to_string()));
        }
        if let Some(match_any) = self.match_any {
            ret.push(("match-any", match_any.to_string()));
        }
        if let Some(provider_ids) = self.provider_ids {
            ret.push(("provider-id", provider_ids.join(",")));
        }
        if let Some(providers) = self.providers {
            ret.push(("provider", providers.join(",")));
        }
        if let Some(search_type) = self.search_type {
            ret.push((
                "type",
                match search_type {
                    SearchType::Movie => "movie",
                    SearchType::TvShow => "tv-show",
                    SearchType::Person => "person",
                    SearchType::Channel => "channel",
                    SearchType::Game => "game",
                }
                .to_string(),
            ));
        }
        if let Some(season) = self.season {
            ret.push(("season", season.to_string()));
        }
        if let Some(show_unavailable) = self.show_unavailable {
            ret.push(("show-unavailable", show_unavailable.to_string()));
        }
        if let Some(title) = self.title {
            ret.push(("title", title));
        }
        if let Some(tmsid) = self.tmsid {
            ret.push(("tmsid", tmsid));
        }
        ret.into_iter().map(|(k, v)| (k.to_string(), v)).collect()
    }

    pub fn launch(&mut self, launch: bool) -> &mut Search {
        self.launch = Some(launch);
        self
    }

    pub fn match_any(&mut self, match_any: bool) -> &mut Search {
        self.match_any = Some(match_any);
        self
    }

    pub fn provider(&mut self, provider: String) -> &mut Search {
        match &mut self.providers {
            Some(providers) => {
                providers.push(provider);
            }
            None => {
                self.providers = Some(vec![]);
            }
        }
        self
    }

    pub fn provider_id(&mut self, provider_id: String) -> &mut Search {
        match &mut self.provider_ids {
            Some(provider_ids) => {
                provider_ids.push(provider_id);
            }
            None => {
                self.provider_ids = Some(vec![]);
            }
        }
        self
    }

    pub fn search_type(&mut self, search_type: SearchType) -> &mut Search {
        self.search_type = Some(search_type);
        self
    }

    pub fn season(&mut self, season: u32) -> &mut Search {
        self.season = Some(season);
        self
    }
    pub fn show_unavailable(&mut self, show_unavailable: bool) -> &mut Search {
        self.show_unavailable = Some(show_unavailable);
        self
    }

    pub fn title(&mut self, title: String) -> &mut Search {
        self.title = Some(title);
        self
    }

    pub fn tmsid(&mut self, tmsid: String) -> &mut Search {
        self.tmsid = Some(tmsid);
        self
    }
}

pub enum SearchType {
    Movie,
    TvShow,
    Person,
    Channel,
    Game,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_app_list_with_attributes_and_names() {
        let apps: Apps = from_str(
            r#"<?xml version="1.0" encoding="UTF-8" ?>
<apps>
    <app id="12" type="appl" version="4.1.218">Netflix</app>
    <app id="2285" subtype="rsga" type="appl" version="6.0">Hulu &amp; More</app>
</apps>"#,
        )
        .unwrap();

        assert_eq!(apps.apps.len(), 2);
        assert_eq!(apps.apps[0].id.as_deref(), Some("12"));
        assert_eq!(apps.apps[0].name, "Netflix");
        assert_eq!(apps.apps[0].version.as_deref(), Some("4.1.218"));
        assert_eq!(apps.apps[1].id.as_deref(), Some("2285"));
        assert_eq!(apps.apps[1].name, "Hulu & More");
    }

    #[test]
    fn parses_active_app_on_home_screen_without_attributes() {
        let active: ActiveApp =
            from_str(r#"<active-app><app>Roku</app></active-app>"#).unwrap();

        assert_eq!(active.app.name, "Roku");
        assert_eq!(active.app.id, None);
        assert_eq!(active.app.version, None);
        assert!(active.screensaver.is_none());
    }

    #[test]
    fn parses_active_app_with_attributes() {
        let active: ActiveApp = from_str(
            r#"<?xml version="1.0" encoding="UTF-8" ?>
<active-app>
    <app id="12" subtype="ndka" type="appl" version="4.1.218">Netflix</app>
</active-app>"#,
        )
        .unwrap();

        assert_eq!(active.app.id.as_deref(), Some("12"));
        assert_eq!(active.app.name, "Netflix");
        assert_eq!(active.app.version.as_deref(), Some("4.1.218"));
        assert!(active.screensaver.is_none());
    }

    #[test]
    fn parses_active_app_with_screensaver() {
        let active: ActiveApp = from_str(
            r#"<active-app>
    <app id="837" type="appl" version="2.1">YouTube</app>
    <screensaver id="55545" type="ssvr" version="2.0.1">Default screensaver</screensaver>
</active-app>"#,
        )
        .unwrap();

        assert_eq!(active.app.name, "YouTube");
        let screensaver = active.screensaver.expect("screensaver should be parsed");
        assert_eq!(screensaver.id, "55545");
        assert_eq!(screensaver.name, "Default screensaver");
        assert_eq!(screensaver.screensaver_type, "ssvr");
        assert_eq!(screensaver.version, "2.0.1");
        assert_eq!(screensaver.black, None);
    }

    #[test]
    fn parses_media_player_while_playing() {
        let player: MediaPlayer = from_str(
            r#"<?xml version="1.0" encoding="UTF-8" ?>
<player error="false" state="play">
    <plugin bandwidth="10000000 bps" id="12" name="Netflix"/>
    <format audio="eac3" captions="none" container="mp4" drm="widevine" video="hevc_b" video_res="1080p"/>
    <buffering current="1000" max="1000" target="0"/>
    <new_stream speed="128000 bps"/>
    <position>36500 ms</position>
    <duration>1316000 ms</duration>
    <is_live>false</is_live>
    <runtime>1316000 ms</runtime>
    <stream_segment bitrate="5000000" media_sequence="7" segment_type="audio" time="32000"/>
</player>"#,
        )
        .unwrap();

        assert!(!player.error);
        assert_eq!(player.state, "play");
        assert_eq!(player.position.as_deref(), Some("36500 ms"));
        assert_eq!(player.duration.as_deref(), Some("1316000 ms"));
        assert_eq!(player.runtime.as_deref(), Some("1316000 ms"));
        assert_eq!(player.is_live, Some(false));

        let plugin = player.plugin.expect("plugin should be parsed");
        assert_eq!(plugin.id, "12");
        assert_eq!(plugin.name, "Netflix");
        assert_eq!(plugin.bandwidth, "10000000 bps");

        let format = player.format.expect("format should be parsed");
        assert_eq!(format.audio, "eac3");
        assert_eq!(format.captions, "none");
        assert_eq!(format.container, "mp4");
        assert_eq!(format.drm, "widevine");
        assert_eq!(format.video, "hevc_b");
        assert_eq!(format.video_res, "1080p");

        let buffering = player.buffering.expect("buffering should be parsed");
        assert_eq!(buffering.current, 1000);
        assert_eq!(buffering.max, 1000);
        assert_eq!(buffering.target, 0);

        assert_eq!(player.new_stream.expect("new_stream").speed, "128000 bps");

        let segment = player.stream_segment.expect("stream_segment");
        assert_eq!(segment.bitrate, 5000000);
        assert_eq!(segment.media_sequence, 7);
        assert_eq!(segment.segment_type, "audio");
        assert_eq!(segment.time, 32000);
    }

    #[test]
    fn parses_media_player_is_live_with_blocked_attribute() {
        let player: MediaPlayer = from_str(
            r#"<player error="false" state="play"><is_live blocked="false">true</is_live></player>"#,
        )
        .unwrap();

        assert_eq!(player.is_live, Some(true));
    }

    #[test]
    fn parses_idle_media_player() {
        let player: MediaPlayer =
            from_str(r#"<player error="false" state="close"/>"#).unwrap();

        assert!(!player.error);
        assert_eq!(player.state, "close");
        assert!(player.plugin.is_none());
        assert!(player.format.is_none());
        assert_eq!(player.position, None);
        assert_eq!(player.is_live, None);
    }

    #[test]
    fn parses_media_player_error_flag() {
        let player: MediaPlayer =
            from_str(r#"<player error="true" state="none"/>"#).unwrap();

        assert!(player.error);
        assert_eq!(player.state, "none");
    }

    #[test]
    fn parses_device_info_from_kebab_case_elements() {
        let info: DeviceInfo = from_str(
            r#"<?xml version="1.0" encoding="UTF-8" ?>
<device-info>
    <udn>29380007-0800-1025-80a4-d83134e8a6b1</udn>
    <serial-number>X004000AAAAA</serial-number>
    <device-id>S00820AAAAAA</device-id>
    <advertising-id>ab12</advertising-id>
    <vendor-name>Roku</vendor-name>
    <model-name>Roku Ultra</model-name>
    <model-number>4670X</model-number>
    <model-region>US</model-region>
    <is-tv>false</is-tv>
    <is-stick>false</is-stick>
    <supports-ethernet>true</supports-ethernet>
    <wifi-mac>d8:31:34:e8:a6:b1</wifi-mac>
    <wifi-driver>realtek</wifi-driver>
    <network-type>wifi</network-type>
    <network-name>Home</network-name>
    <friendly-device-name>Living Room</friendly-device-name>
    <friendly-model-name>Roku Ultra</friendly-model-name>
    <default-device-name>Roku Ultra - X004000AAAAA</default-device-name>
    <user-device-name>Living Room</user-device-name>
    <user-device-location>Living Room</user-device-location>
    <build-number>CGB.00E04221A</build-number>
    <software-version>12.5.0</software-version>
    <software-build>4221</software-build>
    <secure-device>true</secure-device>
    <language>en</language>
    <country>US</country>
    <locale>en_US</locale>
    <time-zone-auto>true</time-zone-auto>
    <time-zone>US/Pacific</time-zone>
    <time-zone-name>United States/Pacific</time-zone-name>
    <time-zone-tz>America/Los_Angeles</time-zone-tz>
    <time-zone-offset>-480</time-zone-offset>
    <clock-format>12-hour</clock-format>
    <uptime>4242</uptime>
    <power-mode>PowerOn</power-mode>
    <supports-suspend>false</supports-suspend>
    <supports-find-remote>true</supports-find-remote>
    <find-remote-is-possible>true</find-remote-is-possible>
    <supports-audio-guide>true</supports-audio-guide>
    <supports-rva>true</supports-rva>
    <developer-enabled>false</developer-enabled>
    <keyed-developer-id></keyed-developer-id>
    <search-enabled>true</search-enabled>
    <search-channels-enabled>true</search-channels-enabled>
    <voice-search-enabled>true</voice-search-enabled>
    <notifications-enabled>true</notifications-enabled>
    <notifications-first-use>false</notifications-first-use>
    <supports-private-listening>true</supports-private-listening>
    <headphones-connected>false</headphones-connected>
    <supports-ecs-textedit>true</supports-ecs-textedit>
    <supports-ecs-microphone>true</supports-ecs-microphone>
    <supports-wake-on-wlan>false</supports-wake-on-wlan>
    <has-play-on-roku>true</has-play-on-roku>
    <has-mobile-screensaver>false</has-mobile-screensaver>
    <support-url>roku.com/support</support-url>
    <grandcentral-version>9.2.0</grandcentral-version>
    <davinci-version>2.8.20</davinci-version>
    <can-use-wifi-extender>true</can-use-wifi-extender>
    <has-wifi-extender>false</has-wifi-extender>
    <has-wifi-5G-support>true</has-wifi-5G-support>
</device-info>"#,
        )
        .unwrap();

        assert_eq!(info.udn, "29380007-0800-1025-80a4-d83134e8a6b1");
        assert_eq!(info.serial_number, "X004000AAAAA");
        assert_eq!(info.friendly_device_name, "Living Room");
        assert_eq!(info.model_number, "4670X");
        assert_eq!(info.time_zone_offset, -480);
        assert_eq!(info.uptime, 4242);
        assert_eq!(info.ethernet_mac, None);
        assert_eq!(info.keyed_developer_id, "");
        assert!(info.has_wifi_5g_support);
        assert!(info.supports_ethernet);
        assert!(!info.is_tv);
    }
}
