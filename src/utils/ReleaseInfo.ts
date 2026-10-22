import dayjs from 'dayjs'

/**
 * 当前安装包的版本信息：发布时由打包流程写入（见 .github/workflows/desktop-release.yml），
 * 说明取自发布标签的说明，日期取打包时间；本地开发版没有说明
 */
export const currentReleaseNotes = import.meta.env.VITE_RELEASE_NOTES ?? ''
export const currentReleaseDate = import.meta.env.VITE_BUILD_TIME ?? ''

/** 更新器给的发布时间形如 "2026-10-20 1:02:03.0 +00:00:00"（UTC），转成 ISO */
export const updaterDateToIso = (date?: string) => {
  const m = date?.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2}):(\d{2})/)
  return m ? `${m[1]}T${m[2].padStart(2, '0')}:${m[3]}:${m[4]}Z` : ''
}

/** 发布日期按本地时区显示成 2026-10-21，取不到时返回空串 */
export const formatReleaseDate = (date?: string) => {
  const parsed = date ? dayjs(date) : null
  return parsed?.isValid() ? parsed.format('YYYY-MM-DD') : ''
}

/** 发布说明按分号或换行分条，去掉行首的 "- " 或 "* " */
export const splitReleaseNotes = (notes?: string) =>
  (notes ?? '')
    .split(/[;；\n]/)
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean)
