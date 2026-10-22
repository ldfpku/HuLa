import { describe, expect, it } from 'vitest'
import { buildPermissionGuide, detectBrowserOs } from './DevicePermissionUtils'

describe('DevicePermissionUtils', () => {
  it('Mac 桌面版给出重新授权和系统设置两条路，并说明列表里没有 SMJ 时怎么办', () => {
    for (const kind of ['microphone', 'camera'] as const) {
      const guide = buildPermissionGuide(kind, 'mac', { nativeStatus: 'denied' })
      const name = kind === 'camera' ? '摄像头' : '麦克风'
      expect(guide.canReauthorize).toBe(true)
      expect(guide.canOpenSettings).toBe(true)
      expect(guide.steps.join('')).toContain(`隐私与安全性 → ${name}`)
      expect(guide.steps.join('')).toContain('列表里没有 SMJ')
      expect(guide.steps.join('')).toContain('重新授权')
    }
  })

  it('Mac 被管理策略限制时不提供重新授权', () => {
    const guide = buildPermissionGuide('microphone', 'mac', { nativeStatus: 'restricted' })
    expect(guide.canReauthorize).toBe(false)
    expect(guide.intro).toContain('管理员')
  })

  it('Windows 提醒打开“允许桌面应用访问”', () => {
    const guide = buildPermissionGuide('camera', 'windows')
    expect(guide.canReauthorize).toBe(false)
    expect(guide.steps.join('')).toContain('允许桌面应用访问你的摄像头')
  })

  it('网页版说明浏览器地址栏里放行，不提供打开系统设置', () => {
    const mac = buildPermissionGuide('microphone', 'web', { browserOs: 'mac' })
    expect(mac.canOpenSettings).toBe(false)
    expect(mac.steps.join('')).toContain('地址栏')
    expect(mac.note).toContain('隐私与安全性 → 麦克风')
    expect(buildPermissionGuide('microphone', 'web', { browserOs: 'windows' }).note).toContain('允许桌面应用')
    expect(buildPermissionGuide('microphone', 'web').note).toBeUndefined()
  })

  it('文案里不出现 HuLa', () => {
    for (const platform of ['mac', 'windows', 'web', 'other'] as const) {
      const guide = buildPermissionGuide('microphone', platform, { browserOs: 'mac' })
      expect(JSON.stringify(guide)).not.toMatch(/hula/i)
    }
  })

  it('识别浏览器所在系统', () => {
    expect(detectBrowserOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130')).toBe('mac')
    expect(detectBrowserOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows')
    expect(detectBrowserOs('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('other')
  })
})
