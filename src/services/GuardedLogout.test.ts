import { describe, expect, it, vi } from 'vitest'
import { guardedLogout } from './GuardedLogout'

describe('guarded mail logout', () => {
  it('does not log out when an unsaved draft blocks preparation', async () => {
    const actions = { prepare: vi.fn().mockRejectedValue(new Error('draft pending')), release: vi.fn(), logout: vi.fn() }
    await expect(guardedLogout(actions)).rejects.toThrow('draft pending')
    expect(actions.logout).not.toHaveBeenCalled()
    expect(actions.release).not.toHaveBeenCalled()
  })

  it('unlocks mail if logout fails', async () => {
    const actions = { prepare: vi.fn().mockResolvedValue(true), release: vi.fn(), logout: vi.fn().mockRejectedValue(new Error('offline')) }
    await expect(guardedLogout(actions)).rejects.toThrow('offline')
    expect(actions.release).toHaveBeenCalledOnce()
  })

  it('surfaces both failures if unlocking also fails', async () => {
    const actions = { prepare: vi.fn().mockResolvedValue(true), release: vi.fn().mockRejectedValue(new Error('unlock')), logout: vi.fn().mockRejectedValue(new Error('offline')) }
    await expect(guardedLogout(actions)).rejects.toBeInstanceOf(AggregateError)
  })
})
