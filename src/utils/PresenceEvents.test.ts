import { describe, expect, it } from 'vitest'
import { OnlineEnum } from '@/enums'
import { parsePresenceChange, PresenceVersionTracker } from './PresenceEvents'

describe('presence events', () => {
  it('accepts only well-formed connection updates', () => {
    expect(parsePresenceChange({ uid: 'u1', activeStatus: OnlineEnum.ONLINE, lastOptTime: 10 })).toEqual({
      uid: 'u1',
      activeStatus: OnlineEnum.ONLINE,
      lastOptTime: 10
    })
    expect(parsePresenceChange({ uid: '', activeStatus: OnlineEnum.ONLINE, lastOptTime: 10 })).toBeNull()
    expect(parsePresenceChange({ uid: 'u1', activeStatus: 99, lastOptTime: 10 })).toBeNull()
    expect(parsePresenceChange({ uid: 'u1', activeStatus: OnlineEnum.OFFLINE, lastOptTime: NaN })).toBeNull()
  })

  it('rejects stale updates but permits equal-version group updates and resets across accounts', () => {
    const tracker = new PresenceVersionTracker()
    expect(tracker.accept('account-a', 'u1', 20)).toBe(true)
    expect(tracker.accept('account-a', 'u1', 19)).toBe(false)
    expect(tracker.accept('account-a', 'u1', 20)).toBe(true)
    expect(tracker.accept('account-a', 'u1', undefined)).toBe(true)
    expect(tracker.accept('account-b', 'u1', 1)).toBe(true)
    expect(tracker.accept(undefined, 'u1', 2)).toBe(false)
  })
})
