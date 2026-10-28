import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CallTypeEnum } from '@/enums'

const mocks = vi.hoisted(() => ({
  ensureNativeAccess: vi.fn(),
  isPermissionDenied: vi.fn(),
  showPermissionDeniedDialog: vi.fn(),
  showError: vi.fn()
}))

vi.mock('@/services/i18n', () => ({ useI18nGlobal: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useDevicePermission', () => ({
  useDevicePermission: () => ({
    ensureNativeAccess: mocks.ensureNativeAccess,
    isPermissionDenied: mocks.isPermissionDenied,
    showPermissionDeniedDialog: mocks.showPermissionDeniedDialog
  })
}))

import { preflightMedia } from './useMediaPreflight'

describe('media preflight', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.ensureNativeAccess.mockResolvedValue(undefined)
    Object.assign(window, { $message: { error: mocks.showError } })
  })

  it('checks both devices for video and releases the probe tracks', async () => {
    const stop = vi.fn()
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] })
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    expect(await preflightMedia(CallTypeEnum.VIDEO)).toBe(true)
    expect(getUserMedia).toHaveBeenNthCalledWith(1, { audio: true, video: false })
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: false, video: true })
    expect(stop).toHaveBeenCalledTimes(2)
  })

  it('blocks a missing microphone before probing the camera', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error('device missing'))
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    expect(await preflightMedia(CallTypeEnum.VIDEO)).toBe(false)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(mocks.showError).toHaveBeenCalledWith('message.permission.mic.unavailable')
  })

  it('shows the native permission guide and does not request media', async () => {
    const getUserMedia = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    mocks.ensureNativeAccess.mockResolvedValue({ kind: 'camera', status: 'denied' })
    expect(await preflightMedia(CallTypeEnum.VIDEO)).toBe(false)
    expect(mocks.showPermissionDeniedDialog).toHaveBeenCalledWith('camera', { nativeStatus: 'denied' })
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('explains when the microphone is busy', async () => {
    const error = new Error('device busy')
    error.name = 'NotReadableError'
    const getUserMedia = vi.fn().mockRejectedValue(error)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    expect(await preflightMedia(CallTypeEnum.AUDIO)).toBe(false)
    expect(mocks.showError).toHaveBeenCalledWith('message.permission.mic.busy')
  })

  it('explains when media capture is unsupported', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    expect(await preflightMedia(CallTypeEnum.AUDIO)).toBe(false)
    expect(mocks.showError).toHaveBeenCalledWith('message.permission.device_unsupported')
  })

  it('checks only the microphone for audio calls', async () => {
    const stop = vi.fn()
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] })
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    expect(await preflightMedia(CallTypeEnum.AUDIO)).toBe(true)
    expect(mocks.ensureNativeAccess).toHaveBeenCalledWith(['microphone'])
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false })
    expect(stop).toHaveBeenCalledOnce()
  })

  it('shows the permission guide when camera access is denied after a successful microphone probe', async () => {
    const stop = vi.fn()
    const denied = new DOMException('Permission denied', 'NotAllowedError')
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce({ getTracks: () => [{ stop }] })
      .mockRejectedValueOnce(denied)
    mocks.isPermissionDenied.mockImplementation((error) => error === denied)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    expect(await preflightMedia(CallTypeEnum.VIDEO)).toBe(false)
    expect(stop).toHaveBeenCalledOnce()
    expect(mocks.showPermissionDeniedDialog).toHaveBeenCalledWith('camera')
    expect(mocks.showError).not.toHaveBeenCalled()
  })

  it('explains when the camera is busy after releasing the microphone probe', async () => {
    const stop = vi.fn()
    const busy = new DOMException('Device busy', 'NotReadableError')
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce({ getTracks: () => [{ stop }] })
      .mockRejectedValueOnce(busy)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    expect(await preflightMedia(CallTypeEnum.VIDEO)).toBe(false)
    expect(stop).toHaveBeenCalledOnce()
    expect(mocks.showError).toHaveBeenCalledWith('message.permission.camera.busy')
  })
})
