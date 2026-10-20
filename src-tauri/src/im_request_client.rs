use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use base64::{Engine, prelude::BASE64_STANDARD};
use reqwest::header;
use serde_json::json;
use tracing::error;

use crate::{
    pojo::common::ApiResult,
    vo::vo::{LoginReq, LoginResp},
};

/// 连不上服务器时最多等多久
const CONNECT_TIMEOUT_SECS: u64 = 10;

/// 一个接口请求最多等多久。请求卡住时不能无限期占着调用方
const REQUEST_TIMEOUT_SECS: u64 = 30;

/// 最近一次刷新：用哪个 refresh token 换来了哪一对新 token
#[derive(Debug)]
struct RefreshRecord {
    from_refresh_token: String,
    token: String,
    refresh_token: String,
}

/// 可以克隆：调用方在锁里克隆一份，放开锁再发请求，慢请求就不会挡住其他请求。
/// 刷新 token 经 `refresh_gate` 串行，服务端换发后旧的 refresh token 立即作废，
/// 同一个 refresh token 只能用一次，其余副本直接取用换来的新 token
#[derive(Debug, Clone)]
pub struct ImRequestClient {
    client: reqwest::Client,
    base_url: String,
    pub token: Option<String>,
    pub refresh_token: Option<String>,
    refresh_gate: Arc<tokio::sync::Mutex<Option<RefreshRecord>>>,
}

impl ImRequestClient {
    pub fn new(base_url: String) -> Result<Self, anyhow::Error> {
        let mut headers = header::HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static("application/json"),
        );
        // 凭证不再硬编码：优先从环境变量 HULA_IM_BASIC_AUTH (格式 user:pass) 读取
        let credentials = std::env::var("HULA_IM_BASIC_AUTH").unwrap_or_else(|_| {
            tracing::warn!(
                "HULA_IM_BASIC_AUTH not set; falling back to in-source default credentials (insecure). Override via env in production."
            );
            "luohuo_web_pro:luohuo_web_pro_secret".to_string()
        });
        let basic_auth = BASE64_STANDARD.encode(credentials);
        let basic_auth_value = header::HeaderValue::from_str(&basic_auth)
            .map_err(|e| anyhow::anyhow!("Failed to create HTTP client: {}", e))?;
        headers.insert(header::AUTHORIZATION, basic_auth_value);

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .proxy(crate::websocket::proxy::reqwest_proxy())
            .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to create HTTP client: {}", e))?;

        Ok(Self {
            client: client,
            base_url: base_url,
            token: None,
            refresh_token: None,
            refresh_gate: Arc::new(tokio::sync::Mutex::new(None)),
        })
    }

    pub fn set_base_url(&mut self, base_url: String) {
        self.base_url = base_url;
    }

    /// 构建请求的公共方法（不发送请求）
    ///
    /// 提取了 URL 构建、token 添加、body/params 处理等公共逻辑
    ///
    /// # 参数
    /// - `method`: HTTP 方法
    /// - `path`: API 路径
    /// - `body`: 请求体（可选）
    /// - `params`: 查询参数（可选）
    /// - `extra_headers`: 额外的请求头（可选）
    fn build_request<B: serde::Serialize, C: serde::Serialize>(
        &self,
        method: http::Method,
        path: &str,
        body: &Option<B>,
        params: &Option<C>,
        extra_headers: Option<Vec<(&str, &str)>>,
    ) -> reqwest::RequestBuilder {
        let url = format!("{}/{}", self.base_url, path);
        let mut request_builder = self.client.request(method, &url);

        // 设置 token 请求头
        if let Some(token) = &self.token {
            request_builder = request_builder.header("token", token);
        }

        // 添加额外的请求头
        if let Some(headers) = extra_headers {
            for (key, value) in headers {
                request_builder = request_builder.header(key, value);
            }
        }

        // 设置请求体
        if let Some(body) = body {
            request_builder = request_builder.json(body);
        } else {
            request_builder = request_builder.json(&serde_json::json!({}));
        }

        // 设置查询参数
        if let Some(params) = params {
            request_builder = request_builder.query(params);
        }

        request_builder
    }

    pub async fn request<
        T: serde::de::DeserializeOwned,
        B: serde::Serialize,
        C: serde::Serialize,
    >(
        &mut self,
        method: http::Method,
        path: &str,
        body: Option<B>,
        params: Option<C>,
    ) -> Result<ApiResult<T>, anyhow::Error> {
        let mut retry_count = 0;
        const MAX_RETRY_COUNT: u8 = 2;
        let is_logout = path == ImUrl::Logout.get_url().1;

        loop {
            // 使用 build_request 构建请求
            let request_builder = self
                .build_request(method.clone(), path, &body, &params, None)
                .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS));

            // 发送请求，区分网络错误和业务错误
            let response = request_builder
                .send()
                .await
                .map_err(|e| anyhow::anyhow!("network_error: {}", e))?;
            let result: ApiResult<T> = response
                .json()
                .await
                .map_err(|e| anyhow::anyhow!("network_error: {}", e))?;

            let url = format!("{}/{}", self.base_url, path);

            match result.code {
                Some(406) => {
                    if is_logout {
                        return Ok(result);
                    }
                    if retry_count >= MAX_RETRY_COUNT {
                        return Err(anyhow::anyhow!("token过期，刷新token失败"));
                    }
                    self.start_refresh_token().await?;
                    retry_count += 1;
                    continue;
                }
                Some(401) => {
                    if is_logout {
                        return Ok(result);
                    }
                    error!(
                        "{}; 方法: {}; 失败信息: {}",
                        &url,
                        method,
                        result.msg.clone().unwrap_or_default()
                    );
                    return Err(anyhow::anyhow!("请重新登录"));
                }
                Some(200) => {
                    return Ok(result);
                }
                _ => {
                    error!(
                        "{}; 方法: {}; 失败信息: {}",
                        &url,
                        method,
                        result.msg.clone().unwrap_or_default()
                    );
                    return Err(anyhow::anyhow!(
                        "{}",
                        result.msg.clone().unwrap_or_default()
                    ));
                }
            }
        }
    }

    /// 流式请求方法（用于 SSE 等流式响应）
    ///
    /// 与 `request` 方法的区别：
    /// 1. 添加 `Accept: text/event-stream` 请求头
    /// 2. 返回 `reqwest::Response` 而不是解析 JSON
    /// 3. 不支持自动 token 刷新重试（因为流式响应无法中断重试）
    ///
    /// # 参数
    /// - `method`: HTTP 方法
    /// - `path`: API 路径
    /// - `body`: 请求体（可选）
    /// - `params`: 查询参数（可选）
    ///
    /// # 返回
    /// - `Ok(Response)`: 成功返回响应对象，可用于读取流式数据
    /// - `Err`: 请求失败或状态码非 2xx
    pub async fn request_stream<B: serde::Serialize, C: serde::Serialize>(
        &mut self,
        method: http::Method,
        path: &str,
        body: Option<B>,
        params: Option<C>,
    ) -> Result<reqwest::Response, anyhow::Error> {
        // 添加流式请求头
        let extra_headers = Some(vec![("Accept", "text/event-stream")]);

        // 使用 build_request 构建请求
        let request_builder =
            self.build_request(method.clone(), path, &body, &params, extra_headers);

        // 发送请求
        let response = request_builder.send().await?;

        // 检查响应状态（但不解析 JSON）
        let status = response.status();
        if !status.is_success() {
            let url = format!("{}/{}", self.base_url, path);
            error!("流式请求失败，URL: {}, 状态码: {}", url, status);

            // 根据状态码返回不同的错误信息
            match status.as_u16() {
                406 => {
                    error!("Token expired in stream request");
                    return Err(anyhow::anyhow!("token过期，请刷新后重试"));
                }
                401 => {
                    error!("Unauthorized in stream request");
                    return Err(anyhow::anyhow!("请重新登录"));
                }
                _ => {
                    return Err(anyhow::anyhow!("请求失败，状态码: {}", status));
                }
            }
        }

        Ok(response)
    }

    pub async fn start_refresh_token(&mut self) -> Result<(), anyhow::Error> {
        let url = format!("{}/{}", self.base_url, ImUrl::RefreshToken.get_url().1);

        let refresh_token = match self.refresh_token.clone() {
            Some(token) if !token.is_empty() => token,
            _ => return Err(anyhow::anyhow!("请重新登录")),
        };
        let old_refresh_token = refresh_token.clone();

        // 同一时间只刷新一次；这个 refresh token 已经被别的请求换过时，直接用换来的新 token
        let mut gate = self.refresh_gate.lock().await;
        if let Some(record) = gate.as_ref() {
            if record.from_refresh_token == refresh_token {
                self.token = Some(record.token.clone());
                self.refresh_token = Some(record.refresh_token.clone());
                return Ok(());
            }
        }

        let body = json!({
          "refreshToken": refresh_token
        });

        let request_builder = self
            .client
            .request(http::Method::POST, &url)
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS));
        let response = request_builder
            .json(&body)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("network_error: {}", e))?;
        let result: ApiResult<serde_json::Value> = response
            .json()
            .await
            .map_err(|e| anyhow::anyhow!("network_error: {}", e))?;

        if !result.success {
            // 服务器明确拒绝 refresh token，需要重新登录
            return Err(anyhow::anyhow!("请重新登录"));
        }

        let data = match result.data {
            Some(data) => data,
            None => {
                error!("刷新token失败: 响应缺少 data 字段");
                return Err(anyhow::anyhow!("请重新登录"));
            }
        };

        let token = match data.get("token").and_then(|value| value.as_str()) {
            Some(value) => value,
            None => {
                error!("刷新token失败: 响应缺少 token 字段");
                return Err(anyhow::anyhow!("请重新登录"));
            }
        };
        self.token = Some(token.to_owned());

        let refresh_token = match data.get("refreshToken").and_then(|value| value.as_str()) {
            Some(value) if !value.is_empty() => value.to_owned(),
            _ => old_refresh_token.clone(),
        };
        self.refresh_token = Some(refresh_token.clone());
        *gate = Some(RefreshRecord {
            from_refresh_token: old_refresh_token,
            token: token.to_owned(),
            refresh_token,
        });

        Ok(())
    }

    /// 把副本请求期间刷新得到的 token 写回本对象。
    /// `used_refresh_token` 是取副本时的 refresh token：本对象之后已换成别的（重新登录等）就不覆盖
    pub fn adopt_refreshed_tokens(
        &mut self,
        used_refresh_token: &Option<String>,
        copy: &ImRequestClient,
    ) -> bool {
        if &self.refresh_token != used_refresh_token {
            return false;
        }
        if self.token == copy.token && self.refresh_token == copy.refresh_token {
            return false;
        }
        self.token = copy.token.clone();
        self.refresh_token = copy.refresh_token.clone();
        true
    }

    pub async fn im_request<
        T: serde::de::DeserializeOwned,
        B: serde::Serialize,
        C: serde::Serialize,
    >(
        &mut self,
        url: ImUrl,
        body: Option<B>,
        params: Option<C>,
    ) -> Result<Option<T>, anyhow::Error> {
        let (method, path) = url.get_url();
        let result: ApiResult<T> = self.request(method, path, body, params).await?;
        Ok(result.data)
    }
}

