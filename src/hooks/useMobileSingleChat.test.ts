import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  updateSession: vi.fn(),
  getSessionList: vi.fn(),
  preload: vi.fn(),
  getDetail: vi.fn(),
  push: vi.fn(),
  error: vi.fn()
}))

vi.mock('@/hooks/useMessage', () => ({ useMessage: () => ({ preloadChatRoom: mocks.preload }) }))
vi.mock('@/router', () => ({ default: { push: mocks.push } }))
vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    getSession: mocks.getSession,
    updateSessionLastActiveTime: mocks.updateSession,
    getSessionList: mocks.getSessionList
  })
}))
vi.mock('@/utils/ImRequestUtils', () => ({ getSessionDetailWithFriends: mocks.getDetail }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

import { useMobileSingleChat } from './useMobileSingleChat'

describe('open a mobile directory chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getDetail.mockResolvedValue({ roomId: 'room' })
    mocks.getSession.mockReturnValue(undefined)
    mocks.getSessionList.mockResolvedValue(undefined)
    mocks.push.mockResolvedValue(undefined)
    Object.assign(window, { $message: { error: mocks.error } })
  })

  it('opens the requested user and selects the returned room', async () => {
    await useMobileSingleChat().openMobileSingleChat('peer')
    expect(mocks.getDetail).toHaveBeenCalledWith({ id: 'peer', roomType: 2 })
    expect(mocks.getSessionList).toHaveBeenCalledWith(true)
    expect(mocks.preload).toHaveBeenCalledWith('room')
    expect(mocks.push).toHaveBeenCalledWith('/mobile/chatRoom/chatMain')
  })

  it('reports an error and does not navigate when opening fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getDetail.mockRejectedValue(new Error('offline'))
    await useMobileSingleChat().openMobileSingleChat('peer')
    expect(mocks.error).toHaveBeenCalledWith('message.directory_contact.open_failed')
    expect(mocks.preload).not.toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
