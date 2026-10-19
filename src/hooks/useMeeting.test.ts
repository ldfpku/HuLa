import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createMeeting, emit } = vi.hoisted(() => ({ createMeeting: vi.fn(), emit: vi.fn() }))

vi.mock('@tauri-apps/api/path', () => ({ join: vi.fn(), tempDir: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ BaseDirectory: {}, writeTextFile: vi.fn() }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn(), openUrl: vi.fn() }))
vi.mock('@tauri-apps/plugin-log', () => ({ error: vi.fn(), info: vi.fn() }))
vi.mock('@/hooks/useMitt', () => ({ useMitt: { emit } }))
vi.mock('@/utils/MeetingRequestUtils', () => ({
  cancelMeeting: vi.fn(),
  createMeeting,
  getMeetingIcs: vi.fn(),
  joinMeeting: vi.fn()
}))

import { WsResponseMessageType } from '@/services/wsType'
import { useMeeting } from './useMeeting'

const meeting = { id: 'abcdefghijklmnop', invited: [], mailError: null }

describe('startMeeting', () => {
  beforeEach(() => {
    createMeeting.mockReset()
    emit.mockReset()
  })

  it('把会议链接消息放进发起人自己的会话', async () => {
    const message = { fromUser: { uid: '1' }, message: { id: '9', roomId: '3', sendTime: 1 } }
    createMeeting.mockResolvedValue({ ...meeting, message })
    await useMeeting().startMeeting({ roomId: '3', startAt: '2026-10-20T02:00:00.000Z' })
    expect(emit).toHaveBeenCalledWith(WsResponseMessageType.RECEIVE_MESSAGE, message)
  })

  it('没有发消息时（不在会话里发起）不插入', async () => {
    createMeeting.mockResolvedValue({ ...meeting, message: null })
    await useMeeting().startMeeting({ startAt: '2026-10-20T02:00:00.000Z' })
    expect(emit).not.toHaveBeenCalled()
  })
})