impl ImRequest for ImRequestClient {
    async fn login(&mut self, login_req: LoginReq) -> Result<Option<LoginResp>, anyhow::Error> {
        let result: Option<LoginResp> = self
            .im_request(ImUrl::Login, Some(login_req), None::<serde_json::Value>)
            .await?;

        if let Some(data) = result.clone() {
            self.token = Some(data.token.clone());
            self.refresh_token = Some(data.refresh_token.clone());
        }

        Ok(result)
    }
}

pub enum ImUrl {
    Login,
    RefreshToken,
    ForgetPassword,
    CheckToken,
    Logout,
    Register,
    GetQiniuToken,
    InitConfig,
    StorageProvider,
    MailSso,
    MailUnread,
    RoomMailbox,
    RoomMailboxEnable,
    RoomMailboxDisable,
    UnifiedSearch,
    RoomFiles,
    RoomFileRemove,
    RoomFileSaveToDrive,
    RoomFileFromDrive,
    DriveItems,
    AiSummary,
    AiMailTodo,
    TodoList,
    TodoCreate,
    TodoUpdate,
    TodoDelete,
    MapCoordTranslate,
    MapReverseGeocode,
    MapStatic,
    GetAssistantModelList,
    SendCaptcha,
    GetCaptcha,
    Announcement,
    EditAnnouncement,
    DeleteAnnouncement,
    PushAnnouncement,
    GetAnnouncementList,
    ApplyGroup,
    SearchGroup,
    UpdateMyRoomInfo,
    UpdateRoomInfo,
    GroupList,
    GroupListMember,
    GroupDetail,
    GroupInfo,
    RevokeAdmin,
    AddAdmin,
    ExitGroup,
    AcceptInvite,
    InviteList,
    InviteGroupMember,
    RemoveGroupMember,
    CreateGroup,
    Shield,
    Notification,
    DeleteSession,
    SetSessionTop,
    SessionDetailWithFriends,
    SessionDetail,
    GetMsgReadCount,
    GetMsgReadList,
    ModifyFriendRemark,
    DeleteFriend,
    SendAddFriendRequest,
    HandleInvite,
    NoticeUnReadCount,
    RequestNoticePage,
    GetContactList,
    SearchFriend,
    ChangeUserState,
    GetAllUserState,
    UploadAvatar,
    GetEmoji,
    DeleteEmoji,
    AddEmoji,
    RecallMsg,
    DeleteMsgFile,
    ChatPurges,
    BlockUser,
    MarkMsg,
    SetUserBadge,
    ModifyUserInfo,
    GetUserInfoDetail,
    GetMsgList,
    GetMsgPage,
    GetAllUserBaseInfo,
    GetBadgesBatch,
    GetMemberStatistic,
    GetBadgeList,
    FeedDetail,
    FeedList,
    PushFeed,
    DelFeed,
    EditFeed,
    GetFeedPermission,
    // 朋友圈点赞相关
    FeedLikeToggle,
    FeedLikeList,
    FeedLikeCount,
    FeedLikeHasLiked,
    // 朋友圈评论相关
    FeedCommentAdd,
    FeedCommentDelete,
    FeedCommentList,
    FeedCommentAll,
    FeedCommentCount,
    SendMsg,
    SetHide,
    GetFriendPage,
    MarkMsgRead,
    CheckEmail,
    MergeMsg,
    GetUserByIds,
    // 音视频通话与会议
    RtcIceServers,
    MeetingList,
    MeetingCreate,
    MeetingDetail,
    MeetingJoin,
    MeetingIcs,
    MeetingCancel,
    MeetingAvailability,
    MeetingStatus,
    GenerateQRCode,
    CheckQRStatus,
    ScanQRCode,
    ConfirmQRCode,
    MessageSend,
    MessageSendStream,
    MessageListByConversationId,
    MessageDelete,
    MessageDeleteByConversationId,
    MessagePage,
    MessageDeleteByAdmin,
    MessageSaveGeneratedContent,

    ConversationCreateMy,
    ConversationUpdateMy,
    ConversationMyList,
    ConversationGetMy,
    ConversationDeleteMy,
    ConversationDeleteByUnpinned,
    ConversationPage,
    ConversationDeleteByAdmin,

    ModelCreate,
    ModelUpdate,
    ModelDelete,
    ModelGet,
    ModelRemainingUsage,
    ModelPage,
    ModelSimpleList,

    ChatRoleMyPage,
    ChatRoleGetMy,
    ChatRoleCreateMy,
    ChatRoleUpdateMy,
    ChatRoleDeleteMy,
    ChatRoleCategoryList,
    ChatRoleCreate,
    ChatRoleUpdate,
    ChatRoleDelete,
    ChatRoleGet,
    ChatRolePage,

    ApiKeyCreate,
    ApiKeyUpdate,
    ApiKeyDelete,
    ApiKeyGet,
    ApiKeyPage,
    ApiKeySimpleList,
    ApiKeyBalance,

    PlatformList,
    PlatformAddModel,

    ToolCreate,
    ToolUpdate,
    ToolDelete,
    ToolGet,
    ToolPage,
    ToolSimpleList,

    ImageMyPage,
    ImagePublicPage,
    ImageGetMy,
    ImageMyListByIds,
    ImageDraw,
    ImageDeleteMy,
    ImageMidjourneyImagine,
    ImageMidjourneyNotify,
    ImageMidjourneyAction,
    ImagePage,
    ImageUpdate,
    ImageDelete,

