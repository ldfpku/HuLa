// 生成桌面版发布清单 latest.json，并把要上传到 R2 的文件按上传顺序列出来。
// 用法：node desktop-manifest.mjs <构建产物目录> <输出目录>
// 产物目录是各平台 actions/upload-artifact 的下载结果（desktop-windows/、desktop-macos/）。
// 邮箱站点的 /api/desktop/update 与下载页读这份清单（mailflare src/lib/desktop/）。
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [artifactsDir, outDir] = process.argv.slice(2)
if (!artifactsDir || !outDir) {
  console.error('用法：node desktop-manifest.mjs <构建产物目录> <输出目录>')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const version = pkg.version
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`package.json 的版本号不是 x.y.z：${version}`)

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  )
const files = walk(artifactsDir)
const find = (test, label, optional = false) => {
  const hit = files.filter((file) => test(file.replaceAll('\\', '/')))
  if (optional && hit.length === 0) return null
  if (hit.length !== 1) throw new Error(`应当正好有一个${label}，实际 ${hit.length} 个：${hit.join(', ')}`)
  return hit[0]
}

const windowsSetup = find((f) => /\/nsis\/[^/]+-setup\.exe$/.test(f), ' Windows 安装包（nsis/*-setup.exe）')
const macDmg = find((f) => /\/dmg\/[^/]+\.dmg$/.test(f), ' macOS 磁盘映像（dmg/*.dmg）')
const macUpdate = find((f) => /\/macos\/[^/]+\.app\.tar\.gz$/.test(f), ' macOS 更新包（macos/*.app.tar.gz）')
const signature = (file) => readFileSync(`${file}.sig`, 'utf8').trim()

// R2 里的对象名：releases/<版本>/<文件名>；清单里只写 <版本>/<文件名>，下载地址由邮箱站点拼
const names = {
  windowsSetup: `SMJ_${version}_x64-setup.exe`,
  macDmg: `SMJ_${version}_universal.dmg`,
  macUpdate: `SMJ_${version}_universal.app.tar.gz`
}
const rel = (name) => `${version}/${name}`

const notes = (process.env.RELEASE_NOTES ?? '')
  .split(/[;；\n]/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => `- ${line}`)
  .join('\n')

const macPlatform = { file: rel(names.macUpdate), signature: signature(macUpdate) }
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  // 自动更新：键是 Tauri 的 {{target}}-{{arch}}；通用包同时服务 Apple 芯片和 Intel
  platforms: {
    'windows-x86_64': { file: rel(names.windowsSetup), signature: signature(windowsSetup) },
    'darwin-aarch64': macPlatform,
    'darwin-x86_64': macPlatform
  },
  // 下载页：首次安装用的文件
  downloads: {
    windows: { file: rel(names.windowsSetup), size: statSync(windowsSetup).size },
    macos: { file: rel(names.macDmg), size: statSync(macDmg).size }
  }
}

mkdirSync(join(outDir, version), { recursive: true })
const uploads = [[windowsSetup, names.windowsSetup]]
uploads.push([macDmg, names.macDmg], [macUpdate, names.macUpdate])
for (const [from, name] of uploads) copyFileSync(from, join(outDir, rel(name)))
writeFileSync(join(outDir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
// 上传顺序：先安装包和更新包，最后清单，客户端看到新版本时文件一定已经在了
writeFileSync(
  join(outDir, 'upload-order.txt'),
  `${uploads.map(([, name]) => rel(name)).join('\n')}\n`
)
console.log(JSON.stringify(manifest, null, 2))
