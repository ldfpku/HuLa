import { describe, expect, it, vi } from 'vitest'
import { openWebMailNotification, trustedWebMailSsoUrl } from './MailNotification'

describe('web mail notification', () => {
  const url = `https://mail.example.test/api/im/mail/sso/${'a'.repeat(48)}?next=%2Finbox%2Fm1`

  it('reserves and isolates a tab before requesting the one-time link', async () => {
    const tab = { opener: window, location: { replace: vi.fn() }, close: vi.fn() }
    const open = vi.fn(() => tab)
    const requestSso = vi.fn().mockResolvedValue(url)
    await openWebMailNotification({
      open,
      requestSso,
      isCurrentAccount: () => true,
      trustedOrigin: 'https://mail.example.test'
    })
    expect(open.mock.invocationCallOrder[0]).toBeLessThan(requestSso.mock.invocationCallOrder[0])
    expect(tab.opener).toBeNull()
    expect(tab.location.replace).toHaveBeenCalledWith(url)
  })

  it('reports blocked tabs without requesting a one-time link', async () => {
    const requestSso = vi.fn()
    await expect(
      openWebMailNotification({
        open: () => null,
        requestSso,
        isCurrentAccount: () => true,
        trustedOrigin: 'https://mail.example.test'
      })
    ).rejects.toThrow('阻止')
    expect(requestSso).not.toHaveBeenCalled()
  })

  it('closes the reserved tab when the account changes or the link is invalid', async () => {
    const tab = { opener: window, location: { replace: vi.fn() }, close: vi.fn() }
    await expect(
      openWebMailNotification({
        open: () => tab,
        requestSso: async () => url,
        isCurrentAccount: () => false,
        trustedOrigin: 'https://mail.example.test'
      })
    ).rejects.toThrow('账号已切换')
    await expect(
      openWebMailNotification({
        open: () => tab,
        requestSso: async () => 'https://other.example.test/',
        isCurrentAccount: () => true,
        trustedOrigin: 'https://mail.example.test'
      })
    ).rejects.toThrow('登录地址无效')
    expect(tab.close).toHaveBeenCalledTimes(2)
    expect(tab.location.replace).not.toHaveBeenCalled()
  })

  it('only accepts one-time links on the configured origin', () => {
    expect(trustedWebMailSsoUrl(url, 'https://mail.example.test')).toBe(url)
    expect(trustedWebMailSsoUrl(url, 'https://mail.example.test/')).toBe(url)
    expect(() =>
      trustedWebMailSsoUrl(url.replace('mail.example.test', 'attacker.example.test'), 'https://mail.example.test')
    ).toThrow('地址无效')
    expect(() => trustedWebMailSsoUrl(url.replace('https:', 'http:'), 'https://mail.example.test')).toThrow('地址无效')
    expect(() =>
      trustedWebMailSsoUrl(url.replace('mail.example.test', 'mail.example.test:8443'), 'https://mail.example.test')
    ).toThrow('地址无效')
    expect(() => trustedWebMailSsoUrl(url.replace('https://', 'https://user@'), 'https://mail.example.test')).toThrow(
      '地址无效'
    )
    expect(() => trustedWebMailSsoUrl(url, 'https://mail.example.test/proxy')).toThrow('地址无效')
    expect(() => trustedWebMailSsoUrl('not a url', 'https://mail.example.test')).toThrow('地址无效')
    expect(() => trustedWebMailSsoUrl(url, 'not a url')).toThrow('地址无效')
  })

  it('closes the reserved tab when the link is on another origin', async () => {
    const tab = { opener: window, location: { replace: vi.fn() }, close: vi.fn() }
    await expect(
      openWebMailNotification({
        open: () => tab,
        requestSso: async () => url.replace('mail.example.test', 'attacker.example.test'),
        isCurrentAccount: () => true,
        trustedOrigin: 'https://mail.example.test'
      })
    ).rejects.toThrow('地址无效')
    expect(tab.close).toHaveBeenCalledOnce()
    expect(tab.location.replace).not.toHaveBeenCalled()
  })
})
