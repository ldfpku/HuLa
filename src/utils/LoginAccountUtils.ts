/**
 * 账号都在服务端的登录域名下（如 smjtools.com），登录框只需输入 @ 前面的用户名，
 * 服务端会补全域名；输入完整邮箱地址也照样可以登录。
 */

/** 登录域名的本地缓存，下次打开登录窗口时不用等服务端返回就能显示后缀 */
export const LOGIN_DOMAIN_STORAGE_KEY = 'SMJ_LOGIN_DOMAIN'

/** 去掉开头的 @ 并转小写，无效时返回空字符串 */
export const normalizeLoginDomain = (domain: unknown): string => {
  if (typeof domain !== 'string') return ''
  return domain.trim().replace(/^@/, '').toLowerCase()
}

/** 用户名补全为完整邮箱地址；已含 @ 或没有登录域名时原样返回 */
export const completeLoginAccount = (account: string, domain: string): string => {
  const value = account.trim()
  if (!value || value.includes('@') || !domain) return value
  return `${value}@${domain}`
}

/** 登录域名下的完整地址显示为用户名，其它地址原样显示 */
export const shortLoginName = (account: string, domain: string): string => {
  if (!domain) return account
  const suffix = `@${domain}`.toLowerCase()
  return account.toLowerCase().endsWith(suffix) ? account.slice(0, -suffix.length) : account
}

/** 输入框右侧要显示的域名后缀：已输入 @ 时不显示 */
export const loginAccountSuffix = (account: string, domain: string): string => {
  return domain && !account.includes('@') ? `@${domain}` : ''
}
