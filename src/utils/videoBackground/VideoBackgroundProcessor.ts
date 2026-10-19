import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'

/**
 * 视频背景板：在本机把摄像头画面里的人像分割出来，背景换成模糊或图片，输出一条新的视频轨道。
 *
 * 人像分割用 MediaPipe 的 selfie_segmenter_landscape 模型（256x144），wasm 和模型都随包放在
 * `video-bg/` 下（wasm 由 vite.config.ts 的 smj-video-bg 插件从 node_modules 拷出），不访问任何外部地址。
 * 帧循环用 Worker 里的定时器驱动，窗口切到后台时也不会被浏览器节流，对方看到的画面不会卡住。
 *
 * mailflare 的会议页（src/lib/meetings/video-background/processor.ts）有一份同样的实现，改动时两边保持一致。
 */

export type BackgroundEffect = { type: 'none' } | { type: 'blur' } | { type: 'image'; src: string }

export type ProcessorOptions = {
  /** 随包资源目录，以 / 结尾 */
  assetsBase: string
  /** 画到调用方给的画布上（会议页的视频中间件），不给时自己建画布并输出轨道 */
  canvas?: HTMLCanvasElement
  /** 设备较慢，已自动降低处理帧率 */
  onDegrade?: () => void
  /** 降档后仍跟不上，调用方应关掉背景 */
  onOverload?: () => void
}

const SEG_WIDTH = 256
const SEG_HEIGHT = 144
const TARGET_FPS = 30
const LOW_FPS = 15
const OVERLOAD_MS = 3000

let segmenterPromise: Promise<ImageSegmenter> | null = null

