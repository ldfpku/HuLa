/**
 * 网页版录音：代替 tauri-plugin-mic-recorder 的 start_recording / stop_recording。
 * 用浏览器的 MediaRecorder 录麦克风，停止时把录音放进内存文件系统并返回路径，
 * 业务代码照常 readFile、解码、压缩成 MP3 后上传。
 */
import { virtualFs } from './virtualFs'

let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let count = 0

const extensionOf = (mimeType: string) => (mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm')

export const startRecording = async () => {
  if (recorder) await stopRecording()
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持录音')
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  chunks = []
  recorder = new MediaRecorder(stream)
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  recorder.start()
  return null
}

export const stopRecording = async (): Promise<string | null> => {
  const current = recorder
  recorder = null
  if (!current) return null
  const stopped = new Promise<void>((resolve) => current.addEventListener('stop', () => resolve(), { once: true }))
  if (current.state !== 'inactive') current.stop()
  await stopped
  current.stream.getTracks().forEach((track) => track.stop())
  const blob = new Blob(chunks, { type: current.mimeType })
  chunks = []
  if (!blob.size) return null
  const path = `web-record/${++count}.${extensionOf(current.mimeType)}`
  virtualFs.writeFile(path, new Uint8Array(await blob.arrayBuffer()))
  return path
}
