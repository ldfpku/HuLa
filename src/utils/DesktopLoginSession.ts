export const DESKTOP_LOGIN_SESSION_MS = 30 * 24 * 60 * 60 * 1000

const sessionKey = (uid: string) => `desktop-login-session:${uid}`

export const recordDesktopLogin = (uid: string, now = Date.now()) => {
  if (!uid) throw new Error('无法记录免登录期限：缺少用户 ID')
  localStorage.setItem(sessionKey(uid), String(now))
}

export const clearDesktopLogin = (uid: string) => {
  if (uid) localStorage.removeItem(sessionKey(uid))
}

export const desktopLoginRemaining = (uid: string | undefined, now = Date.now()) => {
  if (!uid) return 0
  const stored = localStorage.getItem(sessionKey(uid))
  if (!stored) return 0
  const startedAt = Number(stored)
  if (!Number.isFinite(startedAt) || startedAt <= 0 || now < startedAt) return 0
  return Math.max(0, DESKTOP_LOGIN_SESSION_MS - (now - startedAt))
}

export const hasValidDesktopLogin = (uid: string | undefined, now = Date.now()) => desktopLoginRemaining(uid, now) > 0
