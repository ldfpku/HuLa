import { join, tempDir } from '@tauri-apps/api/path'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { BaseDirectory, writeTextFile } from '@tauri-apps/plugin-fs'
import { openPath, openUrl } from '@tauri-apps/plugin-opener'
import { error, info } from '@tauri-apps/plugin-log'
import { isDesktop } from '@/utils/PlatformConstants'
import {
  cancelMeeting,
  createMeeting,
  getMeetingIcs,
  joinMeeting,
  type MeetingCreateParams,
  type MeetingCreateResult
} from '@/utils/MeetingRequestUtils'

/** 会议链接的路径：/meet/<16 位 id> */
const MEETING_PATH = /^\/meet\/([a-z2-7]{16})\/?$/

/** 从链接里取会议 id，不是会议链接时返回 null */
export const parseMeetingLink = (url: string): string | null => {
  try {
    return MEETING_PATH.exec(new URL(url).pathname)?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * 视频会议（Cloudflare RealtimeKit）。会议界面是服务端的 /meet/<id> 页面：
 * 桌面端在应用内独立窗口打开，入会凭证放在 URL 片段里，不经过浏览器登录；
 * 日历用系统自带的，“加入日历”就是把 .ics 文件交给系统默认日历打开。
 */
export const useMeeting = () => {
  /** 以当前账号入会并打开会议窗口 */
  const openMeeting = async (id: string) => {
    const joined = await joinMeeting(id)
    const meta = {
      title: joined.title,
      startsAt: joined.startsAt,
      durationMinutes: joined.durationMinutes,
      hostName: joined.hostName,
      // 会议页据此显示“仅主持人可共享屏幕”开关
      host: joined.host === true
    }
    const url = `${joined.url}#t=${encodeURIComponent(joined.authToken)}&m=${encodeURIComponent(JSON.stringify(meta))}`

    if (!isDesktop()) {
      // 移动端没有多窗口，交给系统浏览器
      await openUrl(url)
      return
    }
    const label = `meeting-${id}`
    const existing = await WebviewWindow.getByLabel(label)
    if (existing) {
      await existing.unminimize().catch(() => undefined)
      await existing.setFocus()
      return
    }
    const meetingWindow = new WebviewWindow(label, {
      url,
      title: `${joined.title} - 视频会议`,
      width: 1180,
      height: 760,
      minWidth: 820,
      minHeight: 560,
      center: true,
      resizable: true,
      focus: true
    })
    meetingWindow.once('tauri://error', (event) => {
      error(`[会议] 打开会议窗口失败: ${JSON.stringify(event.payload)}`)
      void openUrl(joined.url)
    })
  }

  /** 发起或预约会议；立即开始的会议创建后直接打开 */
  const startMeeting = async (params: MeetingCreateParams): Promise<MeetingCreateResult> => {
    const created = await createMeeting(params)
    info(`[会议] 已创建 ${created.id}，邮件邀请 ${created.invited.length} 人`)
    if (created.mailError) {
      window.$message?.warning?.(`会议已创建，但邀请邮件未发出：${created.mailError}`)
    }
    if (!params.startAt) await openMeeting(created.id)
    return created
  }

  /** 把会议加入本机日历：写一个 .ics 临时文件，用系统默认日历打开 */
  const addToCalendar = async (id: string) => {
    try {
      const ics = await getMeetingIcs(id)
      const name = `smj-meeting-${id}.ics`
      await writeTextFile(name, ics.body, { baseDir: BaseDirectory.Temp })
      await openPath(await join(await tempDir(), name))
    } catch (e) {
      error(`[会议] 加入日历失败: ${String(e)}`)
      window.$message?.error?.('无法打开系统日历，请在邀请邮件中接受日历邀请')
    }
  }

  /** 发起人确认后取消会议；受邀人会收到取消邮件，日历里的日程随之删除 */
  const confirmCancelMeeting = (
    id: string,
    hooks: { onStart?: () => void; onDone?: (cancelled: boolean) => void } = {}
  ) => {
    window.$dialog.warning({
      title: '取消会议',
      content: '取消后其他人将无法进入该会议，已邀请的人会收到取消通知。确定取消吗？',
      positiveText: '取消会议',
      negativeText: '再想想',
      onPositiveClick: async () => {
        hooks.onStart?.()
        try {
          const result = await cancelMeeting(id)
          if (result.mailError) window.$message?.warning?.(`会议已取消，但取消通知邮件未发出：${result.mailError}`)
          else window.$message?.success?.('会议已取消')
          hooks.onDone?.(true)
        } catch (e) {
          error(`[会议] 取消会议失败: ${String(e)}`)
          hooks.onDone?.(false)
        }
      }
    })
  }

  return { openMeeting, startMeeting, addToCalendar, confirmCancelMeeting }
}
