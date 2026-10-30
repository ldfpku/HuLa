import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DialogOptions } from 'naive-ui'

const mocks = vi.hoisted(() => ({ exit: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('@/stores/group', () => ({ useGroupStore: () => ({ exitGroup: mocks.exit }) }))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ userInfo: { uid: 'self' } }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

import { useGroupExit } from './useGroupExit'

describe('group exit confirmation', () => {
  let dialog: DialogOptions

  beforeEach(() => {
    vi.clearAllMocks()
    dialog = {}
    Object.assign(window, {
      $dialog: {
        warning: (options: DialogOptions) => {
          dialog = { ...options }
          return dialog
        }
      },
      $message: { success: mocks.success, error: mocks.error, warning: mocks.warning }
    })
  })

  it('immediately shows progress, blocks duplicate clicks, and navigates only after success', async () => {
    let complete!: () => void
    mocks.exit.mockReturnValue(
      new Promise<void>((resolve) => {
        complete = resolve
      })
    )
    const navigate = vi.fn()
    useGroupExit().confirmExitGroup('room', 'Group', true, navigate)
    expect(dialog.positiveText).toBe('menu.dissolve_group')
    const pending = dialog.onPositiveClick?.(new MouseEvent('click'))
    expect(dialog.loading).toBe(true)
    expect(dialog.positiveText).toBe('message.group_action.dissolve_pending')
    expect(dialog.closable).toBe(false)
    expect(dialog.maskClosable).toBe(false)
    expect(dialog.closeOnEsc).toBe(false)
    expect(dialog.negativeButtonProps?.disabled).toBe(true)
    await expect(dialog.onPositiveClick?.(new MouseEvent('click'))).resolves.toBe(false)
    expect(mocks.exit).toHaveBeenCalledOnce()
    expect(navigate).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    complete()
    await expect(pending).resolves.toBe(true)
    expect(mocks.exit).toHaveBeenCalledWith('room', true)
    expect(navigate).toHaveBeenCalledOnce()
    expect(mocks.success).toHaveBeenCalledWith('message.group_action.dissolve_success')
  })

  it('keeps the confirmation open after failure and allows retry without reporting success', async () => {
    mocks.exit.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
    const navigate = vi.fn()
    useGroupExit().confirmExitGroup('room', 'Group', false, navigate)
    await expect(dialog.onPositiveClick?.(new MouseEvent('click'))).resolves.toBe(false)
    expect(dialog.loading).toBe(false)
    expect(dialog.positiveText).toBe('menu.leave_group')
    expect(dialog.closable).toBe(true)
    expect(dialog.negativeButtonProps?.disabled).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith('message.group_action.leave_failed')
    await expect(dialog.onPositiveClick?.(new MouseEvent('click'))).resolves.toBe(true)
    expect(mocks.exit).toHaveBeenCalledWith('room', false)
    expect(navigate).toHaveBeenCalledOnce()
  })

  it('never sends an exit request for the directory channel', () => {
    useGroupExit().confirmExitGroup('1', 'Everyone', true)
    expect(mocks.warning).toHaveBeenCalledOnce()
    expect(mocks.exit).not.toHaveBeenCalled()
    expect(dialog.onPositiveClick).toBeUndefined()
  })
})
