const DESKTOP_MARKER = 'smj_desktop'

export function desktopMailTarget(path = '/inbox'): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('邮件窗口地址无效')
  }
  const url = new URL(path, 'https://desktop-mail.invalid')
  if (url.origin !== 'https://desktop-mail.invalid') throw new Error('邮件窗口地址无效')
  url.searchParams.set(DESKTOP_MARKER, '1')
  return `${url.pathname}${url.search}${url.hash}`
}
