//! 让 WebSocket 和 HTTP 请求一样走系统代理
//!
//! reqwest 会读 HTTPS_PROXY 等环境变量和 Windows 的系统代理，tokio-tungstenite 不会，
//! 开着系统代理的电脑上 WebSocket 因此绕开代理直连服务器。这里按同样的来源找出代理，
//! 用 HTTP CONNECT 建一条到服务器的隧道，TLS 和 WebSocket 升级在隧道里进行。

use base64::Engine;
use std::io;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use url::{Host, Url};

/// 代理回应 CONNECT 的头部上限
const MAX_RESPONSE_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProxyConfig {
    pub host: String,
    pub port: u16,
    /// Proxy-Authorization 的值（代理地址里带了用户名密码时）
    pub authorization: Option<String>,
    /// 代理设置从哪里读到的，写日志用
    pub source: &'static str,
}

impl ProxyConfig {
    pub fn address(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

/// 找出访问这个地址应走的 HTTP 代理；没有代理或地址在绕过列表里时返回 None
pub fn system_proxy_for(url: &Url) -> Option<ProxyConfig> {
    let host = url
        .host_str()?
        .trim_start_matches('[')
        .trim_end_matches(']');
    let secure = url.scheme() == "wss" || url.scheme() == "https";

    let env_names: &[&str] = if secure {
        &["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]
    } else {
        &["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]
    };
    let from_env = env_names.iter().find_map(|name| {
        std::env::var(name)
            .ok()
            .filter(|value| !value.trim().is_empty())
    });
    if let Some(value) = from_env {
        let no_proxy = std::env::var("NO_PROXY")
            .or_else(|_| std::env::var("no_proxy"))
            .unwrap_or_default();
        if bypassed_by_no_proxy(host, &no_proxy) {
            return None;
        }
        return parse_proxy_url(&value, "environment");
    }

    windows_proxy(host, secure)
}

/// 经代理建一条到 host:port 的隧道
pub async fn tunnel(proxy: &ProxyConfig, url: &Url) -> io::Result<TcpStream> {
    let port = url
        .port_or_known_default()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "URL has no port"))?;
    let authority = match url.host() {
        Some(Host::Ipv6(ip)) => format!("[{ip}]:{port}"),
        Some(host) => format!("{host}:{port}"),
        None => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "URL has no host",
            ));
        }
    };

    let mut stream = TcpStream::connect((proxy.host.as_str(), proxy.port)).await?;
    let _ = stream.set_nodelay(true);
    let mut request = format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n");
    if let Some(ref authorization) = proxy.authorization {
        request.push_str(&format!("Proxy-Authorization: {authorization}\r\n"));
    }
    request.push_str("\r\n");
    stream.write_all(request.as_bytes()).await?;

    // 代理回完头部后不会再发数据，直到我们开始 TLS，所以按块读到空行即可
    let mut response = Vec::with_capacity(256);
    let mut chunk = [0u8; 512];
    loop {
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "proxy closed the connection during CONNECT",
            ));
        }
        response.extend_from_slice(&chunk[..read]);
        if response.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if response.len() > MAX_RESPONSE_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "proxy response to CONNECT is too long",
            ));
        }
    }

    let status_line = response
        .split(|byte| *byte == b'\n')
        .next()
        .map(|line| String::from_utf8_lossy(line).trim().to_string())
        .unwrap_or_default();
    if connect_succeeded(&status_line) {
        Ok(stream)
    } else {
        Err(io::Error::other(format!(
            "proxy refused CONNECT: {status_line}"
        )))
    }
}

fn connect_succeeded(status_line: &str) -> bool {
    let mut parts = status_line.split_whitespace();
    matches!(parts.next(), Some(version) if version.starts_with("HTTP/1."))
        && matches!(parts.next(), Some(code) if code.len() == 3 && code.starts_with('2'))
}

