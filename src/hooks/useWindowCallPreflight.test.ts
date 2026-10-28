import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  preflight: vi.fn(),
  startMeeting: vi.fn(),
  global: { currentSession: { type: 0 }, currentSessionRoomId: 'room' }
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: vi.fn() }))
vi.mock('@tauri-apps/api/window', () => ({ UserAttentionType: {}, primaryMonitor: vi.fn() }))
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn() }))
vi.mock('@/stores/global', () => ({ useGlobalStore: () => mocks.global }))
vi.mock('@/utils/PlatformConstants', () => ({
  isCompatibility: () => true,
  isDesktop: () => true,
  isMac: () => false,
  isWeb: () => false,
  isWindows: () => true,
  isWindows10: () => false
}))
vi.mock('@/hooks/useMediaPreflight', () => ({ preflightMedia: mocks.preflight }))
vi.mock('@/hooks/useMeeting', () => ({ useMeeting: () => ({ startMeeting: mocks.startMeeting }) }))

import { CallTypeEnum, RoomTypeEnum } from '@/enums'
import { useWindow } from './useWindow'

describe('group call preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.global.currentSession.type = RoomTypeEnum.GROUP
  })

  it('does not create a video meeting when the camera or microphone check fails', async () => {
    mocks.preflight.mockResolvedValue(false)
    await useWindow().startRtcCall(CallTypeEnum.VIDEO)
    expect(mocks.preflight).toHaveBeenCalledWith(CallTypeEnum.VIDEO)
    expect(mocks.startMeeting).not.toHaveBeenCalled()
  })

  it('starts an audio meeting after checking the microphone', async () => {
    mocks.preflight.mockResolvedValue(true)
    await useWindow().startRtcCall(CallTypeEnum.AUDIO)
    expect(mocks.preflight).toHaveBeenCalledWith(CallTypeEnum.AUDIO)
    expect(mocks.startMeeting).toHaveBeenCalledWith({ roomId: 'room' }, true)
  })
})
