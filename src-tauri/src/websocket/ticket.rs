//! 连接聊天 WebSocket 前，用 token 换一张一次性 ticket（服务端 60 秒内有效、用一次即作废），
//! 连接地址里只带 ticket，不再带长期有效的 token。地址会出现在代理和服务器日志里，
//! 泄露的 ticket 已经用过或过期，没有用处
use serde::Deserialize;
use std::time::Duration;
use tracing::warn;
use url::Url;

/// 换 ticket 的请求要给握手留出时间（握手总共 15 秒）
const TICKET_TIMEOUT_SECS: u64 = 6;

#[derive(Deserialize)]
struct TicketEnvelope {
    code: Option<i64>,
    data: Option<TicketData>,
}

#[derive(Deserialize)]
struct TicketData {
    ticket: Option<String>,
}

/// wss://host/api/im/ws -> https://host/api/im/ws/ticket
pub fn ticket_url(server_url: &Url) -> Option<Url> {
    let mut url = server_url.clone();
    let scheme = match url.scheme() {
        "wss" => "https",
        "ws" => "http",
        _ => return None,
    };
    url.set_scheme(scheme).ok()?;
    url.set_query(None);
    let path = format!("{}/ticket", url.path().trim_end_matches('/'));
    url.set_path(&path);
    Some(url)
}

/// 取一张 ticket；失败（网络、旧版服务端没有这个接口）时返回 None，由调用方退回旧的 Token 参数
pub async fn fetch_ticket(server_url: &Url, token: &str) -> Option<String> {
    let url = ticket_url(server_url)?;
    let client = reqwest::Client::builder()
        .proxy(super::proxy::reqwest_proxy())
        .timeout(Duration::from_secs(TICKET_TIMEOUT_SECS))
        .build()
        .ok()?;
    let response = match client.post(url).header("token", token).send().await {
        Ok(response) => response,
        Err(e) => {
            warn!("WebSocket ticket request failed: {}", e);
            return None;
        }
    };
    let envelope = response.json::<TicketEnvelope>().await.ok()?;
    if envelope.code != Some(200) {
        warn!("WebSocket ticket refused: code {:?}", envelope.code);
        return None;
    }
    envelope.data?.ticket.filter(|t| !t.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ticket_url_follows_the_socket_url() {
        let url = Url::parse("wss://mail.smjtools.com/api/im/ws?clientId=a").unwrap();
        assert_eq!(
            ticket_url(&url).unwrap().as_str(),
            "https://mail.smjtools.com/api/im/ws/ticket"
        );
        let local = Url::parse("ws://127.0.0.1:3000/api/im/ws/").unwrap();
        assert_eq!(
            ticket_url(&local).unwrap().as_str(),
            "http://127.0.0.1:3000/api/im/ws/ticket"
        );
        assert!(ticket_url(&Url::parse("https://x/api/im/ws").unwrap()).is_none());
    }
}
