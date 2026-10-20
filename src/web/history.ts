/**
 * 网页版的聊天记录窗口和文件窗口：桌面版从本机数据库查，网页版没有本机记录，
 * 改由服务端 im/chat/msg/history 按条件查，这里把两边的参数和返回格式对上
 */

/** 聊天记录窗口的类型页签 → 服务端的 kind */
const HISTORY_KIND: Record<string, string> = { image: 'image', file: 'file' }

/** 文件窗口每次取的条数（窗口不翻页，取服务端允许的最大值） */
export const FILE_PAGE_SIZE = 100

const TYPE_FILE = 4
const TYPE_VIDEO = 6

export interface HistoryPage {
  list: any[]
  cursor: string
  isLast: boolean
}

/** 聊天记录窗口的查询参数（与 Rust 的 ChatHistoryQueryParam 一致）→ 服务端参数，不含游标 */
export const chatHistoryQuery = (param: any): Record<string, unknown> => ({
  roomId: param?.roomId,
  kind: HISTORY_KIND[param?.messageType] ?? undefined,
  keyword: param?.searchKeyword?.trim() || undefined,
  startTime: param?.dateRange?.startTime ?? undefined,
  endTime: param?.dateRange?.endTime ?? undefined,
  pageSize: param?.pagination?.pageSize
})

/**
 * 聊天记录窗口按页码翻页，服务端按游标翻页：记下每页结束的游标，
 * 条件变了（回到第 1 页）就重新开始
 */
export const createHistoryPager = (fetchPage: (query: Record<string, unknown>) => Promise<HistoryPage>) => {
  let key = ''
  const cursors: string[] = []
  return async (param: any) => {
    const query = chatHistoryQuery(param)
    const page = Math.max(Number(param?.pagination?.page) || 1, 1)
    const nextKey = JSON.stringify(query)
    if (page === 1 || nextKey !== key) {
      key = nextKey
      cursors.length = 0
    }
    const cursor = page > 1 ? cursors[page - 2] : undefined
    if (page > 1 && !cursor) return { messages: [], hasMore: false, currentPage: page }
    const result = await fetchPage({ ...query, cursor })
    cursors[page - 1] = result.cursor
    return { messages: result.list ?? [], hasMore: !result.isLast, currentPage: page }
  }
}

/** 文件窗口的查询参数（与 Rust 的 FileQueryParam 一致）→ 服务端参数 */
export const fileQuery = (param: any): Record<string, unknown> => ({
  kind: 'files',
  roomId:
    param?.navigationType === 'sessions' || param?.navigationType === 'groups' ? param?.roomId || undefined : undefined,
  fromUid: param?.navigationType === 'senders' ? param?.selectedUser || undefined : undefined,
  keyword: param?.searchKeyword?.trim() || undefined,
  pageSize: FILE_PAGE_SIZE
})

const pad = (value: number) => String(value).padStart(2, '0')
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/** 与 Rust 的 format_display_date 一致：今天、昨天、今年的月日、往年的年月日 */
export const displayDate = (date: Date, now = new Date()) => {
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const diff = Math.round((day(now) - day(date)) / 86_400_000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  const monthDay = `${pad(date.getMonth() + 1)}月${pad(date.getDate())}日`
  return date.getFullYear() === now.getFullYear() ? monthDay : `${date.getFullYear()}年${monthDay}`
}

const fileNameOf = (type: number, body: any) => {
  const name = body?.fileName ?? body?.filename
  if (typeof name === 'string' && name) return name
  if (type !== TYPE_VIDEO || typeof body?.url !== 'string') return null
  try {
    return decodeURIComponent(new URL(body.url).pathname.split('/').pop() || '') || null
  } catch {
    return null
  }
}

/** 一条文件或视频消息 → Rust 的 FileInfo；不是文件的返回 null */
export const toFileInfo = (item: any) => {
  const message = item?.message ?? {}
  const type = Number(message.type)
  if (type !== TYPE_FILE && type !== TYPE_VIDEO) return null
  const body = message.body ?? {}
  const fileName = fileNameOf(type, body)
  if (!fileName) return null
  const sendTime = Number(message.sendTime) || 0
  const time = new Date(sendTime)
  return {
    id: String(message.id),
    fileName,
    fileSize: Number(body.size ?? body.fileSize) || 0,
    fileType: type === TYPE_FILE ? 'file' : 'video',
    uploadTime: `${dateKey(time)} ${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`,
    sendTime,
    sender: {
      id: item?.fromUser?.uid ?? '',
      name: item?.fromUser?.username || '未知用户',
      avatar: item?.fromUser?.avatar || '',
      isOnline: null
    },
    downloadUrl: body.url ?? body.downloadUrl ?? null,
    isDownloaded: false,
    status: 'completed',
    thumbnailUrl: body.thumbUrl ?? body.thumbnailUrl ?? null
  }
}

/** 服务端一页文件消息 → Rust 的 FileQueryResponse：按天分组（新的在前）并列出发送人 */
export const toFileResponse = (page: HistoryPage, now = new Date()) => {
  const files = (page.list ?? []).map(toFileInfo).filter((file): file is NonNullable<typeof file> => file !== null)
  const groups = new Map<string, { date: string; displayDate: string; files: typeof files }>()
  const users = new Map<string, (typeof files)[number]['sender']>()
  for (const file of [...files].sort((a, b) => b.sendTime - a.sendTime)) {
    const time = new Date(file.sendTime)
    const key = dateKey(time)
    if (!groups.has(key)) groups.set(key, { date: key, displayDate: displayDate(time, now), files: [] })
    groups.get(key)!.files.push(file)
    if (file.sender.id) users.set(file.sender.id, file.sender)
  }
  return {
    timeGroupedFiles: [...groups.values()],
    userList: [...users.values()],
    hasMore: !page.isLast,
    currentPage: 1
  }
}

/** 与 Rust 的 get_navigation_items 一致 */
export const navigationItems = () => [
  { key: 'myFiles', label: '我的文件', icon: 'file', active: true },
  { key: 'senders', label: '发送人', icon: 'avatar', active: false },
  { key: 'sessions', label: '会话', icon: 'message', active: false },
  { key: 'groups', label: '群聊', icon: 'peoples', active: false }
]
