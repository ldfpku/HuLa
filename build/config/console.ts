import pkg from '../../package.json'
import { execSync } from 'node:child_process'

let rustVersion = 'unknown'
try {
  rustVersion = execSync('rustc --version', { encoding: 'utf8' }).trim()
} catch {}

const tauriCliVersion = pkg.devDependencies?.['@tauri-apps/cli'] ?? 'unknown'

const detectIsChineseLocale = () => {
  const locale = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANGUAGE || ''
  return /zh/i.test(locale)
}

const isChineseLocale = detectIsChineseLocale()

const ENV_LABEL = isChineseLocale ? '当前环境: ' : 'Environment: '
const HOST_LABEL = isChineseLocale ? '主机: ' : 'Host: '
const VERSION_LABEL = isChineseLocale ? '版本: ' : 'version: '
const NODE_PREFIX = isChineseLocale ? '当前 ' : 'Current '
const NODE_SUFFIX = isChineseLocale ? ' 版本: ' : ' version: '
const PKG_MANAGER_LABEL = isChineseLocale ? '包管理器: ' : 'Package manager: '
const SERVER_LABEL = isChineseLocale ? '服务端: ' : 'Server: '

const getRuntimePackageManager = () => {
  const ua = process.env.npm_config_user_agent ?? ''
  if (!ua) return 'unknown'
  const firstPart = ua.split(' ')[0]
  return firstPart || 'unknown'
}

const runtimePackageManager = getRuntimePackageManager()

/**
 * 启动时打印信息
 * @param env 环境变量
 * @param mode 运行模式
 * @param host 当前 Vite 服务器 Host
 */
export const atStartup = (env: { [key: string]: string }, mode: string, host: string) => {
  return () => {
    if (mode !== 'production') {
      console.log(
        `  🍀 ${'\x1b[32m'}${'\x1b[1m'}${env.VITE_APP_NAME} ${'\x1b[0m'}${'\x1b[90m'}${pkg.version}${'\x1b[0m'}`
      )
      console.log(
        `  ${'\u001b[32m'}${'\x1b[1m'}${'➜'}${'\x1b[0m'}  ` +
          `${ENV_LABEL}` +
          `${'\x1b[31m'}${mode}${'\x1b[0m'}` +
          `  ${HOST_LABEL}` +
          `${'\x1b[36m'}${host}${'\x1b[0m'}`
      )
      console.log(
        `  ${'\u001b[32m'}${'\x1b[1m'}${'➜'}${'\x1b[0m'}  ${'\x1b[32m'}${'\x1b[1m'}${'Vue '}${'\x1b[0m'}${VERSION_LABEL} ` +
          `${'\x1b[90m'}${pkg.dependencies.vue}${'\x1b[0m'}` +
          ` ${'\x1b[36m'}${'\x1b[1m'}${'Vite '}${'\x1b[0m'}${VERSION_LABEL} ` +
          `${'\x1b[90m'}${pkg.devDependencies.vite}${'\x1b[0m'}` +
          ` ${'\u001b[34m'}${'\x1b[1m'}${'TypeScript '}${'\x1b[0m'}${VERSION_LABEL} ` +
          `${'\x1b[90m'}${pkg.devDependencies.typescript}${'\x1b[0m'}`
      )
      console.log(
        `  ${'\u001b[32m'}${'\x1b[1m'}${'➜'}${'\x1b[0m'} ` +
          ` ${'\x1b[33m'}${'\x1b[1m'}${'Tauri '}${'\x1b[0m'}${VERSION_LABEL} ` +
          `${'\x1b[90m'}${tauriCliVersion}${'\x1b[0m'}` +
          ` ${'\x1b[38;5;208m'}${'\x1b[1m'}${'Rust '}${'\x1b[0m'}${VERSION_LABEL} ` +
          `${'\x1b[90m'}${rustVersion}${'\x1b[0m'}`
      )
      console.log(
        `  ${'\u001b[32m'}${'\x1b[1m'}${'➜'}${'\x1b[0m'}  ` +
          `${NODE_PREFIX}${'\x1b[32m'}${'\x1b[1m'}Node.js${'\x1b[0m'}${NODE_SUFFIX}`,
        `${'\x1b[90m'}${process.version}${'\x1b[0m'}`,
        `  ${PKG_MANAGER_LABEL}${'\x1b[33m'}${'\x1b[90m'}${runtimePackageManager}${'\x1b[0m'}`
      )
      // 只打印文字，不访问任何地址；服务端是部署在 Cloudflare 上的 mailflare
      console.log(
        `  ${'\u001b[32m'}${'\x1b[1m'}${'\u001b[2m'}${'➜'}${'\x1b[0m'}  ` +
          SERVER_LABEL +
          `${'\x1b[35m'}${env.VITE_WEB_PROXY_TARGET || 'https://mail.smjtools.com'}${'\x1b[0m'}`
      )
    }
  }
}
