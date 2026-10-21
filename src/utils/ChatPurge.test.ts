import { describe, expect, it } from 'vitest'
import { chatPurgeSteps, parseChatPurgeEpoch } from './ChatPurge'

describe('chatPurgeSteps', () => {
  const changes = {
    epoch: 30,
    rooms: [
      { roomId: '1', all: false, msgIds: ['5', '7'] },
      { roomId: 'a', all: true, msgIds: [] }
    ]
  }

  it('drops whole rooms and single messages in rooms that stay', () => {
    expect(chatPurgeSteps(changes, 0)).toEqual({
      rooms: ['a'],
      messages: [
        { roomId: '1', msgId: '5' },
        { roomId: '1', msgId: '7' }
      ],
      epoch: 30
    })
  })

  it('does nothing once the newest run is applied', () => {
    expect(chatPurgeSteps(changes, 30)).toBeNull()
    expect(chatPurgeSteps({ epoch: 0, rooms: [] }, 0)).toBeNull()
    expect(chatPurgeSteps(null, 0)).toBeNull()
  })

  it('reads a missing or broken saved epoch as never applied', () => {
    expect(parseChatPurgeEpoch(null)).toBe(0)
    expect(parseChatPurgeEpoch('abc')).toBe(0)
    expect(parseChatPurgeEpoch('30')).toBe(30)
  })
})
