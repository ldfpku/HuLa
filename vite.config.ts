import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import UnoCSS from '@unocss/vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import { internalIpV4 } from 'internal-ip'
import os from 'os'
import postcsspxtorem from 'postcss-pxtorem'
import AutoImport from 'unplugin-auto-import/vite' //自动导入
import { NaiveUiResolver, VantResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite' //组件注册
import { type ConfigEnv, defineConfig, loadEnv } from 'vite'
import VueSetupExtend from 'vite-plugin-vue-setup-extend'
import { getComponentsDirs, getComponentsDtsPath } from './build/config/components'
import { createManualChunks } from './build/config/chunks'
import { atStartup } from './build/config/console'
import packageJson from './package.json'

function getLocalIP() {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      // 只要 IPv4、非内网回环地址
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return void 0
}

// 读取 package.json 依赖
const dependencies = Object.keys(packageJson.dependencies || {})

// 预先获取本地IP
const rawIP = getLocalIP() || (await internalIpV4())

/**
 * 网页版挂在 /im/ 下，但代码里直接写了 public 目录的绝对路径（如 '/emoji/xx.webp'、'/logo.png'），
 * Vite 不会给这类字符串加 base。网页构建时把它们改成带 /im/ 前缀的地址。
 */
const createPublicPathRebase = (base: string) => {
  const publicDir = fileURLToPath(new URL('./public', import.meta.url))
  const entries = readdirSync(publicDir)
  const escapeRegExp = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const dirs = entries.filter((name) => statSync(`${publicDir}/${name}`).isDirectory()).map(escapeRegExp)
  const files = entries.filter((name) => !statSync(`${publicDir}/${name}`).isDirectory()).map(escapeRegExp)
  const pattern = new RegExp(`(['"\`(])/(?:(${dirs.join('|')})/|(${files.join('|')})(?=['"\`)?#]))`, 'g')
  const prefix = base.replace(/\/$/, '')
  return {
    name: 'smj-web-public-paths',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (id.includes('node_modules') || !id.includes('/src/') || !/\.(vue|ts|tsx|js|scss|css)(\?|$)/.test(id))
        return null
      if (!pattern.test(code)) return null
      pattern.lastIndex = 0
      return {
        code: code.replace(pattern, (match, quote, dir, file, offset) => {
          // 模板里的静态 src/href 和 import 语句 Vite 自己会处理 base，跳过
          const before = code.slice(Math.max(0, offset - 12), offset)
          if (/(?:\b(?:src|href|poster)=|\bfrom\s*|\bimport\s*\(?)$/.test(before)) return match
          return `${quote}${prefix}/${dir ? `${dir}/` : file}`
        }),
        map: null
      }
    }
  }
}

/**
 * 视频背景板的人像分割 wasm（src/utils/videoBackground）。只带 SIMD 版（主流浏览器都支持），
 * 从 node_modules 拷到产物的 video-bg/wasm/，开发时直接从 node_modules 读，不进 git 也不走 CDN。
 */
const createVideoBackgroundWasm = () => {
  const wasmDir = fileURLToPath(new URL('./node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url))
  const files = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']
  const contentType = (file: string) => (file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
  return {
    name: 'smj-video-bg-wasm',
    configureServer(server: { middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        const file = /\/video-bg\/wasm\/([\w.]+)(?:\?.*)?$/.exec(req.url || '')?.[1]
        if (!file || !files.includes(file)) return next()
        res.setHeader('Content-Type', contentType(file))
        createReadStream(`${wasmDir}${file}`).pipe(res)
      })
    },
    generateBundle(this: { emitFile: (file: { type: 'asset'; fileName: string; source: Uint8Array }) => void }) {
      for (const file of files) {
        this.emitFile({ type: 'asset', fileName: `video-bg/wasm/${file}`, source: readFileSync(`${wasmDir}${file}`) })
      }
    }
  }
}

/**
 * 网页版“添加到主屏幕”（PWA）：输出 manifest.webmanifest 和 service worker（src/web/sw.js → sw.js），
 * 并在页面 <head> 里写入 manifest、主题色和 iOS 主屏幕需要的标签。图标都是随包的品牌图标，不引用外部地址。
 */
const createWebAppManifest = (base: string) => {
  const manifest = {
    id: base,
    name: 'SMJ 即时通讯',
    short_name: 'SMJ',
    description: '斯米伽（SMJ）内部即时通讯，与斯米伽邮箱共用账号',
    lang: 'zh-CN',
    start_url: base,
    scope: base,
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: '#034fbc',
    icons: [
      { src: `${base}brand/smj-icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}brand/smj-icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${base}brand/smj-icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  }
  const headTags = [
    `<link rel="manifest" href="${base}manifest.webmanifest" />`,
    '<meta name="theme-color" content="#034fbc" />',
    '<meta name="mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-title" content="SMJ" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
    '<meta name="application-name" content="SMJ" />'
  ].join('\n    ')
  return {
    name: 'smj-web-app-manifest',
    transformIndexHtml: (html: string) =>
      html
        .replace('</head>', `    ${headTags}\n  </head>`)
        .replace('<html lang="en">', '<html lang="zh-CN">')
        // 软键盘弹出时让页面缩到键盘上方（Android Chrome），iOS 由 src/web/phone.ts 按可见区域处理
        .replace('viewport-fit=cover"', 'viewport-fit=cover, interactive-widget=resizes-content"'),
    generateBundle(this: { emitFile: (file: { type: 'asset'; fileName: string; source: string }) => void }) {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(manifest, null, 2) })
      // 缓存名带上构建时间：每次发布 service worker 内容都不同，浏览器才会换新并清掉旧缓存
      const sw = readFileSync(fileURLToPath(new URL('./src/web/sw.js', import.meta.url)), 'utf8')
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw.replace('__SMJ_BUILD__', Date.now().toString(36)) })
    }
  }
}

// https://vitejs.dev/config/
/**! 不需要优化前端打包(如开启gzip) */
export default defineConfig(({ mode }: ConfigEnv) => {
  // 获取当前环境的配置,如何设置第三个参数则加载所有变量，而不是以"VITE_"前缀的变量
  const config = loadEnv(mode, process.cwd(), '')
  const currentPlatform = config.TAURI_ENV_PLATFORM
  const isPC = currentPlatform === 'windows' || currentPlatform === 'darwin' || currentPlatform === 'linux'
  // 网页版（vite --mode web）：入口换成 src/web/entry.ts，开发时把 /api 代理到 IM 服务端
  const isWeb = mode === 'web'
  const webProxyTarget = config.VITE_WEB_PROXY_TARGET || 'https://mail.smjtools.com'

  const serverPort = isPC ? 6130 : 5210
  const componentsDirs = getComponentsDirs(currentPlatform)
  const componentsDtsPath = getComponentsDtsPath(currentPlatform)

  // 根据平台决定host地址
  const host = (() => {
    if (isPC) {
      return '127.0.0.1'
    }

    // 移动端逻辑：检查是否为有效的内网IP地址
    if (rawIP && !rawIP.endsWith('.0') && !rawIP.endsWith('.255')) {
      return rawIP // 有效IP且非网段/广播地址
    }

    // 无效IP或特殊地址的情况
    return config.TAURI_ENV_PLATFORM === 'ios'
      ? (rawIP ?? '127.0.0.1')
      : config.TAURI_ENV_PLATFORM === 'android'
        ? '0.0.0.0'
        : '127.0.0.1'
  })()

  // 是否开启启动时打印信息
  atStartup(config, mode, host)()

  return {
    // 网页版挂在 mailflare 的 /im/ 下
    base: isWeb ? '/im/' : '/',
    // 桌面版“检查更新”里显示的版本发布日期（打包时间）
    define: {
      'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString())
    },
    resolve: {
      alias: {
        // 配置主路径别名@
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        // 配置移动端路径别名#
        '#': fileURLToPath(new URL('./src/mobile', import.meta.url)),
        // 配置路径别名~(根路径)
        '~': fileURLToPath(new URL('.', import.meta.url))
      }
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
          additionalData: '@use "@/styles/scss/global/variable.scss" as *;' // 加载全局样式，使用scss特性
        }
      },
      postcss: {
        plugins: [
          postcsspxtorem({
            rootValue: 16, // 1rem = 16px，可根据设计稿调整
            propList: ['*'], // 所有属性都转换
            unitPrecision: 5, // 保留小数位数
            selectorBlackList: [], // 不转换的类名（可选）
            replace: true, // 替换原来的 px
            mediaQuery: false, // 是否在媒体查询中转换
            minPixelValue: 0 // 最小转换单位
          })
        ]
      }
    },
    plugins: [
      {
        // Vant 图标字体除了内联的 woff2，还带一个 at.alicdn.com 的 woff 备选，浏览器会去下载；去掉外部备选，只用内联字体。
        // 有组件在 scoped 样式里再次引入了 Vant 的样式，所以在最终产物的 CSS 上处理
        name: 'smj-strip-external-fonts',
        generateBundle(_options: unknown, bundle: Record<string, any>) {
          for (const file of Object.values(bundle)) {
            if (file.type !== 'asset' || !file.fileName.endsWith('.css')) continue
            file.source = String(file.source).replace(
              /,\s*url\(\s*["']?(?:https?:)?\/\/at\.alicdn\.com[^)]*\)\s*format\(["'][a-z0-9]+["']\)/g,
              ''
            )
          }
        }
      },
      createVideoBackgroundWasm(),
      isWeb && createPublicPathRebase('/im/'),
      isWeb && createWebAppManifest('/im/'),
      isWeb && {
        name: 'smj-web-entry',
        // order: 'pre'：构建时要在 Vite 收集入口脚本之前替换，否则仍按 src/main.ts 打包
        transformIndexHtml: {
          order: 'pre' as const,
          handler: (html: string) =>
            html
              .replace('/src/main.ts', '/src/web/entry.ts')
              // 启动看门狗要先于所有模块执行，内联在 <head> 最前面（见 src/web/bootGuard.js）
              .replace(
                '<head>',
                `<head>\n    <script>${readFileSync(fileURLToPath(new URL('./src/web/bootGuard.js', import.meta.url)), 'utf8').replace(/^[\s\S]*?\n;/, ';')}</script>`
              )
        }
      },
      /**
       * vue3.5.0已支持解构并具有响应式
       * */
      vue(),
      VueSetupExtend(), // setup 中给组件命名(keepAlive需要)
      vueJsx(), // 开启jsx功能
      UnoCSS(), // 开启UnoCSS
      AutoImport({
        imports: [
          'vue',
          'vue-router',
          'pinia',
          { 'naive-ui': ['useDialog', 'useMessage', 'useNotification', 'useLoadingBar', 'useModal'] }
        ],
        dts: 'src/typings/auto-imports.d.ts'
      }),
      /**自动导入组件，但是不会自动导入jsx和tsx*/
      Components({
        dirs: componentsDirs, // 根据平台加载对应组件目录
        resolvers: [NaiveUiResolver(), VantResolver()],
        dts: componentsDtsPath
      })
    ],
    worker: {
      format: 'es' as const
    },
    build: {
      // 设置兼容低版本浏览器的目标
      target: ['chrome87', 'edge88', 'firefox78', 'safari14'],
      cssCodeSplit: true, // 启用 CSS 代码拆分
      minify: 'oxc' as const, // Vite 8 默认使用 Oxc 压缩，减少对 esbuild 依赖
      // chunk 大小警告的限制(kb)
      chunkSizeWarningLimit: 1200,
      // Vite 8 默认使用 Oxc，生产环境移除 console.log、debugger
      oxc: mode === 'production' ? { dropConsole: true, dropDebugger: true } : undefined,
      // 显式关闭 esbuild 转译链路，避免 worker 构建时触发 transformWithEsbuild
      esbuild: false,
      sourcemap: false, // 关闭源码映射
      // Vite 8 默认构建器为 Rolldown，这里改为官方推荐的 rolldownOptions
      rolldownOptions: {
        output: {
          chunkFileNames: 'static/js/[name]-[hash].js', // 引入文件名的名称
          entryFileNames: 'static/js/[name]-[hash].js', // 包的入口文件名称
          assetFileNames: 'static/[ext]/[name]-[hash].[ext]', // 资源文件像 字体，图片等
          manualChunks: createManualChunks(dependencies)
        }
      }
    },
    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      hmr: isWeb
        ? undefined
        : {
            protocol: 'ws',
            host: host,
            port: serverPort
          },
      cors: true, // 配置 CORS
      proxy: isWeb ? { '/api': { target: webProxyTarget, changeOrigin: true, secure: true, ws: true } } : undefined,
      host: '0.0.0.0',
      port: serverPort,
      strictPort: true,
      watch: {
        // 3. tell vite to ignore watching `src-tauri`
        ignored: ['**/src-tauri/**']
      }
    }
  }
})
