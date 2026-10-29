import { OnlineEnum } from '@/enums'

export type PresenceChange = {
  uid: string
  activeStatus: OnlineEnum
  lastOptTime: number
}

export function parsePresenceChange(value: unknown): PresenceChange | null {
  if (!value || typeof value !== 'object') return null
  if (!('uid' in value) || typeof value.uid !== 'string' || !value.uid) return null
  if (
    !('activeStatus' in value) ||
    (value.activeStatus !== OnlineEnum.ONLINE && value.activeStatus !== OnlineEnum.OFFLINE)
  ) {
    return null
  }
  if (!('lastOptTime' in value) || typeof value.lastOptTime !== 'number' || !Number.isFinite(value.lastOptTime)) {
    return null
  }
  return { uid: value.uid, activeStatus: value.activeStatus, lastOptTime: value.lastOptTime }
}

export class PresenceVersionTracker {
  private account = ''
  private versions = new Map<string, number>()

  accept(account: string | undefined, uid: string, version: unknown): boolean {
    if (!account || !uid) return false
    if (account !== this.account) {
      this.account = account
      this.versions.clear()
    }
    if (typeof version !== 'number' || !Number.isFinite(version)) return true
    const previous = this.versions.get(uid)
    if (previous !== undefined && version < previous) return false
    this.versions.set(uid, version)
    return true
  }
}
