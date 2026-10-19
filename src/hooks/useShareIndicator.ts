import { invoke } from '@tauri-apps/api/core'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { Ref } from 'vue'
import { isDesktop, isWeb } from '@/utils/PlatformConstants'

/**
 * 桌面版共享屏幕时的系统级提示：被共享的显示器四周的绿色边框和屏幕顶部的“正在共享”提示条
 * （Rust 的 screen_share_indicator_*）。网页版画不到浏览器外，由通话页自己显示边框和预览。
 */
export const useShareIndicator = (
  isScreenSharing: Ref<boolean>,
  localScreenStream: Ref<MediaStream | null>,
  stopScreenShare: () => unknown
) => {
  if (!isDesktop() || isWeb()) return

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
