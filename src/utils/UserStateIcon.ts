import { withBasePath } from '@/web/notifyUtils'

const stateIcons: Record<string, string> = {
  '1': '/status/online.png',
  '2': '/status/busy.png',
  '3': '/status/leave.png',
  '4': '/status/bequiet@3x.png',
  '5': '/status/cloaking.png'
}

export function userStateIcon(state: { id: string; url?: string }, base = import.meta.env.BASE_URL): string {
  const url = state.url || stateIcons[state.id] || '/status/offline.png'
  return withBasePath(base, url)
}
