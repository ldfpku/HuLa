/**
 * 网页版的内存文件系统：桌面版先把要发送的文件写进本机临时目录，再让 Rust 按路径上传。
 * 网页里没有本机目录，这里把写入的内容留在内存里，供 stat / read / 上传 / 预览使用，删除时释放。
 */

type Entry = { chunks: Uint8Array[]; blob?: Blob; url?: string; mtime: number }

const files = new Map<string, Entry>()
/** 业务代码会把临时目录（替身返回 /web）拼到文件名前，这里统一去掉，按文件名存取 */
const key = (path: string) =>
  String(path ?? '')
    .replace(/^asset:\/\/(localhost\/)?/, '')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/web\//, '')
const handles = new Map<number, string>()
let nextRid = 1

// 一律复制一份：调用方之后可能把原 ArrayBuffer 交给 decodeAudioData 等，原缓冲会被转移变成 0 字节
const toBytes = (data: unknown): Uint8Array => {
  if (data instanceof Uint8Array) return data.slice()
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0))
  if (Array.isArray(data)) return Uint8Array.from(data)
  if (typeof data === 'string') return new TextEncoder().encode(data)
  return new Uint8Array()
}

const blobOf = (entry: Entry) => {
  if (!entry.blob) entry.blob = new Blob(entry.chunks as BlobPart[])
  return entry.blob
}

export const virtualFs = {
  has: (path: string) => files.has(key(path)),

  writeFile(path: string, data: unknown) {
    this.remove(path)
    files.set(key(path), { chunks: [toBytes(data)], mtime: Date.now() })
  },

  open(path: string, options?: { append?: boolean; truncate?: boolean; create?: boolean }) {
    if (!files.has(key(path)) || (!options?.append && options?.create)) {
      this.remove(path)
      files.set(key(path), { chunks: [], mtime: Date.now() })
    }
    const rid = nextRid++
    handles.set(rid, key(path))
    return rid
  },

  write(rid: number, data: unknown) {
    const entry = files.get(handles.get(rid) ?? '')
    if (!entry) throw new Error('文件未打开')
    const bytes = toBytes(data)
    entry.chunks.push(bytes)
    entry.blob = undefined
    return bytes.byteLength
  },

  close(rid: number) {
    const path = handles.get(rid)
    handles.delete(rid)
    return path
  },

  copy(from: string, to: string) {
    const entry = files.get(key(from))
    if (!entry) throw new Error(`文件不存在: ${from}`)
    this.remove(to)
    files.set(key(to), { chunks: [...entry.chunks], mtime: Date.now() })
  },

  stat(path: string) {
    const entry = files.get(key(path))
    if (!entry) throw new Error(`文件不存在: ${path}`)
    return {
      isFile: true,
      isDirectory: false,
      isSymlink: false,
      size: blobOf(entry).size,
      mtime: entry.mtime,
      atime: entry.mtime,
      birthtime: entry.mtime,
      readonly: false
    }
  },

  async read(path: string) {
    const entry = files.get(key(path))
    if (!entry) throw new Error(`文件不存在: ${path}`)
    return new Uint8Array(await blobOf(entry).arrayBuffer())
  },

  blob(path: string) {
    const entry = files.get(key(path))
    return entry ? blobOf(entry) : null
  },

  /** 给 <img>/<video> 预览用的地址 */
  objectUrl(path: string) {
    const entry = files.get(key(path))
    if (!entry) return null
    entry.url ??= URL.createObjectURL(blobOf(entry))
    return entry.url
  },

  remove(path: string) {
    const entry = files.get(key(path))
    if (entry?.url) URL.revokeObjectURL(entry.url)
    files.delete(key(path))
  }
}

/** 超过这个大小的文件分片上传：Cloudflare 单个请求最多 100 MB，服务端分片为 32 MB */
const MULTIPART_THRESHOLD = 32 * 1024 * 1024

type Progress = (loaded: number) => void

/** 发一个请求，上传进度按已发送字节回报，返回响应文本 */
const xhrSend = (
  method: string,
  url: string,
  body: Blob | string | null,
  headers: Record<string, string>,
  onProgress?: Progress
) =>
  new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value)
    if (onProgress) xhr.upload.onprogress = (event) => onProgress(event.loaded)
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.responseText) : reject(`上传失败: HTTP ${xhr.status}`)
    xhr.onerror = () => reject('上传失败: 网络错误')
    xhr.send(body)
  })

/**
 * 聊天文件的分片上传（服务端 files.ts）：先 POST ?uploads&size 开始，逐片 PUT，再 POST 分片清单完成。
 * 服务端不支持分片时返回 false，调用方退回整个文件 PUT
 */
const uploadInParts = async (url: string, blob: Blob, report: (loaded: number) => void): Promise<boolean> => {
  const started = await xhrSend('POST', `${url}&uploads&size=${blob.size}`, null, {})
    .then((text) => JSON.parse(text) as { uploadId?: string; partSize?: number; parts?: number })
    .catch(() => null)
  if (!started?.uploadId || !started.partSize || !started.parts) return false
  const parts: { partNumber: number; etag: string }[] = []
  try {
    for (let partNumber = 1; partNumber <= started.parts; partNumber++) {
      const offset = (partNumber - 1) * started.partSize
      const chunk = blob.slice(offset, offset + started.partSize)
      const partUrl = `${url}&uploadId=${encodeURIComponent(started.uploadId)}&partNumber=${partNumber}`
      // 单片失败重试两次，网络抖一下不至于整个文件重传
      let text = ''
      for (let attempt = 0; ; attempt++) {
        try {
          text = await xhrSend('PUT', partUrl, chunk, {}, (loaded) => report(offset + loaded))
          break
        } catch (error) {
          if (attempt >= 2) throw error
        }
      }
      parts.push({ partNumber, etag: (JSON.parse(text) as { etag: string }).etag })
    }
    await xhrSend('POST', `${url}&uploadId=${encodeURIComponent(started.uploadId)}`, JSON.stringify({ parts }), {
      'Content-Type': 'application/json'
    })
  } catch (error) {
    void xhrSend('DELETE', `${url}&uploadId=${encodeURIComponent(started.uploadId)}`, null, {}).catch(() => undefined)
    throw error
  }
  return true
}

/**
 * 按路径把内存里的文件上传到上传地址，进度通过 Tauri Channel 回报，与 Rust 的 upload_file_put 一致；
 * 大文件分片上传
 */
export const uploadFilePut = async (args: any) => {
  const blob = virtualFs.blob(args?.path)
  if (!blob) throw `文件不存在: ${args?.path}`
  const report = (loaded: number) => args?.onProgress?.onmessage?.({ progressTotal: loaded, total: blob.size })
  if (blob.size > MULTIPART_THRESHOLD && (await uploadInParts(args.url, blob, report))) return
  await xhrSend('PUT', args.url, blob, args?.headers ?? {}, report)
}
