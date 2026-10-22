import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { NButton } from 'naive-ui'
import { MittEnum } from '../enums'
import { useMitt } from './useMitt'
import { useI18nGlobal } from '@/services/i18n'
import { isMac, isMobile, isWeb } from '@/utils/PlatformConstants'

/** 已在后台下载好、等用户重启的新版本（每个窗口各自一份，只有主窗口会下载） */
let readyUpdate: Update | null = null
let preparing = false

/** 新版本下载好后提示重启；不点也没关系，Windows 下次启动时自动安装，macOS 已经装好，下次打开就是新版 */
const notifyReady = (version: string) => {
  const { t } = useI18nGlobal()
  const notice = window.$notification.create({
    title: t('message.auto_update.title'),
    content: t(isMac() ? 'message.auto_update.ready_mac' : 'message.auto_update.ready_windows', { version }),
    closable: true,
    action: () =>
      h(
        NButton,
        {
          text: true,
          type: 'primary',
          onClick: () => {
            notice.destroy()
            void applyReadyUpdate()
          }
        },
        { default: () => t('message.auto_update.restart_now') }
      )
  })
}

/** 用户点了“立即重启”：macOS 新版已装好，直接重启；Windows 运行安装程序（静默模式，装完自动打开） */
const applyReadyUpdate = async () => {
  try {
    if (isMac()) {
      await relaunch()
      return
    }
    await readyUpdate?.install()
  } catch (error) {
    console.error('[update] 安装新版本失败', error)
    window.$message?.error(useI18nGlobal().t('message.auto_update.install_failed'))
  }
}

/** 后台下载新版本（下载时校验更新签名），macOS 下载完即替换应用，下次打开就是新版 */
const prepareUpdate = async (update: Update) => {
  if (preparing || readyUpdate?.version === update.version) {
    return
  }
  preparing = true
  try {
    await update.download()
    if (isMac()) {
      await update.install()
    }
    readyUpdate = update
    notifyReady(update.version)
  } catch (error) {
    console.error('[update] 后台下载新版本失败', error)
  } finally {
    preparing = false
  }
}

/**
 * 自动更新
 */
export const useCheckUpdate = () => {
  // 主窗口检查周期：4 小时
  const CHECK_UPDATE_TIME = 4 * 60 * 60 * 1000
  // 登录窗口检查周期
  const CHECK_UPDATE_LOGIN_TIME = 5 * 60 * 1000

  /**
   * 检查更新
   * - 登录窗口（启动时）：有新版直接打开更新窗口下载安装，装完自动打开
   * - 主窗口：后台下载，好了再提示重启，不打断正在进行的聊天、通话和会议
   * @param closeWin 当前窗口
   * @param canInstall 登录窗口用：正在登录时返回 false，不打断登录（交给主窗口后台下载）
   */
  const checkUpdate = async (closeWin: string, canInstall: () => boolean = () => true) => {
    // 更新信息由邮箱站点 /api/desktop/update 提供（见 src-tauri/tauri.conf.json 的 updater.endpoints），网页版不需要
    if (import.meta.env.DEV || isWeb() || isMobile()) {
      return
    }

    try {
      const update = await check({ timeout: 5000 /* 接口请求时长 5秒 */ })
      if (!update?.available) {
        return
      }
      if (closeWin === 'login') {
        if (canInstall()) {
          useMitt.emit(MittEnum.DO_UPDATE, { close: closeWin })
        }
        return
      }
      void prepareUpdate(update)
    } catch (error) {
      console.log(error)
    }
  }

  return {
    checkUpdate,
    CHECK_UPDATE_TIME,
    CHECK_UPDATE_LOGIN_TIME
  }
}
