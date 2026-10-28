import { describe, expect, it } from 'vitest'
import { desktopMailTarget } from './DesktopMail'

describe('desktop mail target', () => {
  it('marks inbox and preserves message query parameters and fragments', () => {
    expect(desktopMailTarget()).toBe('/inbox?smj_desktop=1')
    expect(desktopMailTarget('/message/42?folder=sent#part')).toBe('/message/42?folder=sent&smj_desktop=1#part')
  })

  it('rejects external or malformed targets', () => {
    for (const path of ['https://example.test', '//example.test', '/\\example.test']) {
      expect(() => desktopMailTarget(path)).toThrow()
    }
  })
})
