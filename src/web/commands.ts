/**
 * 网页版的 Rust 命令实现：前端 invoke 的命令名和参数保持不变，
 * 数据直接从服务端读取，不在本机保存聊天记录
 */
import { ImRequestError, imRequest, refreshTokens, tokenStore, webConfig } from './imClient'
import type { WebSocketClient } from './wsClient'

type Args = Record<string, any> | undefined
type Handler = (args: Args) => unknown

/** 两条消息间隔超过 5 分钟时显示时间，与 Rust 端 calculate_time_block 一致 */
const TIME_BLOCK_GAP = 5 * 60 * 1000

const withTimeBlocks = (list: any[]) => {
  const sorted = [...list].sort((a, b) => (a?.message?.sendTime ?? 0) - (b?.message?.sendTime ?? 0))
  return sorted.map((item, index) => {
    const prev = sorted[index - 1]?.message?.sendTime
    const current = item?.message?.sendTime ?? 0
    return { ...item, timeBlock: index === 0 || (prev && current - prev > TIME_BLOCK_GAP) ? 1 : undefined }
  })
}

const settings = () => ({
  database: { sqlite_file: '' },
  backend: { base_url: webConfig.baseUrl, ws_url: webConfig.wsUrl },
  youdao: null,
  tencent: null,
  minio: null,
  ice_server: null
})

const relogin = (emit: (event: string, payload?: unknown) => void) => (error: unknown) => {
  if (error instanceof ImRequestError && error.message.includes('请重新登录')) emit('relogin')
  throw error instanceof Error ? error.message : error
}

export const createCommands = (ws: WebSocketClient, emit: (event: string, payload?: unknown) => void) => {
  const onError = relogin(emit)
  const commands: Record<string, Handler> = {
    is_app_state_ready: () => true,
    get_settings: settings,
    update_settings: () => settings(),
    switch_user_database: () => null,

    im_request_command: (args) => imRequest(args?.url, args?.body, args?.params).catch(onError),

    login_command: async (args) => {
      const data = args?.data ?? {}
      if (data.isAutoLogin) {
        const stored = tokenStore.get()
        if (!stored || (data.uid && stored.uid !== data.uid)) throw '请重新登录'
        const tokens = await refreshTokens().catch(() => {
          throw '请重新登录'
        })
        return { token: tokens.token, refreshToken: tokens.refreshToken, client: '', expire: '', uid: tokens.uid }
      }
      const resp = await imRequest<any>('login', data).catch((error) => {
        throw error instanceof Error ? error.message : error
      })
      tokenStore.set({ uid: resp.uid, token: resp.token, refreshToken: resp.refreshToken })
      return resp
    },
    get_user_tokens: () => {
      const tokens = tokenStore.get()
      return { token: tokens?.token ?? null, refreshToken: tokens?.refreshToken ?? null }
    },
    update_token: (args) => {
      const req = args?.req ?? {}
      const current = tokenStore.get()
      tokenStore.set({
        uid: req.uid || current?.uid || '',
        token: req.token ?? current?.token ?? '',
        refreshToken: req.refreshToken ?? current?.refreshToken ?? ''
      })
      return null
    },
    remove_tokens: () => {
      tokenStore.clear()
      return null
    },
    save_user_info: () => null,
    update_user_last_opt_time: () => null,

    ws_init_connection: (args) => ws.init(args?.params?.clientId ?? ''),
    ws_disconnect: () => ws.disconnect(),
    ws_send_message: (args) => ws.send(args?.params?.data),
    ws_get_state: () => ws.getState(),
    ws_is_connected: () => ws.isConnected(),
    ws_force_reconnect: () => ws.reconnectNow(),
    ws_update_config: () => null,
    ws_get_health: () => ({ isHealthy: ws.isConnected(), consecutiveFailures: 0 }),
    ws_set_app_background_state: () => null,
    ws_get_app_background_state: () => false,

    list_contacts_command: () => imRequest('getContactList').catch(onError),
    hide_contact_command: (args) => imRequest('setHide', args?.data ?? args).catch(onError),
    page_room: (args) => imRequest('groupList', undefined, args?.pageParam).catch(onError),
    get_room_members: (args) => imRequest('groupListMember', undefined, { roomId: args?.roomId }).catch(onError),
    cursor_page_room_members: async (args) => {
      const list = await imRequest<any[]>('groupListMember', undefined, { roomId: args?.param?.roomId }).catch(onError)
      return { list: list ?? [], cursor: '', isLast: true }
    },
    update_my_room_info: (args) => imRequest('updateMyRoomInfo', args?.myRoomInfo).catch(onError),

    page_msg: async (args) => {
      const param = args?.param ?? {}
      const page = await imRequest<any>('getMsgPage', undefined, {
        roomId: param.roomId,
        pageSize: param.pageSize,
        cursor: param.cursor || undefined
      }).catch(onError)
      return { ...page, list: withTimeBlocks(page?.list ?? []) }
    },
    send_msg: (args) => {
      const data = args?.data ?? {}
      imRequest<any>('sendMsg', data)
        .then((resp) => args?.successChannel?.onmessage({ ...resp, oldMsgId: data.id }))
        .catch(() => args?.errorChannel?.onmessage(data.id))
      return null
    },
    sync_messages: () => null,
    save_msg: () => null,
    save_message_mark: () => null,
    delete_message: () => null,
    delete_room_messages: () => null,
    update_message_recall_status: () => null,
    query_chat_history: () => ({ list: [], total: 0 }),
    query_files: () => ({ list: [], total: 0 }),
    debug_message_stats: () => null,
    get_files_meta: () => [],
    hide_splash_screen: () => null,
    set_complete: () => null
  }
  return commands
}
