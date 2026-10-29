# A 端测试记录

## 归属与当前状态

- 角色：A；账户：`test@smjtools.com`。
- 本文件由 A 维护；B 只维护 [B 端记录](results-b.md)。不记录密码、令牌、真实用户资料或未脱敏证据。
- 当前状态：**基线准备中**，端到端用例尚未执行。缺少任何适用实例的记录均视为未执行，不代表通过。
- 双人用例须与 B 使用相同轮次、用例 ID、端组合和方向；未收到 B 的独立记录时，不得声称双端通过。

## 基线与环境

每次基线变化新增一行；源码文件的安全指纹清单可另附为脱敏文本或逐行写在“指纹核对”列。只同步路径与 SHA-256，不同步敏感配置内容。

| 轮次 | 日期、时区 | 分支、commit | 测试服务标识 | 源码变更与指纹核对 | D 构建/系统 | W 浏览器 | M 真实设备/浏览器 | B 基线确认 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-20261029-01（暂定） | 2026-10-29 14:13，UTC+08:00 | `master`，准备阶段原始 HEAD 为 `c17d46e42e3f0cf12cff054929f17869541ab4de`；分发提交见下文 | `mail.smjtools.com` 测试服务 | 本机 14 个源码/测试文件的 SHA-256 见下表；B 尚未核对 | Windows 11 家庭版 10.0.26300；桌面尚未启动 | 本机已安装 Edge 156.0.4314.50；尚未执行浏览器用例 | 尚未确认设备 | 待确认 |

### A 端源码与测试文件指纹

上述原始 HEAD 只记录准备阶段的起点，不是包含本计划和修复的分发提交。同步后，双方使用 `git rev-parse HEAD` 记录实际分发提交并相互核对，再核对以下指纹。指纹覆盖本轮须对齐的源码及测试文件，不包含文档、配置、密码或其他敏感内容。B 需逐项核对，并确认双方没有额外影响运行结果的源码差异。

| 相对路径 | SHA-256 |
| --- | --- |
| `locales/en/components.json` | `be680c45aabe3a583199d60293e14a0ab7316dae14eea19da619747992f9b62f` |
| `locales/ko/components.json` | `2a03640febc7a75d64565a7fe1774ae9e240ad1e3d53e34dd833747cc377e620` |
| `locales/zh-CN/components.json` | `ff46991ba81fb552859254ef508bea761db38bcce0143d6f7a67cd50629e07ab` |
| `src/components/windows/SplitWindowMenu.test.ts` | `6e16982a4e77fd9a4d62fbaafb41e69e7e19be259cdcc34288b05f6e664d19a5` |
| `src/components/windows/SplitWindowMenu.vue` | `c38d761bf001b13d2f1ff1528034f8b36f7500f5e8a5febe37a8293035e7db86` |
| `src/hooks/useMsgInput.ts` | `7035b8200bc52c8d9ec518105449b182b8a2fb779367361ef8990a40c7890399` |
| `src/web/commands.ts` | `3f9c94b27bf58e28633982decbed838035837e09d2764583bc7b530c069887c4` |
| `src/web/imClient.ts` | `50ad83612bfc9c030f0cde40eb5c4b4666f4633b2dfe0e58e83e53c386720350` |
| `src/web/sharedLogin.ts` | `dc4f176c9217da8eb711b5070aa517d7e8e618f166613df20cf88a6ac756542a` |
| `src/services/avatarPickerLocale.test.ts` | `ab23d4b00ab9370714d267e26dd3bb237312a753c29a775f73a453d9099997dd` |
| `src/utils/FileUploadScheduling.test.ts` | `e06a64cb82cfd3dc3da616b987b00e00abd2a130a33fee9c31c5ff94df0b7153` |
| `src/utils/FileUploadScheduling.ts` | `216d432bbbf60d39e61fda05a007fc81b02fbd4cc437df46c30771f42e5bde81` |
| `src/web/imClient.test.ts` | `51a289b33cc3df0f10e422af3865e1737b977482877630e94698f7348d23b703` |
| `src/web/sharedLogin.test.ts` | `2ccfd616f1cdfbf8dbb89c614acb9e3d93f0371667e695baaf4274112fdf1679` |

