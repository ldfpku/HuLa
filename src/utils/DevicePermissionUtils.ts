export type DeviceKind = 'microphone' | 'camera'

/** 桌面版 media_permission_status 返回的 macOS 系统授权状态 */
export type NativeMediaStatus = 'not_determined' | 'restricted' | 'denied' | 'authorized'

/** 提示针对的环境：Mac 桌面版、Windows 桌面版、浏览器（网页版）、其他（Linux 桌面版等） */
export type PermissionPlatform = 'mac' | 'windows' | 'web' | 'other'

export type PermissionGuide = {
  intro: string
  steps: string[]
  note?: string
  /** 是否显示“打开系统设置” */
  canOpenSettings: boolean
  /** 是否显示“重新授权”（仅 Mac 桌面版：清掉旧记录后由 SMJ 重新弹出系统授权框） */
  canReauthorize: boolean
}

const DEVICE_NAME: Record<DeviceKind, string> = { microphone: '麦克风', camera: '摄像头' }

/** 网页版按浏览器所在系统补充一句系统层面的设置 */
export const detectBrowserOs = (userAgent: string): 'mac' | 'windows' | 'other' => {
  if (/Macintosh|Mac OS X/.test(userAgent) && !/iPhone|iPad/.test(userAgent)) return 'mac'
  if (/Windows/.test(userAgent)) return 'windows'
  return 'other'
}

/**
 * 设备权限被拒时给用户看的说明和操作步骤。
 * 按钮名要和弹窗里的一致：“重新授权”“打开系统设置”“挂断”。
 */
export const buildPermissionGuide = (
  kind: DeviceKind,
  platform: PermissionPlatform,
  options: { nativeStatus?: NativeMediaStatus; browserOs?: 'mac' | 'windows' | 'other' } = {}
): PermissionGuide => {
  const name = DEVICE_NAME[kind]
  const panel = kind === 'camera' ? '摄像头' : '麦克风'

  if (platform === 'mac') {
    if (options.nativeStatus === 'restricted') {
      return {
        intro: `这台 Mac 的${name}被“屏幕使用时间”或公司管理策略限制，SMJ 无法自行开启，请联系电脑管理员解除限制。`,
        steps: [],
        canOpenSettings: true,
        canReauthorize: false
      }
    }
    return {
      intro: `SMJ 还没有获得${name}权限，所以无法通话。`,
      steps: [
        `点下方“重新授权”，系统会弹出“‘SMJ’想要访问${name}”，选择“允许”。`,
        `如果没有弹窗：点“打开系统设置”，会直接打开“隐私与安全性 → ${panel}”，在列表里找到 SMJ，打开右侧开关；系统提示“退出并重新打开”时照做。`,
        `如果列表里没有 SMJ：按 ⌘Q 完全退出 SMJ（或在程序坞右键 SMJ → 退出），重新打开后再来点“重新授权”。`,
        '授权完成后挂断，重新拨打即可。'
      ],
      note: '每次升级 SMJ 后，系统可能要求重新授权，按上面步骤再做一次即可。',
      canOpenSettings: true,
      canReauthorize: true
    }
  }

  if (platform === 'windows') {
    return {
      intro: `Windows 阻止了 SMJ 使用${name}。`,
      steps: [
        `点下方“打开系统设置”，会打开“隐私和安全性 → ${panel}”。`,
        `打开“${panel}访问权限”和“允许应用访问你的${panel}”两个开关。`,
        `往下找到“允许桌面应用访问你的${panel}”，也打开。`,
        '回到 SMJ，挂断后重新拨打。'
      ],
      canOpenSettings: true,
      canReauthorize: false
    }
  }

  if (platform === 'other') {
    return {
      intro: `系统没有允许 SMJ 使用${name}。`,
      steps: [`请在系统设置里允许 SMJ 使用${name}，并确认${name}没有被其他程序占用。`, '然后挂断，重新拨打。'],
      canOpenSettings: false,
      canReauthorize: false
    }
  }

  const browserOs = options.browserOs ?? 'other'
  const systemNote =
    browserOs === 'mac'
      ? `如果浏览器里已是“允许”仍然不行：打开 Mac 的“系统设置 → 隐私与安全性 → ${panel}”，打开你所用浏览器（如 Google Chrome、Safari）的开关，然后重启浏览器。`
      : browserOs === 'windows'
        ? `如果浏览器里已是“允许”仍然不行：打开 Windows“设置 → 隐私和安全性 → ${panel}”，打开“允许桌面应用访问你的${panel}”，然后重启浏览器。`
        : undefined
  return {
    intro: `浏览器阻止了本网站使用${name}。`,
    steps: ['点地址栏最左侧的图标（锁形或“查看网站信息”）。', `把“${name}”改成“允许”。`, '刷新页面，重新拨打。'],
    note: systemNote,
    canOpenSettings: false,
    canReauthorize: false
  }
}
