/**
 * 网页版入口：先装好 Tauri 替身，再加载与桌面版相同的应用。
 * 应用必须动态加载：正式构建会把路由、Tauri 插件等拆成独立 chunk，静态 import 时它们的顶层代码
 * 会先于这里执行，读不到 __TAURI_INTERNALS__。
 */
import './devProxy'
import { currentLabel } from './tauriShim'
import { startPhoneSupport } from './phone'
import { captureInstallPrompt, startInstallHint } from './installHint'
import { registerServiceWorker } from './pwa'

startPhoneSupport()
registerServiceWorker()
captureInstallPrompt()

await import('../main')
// 应用已挂载，告诉启动看门狗（src/web/bootGuard.js）入口跑完了
;(window as any).__smjBootOk = true
const { tryWebSignIn } = await import('./sharedLogin')
void tryWebSignIn(currentLabel)
const { startWebNotify } = await import('./notify')
startWebNotify(currentLabel)
startInstallHint(currentLabel)
