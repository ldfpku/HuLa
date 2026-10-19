//! 建立 WebSocket 的 TCP 连接
//!
//! 系统设了 HTTP 代理时先经代理建隧道（与 reqwest 的 HTTP 请求走同一条路），
//! 代理不可用时回退直连。直连按 RFC 8305 Happy Eyeballs 的简化做法：
//! tokio-tungstenite 的 connect_async 用 `TcpStream::connect` 逐个尝试解析出的地址，
//! 前一个地址不失败就不会试下一个，某一类地址不通时每个都要等系统的 TCP 超时
//! （Windows 约 21 秒）。这里两类地址交替排列，每隔一小段时间并行发起下一个，用最先连上的那个。

use super::proxy::{system_proxy_for, tunnel};
use futures_util::stream::{FuturesUnordered, StreamExt};
use std::io;
use std::net::SocketAddr;
use tokio::net::{TcpStream, lookup_host};
use tokio::time::{Duration, Instant, sleep_until, timeout};
use tracing::warn;
use url::{Host, Url};

/// 前一个地址还没有结果时，隔多久并行尝试下一个地址
const ATTEMPT_DELAY_MS: u64 = 250;

/// 经代理建隧道最多等多久，超过就回退直连（整个握手仍受 15 秒超时约束）
const PROXY_TIMEOUT_SECS: u64 = 5;

/// 连上的 TCP 连接，以及走的是哪条路（写日志用）
pub struct Dialed {
    pub stream: TcpStream,
    pub route: String,
}

/// 按 URL 的主机和端口建立 TCP 连接：有系统代理先走代理，不行再直连
pub async fn dial(url: &Url) -> io::Result<Dialed> {
    if let Some(proxy) = system_proxy_for(url) {
        let address = proxy.address();
        match timeout(Duration::from_secs(PROXY_TIMEOUT_SECS), tunnel(&proxy, url)).await {
            Ok(Ok(stream)) => {
                return Ok(Dialed {
                    stream,
                    route: format!("proxy {} ({})", address, proxy.source),
                });
            }
            Ok(Err(error)) => warn!(
                "WebSocket proxy {} ({}) failed, connecting directly: {}",
                address, proxy.source, error
            ),
            Err(_) => warn!(
                "WebSocket proxy {} ({}) did not answer in {}s, connecting directly",
                address, proxy.source, PROXY_TIMEOUT_SECS
            ),
        }
    }
    dial_direct(url).await
}

async fn dial_direct(url: &Url) -> io::Result<Dialed> {
    let port = url
        .port_or_known_default()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "URL has no port"))?;
    let addrs: Vec<SocketAddr> = match url.host() {
        Some(Host::Domain(domain)) => lookup_host((domain, port)).await?.collect(),
        Some(Host::Ipv4(ip)) => vec![SocketAddr::new(ip.into(), port)],
        Some(Host::Ipv6(ip)) => vec![SocketAddr::new(ip.into(), port)],
        None => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "URL has no host",
            ));
        }
    };
    let resolved = addrs.len();
    let (stream, addr) = race(interleave(addrs)).await?;
    Ok(Dialed {
        stream,
        route: format!("direct {} ({} addresses)", addr, resolved),
    })
}

/// 两类地址交替排列，第一个地址的类型排在前面（尊重系统的地址优先顺序）
fn interleave(addrs: Vec<SocketAddr>) -> Vec<SocketAddr> {
    let Some(first) = addrs.first() else {
        return addrs;
    };
    let first_is_v6 = first.is_ipv6();
    let (mut preferred, mut other): (Vec<_>, Vec<_>) = addrs
        .into_iter()
        .partition(|addr| addr.is_ipv6() == first_is_v6);
    preferred.reverse();
    other.reverse();
    let mut ordered = Vec::with_capacity(preferred.len() + other.len());
    loop {
        match (preferred.pop(), other.pop()) {
            (None, None) => break,
            (a, b) => ordered.extend(a.into_iter().chain(b)),
        }
    }
    ordered
}

/// 依次错开发起连接，返回最先成功的；全部失败时返回最后一个错误
async fn race(addrs: Vec<SocketAddr>) -> io::Result<(TcpStream, SocketAddr)> {
    let mut pending = addrs.into_iter();
    let mut attempts = FuturesUnordered::new();
    let mut last_error: Option<io::Error> = None;

    let start = |attempts: &mut FuturesUnordered<_>, addr: SocketAddr| {
        attempts.push(async move { (addr, TcpStream::connect(addr).await) });
    };

    match pending.next() {
        Some(addr) => start(&mut attempts, addr),
        None => {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "host resolved to no addresses",
            ));
        }
    }
    let mut next_at = Instant::now() + Duration::from_millis(ATTEMPT_DELAY_MS);

    loop {
        let has_more = !pending.as_slice().is_empty();
        tokio::select! {
            Some((addr, result)) = attempts.next() => match result {
                Ok(stream) => return Ok((stream, addr)),
                Err(error) => {
                    last_error = Some(error);
                    // 一个地址明确失败了，不必再等，马上试下一个
                    if let Some(addr) = pending.next() {
                        start(&mut attempts, addr);
                        next_at = Instant::now() + Duration::from_millis(ATTEMPT_DELAY_MS);
                    } else if attempts.is_empty() {
                        break;
                    }
                }
            },
            _ = sleep_until(next_at), if has_more => {
                if let Some(addr) = pending.next() {
                    start(&mut attempts, addr);
                }
                next_at = Instant::now() + Duration::from_millis(ATTEMPT_DELAY_MS);
            }
            else => break,
        }
    }

    Err(last_error
        .unwrap_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "no address connected")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn addr(s: &str) -> SocketAddr {
        s.parse().unwrap()
    }

    #[test]
    fn interleaves_families_starting_with_the_first() {
        let ordered = interleave(vec![
            addr("[2606:4700::1]:443"),
            addr("[2606:4700::2]:443"),
            addr("104.21.0.1:443"),
            addr("172.67.0.1:443"),
        ]);
        assert_eq!(
            ordered,
            vec![
                addr("[2606:4700::1]:443"),
                addr("104.21.0.1:443"),
                addr("[2606:4700::2]:443"),
                addr("172.67.0.1:443"),
            ]
        );
    }

    #[test]
    fn keeps_a_single_family_in_order() {
        let ordered = interleave(vec![addr("10.0.0.1:443"), addr("10.0.0.2:443")]);
        assert_eq!(ordered, vec![addr("10.0.0.1:443"), addr("10.0.0.2:443")]);
    }
}
