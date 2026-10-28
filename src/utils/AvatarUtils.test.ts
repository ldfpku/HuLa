import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AvatarUtils } from './AvatarUtils'

describe('default avatars', () => {
  afterEach(() => vi.restoreAllMocks())

  it('only exposes bundled avatar files and includes both endpoints', () => {
    expect(AvatarUtils.DEFAULT_AVATARS).toHaveLength(22)
    expect(AvatarUtils.DEFAULT_AVATARS[0]).toBe('001')
    expect(AvatarUtils.DEFAULT_AVATARS[21]).toBe('022')
    for (const id of AvatarUtils.DEFAULT_AVATARS) {
      expect(existsSync(join(process.cwd(), 'public', 'avatar', `${id}.webp`))).toBe(true)
      expect(AvatarUtils.isDefaultAvatar(id)).toBe(true)
    }
    expect(AvatarUtils.isDefaultAvatar('1a1')).toBe(false)
    expect(AvatarUtils.isDefaultAvatar('023')).toBe(false)
  })

  it('randomly selects across the full preset range', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.999999)
    expect(AvatarUtils.randomDefaultAvatar()).toBe('001')
    expect(AvatarUtils.randomDefaultAvatar()).toBe('022')
  })

  it('keeps missing-avatar fallbacks stable per user without overriding chosen avatars', () => {
    const id = AvatarUtils.defaultAvatarForUser('user-123')
    expect(AvatarUtils.getAvatarUrl('', 'user-123')).toBe(`/avatar/${id}.webp`)
    expect(AvatarUtils.getAvatarUrl(null, 'user-123')).toBe(`/avatar/${id}.webp`)
    expect(AvatarUtils.getAvatarUrl('/avatar-light.svg', 'user-123')).toBe(`/avatar/${id}.webp`)
    expect(AvatarUtils.getAvatarUrl('022', 'user-123')).toBe('/avatar/022.webp')
    expect(AvatarUtils.getAvatarUrl('/avatar/022.webp', 'user-123')).toBe('/avatar/022.webp')
    expect(AvatarUtils.getAvatarUrl('https://example.test/portrait.png', 'user-123')).toBe(
      'https://example.test/portrait.png'
    )
    expect(AvatarUtils.getAvatarUrl('', undefined)).toBe('/avatar-light.svg')
  })

  it('distributes distinct user identifiers across the entire preset pool', () => {
    const assigned = new Set(
      Array.from({ length: 1000 }, (_, index) => AvatarUtils.defaultAvatarForUser(`user-${index}`))
    )
    expect(assigned.size).toBe(AvatarUtils.DEFAULT_AVATARS.length)
  })
})
