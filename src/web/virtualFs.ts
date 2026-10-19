/**
 * 网页版的内存文件系统：桌面版先把要发送的文件写进本机临时目录，再让 Rust 按路径上传。
 * 网页里没有本机目录，这里把写入的内容留在内存里，供 stat / read / 上传 / 预览使用，删除时释放。
 */

type Entry = { chunks: Uint8Array[]; blob?: Blob; url?: string; mtime: number }

const files = new Map<string, Entry>()
/** 业务代码会把临时目录（替身返回 /web）拼到文件名前，这里统一去掉，按文件名存取 */
const key = (path: string) => String(path ?? '').replace(/^\/web\//, '')
const handles = new Map<number, string>()
let nextRid = 1

const toBytes = (data: unknown): Uint8Array => {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
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

/** 按路径把内存里的文件 PUT 到上传地址，进度通过 Tauri Channel 回报，与 Rust 的 upload_file_put 一致 */
export const uploadFilePut = (args: any) =>
  new Promise<void>((resolve, reject) => {
    const blob = virtualFs.blob(args?.path)
    if (!blob) {
      reject(`文件不存在: ${args?.path}`)
      return
    }
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', args.url)
    for (const [key, value] of Object.entries<string>(args?.headers ?? {})) xhr.setRequestHeader(key, value)
    xhr.upload.onprogress = (event) => {
      args?.onProgress?.onmessage?.({ progressTotal: event.loaded, total: event.total || blob.size })
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(`上传失败: HTTP ${xhr.status}`))
    xhr.onerror = () => reject('上传失败: 网络错误')
    xhr.send(blob)
  })
