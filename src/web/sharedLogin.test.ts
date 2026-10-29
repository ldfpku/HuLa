import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  request: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
  message: vi.fn()
}))

vi.mock('@/services/tauriCommand', () => ({ loginCommand: mocks.login }))
vi.mock('./imClient', () => ({
  requestPath: mocks.request,
  tokenStore: { get: mocks.get, set: mocks.set, clear: mocks.clear }
}))

import { tryWebSignIn } from './sharedLogin'

describe('shared web login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    Object.assign(window, { $message: { error: mocks.message } })
    mocks.get.mockReturnValue({ uid: 'user', token: 'token', refreshToken: 'refresh' })
  })

  afterEach(() => vi.restoreAllMocks())

  it('keeps saved tokens and reports a network timeout during login', async () => {
    mocks.login.mockRejectedValue(new Error('network_error: 请求超时'))
    await tryWebSignIn('login')
    expect(mocks.clear).not.toHaveBeenCalled()
    expect(mocks.message).toHaveBeenCalledWith('network_error: 请求超时')
  })

  it('clears tokens only when login explicitly requires reauthentication', async () => {
    mocks.login.mockRejectedValue('请重新登录')
    await tryWebSignIn('login')
    expect(mocks.clear).toHaveBeenCalledOnce()
  })

  it('reports a network failure when exchanging a mail session', async () => {
    mocks.get.mockReturnValue(null)
    mocks.request.mockRejectedValue(new Error('network_error: 请求超时'))
    await tryWebSignIn('login')
    expect(mocks.message).toHaveBeenCalledWith('network_error: 请求超时')
    expect(mocks.set).not.toHaveBeenCalled()
    expect(mocks.login).not.toHaveBeenCalled()
  })
})
