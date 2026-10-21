import { describe, expect, it } from 'vitest'
import {
  detectMobileOs,
  installGuideUrl,
  installHintText,
  isInAppBrowser,
  shouldShowInstallHint
} from './installHintUtils'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

describe('installHintUtils', () => {
  it('识别手机系统，iPad 自称 Mac 时按触屏判断', () => {
    expect(detectMobileOs(IPHONE)).toBe('ios')
    expect(detectMobileOs(ANDROID)).toBe('android')
    expect(detectMobileOs(MAC, 5)).toBe('ios')
    expect(detectMobileOs(MAC, 0)).toBeNull()
    expect(detectMobileOs(WINDOWS, 10)).toBeNull()
  })

  it('只在手机浏览器里、未装到主屏幕且没关过时提示', () => {
    const base = { os: 'ios' as const, standalone: false, dismissed: false, embedded: false }
    expect(shouldShowInstallHint(base)).toBe(true)
    expect(shouldShowInstallHint({ ...base, os: null })).toBe(false)
    expect(shouldShowInstallHint({ ...base, standalone: true })).toBe(false)
    expect(shouldShowInstallHint({ ...base, dismissed: true })).toBe(false)
    expect(shouldShowInstallHint({ ...base, embedded: true })).toBe(false)
  })

  it('内置浏览器先提示用浏览器打开', () => {
    expect(isInAppBrowser(`${ANDROID} MicroMessenger/8.0.50`)).toBe(true)
    expect(isInAppBrowser(ANDROID)).toBe(false)
    expect(installHintText('android', true, false)).toContain('在浏览器中打开')
    expect(installHintText('ios', false, false)).toContain('添加到主屏幕')
    expect(installHintText('android', false, false)).toContain('⋮')
  })

  it('说明页在同域名的邮箱设置里', () => {
    expect(installGuideUrl('https://mail.smjtools.com/')).toBe('https://mail.smjtools.com/settings/mobile')
  })
})
