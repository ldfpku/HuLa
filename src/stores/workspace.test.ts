import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkspaceStore } from './workspace'

describe('main workspace', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('switches between workspaces without discarding a mail destination', () => {
    const workspace = useWorkspaceStore()
    workspace.openMail('/inbox/message-1')
    expect(workspace.active).toBe('mail')
    expect(workspace.mailNavigation).toEqual({ id: 1, target: '/inbox/message-1?smj_desktop=1' })
    workspace.openChat()
    workspace.openMail()
    expect(workspace.active).toBe('mail')
    expect(workspace.mailNavigation?.id).toBe(1)
    workspace.openTodo()
    expect(workspace.active).toBe('todo')
  })

  it('rejects external destinations before changing workspace and clears state on account reset', () => {
    const workspace = useWorkspaceStore()
    expect(() => workspace.openMail('https://outside.example/')).toThrow()
    expect(workspace.active).toBe('chat')
    workspace.openMail('/inbox')
    workspace.reset()
    expect(workspace.active).toBe('chat')
    expect(workspace.mailNavigation).toBeNull()
  })
})
