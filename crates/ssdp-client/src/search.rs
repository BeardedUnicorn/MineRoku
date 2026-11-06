use crate::{Error, SearchTarget};

use futures_core::stream::Stream;
use genawaiter::sync::{Co, Gen};
use std::{collections::HashMap, net::SocketAddr, time::Duration};
use tokio::net::UdpSocket;

const INSUFFICIENT_BUFFER_MSG: &str = "buffer size too small, udp packets lost";
const DEFAULT_SEARCH_TTL: u32 = 2;

#[derive(Debug)]
/// Response given by ssdp control point
pub struct SearchResponse {
    location: String,
    st: SearchTarget,
    usn: String,
    server: String,
    extra_headers: HashMap<String, String>,
}

impl SearchResponse {
    /// URL of the control point
    pub fn location(&self) -> &str {
        &self.location
    }
    /// search target returned by the control point
    pub fn search_target(&self) -> &SearchTarget {
        &self.st
    }
    /// Unique Service Name
    pub fn usn(&self) -> &str {
        &self.usn
    }
    /// Server (user agent)
    pub fn server(&self) -> &str {
        &self.server
    }
    /// Other Custom header
    pub fn extra_header(&self, key: &str) -> Option<&str> {
        self.extra_headers.get(key).map(|x| x.as_str())
    }
}

#[cfg(not(any(windows, target_os = "android")))]
async fn get_bind_addr() -> Result<SocketAddr, std::io::Error> {
    Ok(([0, 0, 0, 0], 0).into())
}

#[cfg(windows)]
async fn get_bind_addr() -> Result<SocketAddr, std::io::Error> {
    let any: SocketAddr = ([0, 0, 0, 0], 0).into();
    let socket = UdpSocket::bind(any).await?;
    let googledns: SocketAddr = ([8, 8, 8, 8], 80).into();
    socket.connect(googledns).await?;
    let bind_addr = socket.local_addr()?;
    Ok(bind_addr)
}

#[cfg(target_os = "android")]
async fn get_bind_addr() -> Result<SocketAddr, std::io::Error> {
    // On Android, bind to INADDR_ANY
    let addr = ([0, 0, 0, 0], 0).into();
    log::info!("Android SSDP: Using bind address: {:?}", addr);
    Ok(addr)
}

/// Get the WiFi interface IP on Android by reading network interfaces
#[cfg(target_os = "android")]
fn get_wifi_interface_ip() -> Result<std::net::Ipv4Addr, std::io::Error> {
    use std::ffi::CStr;
    use std::ptr;
    
    log::info!("Android SSDP: Searching for WiFi interface IP...");
    
    unsafe {
        let mut ifaddrs: *mut libc::ifaddrs = ptr::null_mut();
        if libc::getifaddrs(&mut ifaddrs) != 0 {
            let err = std::io::Error::last_os_error();
            log::error!("Android SSDP: getifaddrs failed: {}", err);
            return Err(err);
        }
        
        let mut current = ifaddrs;
        let mut wifi_ip: Option<std::net::Ipv4Addr> = None;
        
        while !current.is_null() {
            let ifaddr = &*current;
            let name = CStr::from_ptr(ifaddr.ifa_name).to_str().unwrap_or("");
            
            // Look for wlan interface
            if name.starts_with("wlan") && !ifaddr.ifa_addr.is_null() {
                let addr = &*ifaddr.ifa_addr;
                
                if addr.sa_family == libc::AF_INET as u16 {
                    let sockaddr_in = &*(ifaddr.ifa_addr as *const libc::sockaddr_in);
                    let ip_bytes = sockaddr_in.sin_addr.s_addr.to_ne_bytes();
                    let ip = std::net::Ipv4Addr::new(ip_bytes[0], ip_bytes[1], ip_bytes[2], ip_bytes[3]);
                    
                    // Skip loopback and link-local
                    if !ip.is_loopback() && !ip.is_link_local() {
                        // Skip common VPN ranges: 100.64.0.0/10
                        if ip.octets()[0] == 100 && ip.octets()[1] >= 64 && ip.octets()[1] <= 127 {
                            log::debug!("Android SSDP: Skipping VPN address {} on {}", ip, name);
                            current = ifaddr.ifa_next;
                            continue;
                        }
                        
                        log::info!("Android SSDP: Found WiFi interface {} with IP {}", name, ip);
                        wifi_ip = Some(ip);
                        break;
                    }
                }
            }
            
            current = ifaddr.ifa_next;
        }
        
        libc::freeifaddrs(ifaddrs);
        
        if let Some(ip) = wifi_ip {
            Ok(ip)
        } else {
            log::warn!("Android SSDP: No suitable WiFi interface found");
            Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "No WiFi interface found"
            ))
        }
    }
}