/// 解析 http://user:pass@host:port 或 host:port；SOCKS 等其他协议不支持，返回 None
fn parse_proxy_url(value: &str, source: &'static str) -> Option<ProxyConfig> {
    let value = value.trim();
    let with_scheme = if value.contains("://") {
        value.to_string()
    } else {
        format!("http://{value}")
    };
    let url = Url::parse(&with_scheme).ok()?;
    if url.scheme() != "http" {
        return None;
    }
    let host = url
        .host_str()?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let port = url.port().unwrap_or(80);
    let authorization = if url.username().is_empty() {
        None
    } else {
        let user = percent_decode(url.username());
        let password = percent_decode(url.password().unwrap_or(""));
        let encoded =
            base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}"));
        Some(format!("Basic {encoded}"))
    };
    Some(ProxyConfig {
        host,
        port,
        authorization,
        source,
    })
}

fn percent_decode(value: &str) -> String {
    url::form_urlencoded::parse(format!("x={value}").as_bytes())
        .next()
        .map(|(_, decoded)| decoded.into_owned())
        .unwrap_or_else(|| value.to_string())
}

/// NO_PROXY：逗号分隔；`*` 表示全部；`example.com` 和 `.example.com` 都匹配它和它的子域名
fn bypassed_by_no_proxy(host: &str, no_proxy: &str) -> bool {
    let host = host.to_ascii_lowercase();
    no_proxy
        .split(',')
        .map(|entry| entry.trim().to_ascii_lowercase())
        .filter(|entry| !entry.is_empty())
        .any(|entry| {
            if entry == "*" {
                return true;
            }
            let entry = entry.trim_start_matches("*.").trim_start_matches('.');
            host == entry || host.ends_with(&format!(".{entry}"))
        })
}

/// Windows 系统代理的 ProxyServer：`host:port`，或 `http=host:port;https=host:port;socks=...`
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn parse_windows_proxy_server(value: &str, secure: bool) -> Option<ProxyConfig> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    if !value.contains('=') {
        return parse_proxy_url(value, "Windows system proxy");
    }
    let wanted: &[&str] = if secure {
        &["https", "http"]
    } else {
        &["http"]
    };
    wanted.iter().find_map(|scheme| {
        value.split(';').find_map(|part| {
            let (key, address) = part.split_once('=')?;
            if key.trim().eq_ignore_ascii_case(scheme) {
                let address = address.trim();
                // 按协议分的写法里地址本身不带 scheme，个别工具会写成 http://host:port
                let address = address.strip_prefix("http://").unwrap_or(address);
                parse_proxy_url(address, "Windows system proxy")
            } else {
                None
            }
        })
    })
}

