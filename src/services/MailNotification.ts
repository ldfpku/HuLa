type NotificationTab = {
  opener: Window | null
  location: Pick<Location, 'replace'>
  close: () => void
}

export function trustedWebMailSsoUrl(address: string, trustedOrigin: string): string {
  let origin: URL
  let url: URL
  try {
    origin = new URL(trustedOrigin)
    url = new URL(address)
  } catch (error) {
    throw new Error('邮件登录地址无效', { cause: error })
  }
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    url.origin !== origin.origin ||
    url.username ||
    url.password ||
    !/^\/api\/im\/mail\/sso\/[a-f0-9]{48}$/.test(url.pathname)
  ) {
    throw new Error('邮件登录地址无效')
  }
  return url.href
}

export async function openWebMailNotification(actions: {
  open: () => NotificationTab | null
  requestSso: () => Promise<string>
  isCurrentAccount: () => boolean
  trustedOrigin: string
}): Promise<void> {
  const tab = actions.open()
  if (!tab) throw new Error('浏览器阻止了邮件窗口，请允许弹出窗口后重试')
  try {
    tab.opener = null
    const url = trustedWebMailSsoUrl(await actions.requestSso(), actions.trustedOrigin)
    if (!actions.isCurrentAccount()) throw new Error('账号已切换，请重新打开邮件')
    tab.location.replace(url)
  } catch (error) {
    try {
      tab.close()
    } catch (closeError) {
      throw new AggregateError([error, closeError], '打开邮件失败，关闭邮件窗口也失败')
    }
    throw error
  }
}