    VideoMyPage,
    VideoGet,
    VideoMyListByIds,
    VideoGenerate,
    VideoDeleteMy,

    AudioMyPage,
    AudioGetMy,
    AudioMyListByIds,
    AudioGenerate,
    AudioDeleteMy,
    AudioVoices,

    KnowledgePage,
    KnowledgeGet,
    KnowledgeCreate,
    KnowledgeUpdate,
    KnowledgeDelete,
    KnowledgeSimpleList,

    KnowledgeDocumentPage,
    KnowledgeDocumentGet,
    KnowledgeDocumentCreate,
    KnowledgeDocumentCreateList,
    KnowledgeDocumentUpdate,
    KnowledgeDocumentUpdateStatus,
    KnowledgeDocumentDelete,

    KnowledgeSegmentGet,
    KnowledgeSegmentPage,
    KnowledgeSegmentCreate,
    KnowledgeSegmentUpdate,
    KnowledgeSegmentUpdateStatus,
    KnowledgeSegmentSplit,
    KnowledgeSegmentGetProcessList,
    KnowledgeSegmentSearch,

    MindMapGenerateStream,
    MindMapDelete,
    MindMapPage,

    MusicMyPage,
    MusicGenerate,
    MusicDeleteMy,
    MusicGetMy,
    MusicUpdateMy,
    MusicPage,
    MusicDelete,
    MusicUpdate,

    WorkflowCreate,
    WorkflowUpdate,
    WorkflowDelete,
    WorkflowGet,
    WorkflowPage,
    WorkflowTest,

    WriteGenerateStream,
    WriteDelete,
    WritePage,
}

