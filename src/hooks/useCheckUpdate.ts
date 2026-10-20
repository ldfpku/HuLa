import { getVersion } from '@tauri-apps/api/app'
import { check } from '@tauri-apps/plugin-updater'
import { useSettingStore } from '@/stores/setting.ts'
import { MittEnum } from '../enums'
import { useMitt } from './useMitt'
import { isMobile, isWeb } from '@/utils/PlatformConstants'

/**
 * 检查更新
 */
export const useCheckUpdate = () => {
  const settingStore = useSettingStore()
  // 检查更新周期
  const CHECK_UPDATE_TIME = 30 * 60 * 1000
  // 在未登录情况下缩短检查周期
  const CHECK_UPDATE_LOGIN_TIME = 5 * 60 * 1000
  const isProduction = import.meta.env.PROD && !isMobile()

  /**
   * 检查更新
   * @param closeWin 需要关闭的窗口
   * @param initialCheck 是否是初始检查，默认为false。初始检查时只显示强制更新提示，不显示普通更新提示
   */
  const checkUpdate = async (closeWin: string, initialCheck: boolean = false) => {
    // 更新信息由邮箱站点 /api/desktop/update 提供（见 src-tauri/tauri.conf.json 的 updater.endpoints），网页版不需要
    if (import.meta.env.DEV || isWeb() || isMobile()) {
      return
    }

    await check({
      timeout: 5000 /* 接口请求时长 5秒 */
    })
      .then(async (e) => {
        if (!e?.available) {
          return
        }

        const newVersion = e.version
        const currenVersion = await getVersion()
        // 主版本或次版本升高时强制更新，修订号升高时只提示；按数字比较，避免 "10" < "9"
        const [newMajor = 0, newMinor = 0] = newVersion.split('.').map(Number)
        const [currentMajor = 0, currentMinor = 0] = currenVersion.split('.').map(Number)
        const requireForceUpdate =
          isProduction && (newMajor > currentMajor || (newMajor === currentMajor && newMinor > currentMinor))
        if (requireForceUpdate) {
          useMitt.emit(MittEnum.DO_UPDATE, { close: closeWin })
        } else if (newVersion !== currenVersion && settingStore.update.dismiss !== newVersion && !initialCheck) {
          // 只在非初始检查时显示普通更新提示
          useMitt.emit(MittEnum.CHECK_UPDATE)
        }
      })
      .catch((e) => {
        console.log(e)
      })
  }

  return {
    checkUpdate,
    CHECK_UPDATE_TIME,
    CHECK_UPDATE_LOGIN_TIME
  }
}
