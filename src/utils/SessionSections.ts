import { RoomTypeEnum } from '@/enums'

export function groupSessionsByType<T extends { type: RoomTypeEnum }>(sessions: T[]) {
  const groups = sessions.filter((session) => session.type === RoomTypeEnum.GROUP)
  const people = sessions.filter((session) => session.type !== RoomTypeEnum.GROUP)
  return [
    { key: 'groups', sessions: groups },
    { key: 'people', sessions: people }
  ].filter((section) => section.sessions.length > 0)
}