### 本机自动化基线检查

以下为本机准备阶段结果，不代表任何端到端用例通过。

| 时间 | 检查 | 结果 |
| --- | --- | --- |
| 2026-10-29 14:12，UTC+08:00 | `node .\node_modules\vitest\vitest.mjs run` | 通过：51 个测试文件、209 个测试。 |
| 2026-10-29 14:13，UTC+08:00 | `node .\node_modules\vue-tsc\bin\vue-tsc.js --noEmit` | 通过。 |
| 2026-10-29 14:13，UTC+08:00 | `node .\node_modules\@biomejs\biome\bin\biome check locales\zh-CN\components.json locales\en\components.json locales\ko\components.json src\web\commands.ts src\web\imClient.ts src\web\imClient.test.ts src\web\sharedLogin.ts src\web\sharedLogin.test.ts src\services\avatarPickerLocale.test.ts src\components\windows\SplitWindowMenu.test.ts src\hooks\useMsgInput.ts src\utils\FileUploadScheduling.ts src\utils\FileUploadScheduling.test.ts` | 通过：13 个文件。 |
| 2026-10-29 14:12，UTC+08:00 | 测试服务公开配置端点的匿名连接探测 | HTTP 200；不代表登录、文件、消息或 WebSocket 正常。 |

## 可领取任务

1. 按 [交接协议](handoff.md) 核对与 B 的源码及服务基线，等待用户完成同步。
2. 依据 [用例表](test-cases.md) 执行 A 的所有本地实例；双人实例发起时先确认 B 就绪，A 接收时只在自己的端上观察。
3. 把每个适用实例各记一行。用例 ID 和实例缺行默认为未执行；不要用“整组通过”替代每个实例。
4. 将确认问题和 B 提供的候选问题汇总到 [问题记录](issues.md)，但在测试门槛满足前不修复。
5. 最后复核 B 的独立结果、未完成实例和清理清单。

## 用例结果

`端/组合` 使用 D、W、M 或 `A端/B端`；`方向` 使用 `A→B`、`B→A` 或 `本地`。状态仅限未执行、通过、失败、阻塞、不适用。不适用必须提供平台依据；失败或阻塞必须有实际现象和下一步。证据使用安全可访问的脱敏摘要或引用，不放原始业务内容。

| 轮次 | 用例 ID | 端/组合 | 方向 | 状态 | 操作与实际结果摘要 | 脱敏证据及时间 | 问题 ID | 清理/恢复 | 复测 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 待填写 | 待填写 | 待填写 | 待填写 | 未执行 | 待填写 | 待填写 | 无 | 待执行 | 未执行 |

## 等待 B / 未解决事项

| 轮次 | 用例 ID、组合、方向 | 等待内容或阻塞原因 | 对方确认 / 用户操作 | 状态 |
| --- | --- | --- | --- | --- |
| E2E-20261029-01（暂定） | 全部双机用例 | 等待 B 同步计划与上述修复，逐项核对指纹并确认同一测试服务 | 待确认 | 阻塞 |

## 本轮清理核对

| 本轮测试对象或设置 | 清理/恢复步骤 | A 实际结果 | B 确认 | 状态 |
| --- | --- | --- | --- | --- |
| 双人测试群、消息与好友关系 | 只处理本轮创建内容并恢复初始关系 | 待执行 | 待确认 | 未执行 |
| 自制文件、测试邮件、待办及动态 | 按用例逐一清理本轮对象 | 待执行 | 待确认 | 未执行 |
| 资料、主题、快捷键和设备权限 | 恢复已记录的初值 | 待执行 | 不适用 | 未执行 |
