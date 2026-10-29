export const yieldBeforeFileUpload = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export const createUploadProgressUpdater = (apply: (value: number) => void) => {
  let frame: number | undefined
  let active = true
  let latest = 0

  return {
    update(value: number) {
      if (!active) return
      latest = value
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        if (active) apply(latest)
      })
    },
    stop() {
      active = false
      if (frame !== undefined) {
        cancelAnimationFrame(frame)
        frame = undefined
      }
    }
  }
}
