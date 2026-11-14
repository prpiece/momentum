//! Fetching calendar subscription feeds (v1.3). The webview can't: CORS and the CSP block it.
use std::time::Duration;

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

#[tauri::command]
pub async fn fetch_ics(url: String) -> Result<String, String> {
    let url = feed_url(&url)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).build().map_err(|e| e.to_string())?;
    // The error text must not echo the URL: private feed addresses carry a secret token.
    let net = |e: reqwest::Error| format!("Couldn't reach the calendar ({})", e.without_url());
    let mut resp = client.get(url).send().await.map_err(net)?;
    if !resp.status().is_success() {
        return Err(format!("The calendar server answered {}", resp.status()));
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(net)? {
        if body.len() + chunk.len() > MAX_BYTES {
            return Err("The calendar is larger than 10 MB".into());
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map_err(|_| "The calendar isn't text".into())
}

#[cfg(test)]
mod tests {
    use super::feed_url;

    #[test]
    fn schemes() {
        assert_eq!(feed_url(" webcal://a.b/c.ics ").unwrap(), "https://a.b/c.ics");
        assert_eq!(feed_url("HTTPS://a.b/c").unwrap(), "HTTPS://a.b/c");
        assert!(feed_url("file:///etc/passwd").is_err());
        assert!(feed_url("a.b/c.ics").is_err());
    }
}
