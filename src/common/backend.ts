/**
 * 服务端为 mailflare（Cloudflare Workers）时的账号能力开关。
 * 账号由 mailflare 管理员创建，使用邮箱和密码登录，因此不提供第三方登录、扫码登录和自助注册。
 */
export const ACCOUNT_FEATURES = {
  thirdPartyLogin: false,
  qrCodeLogin: false,
  selfRegister: false
} as const

/** 账号开启两步验证且未提交验证码时，服务端返回的错误信息 */
export const MFA_REQUIRED_MESSAGE = 'MFA_REQUIRED'
