import { flushPromises } from '@vue/test-utils'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  createWindow: vi.fn(),
  showInfo: vi.fn(),
  showError: vi.fn(),
  setAutoLogin: vi.fn(),
  ensureReady: vi.fn(),
  user: { userInfo: { uid: 'user-1', account: 'user@example.test', avatar: '', name: 'User' } }
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn(), listen: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: { getByLabel: vi.fn().mockResolvedValue(null) } }))
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn() }))
vi.mock('@vueuse/core', async () => {
  const { ref } = await import('vue')
  return { useNetwork: () => ({ isOnline: ref(true) }) }
})
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/hooks/useWindow.ts', () => ({
  useWindow: () => ({ resizeWindow: vi.fn(), createWebviewWindow: mocks.createWindow })
}))
vi.mock('@/stores/global.ts', () => ({
  useGlobalStore: defineStore('login-test-global', { state: () => ({ isTrayMenuShow: false }) })
}))
vi.mock('@/stores/chat', () => ({ useChatStore: () => ({}) }))
vi.mock('@/stores/ws', () => ({ LoginStatus: { Init: 0 }, useWsLoginStore: () => ({}) }))
vi.mock('../stores/setting', () => ({
  useSettingStore: () => ({ login: { autoLogin: true }, setAutoLogin: mocks.setAutoLogin })
}))
vi.mock('../stores/group', () => ({ useGroupStore: () => ({}) }))
vi.mock('../stores/cached', () => ({ useCachedStore: () => ({}) }))
vi.mock('../stores/config', () => ({ useConfigStore: () => ({}) }))
vi.mock('../stores/userStatus', () => ({ useUserStatusStore: () => ({}) }))
vi.mock('../stores/user', () => ({ useUserStore: () => mocks.user }))
vi.mock('../stores/loginHistory', () => ({ useLoginHistoriesStore: () => ({}) }))
vi.mock('@/stores/initialSync', () => ({ useInitialSyncStore: () => ({}) }))
vi.mock('@/stores/contacts', () => ({ useContactStore: () => ({}) }))
vi.mock('@/stores/emoji', () => ({ useEmojiStore: () => ({}) }))
vi.mock('@/services/webSocketRust', () => ({ default: {} }))
vi.mock('../utils/ImRequestUtils', () => ({ getAllUserState: vi.fn(), getUserDetail: vi.fn() }))
vi.mock('../services/fingerprint', () => ({ getEnhancedFingerprint: vi.fn().mockResolvedValue('client-id') }))
vi.mock('@/utils/AppStateReady', () => ({ ensureAppStateReady: mocks.ensureReady }))
vi.mock('@/utils/ReadCountQueue', () => ({ clearListener: vi.fn() }))
vi.mock('@/utils/TauriInvokeHandler.ts', () => ({
  ErrorType: {},
  invokeSilently: vi.fn(),
  invokeWithErrorHandler: vi.fn()
}))
vi.mock('@/utils/PlatformConstants', () => ({
  isDesktop: () => true,
  isMac: () => false,
  isMobile: () => false,
  isWeb: () => false
}))
vi.mock('@/services/i18n', () => ({ useI18nGlobal: () => ({ t: (key: string) => key }) }))
vi.mock('./useMitt', () => ({ useMitt: { emit: vi.fn() } }))
vi.mock('./useLinkSegments', () => ({ openExternalUrl: vi.fn() }))
vi.mock('@/utils/TokenManager', () => ({ TokenManager: {} }))

import { DESKTOP_LOGIN_SESSION_MS, hasValidDesktopLogin, recordDesktopLogin } from '@/utils/DesktopLoginSession'
import { useLogin } from './useLogin'

describe('desktop login session integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    localStorage.clear()
    mocks.invoke.mockResolvedValue({ uid: 'user-1' })
    mocks.createWindow.mockResolvedValue({})
    mocks.ensureReady.mockResolvedValue(undefined)
    Object.assign(window, { $message: { info: mocks.showInfo, error: mocks.showError } })
  })

  it('records a 30-day session after a manual login succeeds', async () => {
    const login = useLogin()
    login.info.value.account = 'user@example.test'
    login.info.value.password = 'password'
    await login.normalLogin('PC', true, false)
    await flushPromises()
    expect(hasValidDesktopLogin('user-1')).toBe(true)
    expect(mocks.createWindow).toHaveBeenCalledOnce()
  })

  it('rejects auto login without a valid local session', async () => {
    const login = useLogin()
    await login.normalLogin('PC', true, true)
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.showInfo).toHaveBeenCalledWith('login.session_expired')
  })

  it('requires manual login at the 30-day boundary', async () => {
    recordDesktopLogin('user-1', Date.now() - DESKTOP_LOGIN_SESSION_MS)
    const login = useLogin()
    await login.normalLogin('PC', true, true)
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.showInfo).toHaveBeenCalledWith('login.session_expired')
  })

  it('uses the refresh-token flow without a password and does not extend the session', async () => {
    const startedAt = Date.now() - 1000
    recordDesktopLogin('user-1', startedAt)
    const login = useLogin()
    await login.normalLogin('PC', true, true)
    await flushPromises()
    expect(mocks.invoke).toHaveBeenCalledWith(
      'login_command',
      expect.objectContaining({ data: expect.objectContaining({ uid: 'user-1', isAutoLogin: true, password: '' }) })
    )
    expect(localStorage.getItem('desktop-login-session:user-1')).toBe(String(startedAt))
  })

  it('keeps auto login available when the network is unavailable', async () => {
    recordDesktopLogin('user-1')
    mocks.invoke.mockRejectedValue('网络连接失败，请检查网络后重试')
    const login = useLogin()
    await login.normalLogin('PC', true, true)
    await flushPromises()
    expect(login.uiState.value).toBe('auto')
    expect(mocks.setAutoLogin).not.toHaveBeenCalledWith(false)
  })

  it('returns to manual login when the server rejects the refresh token', async () => {
    recordDesktopLogin('user-1')
    mocks.invoke.mockRejectedValue('自动登录失败，请手动登录')
    const login = useLogin()
    login.uiState.value = 'auto'
    await login.normalLogin('PC', true, true)
    await flushPromises()
    expect(login.uiState.value).toBe('manual')
    expect(login.info.value.account).toBe('user@example.test')
    expect(mocks.setAutoLogin).not.toHaveBeenCalledWith(false)
  })

  it('shows an error and allows retry when login preparation fails', async () => {
    mocks.ensureReady.mockRejectedValue(new Error('initialization failed'))
    const login = useLogin()
    login.info.value.account = 'user@example.test'
    login.info.value.password = 'password'
    await login.normalLogin('PC', true, false)
    expect(mocks.showError).toHaveBeenCalledWith('login.status.prepare_failed')
    expect(login.loading.value).toBe(false)
    expect(login.loginDisabled.value).toBe(false)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})
