import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/utils/TauriInvokeHandler', () => ({
  ErrorType: { Network: 'Network' },
  invokeWithErrorHandler: mocks.invoke,
  invokeWithRetry: vi.fn(),
  invokeSilently: vi.fn()
}))
vi.mock('@/stores/chat', () => ({ useChatStore: vi.fn() }))
vi.mock('@/stores/group', () => ({ useGroupStore: vi.fn() }))

import { changeUserState, getUserDetail } from './ImRequestUtils'

describe('user state requests', () => {
  it('lets the state views display the original error without duplicate global toasts', async () => {
    mocks.invoke.mockResolvedValue(undefined)
    await changeUserState({ id: '5' })
    expect(mocks.invoke).toHaveBeenCalledWith(
      'im_request_command',
      expect.objectContaining({ body: { id: '5' }, params: null }),
      expect.objectContaining({ showError: false })
    )
  })

  it('can silently reconcile the authoritative state after a failed change', async () => {
    mocks.invoke.mockResolvedValueOnce({ uid: 'a', userStateId: '5' })
    await expect(getUserDetail(false)).resolves.toMatchObject({ uid: 'a', userStateId: '5' })
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      'im_request_command',
      expect.any(Object),
      expect.objectContaining({ showError: false })
    )
  })
})
