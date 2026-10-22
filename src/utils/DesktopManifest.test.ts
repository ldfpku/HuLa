import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const manifestScript = resolve(root, '.github/scripts/desktop-manifest.mjs')

const writeArtifact = (root: string, relativePath: string, content = 'fixture') => {
  const file = join(root, relativePath)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

const runManifest = (artifacts: string, output: string) =>
  spawnSync(process.execPath, [manifestScript, artifacts, output], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, RELEASE_NOTES: '登录修复;双平台发布' }
  })

describe('desktop release manifest', () => {
  it('refuses to generate a Windows-only release manifest', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hula-desktop-manifest-'))
    try {
      const artifacts = join(directory, 'artifacts')
      writeArtifact(artifacts, 'desktop-windows/nsis/SMJ_1.1.0_x64-setup.exe')
      writeArtifact(artifacts, 'desktop-windows/nsis/SMJ_1.1.0_x64-setup.exe.sig')

      const result = runManifest(artifacts, join(directory, 'out'))

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('macOS 磁盘映像')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('includes signed installers and updater bundles for both desktop platforms', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hula-desktop-manifest-'))
    try {
      const artifacts = join(directory, 'artifacts')
      const output = join(directory, 'out')
      writeArtifact(artifacts, 'desktop-windows/nsis/SMJ_1.1.0_x64-setup.exe')
      writeArtifact(artifacts, 'desktop-windows/nsis/SMJ_1.1.0_x64-setup.exe.sig', 'windows-signature')
      writeArtifact(artifacts, 'desktop-macos/dmg/SMJ_1.1.0_universal.dmg')
      writeArtifact(artifacts, 'desktop-macos/macos/SMJ_1.1.0_universal.app.tar.gz')
      writeArtifact(artifacts, 'desktop-macos/macos/SMJ_1.1.0_universal.app.tar.gz.sig', 'macos-signature')

      const result = runManifest(artifacts, output)
      expect(result.status).toBe(0)

      const manifest = JSON.parse(readFileSync(join(output, 'latest.json'), 'utf8'))
      expect(manifest.version).toBe('1.1.0')
      expect(manifest.notes).toBe('- 登录修复\n- 双平台发布')
      expect(Object.keys(manifest.platforms).sort()).toEqual(['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64'])
      expect(Object.keys(manifest.downloads).sort()).toEqual(['macos', 'windows'])
      expect(manifest.platforms['darwin-aarch64'].signature).toBe('macos-signature')
      expect(manifest.platforms['darwin-x86_64']).toEqual(manifest.platforms['darwin-aarch64'])
      expect(readFileSync(join(output, 'upload-order.txt'), 'utf8').trim().split('\n')).toEqual([
        '1.1.0/SMJ_1.1.0_x64-setup.exe',
        '1.1.0/SMJ_1.1.0_universal.dmg',
        '1.1.0/SMJ_1.1.0_universal.app.tar.gz'
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
