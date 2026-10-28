import { invoke } from '@tauri-apps/api/core'
import { openAppSettings } from '@tauri-apps/plugin-barcode-scanner'
import { error, info } from '@tauri-apps/plugin-log'
import { openUrl } from '@tauri-apps/plugin-opener'
import { NButton } from 'naive-ui'
import { h } from 'vue'
import { useI18nGlobal } from '@/services/i18n'
import {
  buildPermissionGuide,
  type DeviceKind,
  detectBrowserOs,
  type NativeMediaStatus,
  type PermissionPlatform
} from '@/utils/DevicePermissionUtils'
import { isAndroid, isIOS, isMac, isWeb, isWindows } from '@/utils/PlatformConstants'

export type { DeviceKind }

/**
 * 设备权限相关
 *
 * Mac 桌面版先用 media_permission_* 命令问系统授权状态，未询问过时由 SMJ 自己弹出系统授权框，
 * 这样“隐私与安全性”的列表里一定有 SMJ；被拒时弹窗按平台写清步骤。
 * Android 的运行时权限由 MainActivity.kt 在启动时请求。
 */
export const useDevicePermission = () => {
  const { t } = useI18nGlobal()

  /** Mac 桌面版才有系统授权可查，网页版的 Mac 走浏览器自己的权限 */
  const hasNativeMediaPermission = () => isMac() && !isWeb()

  const getPermissionPlatform = (): PermissionPlatform => {
    if (isWeb() || isIOS() || isAndroid()) return 'web'
    if (isMac()) return 'mac'
    if (isWindows()) return 'windows'
    return 'other'
  }

  /**
   * 预检设备权限状态
   * @param kind 设备类型 microphone | camera
   * @returns PermissionState，不支持查询时回退 'prompt'
   */
  const checkDevicePermission = async (kind: DeviceKind): Promise<PermissionState> => {
    if (hasNativeMediaPermission()) {
      const status = await getNativeStatus(kind)
      if (status === 'authorized') return 'granted'
      if (status === 'denied' || status === 'restricted') return 'denied'
      return 'prompt'
    }
    if (!('permissions' in navigator)) return 'prompt'
    try {
      const permission = await navigator.permissions.query({ name: kind as PermissionName })
      return permission.state
    } catch (err) {
      console.warn(`检查 ${kind} 权限失败`, err)
      return 'prompt'
    }
  }

  const getNativeStatus = async (kind: DeviceKind): Promise<NativeMediaStatus | undefined> => {
    try {
      return await invoke<NativeMediaStatus>('media_permission_status', { kind })
    } catch (err) {
      error(`查询${kind}系统授权失败: ${String(err)}`)
      return undefined
    }
  }

  /**
   * Mac 桌面版：逐个检查所需设备的系统授权，未询问过的由 SMJ 弹出系统授权框。
   * @returns 第一个没拿到授权的设备及其状态；全部已授权（或非 Mac 桌面版）返回 undefined
   */
  const ensureNativeAccess = async (
    kinds: DeviceKind[]
  ): Promise<{ kind: DeviceKind; status: NativeMediaStatus } | undefined> => {
    if (!hasNativeMediaPermission()) return undefined
    for (const kind of kinds) {
      try {
        const status = await invoke<NativeMediaStatus>('media_permission_request', { kind })
        info(`${kind} 系统授权状态: ${status}`)
        if (status !== 'authorized') return { kind, status }
      } catch (err) {
        // 查不到就交给 getUserMedia 自己判断
        error(`请求${kind}系统授权失败: ${String(err)}`)
      }
    }
    return undefined
  }

  /**
   * 判断错误是否为权限拒绝
   */
  const isPermissionDenied = (err: unknown): boolean => {
    const name = (err as { name?: string })?.name
    return name === 'NotAllowedError' || name === 'SecurityError'
  }

  /**
   * 多个设备同时请求失败时，尽量识别是哪个权限被拒绝。
   */
  const resolveDeniedDeviceKind = async (kinds: DeviceKind[]): Promise<DeviceKind> => {
    if (kinds.length === 1) return kinds[0]
    for (const kind of kinds) {
      if ((await checkDevicePermission(kind)) === 'denied') return kind
    }
    return kinds.includes('camera') ? 'camera' : 'microphone'
  }

  /**
   * 获取当前平台的隐私设置入口
   * @param kind 设备类型
   */
  const getSettingsUrl = (kind: DeviceKind): string => {
    const isCamera = kind === 'camera'
    if (isMac()) {
      return isCamera
        ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera'
        : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
    }
    if (isWindows()) {
      return isCamera ? 'ms-settings:privacy-webcam' : 'ms-settings:privacy-microphone'
    }
    // iOS/Android 暂无通用 DeepLink，返回应用设置页占位
    if (isIOS()) return 'app-settings:'
    if (isAndroid()) return 'package:com.android.settings'
    return ''
  }

  /**
   * 打开系统隐私设置页
   * 优先用 opener 的 openUrl（走系统默认处理器），失败时降级兜底。
   */
  const openSystemSettings = async (kind: DeviceKind): Promise<void> => {
    if (isWeb()) return
    if (isIOS() || isAndroid()) {
      try {
        await openAppSettings()
        return
      } catch (err) {
        console.error('打开应用设置失败:', err)
      }
    }

    const url = getSettingsUrl(kind)
    if (!url) {
      console.warn('当前平台暂不支持自动打开系统设置')
      return
    }
    try {
      await openUrl(url)
    } catch (err) {
      console.error('打开系统设置失败:', err)
      // 降级：尝试用 window.open
      try {
        window.open(url, '_blank', 'noreferrer')
      } catch {
        // 忽略降级失败
      }
    }
  }

  /**
   * 清掉 SMJ 的系统授权记录后重新弹出授权框（仅 Mac 桌面版）。
   * 安装包每次升级签名都会变，旧的授权记录可能失效，重置是最直接的恢复办法。
   */
  const reauthorize = async (kind: DeviceKind): Promise<NativeMediaStatus | undefined> => {
    try {
      return await invoke<NativeMediaStatus>('media_permission_reset', { kind })
    } catch (err) {
      error(`重新授权${kind}失败: ${String(err)}`)
      return undefined
    }
  }

  /**
   * 设备权限被拒时的弹窗：按平台写清步骤。
   * Mac 桌面版有“重新授权”“打开系统设置”，Windows 有“打开系统设置”，网页版说明浏览器里怎么放行。
   */
  const showPermissionDeniedDialog = (
    kind: DeviceKind,
    options: { nativeStatus?: NativeMediaStatus; onHangup?: () => void | Promise<void> } = {}
  ) => {
    const guide = buildPermissionGuide(kind, getPermissionPlatform(), {
      nativeStatus: options.nativeStatus,
      browserOs: detectBrowserOs(navigator.userAgent)
    })
    const title = t(kind === 'camera' ? 'message.permission.camera.title' : 'message.permission.mic.title')
    const deviceName = kind === 'camera' ? '摄像头' : '麦克风'
    let busy = false

    const dialog = window.$dialog.warning({
      title,
      style: { width: '460px', maxWidth: 'calc(100vw - 32px)' },
      content: () =>
        h('div', { class: 'text-14px leading-22px' }, [
          h('p', { class: 'm-0' }, guide.intro),
          guide.steps.length
            ? h(
                'ol',
                { class: 'mt-8px mb-0 pl-20px' },
                guide.steps.map((step) => h('li', { class: 'mb-4px' }, step))
              )
            : null,
          guide.note ? h('p', { class: 'mt-8px mb-0 text-12px text-[#909090]' }, guide.note) : null
        ]),
      action: () =>
        h('div', { class: 'flex flex-wrap justify-end gap-8px' }, [
          h(
            NButton,
            {
              onClick: () => {
                dialog.destroy()
                void options.onHangup?.()
              }
            },
            { default: () => t('message.permission.hangup') }
          ),
          guide.canOpenSettings
            ? h(
                NButton,
                {
                  type: guide.canReauthorize ? 'default' : 'primary',
                  onClick: () => void openSystemSettings(kind)
                },
                { default: () => t('message.permission.open_settings') }
              )
            : null,
          guide.canReauthorize
            ? h(
                NButton,
                {
                  type: 'primary',
                  onClick: async () => {
                    if (busy) return
                    busy = true
                    dialog.loading = true
                    const status = await reauthorize(kind)
                    dialog.loading = false
                    busy = false
                    if (status === 'authorized') {
                      window.$message.success(`已获得${deviceName}权限，请重新拨打`)
                      dialog.destroy()
                      void options.onHangup?.()
                    } else {
                      window.$message.warning(`仍未获得${deviceName}权限，请按第 2、3 步在系统设置里打开`)
                    }
                  }
                },
                { default: () => t('message.permission.reauthorize') }
              )
            : null,
          !guide.canOpenSettings && !guide.canReauthorize
            ? h(
                NButton,
                { type: 'primary', onClick: () => dialog.destroy() },
                { default: () => t('message.permission.got_it') }
              )
            : null
        ])
    })
    error(`设备权限被拒绝(${kind}${options.nativeStatus ? `, 系统状态 ${options.nativeStatus}` : ''})`)
  }

  return {
    checkDevicePermission,
    ensureNativeAccess,
    isPermissionDenied,
    resolveDeniedDeviceKind,
    openSystemSettings,
    showPermissionDeniedDialog
  }
}
