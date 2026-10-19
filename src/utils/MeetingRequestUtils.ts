import { ImUrlEnum } from '@/enums'
import type { MessageType } from '@/services/types'
import { imRequest } from '@/utils/ImRequestUtils'

/** 服务端（mailflare）返回的会议信息 */
export type MeetingInfo = {
  id: string
  title: string
  /** 会议链接，如 https://mail.smjtools.com/meet/xxxx */
  url: string
  hostId: string
  hostName: string
  roomId: string | null
  /** 预约开始时间（毫秒），即时会议为 null */
  startsAt: number | null
  durationMinutes: number
  createdAt: number
  inviteeIds: string[]
}

export type MeetingCreateParams = {
  title?: string
  /** 从哪个会话发起；群聊默认邀请全体群成员 */
  roomId?: string
  /** 预约时间（ISO 字符串），不传表示立即开始 */
  startAt?: string
  durationMinutes?: number
  /** 被邀请人 uid，不传则按会话成员 */
  inviteUids?: string[]
  /** 是否发送邮件邀请（含日历邀请），默认 true */
  sendMail?: boolean
}

export type MeetingCreateResult = MeetingInfo & {
  /** 已发送邀请邮件的地址 */
  invited: string[]
  mailError: string | null
  /** 发到会话里的会议链接消息；服务端只推给其他成员，发起人自己的由客户端插入 */
  message: MessageType | null
}

export type MeetingJoinResult = MeetingInfo & { authToken: string; host: boolean }

/** 一对一通话用的 ICE 服务器（Cloudflare TURN 临时凭证） */
export async function getRtcIceServers(): Promise<{ iceServers: RTCIceServer[] }> {
  return await imRequest({ url: ImUrlEnum.RTC_ICE_SERVERS }, { showError: false })
}

export async function createMeeting(body: MeetingCreateParams): Promise<MeetingCreateResult> {
  return await imRequest({ url: ImUrlEnum.MEETING_CREATE, body })
}

export async function joinMeeting(id: string): Promise<MeetingJoinResult> {
  return await imRequest({ url: ImUrlEnum.MEETING_JOIN, body: { id } })
}

export async function getMeetingDetail(id: string): Promise<MeetingInfo> {
  return await imRequest({ url: ImUrlEnum.MEETING_DETAIL, params: { id } })
}

export async function listMeetings(): Promise<MeetingInfo[]> {
  return await imRequest({ url: ImUrlEnum.MEETING_LIST })
}

/** 会议的 .ics 日历文件内容，交给系统日历打开 */
/** 发起人取消会议；已发邀请的人会收到取消邮件，日历里的日程随之删除 */
export async function cancelMeeting(id: string): Promise<{ id: string; mailError: string | null }> {
  return await imRequest({ url: ImUrlEnum.MEETING_CANCEL, body: { id } })
}

export async function getMeetingIcs(id: string): Promise<{ filename: string; body: string }> {
  return await imRequest({ url: ImUrlEnum.MEETING_ICS, params: { id } })
}
