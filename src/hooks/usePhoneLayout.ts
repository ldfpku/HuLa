import router from '@/router'
import { isWeb, PHONE_LAYOUT_QUERY } from '@/utils/PlatformConstants'

/**
 * 网页版在手机（和窄窗口）上的单栏布局：会话列表、聊天页、联系人详情各占满一屏。
 * 桌面三栏放不下时右栏会被收起、点会话没有反应，所以改单栏（条件见 PHONE_LAYOUT_QUERY）。
 * 只在网页版生效，Tauri 桌面版和原生移动版不受影响。
 */
const media = typeof window !== 'undefined' && isWeb() ? window.matchMedia(PHONE_LAYOUT_QUERY) : null
const phone = ref(Boolean(media?.matches))
media?.addEventListener('change', (event) => {
  phone.value = event.matches
})

/** 单栏里“进入”的那一屏：聊天或联系人详情。记在地址的 ?pane= 里，手机的返回手势和浏览器后退就能回到列表 */
export type PhonePane = 'chat' | 'contact'

export const isPhoneLayout = readonly(phone)

export const currentPhonePane = computed<PhonePane | undefined>(() => {
  if (!phone.value) return undefined
  const pane = router.currentRoute.value.query.pane
  return pane === 'chat' || pane === 'contact' ? pane : undefined
})

/** 打开聊天页或联系人详情（宽屏时什么也不做） */
export const openPhonePane = (pane: PhonePane) => {
  if (!phone.value) return
  const route = router.currentRoute.value
  if (route.query.pane === pane) return
  void router.push({ path: route.path, query: { ...route.query, pane } })
}

/** 直接去掉 ?pane=，不留历史记录（刷新后聊天页的状态没了，先回列表） */
export const clearPhonePane = () => {
  const route = router.currentRoute.value
  if (!route.query.pane) return
  const query = Object.fromEntries(Object.entries(route.query).filter(([key]) => key !== 'pane'))
  void router.replace({ path: route.path, query })
}

/** 回到列表：能后退就后退（和手势返回一致），否则直接去掉 ?pane= */
export const closePhonePane = () => {
  const back = (window.history.state as { back?: string } | null)?.back
  if (back && !back.includes('pane=')) {
    router.back()
    return
  }
  clearPhonePane()
}