/// Search for SSDP control points within a network.
pub async fn search(
    search_target: &SearchTarget,
    timeout: Duration,
    mx: usize,
    ttl: Option<u32>,
) -> Result<impl Stream<Item = Result<SearchResponse, Error>>, Error> {
    let bind_addr: SocketAddr = get_bind_addr().await?;
    let broadcast_address: SocketAddr = ([239, 255, 255, 250], 1900).into();

    log::info!("SSDP: Starting search for target: {}", search_target);
    log::info!("SSDP: Binding to address: {}", bind_addr);
    log::info!("SSDP: Will send M-SEARCH to: {}", broadcast_address);
    log::info!("SSDP: Timeout: {:?}, MX: {}, TTL: {:?}", timeout, mx, ttl);
    
    let socket = match UdpSocket::bind(&bind_addr).await {
        Ok(s) => {
            log::info!("SSDP: Successfully bound socket to {}", s.local_addr().unwrap_or(bind_addr));
            s
        }
        Err(e) => {
            log::error!("SSDP: Failed to bind socket to {}: {}", bind_addr, e);
            return Err(Error::IO(e));
        }
    };
    
    // Android-specific: Bind socket to wlan0 interface to bypass VPN
    #[cfg(target_os = "android")]
    {
        use std::os::fd::AsRawFd;
        let fd = socket.as_raw_fd();
        
        // Try to bind to wlan0 interface
        let interface_name = b"wlan0\0";
        unsafe {
            let result = libc::setsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_BINDTODEVICE,
                interface_name.as_ptr() as *const libc::c_void,
                interface_name.len() as libc::socklen_t,
            );
            if result == 0 {
                log::info!("Android SSDP: Successfully bound socket to wlan0 interface");
            } else {
                log::warn!("Android SSDP: Failed to bind to wlan0 (may require root): {}", std::io::Error::last_os_error());
                // Continue anyway - it might still work
            }
        }
        
        // Set SO_REUSEADDR
        unsafe {
            let optval: libc::c_int = 1;
            let result = libc::setsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_REUSEADDR,
                &optval as *const _ as *const libc::c_void,
                std::mem::size_of_val(&optval) as libc::socklen_t,
            );
            if result == 0 {
                log::info!("Android SSDP: Set SO_REUSEADDR successfully");
            } else {
                log::warn!("Android SSDP: Failed to set SO_REUSEADDR: {}", std::io::Error::last_os_error());
            }
        }
    }
    
    // Configure socket for multicast
    let ttl_val = ttl.unwrap_or(DEFAULT_SEARCH_TTL);
    match socket.set_multicast_ttl_v4(ttl_val) {
        Ok(_) => log::info!("SSDP: Set multicast TTL to {}", ttl_val),
        Err(e) => log::warn!("SSDP: Failed to set multicast TTL: {}", e),
    }
    
    // Enable broadcast
    match socket.set_broadcast(true) {
        Ok(_) => log::info!("SSDP: Enabled broadcast on socket"),
        Err(e) => log::warn!("SSDP: Failed to set broadcast: {}", e),
    }

    // Join multicast group
    let multicast_addr = std::net::Ipv4Addr::new(239, 255, 255, 250);
    
    #[cfg(target_os = "android")]
    {
        // Get the actual WiFi interface IP to join multicast on correct interface
        match get_wifi_interface_ip() {
            Ok(interface_ip) => {
                log::info!("Android SSDP: Attempting to join multicast group {} on interface {}", multicast_addr, interface_ip);
                match socket.join_multicast_v4(multicast_addr, interface_ip) {
                    Ok(_) => log::info!("Android SSDP: Successfully joined multicast group"),
                    Err(e) => {
                        log::error!("Android SSDP: Failed to join multicast group: {} (error kind: {:?})", e, e.kind());
                        // Try with 0.0.0.0 as fallback
                        let any_interface = std::net::Ipv4Addr::new(0, 0, 0, 0);
                        log::info!("Android SSDP: Trying fallback with 0.0.0.0 interface");
                        match socket.join_multicast_v4(multicast_addr, any_interface) {
                            Ok(_) => log::info!("Android SSDP: Joined multicast group with fallback interface"),
                            Err(e2) => {
                                log::error!("Android SSDP: Fallback also failed: {}", e2);
                                return Err(Error::IO(e));
                            }
                        }
                    }
                }
            }
            Err(e) => {
                log::warn!("Android SSDP: Could not determine WiFi interface IP: {}", e);
                log::info!("Android SSDP: Attempting to join multicast with 0.0.0.0");
                let any_interface = std::net::Ipv4Addr::new(0, 0, 0, 0);
                match socket.join_multicast_v4(multicast_addr, any_interface) {
                    Ok(_) => log::info!("Android SSDP: Joined multicast group with 0.0.0.0"),
                    Err(e) => {
                        log::error!("Android SSDP: Failed to join multicast: {}", e);
                        return Err(Error::IO(e));
                    }
                }
            }
        }
    }
    
    #[cfg(not(target_os = "android"))]
    {
        let interface = std::net::Ipv4Addr::new(0, 0, 0, 0);
        if let Err(e) = socket.join_multicast_v4(multicast_addr, interface) {
            log::debug!("Could not join multicast group (may be ok): {}", e);
        }
    }

    let msg = format!(
        "M-SEARCH * HTTP/1.1\r\nHost: 239.255.255.250:1900\r\nMan: \"ssdp:discover\"\r\nST: {}\r\nMX: {}\r\n\r\n",
        search_target, mx
    );
    
    log::info!("SSDP: Prepared M-SEARCH message ({} bytes)", msg.len());
    log::debug!("SSDP M-SEARCH message:\n{}", msg);
    
    // Send multiple times for reliability, especially on Android
    let send_count = if cfg!(target_os = "android") { 5 } else { 3 };
    log::info!("SSDP: Will send {} M-SEARCH packets", send_count);
    
    for i in 0..send_count {
        match socket.send_to(msg.as_bytes(), &broadcast_address).await {
            Ok(bytes) => {
                log::info!("SSDP: Successfully sent {} bytes to {} (attempt {})", bytes, broadcast_address, i + 1);
            }
            Err(e) => {
                log::error!("SSDP: Failed to send M-SEARCH (attempt {}): {} (kind: {:?})", i + 1, e, e.kind());
            }
        }
        if i < send_count - 1 {
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }

    log::info!("SSDP: Starting to listen for responses (timeout: {:?})", timeout);
    Ok(Gen::new(move |co| socket_stream(socket, timeout, co)))
}

