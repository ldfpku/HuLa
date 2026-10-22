/**
 * 通话互斥：通话窗口打开期间每 15 秒告诉服务端“我还在通话中”（VIDEO_HEARTBEAT），
 * 服务端据此把打给自己的新来电直接回“忙线中”，不再在通话上面再弹一个来电。
 */
export const CALL_ALIVE_INTERVAL_MS = 15_000

/** 来电、挂断等事件都是广播给所有窗口的，只处理属于本次通话（同一会话）的 */
export const isEventForRoom = (payload: unknown, roomId: string): boolean => {
  const eventRoom = (payload as { roomId?: unknown } | null)?.roomId
  return eventRoom === undefined || eventRoom === null || String(eventRoom) === String(roomId)
}

/** 对方正在通话或会议中，服务端代为拒绝 */
export const isBusyRejection = (payload: unknown): boolean => (payload as { busy?: unknown } | null)?.busy === true

/** 本机已有通话窗口或会议窗口时，新来电直接回忙线（桌面端窗口标签见 useWindow / useMeeting） */
export const isCallOrMeetingWindow = (label: string): boolean => label === 'rtcCall' || label.startsWith('meeting-')
