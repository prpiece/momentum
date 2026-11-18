//! Fetching calendar subscription feeds (v1.3). The webview can't: CORS and the CSP block it.
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr, ToSocketAddrs},
    time::Duration,
};

const MAX_BYTES: usize = 10 * 1024 * 1024;

/// `webcal://` is https in disguise; anything but http(s) is refused.
fn feed_url(url: &str) -> Result<String, String> {
    let url = url.trim();
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("webcal://") {
        Ok(format!("https://{}", &url["webcal://".len()..]))
    } else if lower.starts_with("https://") || lower.starts_with("http://") {
        Ok(url.to_string())
    } else {
        Err("The address must start with https://, http:// or webcal://".into())
    }
}

/// Link-local (cloud metadata is 169.254.169.254, fe80::/10), unspecified, CGNAT (100.64.0.0/10, Alibaba metadata),
/// AWS IPv6 metadata (fd00:ec2::/32) and NAT64 (64:ff9b::/96, checked as the IPv4 it embeds) addresses are refused (RUST-10).
/// Loopback and private LAN stay allowed: local calendar servers are legitimate.
fn blocked(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_link_local() || v4.is_unspecified() || (v4.octets()[0] == 100 && v4.octets()[1] & 0xc0 == 64),
        IpAddr::V6(v6) => {
            let s = v6.segments();
            let nat64 = s[..2] == [0x64, 0xff9b] && s[2..6] == [0; 4];
            v6.is_unspecified()
                || (s[0] & 0xffc0) == 0xfe80
                || s[..2] == [0xfd00, 0x0ec2]
                || v6.to_ipv4_mapped().is_some_and(|v4: Ipv4Addr| blocked(IpAddr::V4(v4)))
                || (nat64 && blocked(IpAddr::V4(Ipv4Addr::new((s[6] >> 8) as u8, s[6] as u8, (s[7] >> 8) as u8, s[7] as u8))))
        }
    }
}

/// Resolves host names and drops blocked addresses, so every connection (redirects included) is checked.
struct Guard;

impl Resolve for Guard {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let found = tauri::async_runtime::spawn_blocking(move || (host.as_str(), 0).to_socket_addrs().map(Iterator::collect::<Vec<SocketAddr>>))
                .await??;
            let ok: Vec<SocketAddr> = found.into_iter().filter(|a| !blocked(a.ip())).collect();
            if ok.is_empty() {
                return Err("that address is not allowed".into());
            }
            Ok(Box::new(ok.into_iter()) as Addrs)
        })
    }
}

/// IP-literal hosts skip the resolver, so they are checked on their own.
fn literal_blocked(url: &reqwest::Url) -> bool {
    url.host_str().and_then(|h| h.trim_matches(['[', ']']).parse::<IpAddr>().ok()).is_some_and(blocked)
}

#[tauri::command]
pub async fn fetch_ics(url: String) -> Result<String, String> {
    let url = feed_url(&url)?;
    if literal_blocked(&reqwest::Url::parse(&url).map_err(|e| e.to_string())?) {
        return Err("That calendar address is not allowed".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .dns_resolver(std::sync::Arc::new(Guard))
        // No https -> http downgrade on redirect.
        .redirect(reqwest::redirect::Policy::custom(|a| {
            if a.previous().len() >= 5 || literal_blocked(a.url()) || (a.previous().last().is_some_and(|u| u.scheme() == "https") && a.url().scheme() != "https") {
                a.stop()
            } else {
                a.follow()
            }
        })).build().map_err(|e| e.to_string())?;
    // The error text must not echo the URL: private feed addresses carry a secret token.
    let net = |e: reqwest::Error| format!("Couldn't reach the calendar ({})", e.without_url());
    let mut resp = client.get(url).send().await.map_err(net)?;
    if !resp.status().is_success() {
        return Err("The calendar server didn't return a calendar".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(net)? {
        if body.len() + chunk.len() > MAX_BYTES {
            return Err("The calendar is larger than 10 MB".into());
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).ok().filter(|t| looks_like_ics(t)).ok_or_else(|| "The calendar server didn't return a calendar".into())
}

/// Only iCalendar text goes back to the webview (not whatever an internal host answered with).
fn looks_like_ics(text: &str) -> bool {
    text.trim_start_matches('\u{feff}').trim_start().starts_with("BEGIN:VCALENDAR")
}

#[cfg(test)]
mod tests {
    use super::{blocked, feed_url, looks_like_ics};
    use std::net::IpAddr;

    #[test]
    fn blocks_link_local_and_unspecified_only() {
        let b = |s: &str| blocked(s.parse::<IpAddr>().unwrap());
        assert!(b("169.254.169.254") && b("fe80::1") && b("0.0.0.0") && b("::") && b("::ffff:169.254.1.1"));
        assert!(b("100.100.100.200") && b("100.64.0.1") && b("100.127.255.255") && b("fd00:ec2::254") && b("64:ff9b::a9fe:a9fe") && b("64:ff9b::6464:64c8"));
        assert!(!b("100.63.255.255") && !b("100.128.0.1") && !b("64:ff9b::808:808") && !b("fd00:ec3::1"));
        assert!(!b("127.0.0.1") && !b("::1") && !b("192.168.1.5") && !b("10.0.0.2") && !b("8.8.8.8"));
    }

    #[test]
    fn only_icalendar_bodies() {
        assert!(looks_like_ics("BEGIN:VCALENDAR\r\n") && looks_like_ics("\u{feff}\n BEGIN:VCALENDAR"));
        assert!(!looks_like_ics("{\"token\":\"x\"}") && !looks_like_ics("<html>BEGIN:VCALENDAR"));
    }

    #[test]
    fn schemes() {
        assert_eq!(feed_url(" webcal://a.b/c.ics ").unwrap(), "https://a.b/c.ics");
        assert_eq!(feed_url("HTTPS://a.b/c").unwrap(), "HTTPS://a.b/c");
        assert!(feed_url("file:///etc/passwd").is_err());
        assert!(feed_url("a.b/c.ics").is_err());
    }
}
