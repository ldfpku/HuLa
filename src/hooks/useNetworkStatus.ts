/**
 * 网络状态监测钩子
 */
import { createSharedComposable, tryOnScopeDispose } from '@vueuse/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import rustWebSocketClient, { ConnectionState } from '@/services/webSocketRust'

/** 连续连不上服务器多久后，提示里补一句代理软件的说明 */
const LONG_OUTAGE_MS = 60_000

const useSharedNetworkStatus = createSharedComposable(() => {
  // 网络状态 - 基于浏览器navigator.onLine
  const browserOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const wsState = ref<ConnectionState | null>(null)
  const wsStatus = computed<'unknown' | 'connected' | 'connecting' | 'disconnected' | 'error'>(() => {
    switch (wsState.value) {
      case ConnectionState.CONNECTED:
        return 'connected'
      case ConnectionState.CONNECTING:
      case ConnectionState.RECONNECTING:
        return 'connecting'
      case ConnectionState.DISCONNECTED:
        return 'disconnected'
      case ConnectionState.ERROR:
        return 'error'
      default:
        return 'unknown'
    }
  })
  const wsOnline = computed<boolean | null>(() => {
    if (wsState.value === null) return null
    return wsState.value === ConnectionState.CONNECTED
  })
  const isWsConnecting = computed(() => wsStatus.value === 'connecting')
  const isOnline = computed(() => {
    if (!browserOnline.value) return false
    if (wsOnline.value === null) return true
    return wsOnline.value
  })
  // 连接失败过、正在重试（每次重试都会先回到 CONNECTING，单看状态会在“连接中”和“已断开”之间来回跳）
  const wsRetrying = ref(false)
  // 连续连不上服务器约 1 分钟（直连很慢或代理软件已退出时常见）
  const wsOutageLong = ref(false)
  let outageTimer: ReturnType<typeof setTimeout> | null = null
  const clearOutageTimer = () => {
    if (outageTimer) {
      clearTimeout(outageTimer)
      outageTimer = null
    }
  }
  watch(
    wsState,
    (state) => {
      if (state === null || state === ConnectionState.CONNECTED) {
        clearOutageTimer()
        wsRetrying.value = false
        wsOutageLong.value = false
        return
      }
      if (state !== ConnectionState.CONNECTING) wsRetrying.value = true
      // 重试过程中状态会来回切换，计时从第一次连不上算起，连上才清零
      if (outageTimer || wsOutageLong.value) return
      outageTimer = setTimeout(() => {
        outageTimer = null
        wsOutageLong.value = true
      }, LONG_OUTAGE_MS)
    },
    { immediate: true }
  )
  const isListening = ref(false)
  let wsUnlisten: UnlistenFn | null = null

  // 监听浏览器网络状态变化
  const handleOnline = () => {
    browserOnline.value = true
  }

  const handleOffline = () => {
    browserOnline.value = false
  }

  const isTauriContext = () => {
    if (typeof window === 'undefined') return false
    return Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
  }

  const resolveWsState = (state: unknown): ConnectionState | null => {
    if (!state) return null
    const normalized = String(state).toUpperCase()
    switch (normalized) {
      case ConnectionState.CONNECTED:
        return ConnectionState.CONNECTED
      case ConnectionState.CONNECTING:
        return ConnectionState.CONNECTING
      case ConnectionState.RECONNECTING:
        return ConnectionState.RECONNECTING
      case ConnectionState.DISCONNECTED:
        return ConnectionState.DISCONNECTED
      case ConnectionState.ERROR:
        return ConnectionState.ERROR
      default:
        return null
    }
  }

  const updateWsState = (state: unknown) => {
    const resolved = resolveWsState(state)
    if (!resolved) return
    wsState.value = resolved
  }

  const initWsListener = async () => {
    if (!isTauriContext() || wsUnlisten) return
    try {
      wsUnlisten = await listen('websocket-event', (event) => {
        const payload = event.payload as { type?: string; state?: string }
        if (!payload) return
        if (payload.type !== 'connectionStateChanged') return
        updateWsState(payload.state)
      })
    } catch (error) {
      console.warn('[Network] websocket-event 监听失败:', error)
    }
  }

  const initWsState = async () => {
    if (!isTauriContext()) return
    try {
      const state = await rustWebSocketClient.getState()
      updateWsState(state)
    } catch (error) {
      console.warn('[Network] WebSocket 状态获取失败:', error)
    }
  }

  // 初始化网络状态监听
  const initNetworkListener = () => {
    if (isListening.value || typeof window === 'undefined') return
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    isListening.value = true
    void initWsListener()
    void initWsState()
  }

  // 清理网络状态监听
  const cleanupNetworkListener = () => {
    if (!isListening.value || typeof window === 'undefined') return
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    isListening.value = false
    if (wsUnlisten) {
      wsUnlisten()
      wsUnlisten = null
    }
  }

  // 自动初始化监听器
  initNetworkListener()

  // 共享实例在最后一个订阅销毁时清理
  tryOnScopeDispose(() => {
    cleanupNetworkListener()
    clearOutageTimer()
  })

  return {
    isOnline,
    browserOnline,
    wsOnline,
    wsStatus,
    wsState,
    isWsConnecting,
    wsRetrying,
    wsOutageLong,
    initNetworkListener,
    cleanupNetworkListener
  }
})

export const useNetworkStatus = () => useSharedNetworkStatus()
