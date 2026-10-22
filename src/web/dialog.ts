/**
 * 网页版的系统对话框：选文件用 <input type=file>，选中的文件放进内存文件系统并返回路径，
 * 业务代码照常按路径读取、上传；“另存为”返回一个虚拟路径，写入后由浏览器下载。
 */
import { virtualFs } from './virtualFs'

const PICK_PREFIX = 'web-pick'
export const SAVE_PREFIX = 'web-save/'

let pickCount = 0

export const openFileDialog = (options: any): Promise<string | string[] | null> =>
  new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = Boolean(options?.multiple)
    const extensions: string[] = (options?.filters ?? []).flatMap((filter: any) => filter?.extensions ?? [])
    if (extensions.length && !extensions.includes('*')) input.accept = extensions.map((ext) => `.${ext}`).join(',')
    input.style.display = 'none'
    document.body.appendChild(input)
    const finish = (value: string | string[] | null) => {
      input.remove()
      resolve(value)
    }
    input.addEventListener('cancel', () => finish(null))
    input.addEventListener('change', async () => {
      const files = Array.from(input.files ?? [])
      if (!files.length) return finish(null)
      const paths = await Promise.all(
        files.map(async (file) => {
          const path = `${PICK_PREFIX}/${++pickCount}/${file.name}`
          virtualFs.writeFile(path, new Uint8Array(await file.arrayBuffer()))
          return path
        })
      )
      finish(options?.multiple ? paths : paths[0])
    })
    input.click()
  })

export const saveFileDialog = (options: any) => {
  const name = String(options?.defaultPath ?? 'download')
    .split(/[\\/]/)
    .pop()
  return `${SAVE_PREFIX}${Date.now()}/${name}`
}

/** 把内存里的文件交给浏览器下载 */
export const downloadFile = (path: string) => {
  const blob = virtualFs.blob(path)
  if (!blob) return
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = path.split('/').pop() || 'download'
  link.click()
  setTimeout(() => {
    URL.revokeObjectURL(link.href)
    virtualFs.remove(path)
  }, 60_000)
}

/** 写完“另存为”的文件后交给浏览器下载 */
export const downloadIfSaved = (path: string) => {
  if (path.startsWith(SAVE_PREFIX)) downloadFile(path)
}

/** message / ask / confirm：用浏览器自带的提示框 */
export const messageDialog = (args: any) => {
  const text = [args?.title, args?.message].filter(Boolean).join('\n\n')
  const buttons = args?.buttons
  if (buttons === 'YesNo') return window.confirm(text) ? 'Yes' : 'No'
  if (buttons === 'OkCancel') return window.confirm(text) ? 'Ok' : 'Cancel'
  if (buttons?.OkCancelCustom) return window.confirm(text) ? buttons.OkCancelCustom[0] : buttons.OkCancelCustom[1]
  if (buttons?.YesNoCancelCustom)
    return window.confirm(text) ? buttons.YesNoCancelCustom[0] : buttons.YesNoCancelCustom[2]
  window.alert(text)
  return buttons?.OkCustom ?? 'Ok'
}
