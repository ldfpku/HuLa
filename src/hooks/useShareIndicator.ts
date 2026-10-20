import { invoke } from '@tauri-apps/api/core'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { isDesktop, isWeb } from '@/utils/PlatformConstants'

/** 共享时标签页标题的前缀，切到别的标签页也能看到还在共享 */
const SHARE_TITLE_PREFIX = '● 共享中 · '

/** 网页版：标题加前缀，开始共享时提示一次网页画不了屏幕四周的边框 */
const useWebShareCue = (isScreenSharing: Ref<boolean>) => {
  const { t } = useI18n()
  const restore = () => {
    if (document.title.startsWith(SHARE_TITLE_PREFIX)) {
      document.title = document.title.slice(SHARE_TITLE_PREFIX.length)
    }
  }
  watch(isScreenSharing, (sharing) => {
    if (!sharing) return restore()
    if (!document.title.startsWith(SHARE_TITLE_PREFIX)) document.title = SHARE_TITLE_PREFIX + document.title
    window.$message?.info?.(t('message.call_window.share_web_no_border'), { duration: 8000 })
  })
  onBeforeUnmount(restore)
}

/**
 * 桌面版共享屏幕时的系统级提示：被共享的显示器四周的绿色边框和屏幕顶部的“正在共享”提示条
 * （Rust 的 screen_share_indicator_*）。网页版画不到浏览器外，由通话页自己显示边框和预览，
 * 另外给标签页标题加前缀并提示一次。
 */
export const useShareIndicator = (
  isScreenSharing: Ref<boolean>,
  localScreenStream: Ref<MediaStream | null>,
  stopScreenShare: () => unknown
) => {
  if (isWeb()) {
    useWebShareCue(isScreenSharing)
    return
  }
  if (!isDesktop()) return

  let unlisten: UnlistenFn | undefined
  void getCurrentWebviewWindow()
    .listen('screen-share-stop-request', () => {
      if (isScreenSharing.value) void stopScreenShare()
    })
    .then((fn) => {
      unlisten = fn
    })

  watch(
    [isScreenSharing, localScreenStream],
    ([sharing, stream]) => {
      const track = stream?.getVideoTracks()[0]
      if (!sharing || !track) {
        void invoke('screen_share_indicator_hide').catch(() => {})
        return
      }
      const settings = track.getSettings() as MediaTrackSettings & { displaySurface?: string }
      void invoke('screen_share_indicator_show', {
        surface: settings.displaySurface || 'monitor',
        width: settings.width ? Math.round(settings.width) : null,
        height: settings.height ? Math.round(settings.height) : null
      }).catch((e) => console.warn('[共享提示] 显示失败', e))
    },
    { immediate: true }
  )

  onBeforeUnmount(() => {
    unlisten?.()
    void invoke('screen_share_indicator_hide').catch(() => {})
  })
}
