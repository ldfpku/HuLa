import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearDesktopLogin,
  DESKTOP_LOGIN_SESSION_MS,
  hasValidDesktopLogin,
  recordDesktopLogin
} from './DesktopLoginSession'

describe('desktop login session', () => {
  beforeEach(() => localStorage.clear())

  it('expires 30 days after manual login without sliding', () => {
    const start = 1_000_000
    recordDesktopLogin('a', start)
    expect(hasValidDesktopLogin('a', start + DESKTOP_LOGIN_SESSION_MS - 1)).toBe(true)
    expect(hasValidDesktopLogin('a', start + DESKTOP_LOGIN_SESSION_MS)).toBe(false)
    expect(hasValidDesktopLogin('a', start - 1)).toBe(false)
  })

  it('isolates accounts and clears the selected account', () => {
    recordDesktopLogin('a', 100)
    recordDesktopLogin('b', 200)
    clearDesktopLogin('a')
    expect(hasValidDesktopLogin('a', 300)).toBe(false)
    expect(hasValidDesktopLogin('b', 300)).toBe(true)
    expect(hasValidDesktopLogin(undefined, 300)).toBe(false)
  })
})