const loadSegmenter = (assetsBase: string) => {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const fileset = {
        wasmLoaderPath: `${assetsBase}wasm/vision_wasm_internal.js`,
        wasmBinaryPath: `${assetsBase}wasm/vision_wasm_internal.wasm`
      }
      // 模型很小（256x144），CPU（XNNPACK）一帧十几毫秒以内且各机器表现稳定；GPU 模式要把蒙版从显卡读回来，
      // 在集成显卡和软件渲染上反而更慢，初始化也多花一两秒
      return await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${assetsBase}selfie_segmenter_landscape.tflite`, delegate: 'CPU' },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false
      })
    })().catch((e) => {
      segmenterPromise = null
      throw e
    })
  }
  return segmenterPromise
}

/** 提前下载模型（点开背景面板时调用），返回是否加载成功 */
export const preloadSegmenter = (assetsBase: string) =>
  loadSegmenter(assetsBase).then(
    () => true,
    () => false
  )

type Ticker = { schedule: (ms: number, fn: () => void) => void; stop: () => void }

const createTicker = (): Ticker => {
  try {
    const url = URL.createObjectURL(
      new Blob(['onmessage=(e)=>setTimeout(()=>postMessage(0),e.data)'], { type: 'text/javascript' })
    )
    const worker = new Worker(url)
    URL.revokeObjectURL(url)
    let callback: (() => void) | undefined
    worker.onmessage = () => callback?.()
    return {
      schedule: (ms, fn) => {
        callback = fn
        worker.postMessage(ms)
      },
      stop: () => {
        callback = undefined
        worker.terminate()
      }
    }
  } catch {
    let timer: ReturnType<typeof setTimeout> | undefined
    return {
      schedule: (ms, fn) => {
        timer = setTimeout(fn, ms)
      },
      stop: () => clearTimeout(timer)
    }
  }
}

const canvasFilterSupported = () =>
  typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype

const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`背景图加载失败: ${src.slice(0, 64)}`))
    image.src = src
  })

/** 0..1 之间平滑地把置信度拉开，边缘更干净 */
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export class VideoBackgroundProcessor {
  private readonly options: ProcessorOptions
  private readonly video = document.createElement('video')
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly segCanvas = createCanvas(SEG_WIDTH, SEG_HEIGHT)
  private readonly segCtx = this.segCanvas.getContext('2d')!
  private readonly maskCanvas = createCanvas(SEG_WIDTH, SEG_HEIGHT)
  private readonly maskCtx = this.maskCanvas.getContext('2d')!
  private readonly maskData = new ImageData(SEG_WIDTH, SEG_HEIGHT)
  private readonly featherCanvas = createCanvas(SEG_WIDTH, SEG_HEIGHT)
  private readonly featherCtx = this.featherCanvas.getContext('2d')!
  private readonly smoothedMask = new Float32Array(SEG_WIDTH * SEG_HEIGHT)
  private readonly blurCanvas = createCanvas(320, 180)
  private readonly blurCtx = this.blurCanvas.getContext('2d')!
  private readonly filterSupported = canvasFilterSupported()
  private segmenter: ImageSegmenter | null = null
  private ticker: Ticker | null = null
  private effect: BackgroundEffect = { type: 'none' }
  private backgroundImage: HTMLImageElement | null = null
  private output: MediaStreamTrack | null = null
  private running = false
  private hasMask = false
  private frameIndex = 0
  private frameInterval = 1000 / TARGET_FPS
  private segmentEvery = 1
  private costAverage = 0
  private overloadSince = 0
  private degraded = false
  private overloaded = false

  constructor(options: ProcessorOptions) {
    this.options = options
    this.canvas = options.canvas ?? createCanvas(1280, 720)
    this.ctx = this.canvas.getContext('2d')!
    this.video.muted = true
    this.video.playsInline = true
  }

  /** 浏览器能否做背景处理：需要 WebAssembly SIMD、canvas 采集和 Worker */
  static isSupported() {
    return (
      typeof WebAssembly === 'object' &&
      typeof Worker !== 'undefined' &&
      typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function'
    )
  }

  /** SIMD 检测是异步的，打开面板时调用一次 */
  static async checkSupport() {
    if (!VideoBackgroundProcessor.isSupported()) return false
    try {
      return await FilesetResolver.isSimdSupported()
    } catch {
      return false
    }
  }

  get currentEffect() {
    return this.effect
  }

  /** 设置效果；图片在这里预先解码，失败时抛错且效果不变 */
  async setEffect(effect: BackgroundEffect) {
    if (effect.type === 'image') {
      this.backgroundImage = await loadImage(effect.src)
    } else {
      this.backgroundImage = null
    }
    this.effect = effect
  }

  /** 开始处理，返回替换后的视频轨道（画到调用方画布上时为 null） */
  async start(source: MediaStreamTrack) {
    this.segmenter = await loadSegmenter(this.options.assetsBase)
    await this.setSource(source)
    if (!this.options.canvas) {
      const stream = this.canvas.captureStream(TARGET_FPS)
      this.output = stream.getVideoTracks()[0]
      this.output.contentHint = 'motion'
    }
    this.running = true
    this.ticker = createTicker()
    this.tick()
    return this.output
  }

  /** 换摄像头时只换输入，输出轨道不变，对方无需重新协商 */
  async setSource(source: MediaStreamTrack) {
    this.video.srcObject = new MediaStream([source])
    this.hasMask = false
    try {
      await this.video.play()
    } catch (e) {
      console.warn('背景处理的视频源播放失败:', e)
    }
  }

  stop() {
    this.running = false
    this.ticker?.stop()
    this.ticker = null
    this.output?.stop()
    this.output = null
    this.video.pause()
    this.video.srcObject = null
  }

  private tick = () => {
    if (!this.running) return
    const start = performance.now()
    try {
      this.render()
    } catch (e) {
      console.warn('背景处理出错:', e)
    }
    const cost = performance.now() - start
    this.adapt(cost)
    this.ticker?.schedule(Math.max(0, this.frameInterval - cost), this.tick)
  }

  private render() {
    const video = this.video
    if (video.readyState < 2 || !video.videoWidth) return
    const width = video.videoWidth
    const height = video.videoHeight
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    const ctx = this.ctx
    if (this.effect.type === 'none' || !this.segmenter) {
      ctx.drawImage(video, 0, 0, width, height)
      return
    }
    if (this.frameIndex++ % this.segmentEvery === 0 || !this.hasMask) this.segment()

    ctx.save()
    // 1. 人像蒙版：在小图上羽化，放大时的插值再柔化一次边缘，比在原尺寸上模糊省得多
    ctx.globalCompositeOperation = 'copy'
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'medium'
    ctx.drawImage(this.featherCanvas, 0, 0, width, height)
    // 2. 只留下人像
    ctx.globalCompositeOperation = 'source-in'
    ctx.drawImage(video, 0, 0, width, height)
    // 3. 背景垫在后面
    ctx.globalCompositeOperation = 'destination-over'
    this.drawBackground(width, height)
    ctx.restore()
  }

  private segment() {
    const segmenter = this.segmenter!
    this.segCtx.drawImage(this.video, 0, 0, SEG_WIDTH, SEG_HEIGHT)
    const result = segmenter.segmentForVideo(this.segCanvas, performance.now())
    try {
      const mask = result.confidenceMasks?.[0]
      if (!mask) return
      const confidence = mask.getAsFloat32Array()
      const pixels = this.maskData.data
      const smoothed = this.smoothedMask
      // 和上一帧做加权平均，减轻边缘闪烁
      const keep = this.hasMask ? 0.35 : 0
      for (let i = 0; i < confidence.length; i++) {
        const value = smoothed[i] * keep + confidence[i] * (1 - keep)
        smoothed[i] = value
        pixels[i * 4 + 3] = smoothstep(0.4, 0.8, value) * 255
      }
      this.maskCtx.putImageData(this.maskData, 0, 0)
      const feather = this.featherCtx
      feather.globalCompositeOperation = 'copy'
      if (this.filterSupported) feather.filter = 'blur(1px)'
      feather.drawImage(this.maskCanvas, 0, 0)
      if (this.filterSupported) feather.filter = 'none'
      this.hasMask = true
    } finally {
      result.close()
    }
  }

  private drawBackground(width: number, height: number) {
    const ctx = this.ctx
    if (this.effect.type === 'image' && this.backgroundImage) {
      const image = this.backgroundImage
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
      const drawWidth = image.naturalWidth * scale
      const drawHeight = image.naturalHeight * scale
      ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
      return
    }
    // 模糊：缩小后模糊再放大，比原尺寸模糊省得多；不支持 ctx.filter 的浏览器缩得更小，靠放大插值变柔
    const blurWidth = this.filterSupported ? Math.round(width / 4) : Math.round(width / 24)
    const blurHeight = this.filterSupported ? Math.round(height / 4) : Math.round(height / 24)
    if (this.blurCanvas.width !== blurWidth || this.blurCanvas.height !== blurHeight) {
      this.blurCanvas.width = blurWidth
      this.blurCanvas.height = blurHeight
    }
    const blurCtx = this.blurCtx
    if (this.filterSupported) {
      const radius = Math.max(4, Math.round(blurWidth / 50))
      blurCtx.filter = `blur(${radius}px)`
      // 画得比画布大一圈，避免模糊把边缘的透明像素带进来形成暗边
      blurCtx.drawImage(this.video, -radius * 2, -radius * 2, blurWidth + radius * 4, blurHeight + radius * 4)
      blurCtx.filter = 'none'
    } else {
      blurCtx.drawImage(this.video, 0, 0, blurWidth, blurHeight)
    }
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(this.blurCanvas, 0, 0, width, height)
  }

  /** 处理一帧的耗时超过预算时先隔帧分割，再降到 15 帧，还不行就通知调用方关掉 */
  private adapt(cost: number) {
    if (this.effect.type === 'none') return
    this.costAverage = this.costAverage ? this.costAverage * 0.9 + cost * 0.1 : cost
    if (this.frameIndex < 15) return
    const budget = this.frameInterval * 0.8
    if (this.costAverage <= budget) {
      this.overloadSince = 0
      return
    }
    if (this.segmentEvery === 1) {
      this.segmentEvery = 2
      this.costAverage = 0
      this.notifyDegrade()
      return
    }
    if (this.frameInterval < 1000 / LOW_FPS) {
      this.frameInterval = 1000 / LOW_FPS
      this.costAverage = 0
      this.notifyDegrade()
      return
    }
    const now = performance.now()
    if (!this.overloadSince) this.overloadSince = now
    if (now - this.overloadSince > OVERLOAD_MS && !this.overloaded) {
      this.overloaded = true
      this.options.onOverload?.()
    }
  }

  private notifyDegrade() {
    if (this.degraded) return
    this.degraded = true
    this.options.onDegrade?.()
  }
}
