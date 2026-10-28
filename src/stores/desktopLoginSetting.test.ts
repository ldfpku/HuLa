import { createPinia, setActivePinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const isWeb = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/app', () => ({ setTheme: vi.fn() }))
vi.mock('@/utils/PlatformConstants', () => ({ isDesktop: () => true, isMac: () => false, isWeb }))

import { useSettingStore } from './setting'
import { ThemeEnum } from '@/enums'

describe('desktop login preference', () => {
  beforeEach(() => {
    isWeb.mockReturnValue(false)
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('defaults to automatic login but allows users to disable it', () => {
    const settings = useSettingStore()
    expect(settings.login.autoLogin).toBe(true)
    expect(settings.themes.pattern).toBe(ThemeEnum.LIGHT)
    settings.setAutoLogin(false)
    expect(settings.login.autoLogin).toBe(false)
  })

  it('does not change the default for the web application', () => {
    isWeb.mockReturnValue(true)
    const settings = useSettingStore()
    expect(settings.login.autoLogin).toBe(false)
    expect(settings.themes.pattern).toBe(ThemeEnum.OS)
  })

  it('preserves an explicitly chosen dark theme', () => {
    const settings = useSettingStore()
    settings.themes.pattern = ThemeEnum.DARK
    settings.normalizeThemeState()
    expect(settings.themes.content).toBe(ThemeEnum.DARK)
  })

  it('restores a previously chosen dark theme rather than replacing it with the light default', () => {
    const first = createPinia().use(createPersistedState({ auto: true }))
    createApp({}).use(first)
    setActivePinia(first)
    useSettingStore().toggleTheme(ThemeEnum.DARK)

    const restored = createPinia().use(createPersistedState({ auto: true }))
    createApp({}).use(restored)
    setActivePinia(restored)
    expect(useSettingStore().themes.pattern).toBe(ThemeEnum.DARK)
  })
})
