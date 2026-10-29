import { describe, expect, it } from 'vitest'
import { userStateIcon } from './UserStateIcon'

describe('user state icons', () => {
  it('uses local icons when the server does not provide an image', () => {
    expect(userStateIcon({ id: '2', url: '' }, '/im/')).toBe('/im/status/busy.png')
    expect(userStateIcon({ id: '5' }, '/')).toBe('/status/cloaking.png')
  })

  it('preserves a supplied remote icon', () => {
    expect(userStateIcon({ id: '2', url: 'https://example.test/icon.png' }, '/im/')).toBe(
      'https://example.test/icon.png'
    )
  })
})
