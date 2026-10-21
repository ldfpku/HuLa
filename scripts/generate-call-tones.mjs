/**
 * 通话提示音（全部原创、程序合成，不采样任何现成音频）：
 *   smj-call-incoming  来电铃声（循环）：清亮的 FM 钟片音，上行 D–A–D 三连音 + 下行回应，2.4 秒一轮
 *   smj-call-ringback  拨出回铃（循环）：柔和的五度和弦两声“嘟—嘟”，3.2 秒一轮，音量比来电低
 *   smj-call-busy      对方忙线（单次）：三声同音短促提示
 *   smj-call-ended     通话结束（单次）：两音下行 D6 → A5
 *
 * 用法：node scripts/generate-call-tones.mjs   （需要本机有 ffmpeg，输出到 public/sound/）
 * 循环音频每轮结尾留足静音，MP3 编码的首尾补帧落在静音里，循环听不出接缝。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RATE = 44100
const outDir = fileURLToPath(new URL('../public/sound/', import.meta.url))

const note = { A4: 440, D5: 587.33, E5: 659.25, Fs5: 739.99, A5: 880, B5: 987.77, D6: 1174.66 }

const buffer = (seconds) => new Float64Array(Math.round(seconds * RATE))

/** FM 钟片：载波 + 2 倍频调制（调制深度快速衰减，起音清脆、尾音干净），再叠一点低八度暖音和 4 倍频亮点 */
const bell = (out, at, freq, { gain = 1, decay = 0.38, length = 1.1 } = {}) => {
  const start = Math.round(at * RATE)
  const count = Math.min(Math.round(length * RATE), out.length - start)
  for (let i = 0; i < count; i++) {
    const t = i / RATE
    const attack = Math.min(1, t / 0.004)
    // 尾部 80 ms 收到零，截断处不出咔哒声
    const release = Math.min(1, (count / RATE - t) / 0.08)
    const env = attack * release * Math.exp(-t / decay)
    const index = 1.1 * Math.exp(-t / 0.07)
    const fm = Math.sin(2 * Math.PI * freq * t + index * Math.sin(2 * Math.PI * 2 * freq * t))
    const warm = 0.18 * Math.sin(Math.PI * freq * t) * Math.exp(-t / (decay * 0.8))
    const shine = 0.06 * Math.sin(2 * Math.PI * 4 * freq * t) * Math.exp(-t / 0.04)
    out[start + i] += gain * env * (fm + warm + shine)
  }
}

/** 柔和脉冲：两个正弦叠成五度，缓起缓收，像隔着一层的“嘟” */
const pulse = (out, at, freqs, { gain = 1, length = 0.42 } = {}) => {
  const start = Math.round(at * RATE)
  const count = Math.min(Math.round(length * RATE), out.length - start)
  const rise = 0.03
  const fall = 0.12
  for (let i = 0; i < count; i++) {
    const t = i / RATE
    const env = Math.min(1, t / rise, (length - t) / fall)
    let sample = 0
    for (const f of freqs) sample += Math.sin(2 * Math.PI * f * t) + 0.12 * Math.sin(4 * Math.PI * f * t)
    out[start + i] += (gain * env * sample) / freqs.length
  }
}

/** 归一化到目标峰值（dBFS），末尾 30 ms 淡出，保证循环处为零 */
const finish = (samples, peakDb) => {
  let peak = 0
  for (const s of samples) peak = Math.max(peak, Math.abs(s))
  const scale = 10 ** (peakDb / 20) / peak
  const fade = Math.round(0.03 * RATE)
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const tail = Math.min(1, (samples.length - 1 - i) / fade)
    pcm[i] = Math.round(Math.max(-1, Math.min(1, samples[i] * scale * tail)) * 32767)
  }
  return pcm
}

const wav = (pcm) => {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length * 2, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length * 2, 40)
  return Buffer.concat([header, Buffer.from(pcm.buffer)])
}

const incoming = () => {
  const out = buffer(2.4)
  bell(out, 0.0, note.D5)
  bell(out, 0.13, note.A5, { gain: 0.9 })
  bell(out, 0.26, note.D6, { gain: 0.85, decay: 0.45 })
  bell(out, 0.78, note.B5, { gain: 0.8 })
  bell(out, 0.91, note.Fs5, { gain: 0.85, decay: 0.5, length: 1.3 })
  return finish(out, -3)
}

const ringback = () => {
  const out = buffer(3.2)
  pulse(out, 0.0, [note.A4, note.E5])
  pulse(out, 0.6, [note.A4, note.E5])
  return finish(out, -10)
}

const busy = () => {
  const out = buffer(1.2)
  for (const at of [0, 0.3, 0.6]) pulse(out, at, [note.Fs5], { length: 0.16 })
  return finish(out, -8)
}

const ended = () => {
  const out = buffer(1.0)
  bell(out, 0.0, note.D6, { gain: 0.8, decay: 0.2, length: 0.4 })
  bell(out, 0.16, note.A5, { decay: 0.3, length: 0.8 })
  return finish(out, -6)
}

const tones = { 'smj-call-incoming': incoming, 'smj-call-ringback': ringback, 'smj-call-busy': busy, 'smj-call-ended': ended }

const work = mkdtempSync(join(tmpdir(), 'smj-tones-'))
try {
  for (const [name, build] of Object.entries(tones)) {
    const source = join(work, `${name}.wav`)
    writeFileSync(source, wav(build()))
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', source, '-codec:a', 'libmp3lame', '-b:a', '128k', '-map_metadata', '-1', join(outDir, `${name}.mp3`)])
    console.log(`public/sound/${name}.mp3`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
