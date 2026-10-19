import { describe, expect, it } from 'vitest'
import type { MessageType } from '@/services/types'
import { isOwnPendingEcho } from './MessageSync'

const message = (uid: string, clientMsgId?: string) =>
  ({ fromUser: { uid }, message: { id: '42', roomId: 'r1', clientMsgId } }) as unknown as MessageType

describe('isOwnPendingEcho', () => {
  const pending = new Set(['r1:tmp-1'])
  const has = (roomId: string, msgId: string) => pending.has(`${roomId}:${msgId}`)

  it('skips the copy of a message this device is still sending', () => {
    expect(isOwnPendingEcho(message('me', 'tmp-1'), 'me', has)).toBe(true)
  })

  it('shows what the same account sent from another device', () => {
    expect(isOwnPendingEcho(message('me', 'tmp-9'), 'me', has)).toBe(false)
    expect(isOwnPendingEcho(message('me'), 'me', has)).toBe(false)
  })

  it('never hides other people', () => {
    expect(isOwnPendingEcho(message('other', 'tmp-1'), 'me', has)).toBe(false)
    expect(isOwnPendingEcho(message('me', 'tmp-1'), undefined, has)).toBe(false)
  })
})
