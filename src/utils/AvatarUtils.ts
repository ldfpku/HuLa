/**
 * 用于处理头像相关操作的实用类
 */
export class AvatarUtils {
  public static readonly DEFAULT_AVATARS: readonly string[] = Array.from({ length: 22 }, (_, index) =>
    String(index + 1).padStart(3, '0')
  )

  public static randomDefaultAvatar(): string {
    return AvatarUtils.DEFAULT_AVATARS[Math.floor(Math.random() * AvatarUtils.DEFAULT_AVATARS.length)]
  }

  public static defaultAvatarForUser(uid: string): string {
    let hash = 2166136261
    for (let index = 0; index < uid.length; index++) {
      hash = Math.imul(hash ^ uid.charCodeAt(index), 16777619)
    }
    return AvatarUtils.DEFAULT_AVATARS[(hash >>> 0) % AvatarUtils.DEFAULT_AVATARS.length]
  }

  /**
   * 检查头像字符串是否为默认头像 (001-022)
   * @param avatar - 要检查的头像字符串
   * @returns 布尔值指示是否是默认头像
   */
  public static isDefaultAvatar(avatar: string): boolean {
    return AvatarUtils.DEFAULT_AVATARS.includes(avatar)
  }

  /**
   * 根据头像值获取头像URL
   * @param avatar - 头像字符串或URL
   * @returns 头像字符串或URL
   */
  public static getAvatarUrl(avatar: string | null | undefined, uid?: string): string {
    const DEFAULT = '/avatar-light.svg'
    const rawAvatar = avatar?.trim() || ''
    if (!rawAvatar || rawAvatar === '/avatar-light.svg' || rawAvatar === '/avatar-dark.svg') {
      return uid ? `/avatar/${AvatarUtils.defaultAvatarForUser(uid)}.webp` : DEFAULT
    }
    if (AvatarUtils.isDefaultAvatar(rawAvatar)) {
      return `/avatar/${rawAvatar}.webp`
    }
    const base = import.meta.env.BASE_URL
    const relativePath = rawAvatar.startsWith(base) ? rawAvatar.slice(base.length) : rawAvatar.replace(/^\//, '')
    const presetPath = /^avatar\/(\d{3})\.webp$/.exec(relativePath)
    if (presetPath && AvatarUtils.isDefaultAvatar(presetPath[1])) return rawAvatar

    try {
      const parsed = new URL(rawAvatar)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString()
      }
    } catch {
      // 如果是自家预置文件名，可进一步做白名单/正则校验
      if (/^[a-z0-9_-]+$/i.test(rawAvatar)) {
        return `/avatar/${rawAvatar}.webp`
      }
    }
    return DEFAULT
  }
}
