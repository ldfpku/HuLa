import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ uploadFile: vi.fn(), showError: vi.fn() }))
vi.mock('./useUpload', () => ({
  UploadProviderEnum: { QINIU: 'qiniu' },
  useUpload: () => ({
    uploadFile: mocks.uploadFile,
    fileInfo: { value: { downloadUrl: 'https://example.test/a.webp' } }
  })
}))

import { useAvatarUpload } from './useAvatarUpload'

describe('avatar upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uploadFile.mockResolvedValue(undefined)
    Object.assign(window, { $message: { error: mocks.showError } })
  })

  it('waits for the profile update before closing the cropper', async () => {
    let finishUpdate!: () => void
    const update = vi.fn(() => new Promise<void>((resolve) => (finishUpdate = resolve)))
    let upload!: ReturnType<typeof useAvatarUpload>
    const wrapper = mount(
      defineComponent({
        setup() {
          upload = useAvatarUpload({ onSuccess: update })
          return () => h('div')
        }
      })
    )
    upload.showCropper.value = true
    const operation = upload.handleCrop(new Blob(['image'], { type: 'image/webp' }))
    await nextTick()
    expect(update).toHaveBeenCalledWith('https://example.test/a.webp')
    expect(mocks.uploadFile).toHaveBeenCalledWith(
      expect.any(File),
      expect.not.objectContaining({ provider: expect.anything() })
    )
    expect(upload.showCropper.value).toBe(true)
    finishUpdate()
    await operation
    expect(upload.showCropper.value).toBe(false)
    wrapper.unmount()
  })

  it('keeps the cropper open and shows an error when saving the profile fails', async () => {
    let upload!: ReturnType<typeof useAvatarUpload>
    const wrapper = mount(
      defineComponent({
        setup() {
          upload = useAvatarUpload({
            onSuccess: async () => {
              throw new Error('save failed')
            }
          })
          return () => h('div')
        }
      })
    )
    upload.showCropper.value = true
    await upload.handleCrop(new Blob(['image'], { type: 'image/webp' }))
    expect(upload.showCropper.value).toBe(true)
    expect(mocks.showError).toHaveBeenCalledWith('上传头像失败')
    wrapper.unmount()
  })

  it('accepts 150 KB and rejects one byte over the avatar limit', async () => {
    let upload!: ReturnType<typeof useAvatarUpload>
    const wrapper = mount(
      defineComponent({
        setup() {
          upload = useAvatarUpload()
          return () => h('div')
        }
      })
    )
    await upload.handleCrop(new Blob([new Uint8Array(150 * 1024 + 1)], { type: 'image/webp' }))
    expect(mocks.uploadFile).not.toHaveBeenCalled()
    expect(mocks.showError).toHaveBeenCalledWith(expect.stringContaining('不能超过150KB'))
    await upload.handleCrop(new Blob([new Uint8Array(150 * 1024)], { type: 'image/webp' }))
    expect(mocks.uploadFile).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('releases the selected image when cropping is cancelled', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    let upload!: ReturnType<typeof useAvatarUpload>
    const wrapper = mount(
      defineComponent({
        setup() {
          upload = useAvatarUpload()
          return () => h('div')
        }
      })
    )
    upload.localImageUrl.value = 'blob:avatar'
    upload.showCropper.value = true
    await nextTick()
    upload.showCropper.value = false
    await nextTick()
    expect(revoke).toHaveBeenCalledWith('blob:avatar')
    expect(upload.localImageUrl.value).toBe('')
    wrapper.unmount()
    revoke.mockRestore()
  })
})
