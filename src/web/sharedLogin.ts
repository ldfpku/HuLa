/**
 * 网页版和邮件网页同域名：已登录邮件的人打开聊天不用再输密码。
 * 登录页加载后，先用本机保存的 token 自动登录，没有就用邮件网页的登录状态换一组聊天 token。
 */
import { loginCommand } from '@/services/tauriCommand'
import { requestPath, tokenStore } from './imClient'

export const tryWebSignIn = async (label: string) => {
  if (label !== 'login') return
  let tokens = tokenStore.get()
  if (!tokens) {
    if (tokenStore.signedOut()) return
    const resp = await requestPath<{ token: string; refreshToken: string; uid: string }>('POST', 'web/session').catch(
      () => null
    )
    if (!resp?.token) return
    tokens = { uid: resp.uid, token: resp.token, refreshToken: resp.refreshToken }
    tokenStore.set(tokens)
  }
  await loginCommand({ uid: tokens.uid }, true).catch(() => tokenStore.clear())
}
