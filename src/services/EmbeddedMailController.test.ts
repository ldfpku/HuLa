import { describe, expect, it, vi } from 'vitest'
import { EmbeddedMailController, type EmbeddedMailState } from './EmbeddedMailController'

const bounds = { x: 64, y: 24, width: 900, height: 600 }

function fixture() {
  const api = {
    requestSso: vi.fn(async () => 'https://mail.example.test/sso'),
    create: vi.fn(async () => {}),
    navigate: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
    setVisible: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    reportError: vi.fn()
  }
  const controller = new EmbeddedMailController(api)
  const state: EmbeddedMailState = { active: true, account: 'a', bounds, navigation: null }
  return { api, controller, state }
}

describe('embedded mail lifecycle', () => {
  it('keeps the existing view when switching workspaces and navigates explicit deep links', async () => {
    const { api, controller, state } = fixture()
    await controller.update(state)
    expect(api.requestSso).toHaveBeenCalledWith('/inbox?smj_desktop=1')
    expect(api.create).toHaveBeenCalledOnce()
    await controller.update({ ...state, active: false })
    expect(api.setVisible).toHaveBeenCalledWith(false)
    await controller.update(state)
    expect(api.create).toHaveBeenCalledOnce()
    expect(api.requestSso).toHaveBeenCalledOnce()
    await controller.update({ ...state, navigation: { id: 1, target: '/inbox/m1?smj_desktop=1' } })
    expect(api.requestSso).toHaveBeenLastCalledWith('/inbox/m1?smj_desktop=1')
    expect(api.navigate).toHaveBeenCalledOnce()
    await controller.dispose()
    expect(api.close).toHaveBeenCalledOnce()
  })

  it('does not open a stale account after an asynchronous sign-in response', async () => {
    const { api, controller, state } = fixture()
    let resolve!: (url: string) => void
    api.requestSso.mockImplementationOnce(() => new Promise((done) => (resolve = done)))
    const first = controller.update(state)
    await vi.waitFor(() => expect(api.requestSso).toHaveBeenCalledOnce())
    const second = controller.update({ ...state, account: 'b' })
    resolve('https://mail.example.test/old')
    await Promise.all([first, second])
    expect(api.create).toHaveBeenCalledOnce()
    expect(api.create).toHaveBeenCalledWith('https://mail.example.test/sso', bounds, 'b')
  })

  it('does not block a new account when the previous account sign-in fails late', async () => {
    const { api, controller, state } = fixture()
    let reject!: (error: Error) => void
    api.requestSso.mockImplementationOnce(() => new Promise((_resolve, fail) => (reject = fail)))
    const first = controller.update(state)
    await vi.waitFor(() => expect(api.requestSso).toHaveBeenCalledOnce())
    const second = controller.update({ ...state, account: 'b' })
    reject(new Error('previous sign-in failed'))
    await Promise.all([first, second])
    expect(api.reportError).toHaveBeenCalledOnce()
    expect(api.create).toHaveBeenCalledWith('https://mail.example.test/sso', bounds, 'b')
  })

  it('keeps a view created during an account switch hidden until it has been replaced', async () => {
    const { api, controller, state } = fixture()
    let finishCreate!: () => void
    api.create.mockImplementationOnce(() => new Promise((resolve) => (finishCreate = resolve)))
    const first = controller.update(state)
    await vi.waitFor(() => expect(api.create).toHaveBeenCalledOnce())
    const second = controller.update({ ...state, account: 'b' })
    finishCreate()
    await Promise.all([first, second])
    expect(api.close).toHaveBeenCalledOnce()
    expect(api.create).toHaveBeenCalledTimes(2)
    expect(api.create).toHaveBeenLastCalledWith('https://mail.example.test/sso', bounds, 'b')
    expect(api.setVisible).toHaveBeenCalledTimes(1)
    expect(api.setVisible).toHaveBeenCalledWith(true)
    expect(api.close.mock.invocationCallOrder[0]).toBeLessThan(api.create.mock.invocationCallOrder[1])
  })

  it('does not reveal a view after switching workspaces during resize', async () => {
    const { api, controller, state } = fixture()
    let finishResize!: () => void
    api.resize.mockImplementationOnce(() => new Promise((resolve) => (finishResize = resolve)))
    const first = controller.update(state)
    await vi.waitFor(() => expect(api.resize).toHaveBeenCalledOnce())
    const second = controller.update({ ...state, active: false })
    finishResize()
    await Promise.all([first, second])
    expect(api.setVisible).not.toHaveBeenCalledWith(true)
  })

  it('hides an existing view immediately while a deep-link sign-in is pending', async () => {
    const { api, controller, state } = fixture()
    await controller.update(state)
    let finishSignIn!: (url: string) => void
    api.requestSso.mockImplementationOnce(() => new Promise((resolve) => (finishSignIn = resolve)))
    const pending = controller.update({ ...state, navigation: { id: 1, target: '/inbox/m1' } })
    await vi.waitFor(() => expect(api.requestSso).toHaveBeenCalledTimes(2))
    const hidden = controller.update({ ...state, active: false, navigation: { id: 1, target: '/inbox/m1' } })
    await vi.waitFor(() => expect(api.setVisible).toHaveBeenCalledWith(false))
    finishSignIn('https://mail.example.test/sso')
    await Promise.all([pending, hidden])
    expect(api.navigate).not.toHaveBeenCalled()
  })

  it('allows reopening after an obsolete sign-in fails while the workspace is hidden', async () => {
    const { api, controller, state } = fixture()
    let reject!: (error: Error) => void
    api.requestSso.mockImplementationOnce(() => new Promise((_resolve, fail) => (reject = fail)))
    const pending = controller.update(state)
    await vi.waitFor(() => expect(api.requestSso).toHaveBeenCalledOnce())
    const hidden = controller.update({ ...state, active: false })
    reject(new Error('sign-in failed'))
    await Promise.all([pending, hidden])
    await controller.update(state)
    expect(api.create).toHaveBeenCalledOnce()
  })

  it('hides immediately on disposal even when another navigation is pending', async () => {
    const { api, controller, state } = fixture()
    await controller.update(state)
    let finishSignIn!: (url: string) => void
    api.requestSso.mockImplementationOnce(() => new Promise((resolve) => (finishSignIn = resolve)))
    const pending = controller.update({ ...state, navigation: { id: 1, target: '/inbox/m1' } })
    await vi.waitFor(() => expect(api.requestSso).toHaveBeenCalledTimes(2))
    const disposed = controller.dispose()
    await vi.waitFor(() => expect(api.setVisible).toHaveBeenCalledWith(false))
    finishSignIn('https://mail.example.test/sso')
    await Promise.all([pending, disposed])
    expect(api.navigate).not.toHaveBeenCalled()
    expect(api.close).toHaveBeenCalledOnce()
  })

  it('closes the old account immediately when hiding fails, even while work is pending', async () => {
    const { api, controller, state } = fixture()
    await controller.update(state)
    let finishResize!: () => void
    api.resize.mockImplementationOnce(() => new Promise((resolve) => (finishResize = resolve)))
    const pending = controller.update(state)
    await vi.waitFor(() => expect(api.resize).toHaveBeenCalledTimes(2))
    api.setVisible.mockRejectedValueOnce(new Error('hide failed'))
    const switching = controller.update({ ...state, account: 'b' })
    await vi.waitFor(() => expect(api.setVisible).toHaveBeenCalledWith(false))
    await vi.waitFor(() => expect(api.close).toHaveBeenCalledOnce())
    finishResize()
    await Promise.all([pending, switching])
    expect(api.close).toHaveBeenCalledOnce()
    expect(api.reportError).toHaveBeenCalledOnce()
    expect(api.create).toHaveBeenCalledOnce()
  })

  it('reports an immediate close failure and retries closing after pending work', async () => {
    const { api, controller, state } = fixture()
    await controller.update(state)
    let finishResize!: () => void
    api.resize.mockImplementationOnce(() => new Promise((resolve) => (finishResize = resolve)))
    const pending = controller.update(state)
    await vi.waitFor(() => expect(api.resize).toHaveBeenCalledTimes(2))
    api.setVisible.mockRejectedValueOnce(new Error('hide failed'))
    api.close.mockRejectedValueOnce(new Error('close failed'))
    const switching = controller.update({ ...state, account: 'b' })
    await vi.waitFor(() => expect(api.reportError).toHaveBeenCalledOnce())
    expect(api.reportError).toHaveBeenCalledWith(expect.any(AggregateError))
    finishResize()
    await Promise.all([pending, switching])
    expect(api.close).toHaveBeenCalledTimes(2)
    expect(api.create).toHaveBeenCalledOnce()
  })

  it('reports creation errors and retries only when requested', async () => {
    const { api, controller, state } = fixture()
    api.create.mockRejectedValueOnce(new Error('failed'))
    await controller.update(state)
    expect(api.reportError).toHaveBeenCalledOnce()
    await controller.update(state)
    expect(api.create).toHaveBeenCalledOnce()
    await controller.retry()
    expect(api.create).toHaveBeenCalledTimes(2)
  })
})
