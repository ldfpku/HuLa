import { describe, expect, it } from 'vitest'
import { formatReleaseDate, splitReleaseNotes, updaterDateToIso } from './ReleaseInfo'

describe('ReleaseInfo', () => {
  it('更新器的时间转成 ISO 后显示成具体日期', () => {
    expect(updaterDateToIso('2026-10-21 3:02:03.0 +00:00:00')).toBe('2026-10-21T03:02:03Z')
    expect(formatReleaseDate('2026-10-21T03:02:03Z')).toMatch(/^2026-10-2[01]$/)
  })

  it('取不到日期时不显示', () => {
    expect(updaterDateToIso(undefined)).toBe('')
    expect(formatReleaseDate('')).toBe('')
    expect(formatReleaseDate('not a date')).toBe('')
  })

  it('标签说明和 latest.json 的说明都能分条', () => {
    expect(splitReleaseNotes('登录只需输入用户名；共享屏幕更清晰;新增铃声')).toEqual([
      '登录只需输入用户名',
      '共享屏幕更清晰',
      '新增铃声'
    ])
    expect(splitReleaseNotes('- 第一条\n- 第二条\n')).toEqual(['第一条', '第二条'])
    expect(splitReleaseNotes(undefined)).toEqual([])
  })
})
