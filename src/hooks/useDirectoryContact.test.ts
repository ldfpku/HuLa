import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('@/stores/contacts', () => ({ useContactStore: () => ({ refreshDirectoryContact: mocks.refresh }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

import { useDirectoryContact } from './useDirectoryContact'

describe('directory contact feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, { $message: { error: mocks.error, warning: mocks.warning } })
  })

  it('allows opening the verified contact', async () => {
    mocks.refresh.mockResolvedValue('found')
    await expect(useDirectoryContact().refreshDirectoryContact('peer')).resolves.toBe(true)
    expect(mocks.refresh).toHaveBeenCalledWith('peer')
    expect(mocks.error).not.toHaveBeenCalled()
    expect(mocks.warning).not.toHaveBeenCalled()
  })

  it.each([
    ['failed', 'error', 'message.directory_contact.refresh_failed'],
    ['missing', 'warning', 'message.directory_contact.unavailable']
  ])('does not open a contact when the result is %s', async (result, method, message) => {
    mocks.refresh.mockResolvedValue(result)
    await expect(useDirectoryContact().refreshDirectoryContact('peer')).resolves.toBe(false)
    expect(mocks[method as 'error' | 'warning']).toHaveBeenCalledWith(message)
  })
})
