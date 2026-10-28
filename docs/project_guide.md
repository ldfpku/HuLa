# HuLa 项目入门手册 🚀

<p align="center">
  <img width="350px" height="150px" src="../public/brand/smj-wordmark-color.svg"/>
</p>

<p align="center">基于 Tauri、Vite 7、Vue 3 和 TypeScript 构建的跨平台即时通讯系统完整开发指南</p>

---

## 📋 目录
- [环境要求](#-环境要求)
- [环境配置与安装](#️-环境配置与安装)
- [项目启动](#-项目启动)
- [项目目录结构](#-项目目录结构)
- [服务地址配置](#-服务地址配置)
- [如何提交 Issues 和 PR](#-如何提交-issues-和-pr)

---

## 🔧 环境要求

在开始开发之前，请确保您的系统满足以下要求：

### 必需环境

| 环境 | 版本要求 | 说明 |
|------|---------|------|
| **Node.js** | `^20.19.0` 或 `>=22.12.0` | JavaScript 运行环境 |
| **pnpm** | `>=10.x` | 包管理器，必须使用 pnpm |
| **Rust** | `最新稳定版` | Tauri 后端开发需要 |
| **Git** | `2.0+` | 版本控制 |

### 操作系统支持

| 平台 | 支持版本 |
|------|---------|
| **Windows** | Windows 10, Windows 11 |
| **macOS** | macOS 10.15+ |
| **Linux** | Ubuntu 20.04+ |
| **iOS/iPadOS** | iOS 13.0+, iPadOS 13.0+ |
| **Android** | Android 8.0+ (API 26+) |

---

## 桌面登录、分屏与图标

- 桌面端新安装默认开启自动登录；可在登录设置中关闭。已有配置保留原来的选择。手动登录成功后，桌面端使用刷新令牌恢复会话，最长从该次登录起 30 天，不保存明文密码；旧版本没有期限记录时需要重新登录一次。
- 桌面端新安装默认使用浅色主题，用户可以在通用设置中切换深色或跟随系统；已有主题选择不受影响。深色桌面使用低饱和深灰蓝，聊天正文、次要信息和常用控件按对比度要求设计。
- 从桌面客户端打开的邮箱窗口在没有已保存主题时默认浅色，主动选择的浅色、深色或跟随系统继续保留；普通浏览器的默认主题仍跟随系统。
- 桌面会话按群聊、人员分区，各区内仍按置顶和最近活跃时间排列。群列表显示在线人数/总人数；在线表示用户至少有一个聊天连接，绿色标记在线、灰色标记离线，自定义状态不代替连接状态。群人数、当前群成员和已加载联系人在窗口可见时约每 30 秒刷新；网络异常时可能暂时保留上一次结果。
- AI 摘要、邮件转待办和 AI 对话均须先查看内容及额度提示并确认，切换摘要范围不会自动重新生成。邮箱自动草稿须先确认持续调用及费用提示，再在邮箱助手设置中保存。
- 聊天昵称与邮箱资料名称独立，邮箱服务端不限制昵称修改次数。部署对应服务端前须应用 `0084_add_im_display_name.sql` 迁移；旧备份中没有聊天昵称和头像字段时继续使用原有资料。
- 个人资料中的头像可从 22 张内置头像中选择，也可上传图片；聊天头像独立保存，不覆盖邮箱头像。未设置头像时保留已有头像或按用户 ID 稳定生成默认头像；头像数量有限，不保证每位用户的头像互不相同。
- 30 天仍受服务端刷新令牌有效期、账号撤销和网络状态约束。部署时须确认服务端令牌策略允许所需的恢复期限；本地计时不是服务端安全策略的替代品。主动退出会清除本机保存的令牌。
- 部署参考：公开的 HuLa-Server 上游在 9125bb42 版本中，[生产配置](https://github.com/HuLaSpark/HuLa-Server/blob/9125bb42ea16896055ec057e65124f3c684c361a/luohuo-cloud/luohuo-support/luohuo-boot-server/src/main/resources/config/prod/sa-token.yml)的 `sa-token.timeout` 为 2,592,000 秒（30 天），[初次签发](https://github.com/HuLaSpark/HuLa-Server/blob/9125bb42ea16896055ec057e65124f3c684c361a/luohuo-cloud/luohuo-oauth/luohuo-oauth-biz/src/main/java/com/luohuo/flex/oauth/granter/AbstractTokenGranter.java)及[刷新签发](https://github.com/HuLaSpark/HuLa-Server/blob/9125bb42ea16896055ec057e65124f3c684c361a/luohuo-cloud/luohuo-oauth/luohuo-oauth-biz/src/main/java/com/luohuo/flex/oauth/granter/RefreshTokenGranter.java)的刷新令牌有效期均为该值的两倍。实际部署可能使用其他版本或覆盖配置，且会话撤销、同账号登录及刷新时的令牌清理仍可能提前使其失效；修改令牌策略前应评估安全影响。
- 自动登录遇到网络故障、服务端暂时不可用或限流时保留凭证以便重试；服务端明确拒绝刷新令牌时需要手动登录。
- 主窗口标题栏的分屏菜单可将窗口移至当前屏幕工作区的左、右、上、下半区，并恢复原位置；其他窗口由系统或用户安排。若窗口管理器不允许定位，请使用系统原生分屏。
- 桌面应用图标源文件为 `src-tauri/icons/smj-chat.svg`，桌面打包资源位于 `src-tauri/icons/desktop`，托盘闪烁资源为 `src-tauri/tray/icon.png`。更新图标时应同步生成对应尺寸及托盘资源，避免只替换安装包或任务栏图标。
- 邮件窗口使用独立的 `src-tauri/icons/smj-mail.svg` 图标。在 Windows 上，邮件窗口使用独立任务栏分组；macOS 程序坞按应用而不是按窗口显示图标。
- 本地发送记录与服务器回显按消息 ID 合并，避免回显先到时与临时消息发生主键冲突。历史重复记录不会按相同文本自动删除，以免误删用户有意重复发送的消息。

---

## ⚙️ 环境配置与安装

### 1. 安装 Node.js 和 pnpm

**Windows:**
```bash
# 方法1: 使用 winget 安装 Node.js
winget install OpenJS.NodeJS

# 方法2: 从官网下载安装包
# 访问 https://nodejs.org/ 下载 LTS 版本

# 安装 pnpm
npm install -g pnpm@latest
```

**macOS:**
```bash
# 使用 Homebrew 安装
brew install node pnpm

# 或使用 nvm 管理 Node.js 版本
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 22
nvm use 22
npm install -g pnpm@latest
```

**Linux (Ubuntu/Debian):**
```bash
# 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装 pnpm
npm install -g pnpm@latest
```

### 2. 安装 Rust 和 Tauri 环境

**所有平台:**
```bash
# 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# 验证安装
rustc --version
cargo --version
```

**Windows 额外要求:**

详细安装步骤：

1. **安装 Microsoft C++ Build Tools**
   ```bash
   # 方法1: 使用 winget 安装
   winget install Microsoft.VisualStudio.2022.BuildTools

   # 方法2: 下载安装包
   # 访问 https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022
   ```

2. **或者安装 Visual Studio Community 2022**
   ```bash
   # 使用 winget 安装
   winget install Microsoft.VisualStudio.2022.Community

   # 必须勾选以下工作负载：
   # - 使用 C++ 的桌面开发
   # - MSVC v143 编译器工具集
   # - Windows 10/11 SDK (最新版本)
   ```

3. **安装 WebView2 Runtime (通常已预装)**
   ```bash
   # 检查是否已安装 WebView2
   winget list --name "Microsoft Edge WebView2"

   # 如未安装，执行：
   winget install Microsoft.EdgeWebView2Runtime
   ```

4. **重启命令行工具**
   安装完成后，重新打开 PowerShell 或 CMD 以确保环境变量生效。

**Linux 额外要求:**
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install libwebkit2gtk-4.0-dev \
    build-essential \
    curl \
    wget \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev

# Fedora
sudo dnf install webkit2gtk3-devel.x86_64 \
    openssl-devel \
    curl \
    wget \
    libappindicator-gtk3 \
    librsvg2-devel

# Arch
sudo pacman -S webkit2gtk \
    base-devel \
    curl \
    wget \
    openssl \
    appmenu-gtk-module \
    gtk3 \
    libappindicator-gtk3 \
    librsvg \
    libvips
```

### 3. 移动端开发环境 (可选)

**Android 开发:**
```bash
# 安装 Android Studio 和 SDK
# 设置 ANDROID_HOME 环境变量

# 初始化 Android 项目
pnpm run tauri:android:init
```

**iOS 开发 (仅 macOS):**
```bash
# 安装 Xcode 和 Xcode Command Line Tools
xcode-select --install

# 初始化 iOS 项目
pnpm run tauri:ios:init
```

---

## 🚀 项目启动

### 1. 克隆项目

```bash
# 从 GitHub 克隆
git clone https://github.com/HuLaSpark/HuLa.git

# 或从 Gitee 克隆（国内推荐）
git clone https://gitee.com/HuLaSpark/HuLa.git

# 进入项目目录
cd HuLa
```

### 2. 安装依赖

```bash
# 使用 pnpm 安装所有依赖
pnpm install

# 如果在国内网络环境下遇到问题，可以设置镜像
pnpm config set registry https://registry.npmmirror.com/
```

### 3. 启动开发环境

```bash
# 启动桌面应用开发环境（推荐）
pnpm run tauri:dev
# 简化命令
pnpm run td

# 启动 Android 开发环境
pnpm run tauri:android:dev
# 简化命令
pnpm run adev

# 启动 iOS 开发环境（仅 macOS）
pnpm run tauri:ios:dev
# 简化命令
pnpm run idev
```

### 4. 构建生产版本

```bash
# 构建桌面应用
pnpm run tauri:build
# 简化命令
pnpm run tb
```

### 5. 代码质量检查

```bash
# 检查代码格式和问题（不修复）
pnpm run check

# 修复代码格式和问题
pnpm run check:write

# 格式化所有文件（包括 Vue 组件）
pnpm run format:all

# Git 提交前的代码检查
pnpm run lint:staged
```

### 6. 测试

```bash
# 运行单元测试
pnpm run test:run

# 运行测试 UI 界面
pnpm run test:ui

# 生成测试覆盖率报告
pnpm run coverage
```

---

## 📁 项目目录结构

```
HuLa/
├── 📁 src/                      # Vue 3 前端源码
│   ├── 📁 agreement/            # 用户协议相关组件
│   ├── 📁 assets/               # 静态资源
│   │   ├── 📁 fonts/            # 字体文件
│   │   ├── 📁 img/              # 图片资源
│   │   ├── 📁 logo/             # Logo 资源
│   │   ├── 📁 mobile/           # 移动端专用资源
│   │   └── 📁 video/            # 视频资源
│   ├── 📁 components/           # Vue 组件
│   │   ├── 📁 common/           # 公共组件
│   │   ├── 📁 rightBox/         # 右侧功能组件
│   │   └── 📁 windows/          # 窗口组件
│   ├── 📁 directives/           # Vue 自定义指令
│   ├── 📁 enums/               # 枚举定义
│   ├── 📁 hooks/               # Vue 3 组合式 API Hooks
│   ├── 📁 layout/              # 布局组件
│   │   ├── 📁 center/          # 中央布局
│   │   └── 📁 left/            # 左侧布局
│   ├── 📁 mobile/              # 移动端专用代码
│   ├── 📁 plugins/             # 插件配置
│   ├── 📁 router/              # Vue Router 路由配置
│   ├── 📁 services/            # API 服务层
│   ├── 📁 stores/              # Pinia 状态管理
│   ├── 📁 styles/              # 全局样式
│   ├── 📁 typings/             # TypeScript 类型定义
│   ├── 📁 utils/               # 工具函数
│   ├── 📁 views/               # 页面组件
│   ├── 📁 workers/             # Web Workers
│   ├── 📄 App.vue              # 根组件
│   └── 📄 main.ts              # 应用入口文件
├── 📁 src-tauri/               # Tauri Rust 后端源码
│   ├── 📁 capabilities/         # Tauri 权限配置
│   ├── 📁 configuration/        # 应用配置
│   ├── 📁 entity/              # 数据库实体
│   ├── 📁 icons/               # 应用图标
│   ├── 📁 migration/           # 数据库迁移
│   ├── 📁 src/                 # Rust 源码
│   ├── 📁 tray/                # 系统托盘相关
│   ├── 📄 Cargo.toml           # Rust 项目配置
│   ├── 📄 tauri.conf.json      # Tauri 主配置
│   ├── 📄 tauri.*.conf.json    # 平台特定配置
│   └── 📄 db.sqlite            # SQLite 数据库
├── 📁 public/                  # 静态资源文件
│   ├── 📁 AI/                  # AI 相关资源
│   ├── 📁 avatar/              # 头像资源
│   ├── 📁 emoji/               # 表情包资源
│   ├── 📁 sound/               # 音频文件
│   └── 📄 logo.png             # 应用 Logo
├── 📁 scripts/                 # 构建和开发脚本
│   ├── 📄 check-all.js         # 环境检查脚本
│   ├── 📄 check-dependencies.js # 依赖检查脚本
│   └── 📄 interactive-build-inquirer.js # 交互式构建脚本
├── 📁 docs/                    # 项目文档
├── 📁 preview/                 # 项目预览图
├── 📁 build/                   # 构建输出目录
├── 📁 .husky/                  # Git hooks 配置
├── 📁 .vscode/                 # VS Code 配置
├── 📄 package.json             # 项目依赖和脚本配置
├── 📄 pnpm-lock.yaml           # 依赖版本锁定文件
├── 📄 tsconfig.json            # TypeScript 配置
├── 📄 vite.config.ts           # Vite 构建配置
├── 📄 uno.config.ts            # UnoCSS 配置
├── 📄 biome.json               # 代码格式化配置
├── 📄 vitest.config.ts         # 测试配置
└── 📄 README.md                # 项目说明文档
```

### 核心目录说明

| 目录 | 作用 | 技术栈 |
|------|------|--------|
| `src/` | Vue 3 前端应用源码 | Vue 3 + TypeScript + Vite |
| `src-tauri/` | Tauri Rust 后端源码 | Rust + Tauri + SQLite |
| `src/components/` | 可复用 Vue 组件 | Vue 3 Composition API |
| `src/stores/` | 状态管理 | Pinia + TypeScript |
| `src/services/` | API 接口服务 | Axios + TypeScript |
| `src/hooks/` | 自定义 Hooks | Vue 3 Composition API |
| `src/utils/` | 工具函数库 | TypeScript + Lodash |
| `src/styles/` | 全局样式 | Sass + UnoCSS |
| `public/` | 静态资源文件 | 图片、音频、字体等 |

---

## 🐛 如何提交 Issues 和 PR

### 提交 Issue

1. **🔍 搜索现有 Issues**
   - 在提交新 Issue 前，请先搜索是否已有类似问题
   - 访问 [GitHub Issues](https://github.com/HuLaSpark/HuLa/issues)

2. **📝 创建新 Issue**
   ```markdown
   **问题描述**
   清晰描述您遇到的问题

   **复现步骤**
   1. 进入...
   2. 点击...
   3. 出现错误...

   **期望行为**
   描述您期望发生的情况

   **环境信息**
   - 操作系统: [例如 Windows 11]
   - Node.js 版本: [例如 v22.12.0]
   - HuLa 版本: [例如 v2.6.13]

   **截图或日志**
   如有可能，请提供相关截图或错误日志
   ```

### 提交 Pull Request

1. **🍴 Fork 项目**
   ```bash
   # 点击 GitHub 页面右上角的 "Fork" 按钮
   # 然后克隆您的 Fork
   git clone https://github.com/你的用户名/HuLa.git
   cd HuLa
   ```

2. **🌿 创建功能分支**
   ```bash
   # 创建并切换到新分支
   git checkout -b feature/your-feature-name

   # 或修复分支
   git checkout -b fix/your-bug-fix
   ```

3. **💻 开发和测试**
   ```bash
   # 安装依赖
   pnpm i

   # 启动开发环境
   pnpm run td

   # 运行代码检查
   pnpm run lint:staged

   # 运行测试
   pnpm run test:run
   ```

4. **📝 提交代码**
   ```bash
   # 使用项目提供的提交工具（推荐）
   pnpm run commit

   # 或传统方式提交
   git add .
   git commit -m "feat: 添加新功能描述"
   ```

5. **🚀 推送和创建 PR**
   ```bash
   # 推送到您的 Fork
   git push origin feature/your-feature-name

   # 在 GitHub 上创建 Pull Request
   ```

### 代码提交规范

项目使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

| 类型 | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat: 添加消息撤回功能` |
| `fix` | 修复 Bug | `fix: 修复登录页面样式问题` |
| `docs` | 文档更新 | `docs: 更新 API 文档` |
| `style` | 代码格式化 | `style: 格式化组件代码` |
| `refactor` | 重构代码 | `refactor: 优化消息发送逻辑` |
| `perf` | 性能优化 | `perf: 优化图片加载性能` |
| `test` | 添加测试 | `test: 添加登录功能单元测试` |
| `chore` | 构建过程或辅助工具变动 | `chore: 更新依赖版本` |

### 代码审查流程

1. **自动检查**: PR 提交后会自动运行 CI 检查
2. **代码审查**: 维护者会审查您的代码
3. **修改完善**: 根据反馈修改代码
4. **合并入库**: 审查通过后合并到主分支

---

## 🔧 服务地址配置

### 简化配置说明

HuLa 项目现在使用统一配置方案，您只需要修改一个文件即可完成服务地址配置：

**配置文件：** `src-tauri/configuration/local.yaml`

### 配置步骤

#### 1. 创建本地配置文件

首次启动项目时，运行以下脚本自动创建 `local.yaml` 配置文件：

```bash
# 运行pnpm i 会自动创建 local.yaml 文件（使用 production.yaml 作为模板）
pnpm i
```

#### 2. 修改服务地址

编辑 `src-tauri/configuration/local.yaml` 文件，修改以下配置：

```yaml
# 数据库配置
database:
  sqlite_file: db.sqlite

# 后端服务配置
backend:
  base_url: http://localhost:8080/api      # 修改为您的后端 API 地址
  ws_url: ws://localhost:8080/api/ws/ws    # 修改为您的 WebSocket 地址

# 翻译服务配置（可选）
youdao:
  app_key: ''
  app_secret: ''
tencent:
  api_key: ''
  secret_id: ''
```

#### 3. 配置示例

**本地开发环境：**
```yaml
backend:
  base_url: http://localhost:8080/api
  ws_url: ws://localhost:8080/api/ws/ws
```

**局域网环境：**
```yaml
backend:


### 注意事项

- ✅ **自动同步**：前后端会自动使用 `local.yaml` 中的配置，无需手动同步
- 🔄 **重启生效**：修改配置后需要重启开发服务器 (`pnpm run td`)
- 🌐 **协议选择**：
  - 本地/HTTP：使用 `http://` 和 `ws://`
  - 生产/HTTPS：使用 `https://` 和 `wss://`
- 📁 **文件管理**：`local.yaml` 文件不会提交到 Git，仅用于本地开发

### 验证配置

修改配置后，重启开发服务器验证：

```bash
# 重启开发服务器
pnpm run td


---

## 🎯 开发建议

### 编辑器配置

推荐使用 **Visual Studio Code** 并安装以下插件：

```json
{
  "recommendations": [
    "vue.volar",
    "bradlc.vscode-tailwindcss",
    "rust-lang.rust-analyzer",
    "tauri-apps.tauri-vscode",
    "ms-vscode.vscode-typescript-next",
    "biomejs.biome"
  ]
}
```

### 开发工作流

1. **🔄 保持同步**: 定期从上游仓库拉取最新代码
2. **🧪 测试驱动**: 为新功能编写测试用例
3. **📚 文档更新**: 及时更新相关文档
4. **🎨 代码风格**: 使用项目统一的代码风格
5. **🐛 问题跟踪**: 及时反馈和修复发现的问题

---

## 🤝 社区交流

- 💬 **微信群**: 扫描 README 中的二维码加入讨论群
- 🌟 **GitHub**: [https://github.com/HuLaSpark/HuLa](https://github.com/HuLaSpark/HuLa)
- 🦄 **Gitee**: [https://gitee.com/HulaSpark/HuLa](https://gitee.com/HulaSpark/HuLa)
- 📧 **邮箱**: 2439646234@qq.com
- 🌐 **官网**: [https://hulaspark.com](https://hulaspark.com)

---

## 🎉 开始您的 HuLa 开发之旅

现在您已经掌握了 HuLa 项目的完整开发指南！快来加入我们，一起构建更好的即时通讯体验吧！

如果在开发过程中遇到任何问题，请不要犹豫地：
1. 📖 查阅此文档
2. 🔍 搜索现有 Issues
3. 💬 在社区群中提问
4. 🐛 创建新的 Issue

**祝您开发愉快！** 🚀✨