impl ImUrl {
    pub fn get_url(&self) -> (http::Method, &str) {
        match self {
            // Token 相关
            ImUrl::Login => (http::Method::POST, "oauth/anyTenant/login"),
            ImUrl::RefreshToken => (http::Method::POST, "oauth/anyTenant/refresh"),
            ImUrl::ForgetPassword => (http::Method::PUT, "oauth/anyTenant/password"),
            ImUrl::CheckToken => (http::Method::POST, "oauth/check"),
            ImUrl::Logout => (http::Method::POST, "oauth/anyUser/logout"),
            ImUrl::Register => (http::Method::POST, "oauth/anyTenant/registerByEmail"),

            // 系统相关
            ImUrl::GetQiniuToken => (http::Method::GET, "system/anyTenant/ossToken"),
            ImUrl::InitConfig => (http::Method::GET, "system/anyTenant/config/init"),
            ImUrl::StorageProvider => (http::Method::GET, "system/anyTenant/storage/provider"),
            ImUrl::MailSso => (http::Method::GET, "im/mail/sso"),
            ImUrl::MailUnread => (http::Method::GET, "im/mail/unread"),
            ImUrl::RoomMailbox => (http::Method::GET, "im/room/mailbox"),
            ImUrl::RoomMailboxEnable => (http::Method::POST, "im/room/mailbox"),
            ImUrl::RoomMailboxDisable => (http::Method::POST, "im/room/mailbox/disable"),
            ImUrl::UnifiedSearch => (http::Method::GET, "im/search"),
            ImUrl::RoomFiles => (http::Method::GET, "im/room/files"),
            ImUrl::RoomFileRemove => (http::Method::POST, "im/room/files/remove"),
            ImUrl::RoomFileSaveToDrive => (http::Method::POST, "im/room/files/saveToDrive"),
            ImUrl::RoomFileFromDrive => (http::Method::POST, "im/room/files/fromDrive"),
            ImUrl::DriveItems => (http::Method::GET, "im/drive/items"),
            ImUrl::AiSummary => (http::Method::POST, "im/ai/summary"),
            ImUrl::AiMailTodo => (http::Method::POST, "im/ai/mailTodo"),
            ImUrl::TodoList => (http::Method::GET, "im/todo/list"),
            ImUrl::TodoCreate => (http::Method::POST, "im/todo"),
            ImUrl::TodoUpdate => (http::Method::POST, "im/todo/update"),
            ImUrl::TodoDelete => (http::Method::POST, "im/todo/delete"),
            ImUrl::MapCoordTranslate => (http::Method::GET, "system/anyTenant/map/coord/translate"),
            ImUrl::MapReverseGeocode => {
                (http::Method::GET, "system/anyTenant/map/geocoder/reverse")
            }
            ImUrl::MapStatic => (http::Method::GET, "system/anyTenant/map/static"),
            ImUrl::GetAssistantModelList => (http::Method::GET, "system/model/list"),

            // 验证码相关
            ImUrl::SendCaptcha => (http::Method::POST, "oauth/anyTenant/sendEmailCode"),
            ImUrl::GetCaptcha => (http::Method::GET, "oauth/anyTenant/captcha"),

            // 群公告相关
            ImUrl::Announcement => (http::Method::GET, "im/room/announcement"),
            ImUrl::EditAnnouncement => (http::Method::POST, "im/room/announcement/edit"),
            ImUrl::DeleteAnnouncement => (http::Method::POST, "im/room/announcement/delete"),
            ImUrl::PushAnnouncement => (http::Method::POST, "im/room/announcement/push"),
            ImUrl::GetAnnouncementList => (http::Method::GET, "im/room/announcement/list"),

            // 群聊申请相关
            ImUrl::ApplyGroup => (http::Method::POST, "im/room/apply/group"),

            // 群聊搜索和管理
            ImUrl::SearchGroup => (http::Method::GET, "im/room/search"),
            ImUrl::UpdateMyRoomInfo => (http::Method::POST, "im/room/updateMyRoomInfo"),
            ImUrl::UpdateRoomInfo => (http::Method::POST, "im/room/updateRoomInfo"),
            ImUrl::GroupList => (http::Method::GET, "im/room/group/list"),
            ImUrl::GroupListMember => (http::Method::GET, "im/room/group/listMember"),
            ImUrl::GroupDetail => (http::Method::GET, "im/room/group/detail"),
            ImUrl::GroupInfo => (http::Method::GET, "im/room/group/info"),

            // 群聊管理员
            ImUrl::RevokeAdmin => (http::Method::DELETE, "im/room/group/admin"),
            ImUrl::AddAdmin => (http::Method::PUT, "im/room/group/admin"),

            // 群聊成员管理
            ImUrl::ExitGroup => (http::Method::DELETE, "im/room/group/member/exit"),
            ImUrl::AcceptInvite => (http::Method::POST, "im/room/group/invite/accept"),
            ImUrl::InviteList => (http::Method::GET, "im/room/group/invite/list"),
            ImUrl::InviteGroupMember => (http::Method::POST, "im/room/group/member"),
            ImUrl::RemoveGroupMember => (http::Method::DELETE, "im/room/group/member"),
            ImUrl::CreateGroup => (http::Method::POST, "im/room/group"),

            // 聊天会话相关
            ImUrl::Shield => (http::Method::POST, "im/chat/setShield"),
            ImUrl::Notification => (http::Method::POST, "im/chat/notification"),
            ImUrl::DeleteSession => (http::Method::DELETE, "im/chat/delete"),
            ImUrl::SetSessionTop => (http::Method::POST, "im/chat/setTop"),
            ImUrl::SessionDetailWithFriends => (http::Method::GET, "im/chat/contact/detail/friend"),
            ImUrl::SessionDetail => (http::Method::GET, "im/chat/contact/detail"),
            ImUrl::SetHide => (http::Method::POST, "im/chat/setHide"),

            // 消息已读未读
            ImUrl::GetMsgReadCount => (http::Method::GET, "im/chat/msg/read"),
            ImUrl::MarkMsgRead => (http::Method::PUT, "im/chat/msg/read"),
            ImUrl::SendMsg => (http::Method::POST, "im/chat/msg"),
            ImUrl::GetMsgReadList => (http::Method::GET, "im/chat/msg/read/page"),

            // 好友相关
            ImUrl::ModifyFriendRemark => (http::Method::POST, "im/user/friend/updateRemark"),
            ImUrl::DeleteFriend => (http::Method::DELETE, "im/user/friend"),
            ImUrl::SendAddFriendRequest => (http::Method::POST, "im/room/apply/apply"),
            ImUrl::HandleInvite => (http::Method::POST, "im/room/apply/handler/apply"),
            ImUrl::NoticeUnReadCount => (http::Method::GET, "im/room/notice/unread"),
            ImUrl::RequestNoticePage => (http::Method::GET, "im/room/notice/page"),
            ImUrl::GetFriendPage => (http::Method::GET, "im/user/friend/page"),
            ImUrl::GetContactList => (http::Method::GET, "im/chat/contact/list"),
            ImUrl::SearchFriend => (http::Method::GET, "im/user/friend/search"),

            // 用户状态相关
            ImUrl::ChangeUserState => (http::Method::POST, "im/user/state/changeState"),
            ImUrl::GetAllUserState => (http::Method::GET, "im/user/state/list"),

            // 用户信息相关
            ImUrl::UploadAvatar => (http::Method::POST, "im/user/avatar"),
            ImUrl::GetEmoji => (http::Method::GET, "im/user/emoji/list"),
            ImUrl::DeleteEmoji => (http::Method::DELETE, "im/user/emoji"),
            ImUrl::AddEmoji => (http::Method::POST, "im/user/emoji"),
            ImUrl::SetUserBadge => (http::Method::PUT, "im/user/badge"),
            ImUrl::ModifyUserInfo => (http::Method::PUT, "im/user/info"),
            ImUrl::GetUserInfoDetail => (http::Method::GET, "im/user/userInfo"),
            ImUrl::GetBadgesBatch => (http::Method::POST, "im/user/badges/batch"),
            ImUrl::GetBadgeList => (http::Method::GET, "im/user/badges"),
            ImUrl::BlockUser => (http::Method::PUT, "im/user/black"),

            // 扫码登录相关
            ImUrl::GenerateQRCode => (http::Method::GET, "oauth/anyTenant/qr/generate"),
            ImUrl::CheckQRStatus => (http::Method::GET, "oauth/anyTenant/qr/status/query"),
            ImUrl::ScanQRCode => (http::Method::POST, "oauth/qrcode/scan"),
            ImUrl::ConfirmQRCode => (http::Method::POST, "oauth/qrcode/confirm"),

            // 消息相关
            ImUrl::RecallMsg => (http::Method::PUT, "im/chat/msg/recall"),
            ImUrl::DeleteMsgFile => (http::Method::POST, "im/chat/msg/file/delete"),
            ImUrl::ChatPurges => (http::Method::GET, "im/chat/purges"),
            ImUrl::MarkMsg => (http::Method::PUT, "im/chat/msg/mark"),
            ImUrl::GetMsgPage => (http::Method::GET, "im/chat/msg/page"),
            ImUrl::GetMsgList => (http::Method::POST, "im/chat/msg/list"),
            ImUrl::GetMemberStatistic => (http::Method::GET, "im/chat/member/statistic"),

            // 朋友圈相关
            ImUrl::FeedList => (http::Method::POST, "im/feed/list"),
            ImUrl::PushFeed => (http::Method::POST, "im/feed/pushFeed"),
            ImUrl::GetFeedPermission => (http::Method::GET, "im/feed/getFeedPermission"),
            ImUrl::EditFeed => (http::Method::POST, "im/feed/edit"),
            ImUrl::DelFeed => (http::Method::POST, "im/feed/del"),
            ImUrl::FeedDetail => (http::Method::GET, "im/feed/detail"),
            // 朋友圈点赞相关
            ImUrl::FeedLikeToggle => (http::Method::POST, "im/feed/like/toggle"),
            ImUrl::FeedLikeList => (http::Method::GET, "im/feed/like/list"),
            ImUrl::FeedLikeCount => (http::Method::GET, "im/feed/like/count"),
            ImUrl::FeedLikeHasLiked => (http::Method::GET, "im/feed/like/hasLiked"),
            // 朋友圈评论相关
            ImUrl::FeedCommentAdd => (http::Method::POST, "im/feed/comment/add"),
            ImUrl::FeedCommentDelete => (http::Method::POST, "im/feed/comment/delete"),
            ImUrl::FeedCommentList => (http::Method::POST, "im/feed/comment/list"),
            ImUrl::FeedCommentAll => (http::Method::GET, "im/feed/comment/all"),
            ImUrl::FeedCommentCount => (http::Method::GET, "im/feed/comment/count"),

            // ai相关 - 聊天消息
            ImUrl::MessageSend => (http::Method::POST, "ai/chat/message/send"),
            ImUrl::MessageSendStream => (http::Method::POST, "ai/chat/message/send-stream"),
            ImUrl::MessageListByConversationId => {
                (http::Method::GET, "ai/chat/message/list-by-conversation-id")
            }
            ImUrl::MessageDelete => (http::Method::DELETE, "ai/chat/message/delete"),
            ImUrl::MessageDeleteByConversationId => (
                http::Method::DELETE,
                "ai/chat/message/delete-by-conversation-id",
            ),
            ImUrl::MessagePage => (http::Method::GET, "ai/chat/message/page"),
            ImUrl::MessageDeleteByAdmin => {
                (http::Method::DELETE, "ai/chat/message/delete-by-admin")
            }
            ImUrl::MessageSaveGeneratedContent => {
                (http::Method::POST, "ai/chat/message/save-generated-content")
            }

            // AI 聊天对话
            ImUrl::ConversationCreateMy => (http::Method::POST, "ai/chat/conversation/create-my"),
            ImUrl::ConversationUpdateMy => (http::Method::PUT, "ai/chat/conversation/update-my"),
            ImUrl::ConversationMyList => (http::Method::GET, "ai/chat/conversation/my-list"),
            ImUrl::ConversationGetMy => (http::Method::GET, "ai/chat/conversation/get-my"),
            ImUrl::ConversationDeleteMy => (http::Method::DELETE, "ai/chat/conversation/delete-my"),
            ImUrl::ConversationDeleteByUnpinned => (
                http::Method::DELETE,
                "ai/chat/conversation/delete-by-unpinned",
            ),
            ImUrl::ConversationPage => (http::Method::GET, "ai/chat/conversation/page"),
            ImUrl::ConversationDeleteByAdmin => {
                (http::Method::DELETE, "ai/chat/conversation/delete-by-admin")
            }

            // AI 模型相关接口
            ImUrl::ModelCreate => (http::Method::POST, "ai/model/create"),
            ImUrl::ModelUpdate => (http::Method::PUT, "ai/model/update"),
            ImUrl::ModelDelete => (http::Method::DELETE, "ai/model/delete"),
            ImUrl::ModelGet => (http::Method::GET, "ai/model/get"),
            ImUrl::ModelRemainingUsage => (http::Method::GET, "ai/model/get-remaining-usage"),
            ImUrl::ModelPage => (http::Method::GET, "ai/model/page"),
            ImUrl::ModelSimpleList => (http::Method::GET, "ai/model/simple-list"),

            // 聊天角色相关接口
            ImUrl::ChatRoleMyPage => (http::Method::GET, "ai/chat-role/my-page"),
            ImUrl::ChatRoleGetMy => (http::Method::GET, "ai/chat-role/get-my"),
            ImUrl::ChatRoleCreateMy => (http::Method::POST, "ai/chat-role/create-my"),
            ImUrl::ChatRoleUpdateMy => (http::Method::PUT, "ai/chat-role/update-my"),
            ImUrl::ChatRoleDeleteMy => (http::Method::DELETE, "ai/chat-role/delete-my"),
            ImUrl::ChatRoleCategoryList => (http::Method::GET, "ai/chat-role/category-list"),
            ImUrl::ChatRoleCreate => (http::Method::POST, "ai/chat-role/create"),
            ImUrl::ChatRoleUpdate => (http::Method::PUT, "ai/chat-role/update"),
            ImUrl::ChatRoleDelete => (http::Method::DELETE, "ai/chat-role/delete"),
            ImUrl::ChatRoleGet => (http::Method::GET, "ai/chat-role/get"),
            ImUrl::ChatRolePage => (http::Method::GET, "ai/chat-role/page"),

            // API 密钥相关接口
            ImUrl::ApiKeyCreate => (http::Method::POST, "ai/api-key/create"),
            ImUrl::ApiKeyUpdate => (http::Method::PUT, "ai/api-key/update"),
            ImUrl::ApiKeyDelete => (http::Method::DELETE, "ai/api-key/delete"),
            ImUrl::ApiKeyGet => (http::Method::GET, "ai/api-key/get"),
            ImUrl::ApiKeyPage => (http::Method::GET, "ai/api-key/page"),
            ImUrl::ApiKeySimpleList => (http::Method::GET, "ai/api-key/simple-list"),
            ImUrl::ApiKeyBalance => (http::Method::GET, "ai/api-key/balance"),

            // 平台相关接口
            ImUrl::PlatformList => (http::Method::GET, "ai/platform/list"),
            ImUrl::PlatformAddModel => (http::Method::POST, "ai/platform/add-model"),

            // AI 工具相关接口
            ImUrl::ToolCreate => (http::Method::POST, "ai/tool/create"),
            ImUrl::ToolUpdate => (http::Method::PUT, "ai/tool/update"),
            ImUrl::ToolDelete => (http::Method::DELETE, "ai/tool/delete"),
            ImUrl::ToolGet => (http::Method::GET, "ai/tool/get"),
            ImUrl::ToolPage => (http::Method::GET, "ai/tool/page"),
            ImUrl::ToolSimpleList => (http::Method::GET, "ai/tool/simple-list"),

            // AI 绘画
            ImUrl::ImageMyPage => (http::Method::GET, "ai/image/my-page"),
            ImUrl::ImagePublicPage => (http::Method::GET, "ai/image/public-page"),
            ImUrl::ImageGetMy => (http::Method::GET, "ai/image/get-my"),
            ImUrl::ImageMyListByIds => (http::Method::GET, "ai/image/my-list-by-ids"),
            ImUrl::ImageDraw => (http::Method::POST, "ai/image/draw"),
            ImUrl::ImageDeleteMy => (http::Method::DELETE, "ai/image/delete-my"),
            ImUrl::ImageMidjourneyImagine => (http::Method::POST, "ai/image/midjourney/imagine"),
            ImUrl::ImageMidjourneyNotify => (http::Method::POST, "ai/image/midjourney/notify"),
            ImUrl::ImageMidjourneyAction => (http::Method::POST, "ai/image/midjourney/action"),
            ImUrl::ImagePage => (http::Method::GET, "ai/image/page"),
            ImUrl::ImageUpdate => (http::Method::PUT, "ai/image/update"),
            ImUrl::ImageDelete => (http::Method::DELETE, "ai/image/delete"),

            // AI 视频生成
            ImUrl::VideoMyPage => (http::Method::GET, "ai/video/my-page"),
            ImUrl::VideoGet => (http::Method::GET, "ai/video/get"),
            ImUrl::VideoMyListByIds => (http::Method::GET, "ai/video/my-list-by-ids"),
            ImUrl::VideoGenerate => (http::Method::POST, "ai/video/generate"),
            ImUrl::VideoDeleteMy => (http::Method::DELETE, "ai/video/delete-my"),

            // AI 音频生成
            ImUrl::AudioMyPage => (http::Method::GET, "ai/audio/my-page"),
            ImUrl::AudioGetMy => (http::Method::GET, "ai/audio/get-my"),
            ImUrl::AudioMyListByIds => (http::Method::GET, "ai/audio/my-list-by-ids"),
            ImUrl::AudioGenerate => (http::Method::POST, "ai/audio/generate"),
            ImUrl::AudioDeleteMy => (http::Method::DELETE, "ai/audio/delete-my"),
            ImUrl::AudioVoices => (http::Method::GET, "ai/audio/voices"),

            // 知识库相关接口
            ImUrl::KnowledgePage => (http::Method::GET, "ai/knowledge/page"),
            ImUrl::KnowledgeGet => (http::Method::GET, "ai/knowledge/get"),
            ImUrl::KnowledgeCreate => (http::Method::POST, "ai/knowledge/create"),
            ImUrl::KnowledgeUpdate => (http::Method::PUT, "ai/knowledge/update"),
            ImUrl::KnowledgeDelete => (http::Method::DELETE, "ai/knowledge/delete"),
            ImUrl::KnowledgeSimpleList => (http::Method::GET, "ai/knowledge/simple-list"),

            // 知识库文档相关接口
            ImUrl::KnowledgeDocumentPage => (http::Method::GET, "ai/knowledge/document/page"),
            ImUrl::KnowledgeDocumentGet => (http::Method::GET, "ai/knowledge/document/get"),
            ImUrl::KnowledgeDocumentCreate => (http::Method::POST, "ai/knowledge/document/create"),
            ImUrl::KnowledgeDocumentCreateList => {
                (http::Method::POST, "ai/knowledge/document/create-list")
            }
            ImUrl::KnowledgeDocumentUpdate => (http::Method::PUT, "ai/knowledge/document/update"),
            ImUrl::KnowledgeDocumentUpdateStatus => {
                (http::Method::PUT, "ai/knowledge/document/update-status")
            }
            ImUrl::KnowledgeDocumentDelete => {
                (http::Method::DELETE, "ai/knowledge/document/delete")
            }

            // 知识库文档片段相关接口
            ImUrl::KnowledgeSegmentGet => (http::Method::GET, "ai/knowledge/segment/get"),
            ImUrl::KnowledgeSegmentPage => (http::Method::GET, "ai/knowledge/segment/page"),
            ImUrl::KnowledgeSegmentCreate => (http::Method::POST, "ai/knowledge/segment/create"),
            ImUrl::KnowledgeSegmentUpdate => (http::Method::PUT, "ai/knowledge/segment/update"),
            ImUrl::KnowledgeSegmentUpdateStatus => {
                (http::Method::PUT, "ai/knowledge/segment/update-status")
            }
            ImUrl::KnowledgeSegmentSplit => (http::Method::GET, "ai/knowledge/segment/split"),
            ImUrl::KnowledgeSegmentGetProcessList => {
                (http::Method::GET, "ai/knowledge/segment/get-process-list")
            }
            ImUrl::KnowledgeSegmentSearch => (http::Method::GET, "ai/knowledge/segment/search"),

            // AI 思维导图相关接口
            ImUrl::MindMapGenerateStream => (http::Method::POST, "ai/mind-map/generate-stream"),
            ImUrl::MindMapDelete => (http::Method::DELETE, "ai/mind-map/delete"),
            ImUrl::MindMapPage => (http::Method::GET, "ai/mind-map/page"),

            // 音乐
            ImUrl::MusicMyPage => (http::Method::GET, "ai/music/my-page"),
            ImUrl::MusicGenerate => (http::Method::POST, "ai/music/generate"),
            ImUrl::MusicDeleteMy => (http::Method::DELETE, "ai/music/delete-my"),
            ImUrl::MusicGetMy => (http::Method::GET, "ai/music/get-my"),
            ImUrl::MusicUpdateMy => (http::Method::POST, "ai/music/update-my"),
            ImUrl::MusicPage => (http::Method::GET, "ai/music/page"),
            ImUrl::MusicDelete => (http::Method::DELETE, "ai/music/delete"),
            ImUrl::MusicUpdate => (http::Method::PUT, "ai/music/update"),

            // 工作流
            ImUrl::WorkflowCreate => (http::Method::POST, "ai/workflow/create"),
            ImUrl::WorkflowUpdate => (http::Method::PUT, "ai/workflow/update"),
            ImUrl::WorkflowDelete => (http::Method::DELETE, "ai/workflow/delete"),
            ImUrl::WorkflowGet => (http::Method::GET, "ai/workflow/get"),
            ImUrl::WorkflowPage => (http::Method::GET, "ai/workflow/page"),
            ImUrl::WorkflowTest => (http::Method::POST, "ai/workflow/test"),

            // 写作
            ImUrl::WriteGenerateStream => (http::Method::POST, "ai/write/generate-stream"),
            ImUrl::WriteDelete => (http::Method::DELETE, "ai/write/delete"),
            ImUrl::WritePage => (http::Method::GET, "ai/write/page"),

            // 群成员信息
            ImUrl::GetAllUserBaseInfo => (http::Method::GET, "im/room/group/member/list"),
            ImUrl::CheckEmail => (http::Method::GET, "oauth/anyTenant/checkEmail"),

            ImUrl::MergeMsg => (http::Method::POST, "im/room/mergeMessage"),
            ImUrl::GetUserByIds => (http::Method::POST, "im/user/getUserByIds"),

            // 音视频通话与会议
            ImUrl::RtcIceServers => (http::Method::GET, "im/rtc/iceServers"),
            ImUrl::MeetingList => (http::Method::GET, "im/meeting/list"),
            ImUrl::MeetingCreate => (http::Method::POST, "im/meeting"),
            ImUrl::MeetingDetail => (http::Method::GET, "im/meeting/detail"),
            ImUrl::MeetingJoin => (http::Method::POST, "im/meeting/join"),
            ImUrl::MeetingIcs => (http::Method::GET, "im/meeting/ics"),
            ImUrl::MeetingCancel => (http::Method::POST, "im/meeting/cancel"),
            ImUrl::MeetingAvailability => (http::Method::POST, "im/meeting/availability"),
            ImUrl::MeetingStatus => (http::Method::GET, "im/meeting/status"),
        }
    }

