import { describe, expect, it } from 'vitest'
import type { MessageType } from '@/services/types'
import { compareMessages, sortMessages } from './MessageOrder'

const message = (id: string, sendTime: number) => ({ message: { id, sendTime } }) as unknown as MessageType

describe('sortMessages', () => {
  it('orders by send time, so failed messages with temporary ids stay where they were sent', () => {
    const sent = message('1368', 1792634058000)
    const failed = message('T1792634055628', 1792634055628)
    const earlier = message('T1792633920000', 1792633920000)
    expect(sortMessages([sent, failed, earlier]).map((m) => m.message.id)).toEqual([
      'T1792633920000',
      'T1792634055628',
      '1368'
    ])
  })

  it('breaks ties by numeric id without comparing digits as text', () => {
    const list = [message('1000', 5), message('999', 5), message('1001', 5)]
    expect(sortMessages(list).map((m) => m.message.id)).toEqual(['999', '1000', '1001'])
  })

  it('puts a stored message before one still sending at the same instant', () => {
    expect(compareMessages(message('42', 7), message('T7', 7))).toBeLessThan(0)
    expect(compareMessages(message('T7', 7), message('42', 7))).toBeGreaterThan(0)
  })

  it('is deterministic for two temporary ids', () => {
    expect(compareMessages(message('T1', 7), message('T2', 7))).toBeLessThan(0)
  })
})