macro_rules! yield_try {
    ( $co:expr => $expr:expr ) => {
        match $expr {
            Ok(val) => val,
            Err(e) => {
                $co.yield_(Err(e.into())).await;
                continue;
            }
        }
    };
}

async fn socket_stream(
    socket: UdpSocket,
    timeout: Duration,
    co: Co<Result<SearchResponse, Error>>,
) {
    log::debug!("SSDP: Entering socket_stream, waiting for responses");
    let start_time = std::time::Instant::now();
    
    loop {
        let mut buf = [0u8; 2048];
        let elapsed = start_time.elapsed();
        
        if elapsed >= timeout {
            log::info!("SSDP: Timeout reached after {:?}, stopping response collection", elapsed);
            break;
        }
        
        let remaining_timeout = timeout - elapsed;
        log::debug!("SSDP: Waiting for response (remaining timeout: {:?})", remaining_timeout);
        
        let text = match tokio::time::timeout(remaining_timeout, socket.recv_from(&mut buf)).await {
            Err(_) => {
                log::info!("SSDP: No more responses within timeout period");
                break;
            }
            Ok(res) => match res {
                Ok((2048, _)) => {
                    log::warn!("{INSUFFICIENT_BUFFER_MSG}");
                    continue;
                }
                Ok((read,addr)) => {
                    log::info!("SSDP: Received {} bytes from {}", read, addr);
                    let text = yield_try!(co => std::str::from_utf8(&buf[..read]));
                    log::debug!("SSDP: Received response from {}:\n{}", addr, text);
                    text
                }
                Err(e) => {
                    log::error!("SSDP: Socket recv error: {} (kind: {:?})", e, e.kind());
                    co.yield_(Err(e.into())).await;
                    continue;
                }
            },
        };

        log::debug!("SSDP: Parsing headers from response");
        let headers = yield_try!(co => parse_headers(text));

        let mut location = None;
        let mut st = None;
        let mut usn = None;
        let mut server = None;
        let mut extra_headers = HashMap::new();

        for (header, value) in headers {
            log::trace!("SSDP: Header '{}' = '{}'", header, value);
            if header.eq_ignore_ascii_case("location") {
                location = Some(value);
            } else if header.eq_ignore_ascii_case("st") {
                st = Some(value);
            } else if header.eq_ignore_ascii_case("usn") {
                usn = Some(value);
            } else if header.eq_ignore_ascii_case("server") {
                server = Some(value);
            } else {
                extra_headers.insert(header.to_owned(), value.to_owned());
            }
        }

        let location = yield_try!(co => location
            .ok_or(Error::MissingHeader("location")))
        .to_string();
        let st = yield_try!(co => yield_try!(co => st.ok_or(Error::MissingHeader("st"))).parse::<SearchTarget>());
        let usn = yield_try!(co => usn.ok_or(Error::MissingHeader("urn"))).to_string();
        let server = yield_try!(co => server.ok_or(Error::MissingHeader("server"))).to_string();

        log::info!("SSDP: Successfully parsed response - location: {}, ST: {:?}, USN: {}", location, st, usn);

        co.yield_(Ok(SearchResponse {
            location,
            st,
            usn,
            server,
            extra_headers,
        }))
        .await;
    }
    
    log::info!("SSDP: Response collection completed, processed for {:?}", start_time.elapsed());
}

fn parse_headers(response: &str) -> Result<impl Iterator<Item = (&str, &str)>, Error> {
    let mut response = response.split("\r\n");
    let status_code = response
        .next()
        .ok_or(Error::InvalidHTTP("http response is empty"))?
        .trim_start_matches("HTTP/1.1 ")
        .chars()
        .take_while(|x| x.is_numeric())
        .collect::<String>()
        .parse::<u32>()
        .map_err(|_| Error::InvalidHTTP("status code is not a number"))?;

    if status_code != 200 {
        return Err(Error::HTTPError(status_code));
    }

    let iter = response.filter_map(|l| {
        let mut split = l.splitn(2, ':');
        match (split.next(), split.next()) {
            (Some(header), Some(value)) => Some((header, value.trim())),
            _ => None,
        }
    });

    Ok(iter)
}
