import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createWindow: vi.fn(),
  getWindow: vi.fn(),
  checkFileExists: vi.fn(),
  getFileStatus: vi.fn(),
  updateImageAt: vi.fn(),
  showError: vi.fn(),
  store: { imageList: [] as string[], originalImageList: [] as string[], currentIndex: 0 }
}))

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset:${path}` }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: { getByLabel: mocks.getWindow } }))
vi.mock('@/hooks/useWindow', () => ({ useWindow: () => ({ createWebviewWindow: mocks.createWindow }) }))
vi.mock('@/services/i18n', () => ({ useI18nGlobal: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/chat', () => ({ useChatStore: () => ({ currentMessageMap: {} }) }))
vi.mock('@/stores/fileDownload', () => ({
  useFileDownloadStore: () => ({
    checkFileExists: mocks.checkFileExists,
    getFileStatus: mocks.getFileStatus
  })
}))
vi.mock('@/stores/imageViewer', () => ({
  useImageViewer: () => ({
    ...mocks.store,
    resetImageList: (list: string[], index: number, originalList: string[]) => {
      mocks.store.imageList = list
      mocks.store.originalImageList = originalList
      mocks.store.currentIndex = index
    },
    get originalImageList() {
      return mocks.store.originalImageList
    },
    updateImageAt: mocks.updateImageAt
  })
}))
vi.mock('@/utils/Formatting', () => ({ extractFileName: () => 'image.png' }))
vi.mock('@/utils/PathUtil', () => ({ getFilesMeta: vi.fn() }))

import { useImageViewer } from './useImageViewer'

describe('image viewer opening', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getWindow.mockResolvedValue(null)
    mocks.createWindow.mockResolvedValue({})
    mocks.getFileStatus.mockReturnValue(undefined)
    mocks.store.imageList = []
    mocks.store.originalImageList = []
    Object.assign(window, { $message: { error: mocks.showError } })
  })

  it('opens the selected image without waiting for local file checks', async () => {
    let finishCheck!: (exists: boolean) => void
    mocks.checkFileExists.mockReturnValue(new Promise((resolve) => (finishCheck = resolve)))
    const url = 'https://example.test/image.png'
    const result = await Promise.race([
      useImageViewer()
        .openImageViewer(url)
        .then(() => 'opened'),
      new Promise<string>((resolve) => setTimeout(() => resolve('blocked'), 500))
    ])
    finishCheck(false)
    expect(result).toBe('opened')
    expect(mocks.store.originalImageList).toEqual([url])
    expect(mocks.createWindow).toHaveBeenCalledOnce()
  })

  it('shows an error when the viewer window cannot be created', async () => {
    mocks.checkFileExists.mockResolvedValue(false)
    mocks.createWindow.mockRejectedValue(new Error('window failed'))
    await useImageViewer().openImageViewer('https://example.test/image.png')
    expect(mocks.showError).toHaveBeenCalledWith('message.image_viewer.open_error')
  })

  it('reports native window creation failures after the request returns', async () => {
    mocks.checkFileExists.mockResolvedValue(false)
    await useImageViewer().openImageViewer('https://example.test/image.png')
    const onCreateError = mocks.createWindow.mock.calls[0][11]
    onCreateError('native failure')
    expect(mocks.showError).toHaveBeenCalledWith('message.image_viewer.open_error')
  })

  it('updates and focuses an existing viewer with the selected image', async () => {
    const viewer = { emit: vi.fn(), show: vi.fn(), setFocus: vi.fn() }
    mocks.getWindow.mockResolvedValue(viewer)
    mocks.checkFileExists.mockResolvedValue(false)
    const url = 'https://example.test/selected.png'
    await useImageViewer().openImageViewer(url, undefined, ['https://example.test/other.png'])
    expect(viewer.emit).toHaveBeenCalledWith('update-image', {
      list: [url, 'https://example.test/other.png'],
      index: 0
    })
    expect(viewer.show).toHaveBeenCalledOnce()
    expect(viewer.setFocus).toHaveBeenCalledOnce()
    expect(mocks.createWindow).not.toHaveBeenCalled()
  })
})
