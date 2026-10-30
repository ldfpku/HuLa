import { describe, expect, it, vi } from 'vitest'
import { changeOwnUserState, userStateChangeError } from './UserStateChange'

describe('changing the current user state', () => {
  it('normalizes the reset state after a successful update', async () => {
    const change = vi.fn().mockResolvedValue(undefined)
    const apply = vi.fn()
    await changeOwnUserState('0', {
      currentAccount: () => 'a',
      change,
      readCurrent: vi.fn(),
      isCurrent: () => true,
      apply,
      accountChangedMessage: 'account changed'
    })
    expect(change).toHaveBeenCalledWith('0')
    expect(apply).toHaveBeenCalledWith('1')
  })

  it('does not apply an old account response to the new account', async () => {
    let account = 'a'
    let finish!: () => void
    const apply = vi.fn()
    const pending = changeOwnUserState('2', {
      currentAccount: () => account,
      change: () => new Promise<void>((resolve) => (finish = resolve)),
      readCurrent: vi.fn(),
      isCurrent: () => true,
      apply,
      accountChangedMessage: 'account changed'
    })
    account = 'b'
    finish()
    await expect(pending).rejects.toThrow('account changed')
    expect(apply).not.toHaveBeenCalled()
  })

  it('preserves the server message when the state was saved but notification failed', async () => {
    const error = new Error('状态已保存，但同步失败，系统将自动重试')
    const apply = vi.fn()
    await expect(
      changeOwnUserState('5', {
        currentAccount: () => 'a',
        change: async () => {
          throw error
        },
        readCurrent: vi.fn().mockResolvedValue({ uid: 'a', userStateId: '5' }),
        isCurrent: () => true,
        apply,
        accountChangedMessage: 'account changed'
      })
    ).rejects.toBe(error)
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith('5'))
    expect(userStateChangeError(error, 'fallback')).toBe(error.message)
    expect(userStateChangeError('server message', 'fallback')).toBe('server message')
    expect(userStateChangeError(null, 'fallback')).toBe('fallback')
  })

  it('discards a late status reconciliation after an account switch', async () => {
    let account = 'a'
    let finish!: (value: { uid: string; userStateId: string }) => void
    const apply = vi.fn()
    await expect(
      changeOwnUserState('2', {
        currentAccount: () => account,
        change: async () => {
          throw new Error('network failed')
        },
        readCurrent: () => new Promise((resolve) => (finish = resolve)),
        isCurrent: () => true,
        apply,
        accountChangedMessage: 'account changed'
      })
    ).rejects.toThrow('network failed')
    account = 'b'
    finish({ uid: 'a', userStateId: '2' })
    await Promise.resolve()
    expect(apply).not.toHaveBeenCalled()
  })

  it('discards an old failed-change read after a later selection', async () => {
    let revision = 1
    let finish!: (value: { uid: string; userStateId: string }) => void
    const apply = vi.fn()
    await expect(
      changeOwnUserState('2', {
        currentAccount: () => 'a',
        change: async () => {
          throw new Error('network failed')
        },
        readCurrent: () => new Promise((resolve) => (finish = resolve)),
        isCurrent: () => revision === 1,
        apply,
        accountChangedMessage: 'account changed'
      })
    ).rejects.toThrow('network failed')
    revision = 2
    finish({ uid: 'a', userStateId: '2' })
    await Promise.resolve()
    expect(apply).not.toHaveBeenCalled()
  })

  it('does not apply a successful response after the owning view is gone', async () => {
    let active = true
    let finish!: () => void
    const apply = vi.fn()
    const pending = changeOwnUserState('2', {
      currentAccount: () => 'a',
      change: () => new Promise<void>((resolve) => (finish = resolve)),
      readCurrent: vi.fn(),
      isCurrent: () => active,
      apply,
      accountChangedMessage: 'account changed'
    })
    active = false
    finish()
    await expect(pending).resolves.toBe(false)
    expect(apply).not.toHaveBeenCalled()
  })
})
