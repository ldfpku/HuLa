/** 网页版入口：先装好 Tauri 替身，再加载与桌面版相同的应用 */
import './devProxy'
import { currentLabel } from './tauriShim'
import '../main'
import { tryWebSignIn } from './sharedLogin'

void tryWebSignIn(currentLabel)
