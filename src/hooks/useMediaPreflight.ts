import { CallTypeEnum } from '@/enums'
import { useDevicePermission, type DeviceKind } from '@/hooks/useDevicePermission'
import { useI18nGlobal } from '@/services/i18n'

export const preflightMedia = async (type: CallTypeEnum): Promise<boolean> => {
  const { t } = useI18nGlobal()
  const permissions = useDevicePermission()
  const kinds: DeviceKind[] = type === CallTypeEnum.VIDEO ? ['microphone', 'camera'] : ['microphone']
  const denied = await permissions.ensureNativeAccess(kinds)
  if (denied) {
    permissions.showPermissionDeniedDialog(denied.kind, { nativeStatus: denied.status })
    return false
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    window.$message.error(t('message.permission.device_unsupported'))
    return false
  }

  for (const kind of kinds) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: kind === 'microphone',
        video: kind === 'camera'
      })
      stream.getTracks().forEach((track) => track.stop())
    } catch (error) {
      console.error(`设备检测失败 (${kind}):`, error)
      if (permissions.isPermissionDenied(error)) {
        permissions.showPermissionDeniedDialog(kind)
      } else {
        const errorName = error instanceof Error ? error.name : ''
        const key =
          errorName === 'NotReadableError' || errorName === 'AbortError'
            ? kind === 'camera'
              ? 'message.permission.camera.busy'
              : 'message.permission.mic.busy'
            : kind === 'camera'
              ? 'message.permission.camera.unavailable'
              : 'message.permission.mic.unavailable'
        window.$message.error(t(key))
      }
      return false
    }
  }
  return true
}
