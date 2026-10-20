import { describe, expect, it } from 'vitest'
import { isBusyRejection, isCallOrMeetingWindow, isEventForRoom } from './RtcCallUtils'

describe('RtcCallUtils', () => {
  it('only handles call events of the same room', () => {
    expect(isEventForRoom({ roomId: '12' }, '12')).toBe(true)
    expect(isEventForRoom({ roomId: 12 }, '12')).toBe(true)
    expect(isEventForRoom({ roomId: '13' }, '12')).toBe(false)
    expect(isEventForRoom({}, '12')).toBe(true)
    expect(isEventForRoom(null, '12')).toBe(true)
  })

  it('recognises a busy rejection', () => {
    expect(isBusyRejection({ accepted: 0, busy: true })).toBe(true)
    expect(isBusyRejection({ accepted: 0 })).toBe(false)
    expect(isBusyRejection(undefined)).toBe(false)
  })

  it('treats call and meeting windows as busy', () => {
    expect(isCallOrMeetingWindow('rtcCall')).toBe(true)
    expect(isCallOrMeetingWindow('meeting-abcdefghijklmnop')).toBe(true)
    expect(isCallOrMeetingWindow('home')).toBe(false)
  })
})
