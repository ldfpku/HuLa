import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CALL_TONE_URLS, callBellTone } from './CallToneUtils'

describe('CallToneUtils', () => {
  it('被叫方响来电铃声，主叫方听回铃', () => {
    expect(callBellTone(true)).toBe('incoming')
    expect(callBellTone(false)).toBe('ringback')
  })

  it('提示音文件都随包在 public/sound/', () => {
    for (const url of Object.values(CALL_TONE_URLS)) {
      expect(url).toMatch(/^\/sound\/smj-call-[a-z]+\.mp3$/)
      expect(existsSync(`public${url}`)).toBe(true)
    }
  })
})
