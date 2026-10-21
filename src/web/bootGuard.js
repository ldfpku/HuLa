/**
 * 网页版启动看门狗：由 vite.config.ts 以内联脚本写进 index.html 的 <head>，先于任何模块执行，所以只用老语法。
 * - 从页面一开始就记下脚本错误和未处理的 Promise 错误
 * - 启动 20 秒后界面还没出来（入口没跑完，或首屏加载遮罩还在），在页面上显示原因和“重新加载”“清除缓存后重新加载”，
 *   不再只留一片空白；之后界面出来了提示自动消失
 * 入口跑完时 src/web/entry.ts 设置 window.__smjBootOk；首屏加载遮罩带 data-smj-boot-loading（src/layout/index.vue）
 */
// biome-ignore-all lint/complexity/useArrowFunction: 用老语法，旧版浏览器跑不动应用时也能显示提示
;(function () {
  var errors = []
  var record = function (text) {
    text = String(text || '').slice(0, 300)
    if (text && errors.indexOf(text) < 0 && errors.length < 6) errors.push(text)
  }
  window.__smjBootErrors = errors
  window.addEventListener(
    'error',
    function (event) {
      var target = event.target
      if (target && target !== window && (target.src || target.href)) {
        record('文件加载失败：' + (target.src || target.href))
      } else {
        record((event.message || '脚本错误') + (event.filename ? ' @ ' + event.filename + ':' + event.lineno : ''))
      }
    },
    true
  )
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason
    record('未处理的错误：' + (reason && (reason.stack || reason.message) ? reason.message || reason.stack : reason))
  })

  var PANEL_ID = 'smj-boot-guard'
  var stuck = function () {
    return !window.__smjBootOk || !!document.querySelector('[data-smj-boot-loading]')
  }
  var clearAndReload = function () {
    var jobs = []
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(
          navigator.serviceWorker.getRegistrations().then(function (list) {
            return Promise.all(
              list.map(function (reg) {
                return reg.scope.indexOf('/im/') >= 0 ? reg.unregister() : null
              })
            )
          })
        )
      }
      if (window.caches && caches.keys) {
        jobs.push(
          caches.keys().then(function (keys) {
            return Promise.all(
              keys.map(function (key) {
                return key.indexOf('smj-im-') === 0 ? caches.delete(key) : null
              })
            )
          })
        )
      }
    } catch {
      // 清不掉也照样重新加载
    }
    Promise.all(jobs)
      .catch(function () {})
      .then(function () {
        location.reload()
      })
  }
  var button = function (text, primary, onClick) {
    var b = document.createElement('button')
    b.type = 'button'
    b.textContent = text
    b.style.cssText =
      'display:block;width:100%;margin-top:12px;padding:12px;border-radius:8px;font-size:16px;cursor:pointer;' +
      (primary ? 'background:#034fbc;color:#fff;border:0;' : 'background:#fff;color:#034fbc;border:1px solid #034fbc;')
    b.onclick = onClick
    return b
  }
  var show = function () {
    if (document.getElementById(PANEL_ID) || !document.body) return
    var panel = document.createElement('div')
    panel.id = PANEL_ID
    panel.setAttribute('role', 'alert')
    panel.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;overflow:auto;background:#e9edf5;color:#0a1f54;' +
      'font:15px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC",sans-serif;' +
      'padding:calc(env(safe-area-inset-top) + 24px) 20px calc(env(safe-area-inset-bottom) + 24px)'
    var box = document.createElement('div')
    box.style.cssText = 'max-width:420px;margin:0 auto'
    var title = document.createElement('div')
    title.textContent = 'SMJ 没能正常打开'
    title.style.cssText = 'font-size:20px;font-weight:600;margin-bottom:8px'
    var tip = document.createElement('div')
    tip.textContent =
      '可能是网络不稳定或缓存了旧版本。请先点“重新加载”；仍然不行再点“清除缓存后重新加载”（不会退出登录）。'
    var detail = document.createElement('pre')
    detail.style.cssText =
      'white-space:pre-wrap;word-break:break-all;font-size:12px;line-height:1.5;color:#4a5878;' +
      'background:#fff;border-radius:8px;padding:10px;margin-top:16px;user-select:text;-webkit-user-select:text'
    detail.textContent =
      '诊断信息（截图发给管理员）：\n' +
      (errors.length ? errors.join('\n') : window.__smjBootOk ? '首屏数据加载超时' : '启动脚本没有运行完') +
      '\n' +
      location.pathname +
      ' · ' +
      navigator.userAgent
    box.appendChild(title)
    box.appendChild(tip)
    box.appendChild(
      button('重新加载', true, function () {
        location.reload()
      })
    )
    box.appendChild(button('清除缓存后重新加载', false, clearAndReload))
    box.appendChild(detail)
    panel.appendChild(box)
    document.body.appendChild(panel)
  }
  var check = function () {
    var panel = document.getElementById(PANEL_ID)
    if (stuck()) show()
    else if (panel) panel.parentNode.removeChild(panel)
  }
  setTimeout(function () {
    check()
    setInterval(check, 2000)
  }, 20000)
})()
