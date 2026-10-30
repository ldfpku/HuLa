import { describe, expect, it, vi } from 'vitest'
import { WindowVisibilityController } from './WindowVisibilityController'

describe('window visibility updates', () => {
  it('coalesces overlapping reads so an old window state is not sent', async () => {
    let finish: ((value: boolean) => void) | undefined
    const read = vi.fn().mockImplementationOnce(() => new Promise<boolean>((resolve) => (finish = resolve)))
    read.mockResolvedValue(false)
    const apply = vi.fn().mockResolvedValue(undefined)
    const controller = new WindowVisibilityController(read, apply, vi.fn())
    controller.request()
    controller.request()
    finish?.(true)
    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce())
    expect(apply).toHaveBeenCalledWith(false)
    expect(read).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('reports read failures and retries on a later request', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('synthetic failure')).mockResolvedValue(true)
    const apply = vi.fn().mockResolvedValue(undefined)
    const report = vi.fn()
    const controller = new WindowVisibilityController(read, apply, report)
    controller.request()
    await vi.waitFor(() => expect(report).toHaveBeenCalledOnce())
    controller.request()
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(true))
    controller.dispose()
  })

  it('does not send an in-flight result after disposal', async () => {
    let finish: ((value: boolean) => void) | undefined
    const apply = vi.fn().mockResolvedValue(undefined)
    const controller = new WindowVisibilityController(
      () => new Promise((resolve) => (finish = resolve)),
      apply,
      vi.fn()
    )
    controller.request()
    controller.dispose()
    finish?.(true)
    await Promise.resolve()
    expect(apply).not.toHaveBeenCalled()
  })
})
