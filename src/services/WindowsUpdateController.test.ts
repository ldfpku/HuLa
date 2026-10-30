import { describe, expect, it, vi } from 'vitest'
import type { DownloadEvent } from '@tauri-apps/plugin-updater'
import { WindowsUpdateController, type WindowsUpdateState } from './WindowsUpdateController'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('WindowsUpdateController', () => {
  it('distinguishes download completion from signature verification', async () => {
    const verification = deferred<void>()
    const states: WindowsUpdateState[] = []
    let progress!: (event: DownloadEvent) => void
    const update = {
      version: '2.0',
      download: vi.fn((onEvent?: (event: DownloadEvent) => void) => {
        progress = onEvent!
        return verification.promise
      }),
      install: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    }
    const controller = new WindowsUpdateController(
      async () => update,
      (state) => states.push(state)
    )
    const start = controller.start()
    await vi.waitFor(() => expect(update.download).toHaveBeenCalledOnce())
    progress({ event: 'Started', data: { contentLength: 100 } })
    progress({ event: 'Progress', data: { chunkLength: 33 } })
    expect(controller.state).toMatchObject({ stage: 'downloading', percentage: 33 })
    progress({ event: 'Progress', data: { chunkLength: 200 } })
    expect(controller.state.percentage).toBe(100)
    progress({ event: 'Finished' })
    expect(controller.state.stage).toBe('verifying')
    expect(states.some((state) => state.stage === 'ready')).toBe(false)
    verification.resolve()
    await start
    expect(controller.state).toMatchObject({ stage: 'ready', version: '2.0', percentage: null })
  })

  it.each([undefined, 0])('uses indeterminate progress for length %s', async (contentLength) => {
    const update = {
      version: '2.0',
      download: vi.fn(async (onEvent?: (event: DownloadEvent) => void) => {
        onEvent?.({ event: 'Started', data: { contentLength } })
        onEvent?.({ event: 'Progress', data: { chunkLength: 50 } })
        expect(controller.state.percentage).toBeNull()
      }),
      install: vi.fn(),
      close: vi.fn()
    }
    const controller = new WindowsUpdateController(
      async () => update,
      () => {}
    )
    await controller.start()
    expect(controller.state.stage).toBe('ready')
  })

  it('reports signature failure and closes the old resource before retrying', async () => {
    const update = {
      version: '2.0',
      download: vi.fn().mockRejectedValueOnce(new Error('invalid signature')).mockResolvedValueOnce(undefined),
      install: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined)
    }
    const controller = new WindowsUpdateController(
      async () => update,
      () => {}
    )
    await controller.start()
    expect(controller.state).toMatchObject({ stage: 'error', error: 'download' })
    await controller.start()
    expect(update.close).toHaveBeenCalledOnce()
    expect(controller.state.stage).toBe('ready')
  })

  it('does not duplicate concurrent downloads or installs', async () => {
    const download = deferred<void>()
    const install = deferred<void>()
    const update = {
      version: '2.0',
      download: vi.fn(() => download.promise),
      install: vi.fn(() => install.promise),
      close: vi.fn()
    }
    const check = vi.fn(async () => update)
    const controller = new WindowsUpdateController(check, () => {})
    const first = controller.start()
    await controller.start()
    expect(check).toHaveBeenCalledOnce()
    download.resolve()
    await first
    const installing = controller.install()
    await controller.install()
    expect(update.install).toHaveBeenCalledOnce()
    expect(controller.state.stage).toBe('installing')
    install.resolve()
    await expect(installing).rejects.toThrow('Windows installer returned without exiting')
    expect(controller.state).toMatchObject({ stage: 'ready', error: 'install' })
  })

  it('keeps a verified update available when installation fails', async () => {
    const update = {
      version: '2.0',
      download: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockRejectedValue(new Error('installer failed')),
      close: vi.fn()
    }
    const controller = new WindowsUpdateController(
      async () => update,
      () => {}
    )
    await controller.start()
    await expect(controller.install()).rejects.toThrow('installer failed')
    expect(controller.state).toMatchObject({ stage: 'ready', error: 'install' })
  })

  it('reports when no update is available', async () => {
    const controller = new WindowsUpdateController(
      async () => null,
      () => {}
    )
    await controller.start()
    expect(controller.state.stage).toBe('none')
  })
})
