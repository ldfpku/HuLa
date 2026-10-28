import { describe, expect, it } from 'vitest'
import { RoomTypeEnum } from '@/enums'
import { groupSessionsByType } from './SessionSections'

describe('session categories', () => {
  it('groups conversations while preserving their existing order within each category', () => {
    const sessions = [
      { type: RoomTypeEnum.SINGLE, id: 'person-pinned' },
      { type: RoomTypeEnum.GROUP, id: 'group-pinned' },
      { type: RoomTypeEnum.SINGLE, id: 'person-recent' },
      { type: RoomTypeEnum.GROUP, id: 'group-recent' }
    ]
    expect(groupSessionsByType(sessions)).toEqual([
      { key: 'groups', sessions: [sessions[1], sessions[3]] },
      { key: 'people', sessions: [sessions[0], sessions[2]] }
    ])
  })

  it('omits empty categories', () => {
    expect(groupSessionsByType([{ type: RoomTypeEnum.SINGLE, id: 'person' }])).toHaveLength(1)
    expect(groupSessionsByType([])).toEqual([])
  })
})