    fn from_str(s: &str) -> Result<Self, anyhow::Error> {
        match s {
            // Token 相关
            "login" => Ok(ImUrl::Login),
            "refreshToken" => Ok(ImUrl::RefreshToken),
            "forgetPassword" => Ok(ImUrl::ForgetPassword),
            "checkToken" => Ok(ImUrl::CheckToken),
            "logout" => Ok(ImUrl::Logout),
            "register" => Ok(ImUrl::Register),

            // 系统相关
            "getQiniuToken" => Ok(ImUrl::GetQiniuToken),
            "initConfig" => Ok(ImUrl::InitConfig),
            "storageProvider" => Ok(ImUrl::StorageProvider),
            "mailSso" => Ok(ImUrl::MailSso),
            "mailUnread" => Ok(ImUrl::MailUnread),
            "roomMailbox" => Ok(ImUrl::RoomMailbox),
            "roomMailboxEnable" => Ok(ImUrl::RoomMailboxEnable),
            "roomMailboxDisable" => Ok(ImUrl::RoomMailboxDisable),
            "unifiedSearch" => Ok(ImUrl::UnifiedSearch),
            "roomFiles" => Ok(ImUrl::RoomFiles),
            "roomFileRemove" => Ok(ImUrl::RoomFileRemove),
            "roomFileSaveToDrive" => Ok(ImUrl::RoomFileSaveToDrive),
            "roomFileFromDrive" => Ok(ImUrl::RoomFileFromDrive),
            "driveItems" => Ok(ImUrl::DriveItems),
            "aiSummary" => Ok(ImUrl::AiSummary),
            "aiMailTodo" => Ok(ImUrl::AiMailTodo),
            "todoList" => Ok(ImUrl::TodoList),
            "todoCreate" => Ok(ImUrl::TodoCreate),
            "todoUpdate" => Ok(ImUrl::TodoUpdate),
            "todoDelete" => Ok(ImUrl::TodoDelete),
            "mapCoordTranslate" => Ok(ImUrl::MapCoordTranslate),
            "mapReverseGeocode" => Ok(ImUrl::MapReverseGeocode),
            "mapStatic" => Ok(ImUrl::MapStatic),
            "getAssistantModelList" => Ok(ImUrl::GetAssistantModelList),

            // 验证码相关
            "sendCaptcha" => Ok(ImUrl::SendCaptcha),
            "getCaptcha" => Ok(ImUrl::GetCaptcha),

            // 群公告相关
            "announcement" => Ok(ImUrl::Announcement),
            "editAnnouncement" => Ok(ImUrl::EditAnnouncement),
            "deleteAnnouncement" => Ok(ImUrl::DeleteAnnouncement),
            "pushAnnouncement" => Ok(ImUrl::PushAnnouncement),
            "getAnnouncementList" => Ok(ImUrl::GetAnnouncementList),

            // 群聊申请相关
            "applyGroup" => Ok(ImUrl::ApplyGroup),

            // 群聊搜索和管理
            "searchGroup" => Ok(ImUrl::SearchGroup),
            "updateMyRoomInfo" => Ok(ImUrl::UpdateMyRoomInfo),
            "updateRoomInfo" => Ok(ImUrl::UpdateRoomInfo),
            "groupList" => Ok(ImUrl::GroupList),
            "groupDetail" => Ok(ImUrl::GroupDetail),
            "groupInfo" => Ok(ImUrl::GroupInfo),

            // 群聊管理员
            "revokeAdmin" => Ok(ImUrl::RevokeAdmin),
            "addAdmin" => Ok(ImUrl::AddAdmin),

            // 群聊成员管理
            "exitGroup" => Ok(ImUrl::ExitGroup),
            "acceptInvite" => Ok(ImUrl::AcceptInvite),
            "inviteList" => Ok(ImUrl::InviteList),
            "inviteGroupMember" => Ok(ImUrl::InviteGroupMember),
            "removeGroupMember" => Ok(ImUrl::RemoveGroupMember),
            "createGroup" => Ok(ImUrl::CreateGroup),

            // 聊天会话相关
            "shield" => Ok(ImUrl::Shield),
            "notification" => Ok(ImUrl::Notification),
            "deleteSession" => Ok(ImUrl::DeleteSession),
            "setSessionTop" => Ok(ImUrl::SetSessionTop),
            "sessionDetailWithFriends" => Ok(ImUrl::SessionDetailWithFriends),
            "sessionDetail" => Ok(ImUrl::SessionDetail),

            // 消息已读未读
            "getMsgReadCount" => Ok(ImUrl::GetMsgReadCount),
            "getMsgReadList" => Ok(ImUrl::GetMsgReadList),

            // 好友相关
            "modifyFriendRemark" => Ok(ImUrl::ModifyFriendRemark),
            "deleteFriend" => Ok(ImUrl::DeleteFriend),
            "sendAddFriendRequest" => Ok(ImUrl::SendAddFriendRequest),
            "handleInvite" => Ok(ImUrl::HandleInvite),
            "noticeUnReadCount" => Ok(ImUrl::NoticeUnReadCount),
            "requestNoticePage" => Ok(ImUrl::RequestNoticePage),
            "getContactList" => Ok(ImUrl::GetContactList),
            "searchFriend" => Ok(ImUrl::SearchFriend),

            // 用户状态相关
            "changeUserState" => Ok(ImUrl::ChangeUserState),
            "getAllUserState" => Ok(ImUrl::GetAllUserState),

            // 用户信息相关
            "uploadAvatar" => Ok(ImUrl::UploadAvatar),
            "getEmoji" => Ok(ImUrl::GetEmoji),
            "deleteEmoji" => Ok(ImUrl::DeleteEmoji),
            "addEmoji" => Ok(ImUrl::AddEmoji),
            "setUserBadge" => Ok(ImUrl::SetUserBadge),
            "ModifyUserInfo" => Ok(ImUrl::ModifyUserInfo),
            "getUserInfoDetail" => Ok(ImUrl::GetUserInfoDetail),
            "getBadgesBatch" => Ok(ImUrl::GetBadgesBatch),
            "getBadgeList" => Ok(ImUrl::GetBadgeList),
            "blockUser" => Ok(ImUrl::BlockUser),

            // 消息相关
            "recallMsg" => Ok(ImUrl::RecallMsg),
            "deleteMsgFile" => Ok(ImUrl::DeleteMsgFile),
            "chatPurges" => Ok(ImUrl::ChatPurges),
            "markMsg" => Ok(ImUrl::MarkMsg),
            "getMsgList" => Ok(ImUrl::GetMsgList),
            "getMsgPage" => Ok(ImUrl::GetMsgPage),
            "getMemberStatistic" => Ok(ImUrl::GetMemberStatistic),

            // 朋友圈相关
            "feedDetail" => Ok(ImUrl::FeedDetail),
            "feedList" => Ok(ImUrl::FeedList),
            "pushFeed" => Ok(ImUrl::PushFeed),
            "delFeed" => Ok(ImUrl::DelFeed),
            "editFeed" => Ok(ImUrl::EditFeed),
            "getFeedPermission" => Ok(ImUrl::GetFeedPermission),
            // 朋友圈点赞相关
            "feedLikeToggle" => Ok(ImUrl::FeedLikeToggle),
            "feedLikeList" => Ok(ImUrl::FeedLikeList),
            "feedLikeCount" => Ok(ImUrl::FeedLikeCount),
            "feedLikeHasLiked" => Ok(ImUrl::FeedLikeHasLiked),
            // 朋友圈评论相关
            "feedCommentAdd" => Ok(ImUrl::FeedCommentAdd),
            "feedCommentDelete" => Ok(ImUrl::FeedCommentDelete),
            "feedCommentList" => Ok(ImUrl::FeedCommentList),
            "feedCommentAll" => Ok(ImUrl::FeedCommentAll),
            "feedCommentCount" => Ok(ImUrl::FeedCommentCount),

            // 群成员信息
            "getAllUserBaseInfo" => Ok(ImUrl::GetAllUserBaseInfo),
            "sendMsg" => Ok(ImUrl::SendMsg),
            "setHide" => Ok(ImUrl::SetHide),
            "getFriendPage" => Ok(ImUrl::GetFriendPage),
            "markMsgRead" => Ok(ImUrl::MarkMsgRead),
            "groupListMember" => Ok(ImUrl::GroupListMember),
            "checkEmail" => Ok(ImUrl::CheckEmail),
            "mergeMsg" => Ok(ImUrl::MergeMsg),
            "getUserByIds" => Ok(ImUrl::GetUserByIds),
            "rtcIceServers" => Ok(ImUrl::RtcIceServers),
            "meetingList" => Ok(ImUrl::MeetingList),
            "meetingCreate" => Ok(ImUrl::MeetingCreate),
            "meetingDetail" => Ok(ImUrl::MeetingDetail),
            "meetingJoin" => Ok(ImUrl::MeetingJoin),
            "meetingIcs" => Ok(ImUrl::MeetingIcs),
            "meetingCancel" => Ok(ImUrl::MeetingCancel),
            "meetingAvailability" => Ok(ImUrl::MeetingAvailability),
            "meetingStatus" => Ok(ImUrl::MeetingStatus),
            "generateQRCode" => Ok(ImUrl::GenerateQRCode),
            "checkQRStatus" => Ok(ImUrl::CheckQRStatus),
            "scanQRCode" => Ok(ImUrl::ScanQRCode),
            "confirmQRCode" => Ok(ImUrl::ConfirmQRCode),

            // ================ AI 聊天消息 ================
            "messageSend" => Ok(ImUrl::MessageSend),
            "messageSendStream" => Ok(ImUrl::MessageSendStream),
            "messageListByConversationId" => Ok(ImUrl::MessageListByConversationId),
            "messageDelete" => Ok(ImUrl::MessageDelete),
            "messageDeleteByConversationId" => Ok(ImUrl::MessageDeleteByConversationId),
            "messagePage" => Ok(ImUrl::MessagePage),
            "messageDeleteByAdmin" => Ok(ImUrl::MessageDeleteByAdmin),
            "messageSaveGeneratedContent" => Ok(ImUrl::MessageSaveGeneratedContent),

            // ================ AI 聊天对话 ================
            "conversationCreateMy" => Ok(ImUrl::ConversationCreateMy),
            "conversationUpdateMy" => Ok(ImUrl::ConversationUpdateMy),
            "conversationMyList" => Ok(ImUrl::ConversationMyList),
            "conversationGetMy" => Ok(ImUrl::ConversationGetMy),
            "conversationDeleteMy" => Ok(ImUrl::ConversationDeleteMy),
            "conversationDeleteByUnpinned" => Ok(ImUrl::ConversationDeleteByUnpinned),
            "conversationPage" => Ok(ImUrl::ConversationPage),
            "conversationDeleteByAdmin" => Ok(ImUrl::ConversationDeleteByAdmin),

            // ================ AI 模型 ================
            "modelCreate" => Ok(ImUrl::ModelCreate),
            "modelUpdate" => Ok(ImUrl::ModelUpdate),
            "modelDelete" => Ok(ImUrl::ModelDelete),
            "modelGet" => Ok(ImUrl::ModelGet),
            "modelRemainingUsage" => Ok(ImUrl::ModelRemainingUsage),
            "modelPage" => Ok(ImUrl::ModelPage),
            "modelSimpleList" => Ok(ImUrl::ModelSimpleList),

            // ================ AI 聊天角色 ================
            "chatRoleMyPage" => Ok(ImUrl::ChatRoleMyPage),
            "chatRoleGetMy" => Ok(ImUrl::ChatRoleGetMy),
            "chatRoleCreateMy" => Ok(ImUrl::ChatRoleCreateMy),
            "chatRoleUpdateMy" => Ok(ImUrl::ChatRoleUpdateMy),
            "chatRoleDeleteMy" => Ok(ImUrl::ChatRoleDeleteMy),
            "chatRoleCategoryList" => Ok(ImUrl::ChatRoleCategoryList),
            "chatRoleCreate" => Ok(ImUrl::ChatRoleCreate),
            "chatRoleUpdate" => Ok(ImUrl::ChatRoleUpdate),
            "chatRoleDelete" => Ok(ImUrl::ChatRoleDelete),
            "chatRoleGet" => Ok(ImUrl::ChatRoleGet),
            "chatRolePage" => Ok(ImUrl::ChatRolePage),

            // ================ API 密钥 ================
            "apiKeyCreate" => Ok(ImUrl::ApiKeyCreate),
            "apiKeyUpdate" => Ok(ImUrl::ApiKeyUpdate),
            "apiKeyDelete" => Ok(ImUrl::ApiKeyDelete),
            "apiKeyGet" => Ok(ImUrl::ApiKeyGet),
            "apiKeyPage" => Ok(ImUrl::ApiKeyPage),
            "apiKeySimpleList" => Ok(ImUrl::ApiKeySimpleList),
            "apiKeyBalance" => Ok(ImUrl::ApiKeyBalance),

            // ================ 平台配置 ================
            "platformList" => Ok(ImUrl::PlatformList),
            "platformAddModel" => Ok(ImUrl::PlatformAddModel),

            // ================ AI 工具 ================
            "toolCreate" => Ok(ImUrl::ToolCreate),
            "toolUpdate" => Ok(ImUrl::ToolUpdate),
            "toolDelete" => Ok(ImUrl::ToolDelete),
            "toolGet" => Ok(ImUrl::ToolGet),
            "toolPage" => Ok(ImUrl::ToolPage),
            "toolSimpleList" => Ok(ImUrl::ToolSimpleList),

            // ================ AI 图像 ================
            "imageMyPage" => Ok(ImUrl::ImageMyPage),
            "imagePublicPage" => Ok(ImUrl::ImagePublicPage),
            "imageGetMy" => Ok(ImUrl::ImageGetMy),
            "imageMyListByIds" => Ok(ImUrl::ImageMyListByIds),
            "imageDraw" => Ok(ImUrl::ImageDraw),
            "imageDeleteMy" => Ok(ImUrl::ImageDeleteMy),
            "imageMidjourneyImagine" => Ok(ImUrl::ImageMidjourneyImagine),
            "imageMidjourneyNotify" => Ok(ImUrl::ImageMidjourneyNotify),
            "imageMidjourneyAction" => Ok(ImUrl::ImageMidjourneyAction),
            "imagePage" => Ok(ImUrl::ImagePage),
            "imageUpdate" => Ok(ImUrl::ImageUpdate),
            "imageDelete" => Ok(ImUrl::ImageDelete),

            // ================ AI 视频生成 ================
            "videoMyPage" => Ok(ImUrl::VideoMyPage),
            "videoGet" => Ok(ImUrl::VideoGet),
            "videoMyListByIds" => Ok(ImUrl::VideoMyListByIds),
            "videoGenerate" => Ok(ImUrl::VideoGenerate),
            "videoDeleteMy" => Ok(ImUrl::VideoDeleteMy),

            // ================ AI 音频生成 ================
            "audioMyPage" => Ok(ImUrl::AudioMyPage),
            "audioGetMy" => Ok(ImUrl::AudioGetMy),
            "audioMyListByIds" => Ok(ImUrl::AudioMyListByIds),
            "audioGenerate" => Ok(ImUrl::AudioGenerate),
            "audioDeleteMy" => Ok(ImUrl::AudioDeleteMy),
            "audioVoices" => Ok(ImUrl::AudioVoices),

            // ================ AI 知识库 ================
            "knowledgePage" => Ok(ImUrl::KnowledgePage),
            "knowledgeGet" => Ok(ImUrl::KnowledgeGet),
            "knowledgeCreate" => Ok(ImUrl::KnowledgeCreate),
            "knowledgeUpdate" => Ok(ImUrl::KnowledgeUpdate),
            "knowledgeDelete" => Ok(ImUrl::KnowledgeDelete),
            "knowledgeSimpleList" => Ok(ImUrl::KnowledgeSimpleList),

            // ================ AI 知识库文档 ================
            "knowledgeDocumentPage" => Ok(ImUrl::KnowledgeDocumentPage),
            "knowledgeDocumentGet" => Ok(ImUrl::KnowledgeDocumentGet),
            "knowledgeDocumentCreate" => Ok(ImUrl::KnowledgeDocumentCreate),
            "knowledgeDocumentCreateList" => Ok(ImUrl::KnowledgeDocumentCreateList),
            "knowledgeDocumentUpdate" => Ok(ImUrl::KnowledgeDocumentUpdate),
            "knowledgeDocumentUpdateStatus" => Ok(ImUrl::KnowledgeDocumentUpdateStatus),
            "knowledgeDocumentDelete" => Ok(ImUrl::KnowledgeDocumentDelete),

            // ================ AI 知识库段落 ================
            "knowledgeSegmentGet" => Ok(ImUrl::KnowledgeSegmentGet),
            "knowledgeSegmentPage" => Ok(ImUrl::KnowledgeSegmentPage),
            "knowledgeSegmentCreate" => Ok(ImUrl::KnowledgeSegmentCreate),
            "knowledgeSegmentUpdate" => Ok(ImUrl::KnowledgeSegmentUpdate),
            "knowledgeSegmentUpdateStatus" => Ok(ImUrl::KnowledgeSegmentUpdateStatus),
            "KnowledgeSegmentSplit" => Ok(ImUrl::KnowledgeSegmentSplit),
            "KnowledgeSegmentGetProcessList" => Ok(ImUrl::KnowledgeSegmentGetProcessList),
            "KnowledgeSegmentSearch" => Ok(ImUrl::KnowledgeSegmentSearch),

            // ================ AI 思维导图 ================
            "mindMapGenerateStream" => Ok(ImUrl::MindMapGenerateStream),
            "mindMapDelete" => Ok(ImUrl::MindMapDelete),
            "mindMapPage" => Ok(ImUrl::MindMapPage),

            // ================ AI 音乐 ================
            "musicMyPage" => Ok(ImUrl::MusicMyPage),
            "musicGenerate" => Ok(ImUrl::MusicGenerate),
            "musicDeleteMy" => Ok(ImUrl::MusicDeleteMy),
            "musicGetMy" => Ok(ImUrl::MusicGetMy),
            "musicUpdateMy" => Ok(ImUrl::MusicUpdateMy),
            "musicPage" => Ok(ImUrl::MusicPage),
            "musicDelete" => Ok(ImUrl::MusicDelete),
            "musicUpdate" => Ok(ImUrl::MusicUpdate),

            // ================ AI 工作流 ================
            "workflowCreate" => Ok(ImUrl::WorkflowCreate),
            "workflowUpdate" => Ok(ImUrl::WorkflowUpdate),
            "workflowDelete" => Ok(ImUrl::WorkflowDelete),
            "workflowGet" => Ok(ImUrl::WorkflowGet),
            "workflowPage" => Ok(ImUrl::WorkflowPage),
            "workflowTest" => Ok(ImUrl::WorkflowTest),

            // ================ AI 写作 ================
            "WriteGenerateStream" => Ok(ImUrl::WriteGenerateStream),
            "WriteDelete" => Ok(ImUrl::WriteDelete),
            "WritePage" => Ok(ImUrl::WritePage),

            // 未匹配的字符串
            _ => Err(anyhow::anyhow!("未知的URL类型: {}", s)),
        }
    }
}

