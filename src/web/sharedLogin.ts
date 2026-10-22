/**
 * 网页版和邮件网页同域名、共用一套登录：
 * 登录页加载后，先用本机保存的 token 自动登录，没有就用邮件网页的登录状态换一组聊天 token；
 * 邮件也没登录时跳到邮件登录页，登录后回到 /im/。
 */
import { loginCommand } from '@/services/tauriCommand'
import { requestPath, tokenStore } from './imClient'

const REDIRECT_KEY = 'smj-web-login-redirect'

/** 跳邮件登录页。邮件已登录却换不到聊天 token 时会来回跳，所以 30 秒内只跳一次，之后留在聊天登录页 */
const goToMailLogin = () => {
  if (import.meta.env.DEV) return
  const last = Number(sessionStorage.getItem(REDIRECT_KEY) || 0)
  if (Date.now() - last < 30_000) return
  sessionStorage.setItem(REDIRECT_KEY, String(Date.now()))
  location.replace(`/login?next=${encodeURIComponent(import.meta.env.BASE_URL)}`)
}

export const tryWebSignIn = async (label: string) => {
  if (label !== 'login') return
  let tokens = tokenStore.get()
  if (!tokens) {
    const resp = await requestPath<{ token: string; refreshToken: string; uid: string }>('POST', 'web/session').catch(
      () => null
    )
    if (!resp?.token) {
      goToMailLogin()
      return
    }
    tokens = { uid: resp.uid, token: resp.token, refreshToken: resp.refreshToken }
    tokenStore.set(tokens)
  }
  await loginCommand({ uid: tokens.uid }, true).catch(() => {
    tokenStore.clear()
    goToMailLogin()
  })
}
