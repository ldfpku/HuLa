import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUploadProgressUpdater, yieldBeforeFileUpload } from './FileUploadScheduling'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('file upload scheduling', () => {
  it('starts uploads without waiting for an animation frame', async () => {
    vi.useFakeTimers()
    const requestFrame = vi.fn()
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    const yielded = vi.fn()
    const pending = yieldBeforeFileUpload().then(yielded)

    await vi.runAllTimersAsync()
    await pending
    expect(yielded).toHaveBeenCalledOnce()
    expect(requestFrame).not.toHaveBeenCalled()
  })

  it('coalesces progress updates and ignores a late frame after stopping', () => {
    let callback: FrameRequestCallback | undefined
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback) => {
        callback = cb
        return 1
      })
    )
    const cancel = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const apply = vi.fn()
    const progress = createUploadProgressUpdater(apply)

    progress.update(10)
    progress.update(50)
    callback?.(0)
    expect(apply).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledWith(50)

    progress.update(80)
    progress.stop()
    callback?.(0)
    progress.update(100)
    expect(cancel).toHaveBeenCalledWith(1)
    expect(apply).toHaveBeenCalledOnce()
  })
})
