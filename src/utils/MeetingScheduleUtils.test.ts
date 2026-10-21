import { describe, expect, it } from 'vitest'
import {
  axisPosition,
  conflictingUids,
  describeBusy,
  formatSuggestion,
  layoutDay,
  moveToDay,
  pickTime,
  startOfLocalDay
} from './MeetingScheduleUtils'

const HOUR = 3_600_000
const day = new Date(2026, 9, 20).getTime()
const at = (hour: number, minute = 0) => day + hour * HOUR + minute * 60_000

describe('MeetingScheduleUtils', () => {
  const participants = [
    { uid: 'me', name: '我', avatar: '', busy: [] },
    { uid: 'kim', name: 'Kim', avatar: '', busy: [{ start: at(10), end: at(11), source: 'meeting' as const }] },
    { uid: 'lee', name: 'Lee', avatar: '', busy: [{ start: at(11), end: at(12), source: 'mail' as const }] }
  ]

  it('finds who is busy during the chosen time, touching ends do not count', () => {
    expect(conflictingUids(participants, at(10, 30), at(11, 30))).toEqual(['kim', 'lee'])
    expect(conflictingUids(participants, at(11), at(11, 30))).toEqual(['lee'])
    expect(conflictingUids(participants, at(9), at(10))).toEqual([])
  })

  it('places busy blocks and the selection on the 7:00-21:00 axis', () => {
    const [block] = layoutDay(participants[1].busy, day)
    expect(block.left).toBeCloseTo((3 / 14) * 100)
    expect(block.width).toBeCloseTo((1 / 14) * 100)
    expect(layoutDay([{ start: at(5), end: at(6), source: 'calendar' }], day)).toEqual([])
    expect(axisPosition(day, at(20, 30), at(22))?.width).toBeCloseTo((0.5 / 14) * 100)
    expect(axisPosition(day, at(22), at(23))).toBeNull()
  })

  it('snaps a click to the half hour and keeps the time of day across days', () => {
    expect(pickTime(day, 0)).toBe(at(7))
    expect(pickTime(day, 3.4 / 14)).toBe(at(10))
    expect(pickTime(day, 3.6 / 14)).toBe(at(10, 30))
    expect(moveToDay(at(14, 30), day + 24 * HOUR)).toBe(at(14, 30) + 24 * HOUR)
    expect(startOfLocalDay(at(15, 45))).toBe(day)
  })

  it('labels suggestions and busy blocks without inventing titles', () => {
    expect(formatSuggestion(at(9), at(10), at(8))).toBe('今天 09:00–10:00')
    expect(formatSuggestion(at(9) + 24 * HOUR, at(10) + 24 * HOUR, at(8))).toBe('明天 09:00–10:00')
    expect(formatSuggestion(at(9) + 2 * 24 * HOUR, at(10) + 2 * 24 * HOUR, at(8))).toBe('10月22日 周四 09:00–10:00')
    expect(describeBusy({ start: at(10), end: at(11), source: 'meeting' })).toBe('会议 10:00–11:00（忙碌）')
    expect(describeBusy({ start: at(10), end: at(11), source: 'mail', title: '评审' })).toBe(
      '邮件邀请 10:00–11:00：评审'
    )
  })
})