impl FromStr for ImUrl {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::from_str(s)
    }
}

pub trait ImRequest {
    async fn login(&mut self, login_req: LoginReq) -> Result<Option<LoginResp>, anyhow::Error>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::Mutex;

    struct Server {
        token: String,
        refresh_token: String,
        refreshes: AtomicUsize,
    }

    /// 只认 oauth/check 和 oauth/anyTenant/refresh 的极简服务端；换发后旧 refresh token 立即作废
    async fn serve(listener: TcpListener, server: Arc<Mutex<Server>>) {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let server = server.clone();
            tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                let (head, body) = loop {
                    let n = socket.read(&mut chunk).await.unwrap_or(0);
                    if n == 0 {
                        return;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                    let text = String::from_utf8_lossy(&buf).to_string();
                    if let Some(end) = text.find("\r\n\r\n") {
                        let head = text[..end].to_string();
                        let length = head
                            .lines()
                            .find_map(|l| {
                                l.to_ascii_lowercase()
                                    .strip_prefix("content-length:")
                                    .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                            })
                            .unwrap_or(0);
                        if text.len() >= end + 4 + length {
                            break (head, text[end + 4..end + 4 + length].to_string());
                        }
                    }
                };
                let header = |name: &str| {
                    head.lines().find_map(|l| {
                        let (k, v) = l.split_once(':')?;
                        k.trim()
                            .eq_ignore_ascii_case(name)
                            .then(|| v.trim().to_string())
                    })
                };
                // 刷新请求故意慢一点，让并发的请求都能撞上过期
                let reply = if head.starts_with("POST /oauth/anyTenant/refresh") {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    let sent: serde_json::Value = serde_json::from_str(&body).unwrap();
                    let mut s = server.lock().await;
                    if sent["refreshToken"] == s.refresh_token.as_str() {
                        let n = s.refreshes.fetch_add(1, Ordering::SeqCst) + 1;
                        s.token = format!("access-{n}");
                        s.refresh_token = format!("refresh-{n}");
                        json!({"success": true, "code": 200, "data": {"token": s.token, "refreshToken": s.refresh_token}})
                    } else {
                        json!({"success": false, "code": 401, "msg": "invalid refresh token"})
                    }
                } else {
                    let s = server.lock().await;
                    if header("token").as_deref() == Some(s.token.as_str()) {
                        json!({"success": true, "code": 200, "data": "ok"})
                    } else {
                        json!({"success": false, "code": 406, "msg": "expired"})
                    }
                };
                let body = reply.to_string();
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = socket.write_all(response.as_bytes()).await;
            });
        }
    }

    #[tokio::test]
    async fn copies_share_one_refresh_when_the_token_expires() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = Arc::new(Mutex::new(Server {
            token: "access-0".into(),
            refresh_token: "refresh-0".into(),
            refreshes: AtomicUsize::new(0),
        }));
        // 服务端的 access token 已换过一次，客户端手里的已过期
        server.lock().await.token = "access-new".into();
        tokio::spawn(serve(listener, server.clone()));

        let mut shared = ImRequestClient::new(base).unwrap();
        shared.token = Some("expired".into());
        shared.refresh_token = Some("refresh-0".into());

        let copies: Vec<ImRequestClient> = (0..4).map(|_| shared.clone()).collect();
        let results = futures::future::join_all(copies.into_iter().map(|mut copy| async move {
            let result: Result<Option<serde_json::Value>, anyhow::Error> = copy
                .im_request(
                    ImUrl::CheckToken,
                    None::<serde_json::Value>,
                    None::<serde_json::Value>,
                )
                .await;
            (result, copy)
        }))
        .await;

        let s = server.lock().await;
        assert_eq!(s.refreshes.load(Ordering::SeqCst), 1);
        for (result, copy) in &results {
            assert!(result.is_ok(), "{:?}", result);
            assert_eq!(copy.token.as_deref(), Some("access-1"));
            assert_eq!(copy.refresh_token.as_deref(), Some("refresh-1"));
        }
        drop(s);

        let used = shared.refresh_token.clone();
        assert!(shared.adopt_refreshed_tokens(&used, &results[0].1));
        assert_eq!(shared.token.as_deref(), Some("access-1"));
        // 已经写回过，或本对象换过 refresh token（重新登录），都不再覆盖
        assert!(!shared.adopt_refreshed_tokens(&used, &results[1].1));
        assert!(!shared.adopt_refreshed_tokens(&Some("other".into()), &results[1].1));
    }
}
