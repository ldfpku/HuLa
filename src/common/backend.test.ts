import { describe, expect, it } from 'vitest'
import { APP_FEATURES } from './backend'

describe('workspace entry points', () => {
  it('enables embedded desktop mail and the shared to-do workspace', () => {
    expect(APP_FEATURES.embeddedMailWorkspace).toBe(true)
    expect(APP_FEATURES.todoWorkspace).toBe(true)
  })
})
