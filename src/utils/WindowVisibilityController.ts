export class WindowVisibilityController {
  private running = false
  private pending = false
  private disposed = false

  constructor(
    private readBackground: () => Promise<boolean>,
    private apply: (background: boolean) => Promise<void>,
    private reportError: (error: unknown) => void
  ) {}

  request(): void {
    if (this.disposed) return
    this.pending = true
    if (!this.running) void this.run()
  }

  dispose(): void {
    this.disposed = true
    this.pending = false
  }

  private async run(): Promise<void> {
    this.running = true
    try {
      while (this.pending && !this.disposed) {
        this.pending = false
        try {
          const background = await this.readBackground()
          if (this.disposed) return
          if (this.pending) continue
          await this.apply(background)
        } catch (error) {
          this.reportError(error)
        }
      }
    } finally {
      this.running = false
      if (this.pending && !this.disposed) this.request()
    }
  }
}
