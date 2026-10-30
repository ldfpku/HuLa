import { describe, expect, it } from 'vitest'
import { localTodoDay, millisecondsUntilNextLocalDay } from './TodoDate'

describe('local to-do day', () => {
  it('uses the device calendar day and schedules the next local midnight', () => {
    const date = new Date(2026, 9, 30, 23, 59, 30)
    expect(localTodoDay(date)).toBe('2026-10-30')
    expect(millisecondsUntilNextLocalDay(date)).toBe(30_000)
    expect(localTodoDay(new Date(2027, 0, 1))).toBe('2027-01-01')
  })
})
