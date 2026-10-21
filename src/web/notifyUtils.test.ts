import { describe, expect, it } from 'vitest'
import { badgeText, baseTitle, isPageActive, titleWithUnread, withBasePath } from './notifyUtils'

describe('notifyUtils', () => {
  it('formats badge counts', () => {
    expect(badgeText(0)).toBe('')
    expect(badgeText(-1)).toBe('')
    expect(badgeText(7)).toBe('7')
    expect(badgeText(100)).toBe('99+')
  })

  it('adds and replaces the unread prefix in titles', () => {
    expect(titleWithUnread('SMJ', 3)).toBe('(3) SMJ')
    expect(titleWithUnread('(3) SMJ', 5)).toBe('(5) SMJ')
    expect(titleWithUnread('(99+) SMJ', 0)).toBe('SMJ')
    expect(baseTitle('(12) 消息')).toBe('消息')
  })

  it('treats the page as active only when visible and focused', () => {
    expect(isPageActive({ visibilityState: 'visible', hasFocus: () => true })).toBe(true)
    expect(isPageActive({ visibilityState: 'hidden', hasFocus: () => true })).toBe(false)
    expect(isPageActive({ visibilityState: 'visible', hasFocus: () => false })).toBe(false)
  })

  it('prefixes site paths with the base path', () => {
    expect(withBasePath('/im/', '/logo.png')).toBe('/im/logo.png')
    expect(withBasePath('/im/', '/im/logo.png')).toBe('/im/logo.png')
    expect(withBasePath('/im/', 'https://mail.smjtools.com/a.png')).toBe('https://mail.smjtools.com/a.png')
    expect(withBasePath('/', '/logo.png')).toBe('/logo.png')
  })
})
