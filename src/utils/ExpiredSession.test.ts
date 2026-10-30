import { describe, expect, it } from 'vitest'
import { isExpiredSession } from './ExpiredSession'

describe('expired session matching', () => {
  it('matches string identifiers without converting them to numbers', () => {
    expect(isExpiredSession('local-a', 'desktop', { uid: 'local-a', client: 'desktop' })).toBe(true)
    expect(isExpiredSession('local-a', 'desktop', { uid: 'local-b', client: 'desktop' })).toBe(false)
    expect(isExpiredSession('1', 'desktop', { uid: '01', client: 'desktop' })).toBe(false)
  })

  it('requires the current account and client', () => {
    expect(isExpiredSession(undefined, 'desktop', { uid: '', client: 'desktop' })).toBe(false)
    expect(isExpiredSession('local-a', 'desktop', { uid: 'local-a', client: 'web' })).toBe(false)
  })
})
