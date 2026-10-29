import type { MailNavigation } from '@/stores/workspace'
import { desktopMailTarget } from '@/utils/DesktopMail'

export type MailViewBounds = { x: number; y: number; width: number; height: number }
export type EmbeddedMailState = {
  active: boolean
  account: string
  bounds: MailViewBounds | null
  navigation: MailNavigation | null
}

type EmbeddedMailApi = {
  requestSso: (target: string) => Promise<string>
  create: (url: string, bounds: MailViewBounds, account: string) => Promise<void>
  navigate: (url: string, account: string) => Promise<void>
  resize: (bounds: MailViewBounds) => Promise<void>
  setVisible: (visible: boolean) => Promise<void>
  close: () => Promise<void>
  reportError: (error: unknown) => void
}

export class EmbeddedMailController {
  private desired: EmbeddedMailState = { active: false, account: '', bounds: null, navigation: null }
  private queue: Promise<void> = Promise.resolve()
  private viewAccount = ''
  private created = false
  private visible = false
  private appliedNavigation = 0
  private failed = false
  private disposed = false

  constructor(private readonly api: EmbeddedMailApi) {}

  update(state: EmbeddedMailState): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (state.account !== this.desired.account || state.navigation?.id !== this.desired.navigation?.id) {
      this.failed = false
    }
    if ((!state.active || state.account !== this.desired.account) && this.created && this.visible) {
      const hide = this.api.setVisible(false).then(
        () => {
          this.visible = false
          return { ok: true as const }
        },
        async (error: unknown) => {
          let failure = error
          try {
            await this.api.close()
            this.created = false
            this.visible = false
            this.viewAccount = ''
            this.appliedNavigation = 0
          } catch (closeError: unknown) {
            failure = new AggregateError([error, closeError], '关闭邮件工作区失败')
          }
          this.failed = true
          this.api.reportError(failure)
          return { ok: false as const }
        }
      )
      this.queue = this.queue.then(async () => {
        const result = await hide
        if (!result.ok) this.failed = true
      })
    }
    this.desired = state
    return this.enqueue()
  }

  retry(): Promise<void> {
    this.failed = false
    return this.enqueue()
  }

  dispose(): Promise<void> {
    if (this.disposed) return this.queue
    void this.update({ ...this.desired, active: false })
    this.disposed = true
    return this.enqueue()
  }

  private enqueue(): Promise<void> {
    this.queue = this.queue.then(async () => {
      const account = this.desired.account
      const navigationId = this.desired.navigation?.id ?? 0
      try {
        await this.reconcile()
      } catch (error: unknown) {
        if (this.isCurrent(account, navigationId)) {
          this.failed = true
        }
        this.api.reportError(error)
      }
    })
    return this.queue
  }

  private isCurrent(account: string, navigationId: number): boolean {
    return (
      !this.disposed &&
      this.desired.active &&
      this.desired.account === account &&
      (this.desired.navigation?.id ?? 0) === navigationId
    )
  }

  private async reconcile(): Promise<void> {
    if (this.created && (this.disposed || this.viewAccount !== this.desired.account)) {
      await this.api.close()
      this.created = false
      this.visible = false
      this.viewAccount = ''
      this.appliedNavigation = 0
    }
    if (this.disposed) return
    if (!this.desired.active || !this.desired.account) {
      if (this.created && this.visible) {
        await this.api.setVisible(false)
        this.visible = false
      }
      return
    }
    if (this.failed || !this.desired.bounds || this.desired.bounds.width <= 0 || this.desired.bounds.height <= 0) return

    const account = this.desired.account
    const navigationId = this.desired.navigation?.id ?? 0
    if (!this.created || navigationId !== this.appliedNavigation) {
      const target = this.desired.navigation?.target ?? desktopMailTarget()
      const url = await this.api.requestSso(target)
      if (!this.isCurrent(account, navigationId) || !this.desired.bounds) return
      if (this.created) {
        await this.api.navigate(url, account)
      } else {
        await this.api.create(url, this.desired.bounds, account)
        this.created = true
        this.visible = false
        this.viewAccount = account
      }
      this.appliedNavigation = navigationId
    }
    if (!this.isCurrent(account, navigationId) || !this.desired.bounds) return
    await this.api.resize(this.desired.bounds)
    if (!this.isCurrent(account, navigationId)) return
    if (!this.visible) {
      await this.api.setVisible(true)
      this.visible = true
      if (!this.isCurrent(account, navigationId)) {
        await this.api.setVisible(false)
        this.visible = false
      }
    }
  }
}
