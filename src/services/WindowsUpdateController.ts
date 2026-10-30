import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater'

export type WindowsUpdateStage = 'checking' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'none' | 'error'

export interface WindowsUpdateState {
  stage: WindowsUpdateStage
  version: string
  percentage: number | null
  error: 'download' | 'install' | null
}

type UpdateResource = Pick<Update, 'version' | 'download' | 'install' | 'close'>

export class WindowsUpdateController {
  private update: UpdateResource | null = null
  private running = false
  private total: number | null = null
  private downloaded = 0
  state: WindowsUpdateState = { stage: 'checking', version: '', percentage: null, error: null }

  constructor(
    private readonly check: () => Promise<UpdateResource | null>,
    private readonly onChange: (state: WindowsUpdateState) => void
  ) {}

  private setState(change: Partial<WindowsUpdateState>) {
    this.state = { ...this.state, ...change }
    this.onChange(this.state)
  }

  private onDownload = (event: DownloadEvent) => {
    if (event.event === 'Started') {
      const length = event.data.contentLength
      this.total = typeof length === 'number' && Number.isFinite(length) && length > 0 ? length : null
      this.downloaded = 0
      this.setState({ stage: 'downloading', percentage: this.total === null ? null : 0 })
    } else if (event.event === 'Progress') {
      if (Number.isFinite(event.data.chunkLength) && event.data.chunkLength > 0) {
        this.downloaded += event.data.chunkLength
      }
      this.setState({
        stage: 'downloading',
        percentage: this.total === null ? null : Math.min(100, Math.floor((this.downloaded / this.total) * 100))
      })
    } else {
      this.setState({ stage: 'verifying', percentage: null })
    }
  }

  async start() {
    if (this.running || this.state.stage === 'ready' || this.state.stage === 'installing') return
    this.running = true
    this.total = null
    this.downloaded = 0
    this.setState({ stage: 'checking', version: '', percentage: null, error: null })
    try {
      if (this.update) {
        await this.update.close()
        this.update = null
      }
      this.update = await this.check()
      if (!this.update) {
        this.setState({ stage: 'none' })
        return
      }
      this.setState({ stage: 'downloading', version: this.update.version })
      await this.update.download(this.onDownload)
      this.setState({ stage: 'ready', percentage: null })
    } catch (error) {
      console.error('[update] 检查或下载更新失败:', error)
      this.setState({ stage: 'error', percentage: null, error: 'download' })
    } finally {
      this.running = false
    }
  }

  async install() {
    if (!this.update || this.running || this.state.stage !== 'ready') return
    this.running = true
    this.setState({ stage: 'installing', error: null })
    try {
      await this.update.install()
      throw new Error('Windows installer returned without exiting the application')
    } catch (error) {
      console.error('[update] 启动安装程序失败:', error)
      this.setState({ stage: 'ready', error: 'install' })
      throw error
    } finally {
      this.running = false
    }
  }
}