/// Windows 的 ProxyOverride：分号分隔，可带 `*` 通配；`<local>` 表示不含点的主机名
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn bypassed_by_override(host: &str, overrides: &str) -> bool {
    let host = host.to_ascii_lowercase();
    overrides
        .split(';')
        .map(|entry| entry.trim().to_ascii_lowercase())
        .filter(|entry| !entry.is_empty())
        .any(|entry| {
            if entry == "<local>" {
                return !host.contains('.') && !host.contains(':');
            }
            let entry = entry
                .strip_prefix("https://")
                .or_else(|| entry.strip_prefix("http://"))
                .unwrap_or(&entry);
            wildcard_match(entry, &host)
        })
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn wildcard_match(pattern: &str, text: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let text: Vec<char> = text.chars().collect();
    let (mut p, mut t) = (0, 0);
    let (mut star, mut mark) = (None, 0);
    while t < text.len() {
        if p < pattern.len() && (pattern[p] == '?' || pattern[p] == text[t]) {
            p += 1;
            t += 1;
        } else if p < pattern.len() && pattern[p] == '*' {
            star = Some(p);
            mark = t;
            p += 1;
        } else if let Some(star_at) = star {
            p = star_at + 1;
            mark += 1;
            t = mark;
        } else {
            return false;
        }
    }
    pattern[p..].iter().all(|c| *c == '*')
}

#[cfg(target_os = "windows")]
fn windows_proxy(host: &str, secure: bool) -> Option<ProxyConfig> {
    let key = windows_registry::CURRENT_USER
        .open(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
        .ok()?;
    if key.get_u32("ProxyEnable").ok()? == 0 {
        return None;
    }
    let server = key.get_string("ProxyServer").ok()?;
    let overrides = key.get_string("ProxyOverride").unwrap_or_default();
    if bypassed_by_override(host, &overrides) {
        return None;
    }
    parse_windows_proxy_server(&server, secure)
}

#[cfg(not(target_os = "windows"))]
fn windows_proxy(_host: &str, _secure: bool) -> Option<ProxyConfig> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_proxy_urls() {
        let proxy = parse_proxy_url("http://127.0.0.1:10808", "environment").unwrap();
        assert_eq!(proxy.address(), "127.0.0.1:10808");
        assert_eq!(proxy.authorization, None);

        let proxy = parse_proxy_url("127.0.0.1:10809/", "environment").unwrap();
        assert_eq!(proxy.address(), "127.0.0.1:10809");

        let proxy = parse_proxy_url("http://user:p%40ss@proxy.lan:3128", "environment").unwrap();
        assert_eq!(proxy.address(), "proxy.lan:3128");
        assert_eq!(
            proxy.authorization.as_deref(),
            Some("Basic dXNlcjpwQHNz") // user:p@ss
        );

        assert_eq!(
            parse_proxy_url("socks5://127.0.0.1:10808", "environment"),
            None
        );
    }

    #[test]
    fn parses_windows_proxy_server() {
        let proxy = parse_windows_proxy_server("127.0.0.1:10808", true).unwrap();
        assert_eq!(proxy.address(), "127.0.0.1:10808");

        let per_scheme = "http=127.0.0.1:8080;https=127.0.0.1:8443;socks=127.0.0.1:1080";
        assert_eq!(
            parse_windows_proxy_server(per_scheme, true)
                .unwrap()
                .address(),
            "127.0.0.1:8443"
        );
        assert_eq!(
            parse_windows_proxy_server(per_scheme, false)
                .unwrap()
                .address(),
            "127.0.0.1:8080"
        );
        assert_eq!(
            parse_windows_proxy_server("http=127.0.0.1:8080", true)
                .unwrap()
                .address(),
            "127.0.0.1:8080"
        );
        assert_eq!(
            parse_windows_proxy_server("socks=127.0.0.1:1080", true),
            None
        );
    }

    #[test]
    fn honours_bypass_lists() {
        let overrides = "localhost;127.*;10.*;192.168.*;*.lan;<local>";
        assert!(bypassed_by_override("localhost", overrides));
        assert!(bypassed_by_override("192.168.1.20", overrides));
        assert!(bypassed_by_override("nas.lan", overrides));
        assert!(bypassed_by_override("intranet", overrides));
        assert!(!bypassed_by_override("mail.smjtools.com", overrides));
        assert!(bypassed_by_override("mail.smjtools.com", "*.smjtools.com"));

        assert!(bypassed_by_no_proxy(
            "mail.smjtools.com",
            "localhost, smjtools.com"
        ));
        assert!(bypassed_by_no_proxy("mail.smjtools.com", ".smjtools.com"));
        assert!(bypassed_by_no_proxy("anything", "*"));
        assert!(!bypassed_by_no_proxy(
            "mail.smjtools.com",
            "localhost,127.0.0.1"
        ));
        assert!(!bypassed_by_no_proxy("notsmjtools.com", "smjtools.com"));
    }

    #[test]
    fn checks_the_connect_status() {
        assert!(connect_succeeded("HTTP/1.1 200 Connection established"));
        assert!(connect_succeeded("HTTP/1.0 200"));
        assert!(!connect_succeeded(
            "HTTP/1.1 407 Proxy Authentication Required"
        ));
        assert!(!connect_succeeded("SSH-2.0-OpenSSH"));
    }
}
