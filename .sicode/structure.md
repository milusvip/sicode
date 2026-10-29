# 仓库地图

给 agent 用的"去哪改"索引。**只到包级**——文件树 `ls` 就有，抄下来只会过期；文件级的坑和链路写在 `notes.md`。

SiCode = opencode 的桌面端二开。内核（`ai` / `core` / `server` / `cli` / `tui`）保持上游原样，上游更新**不整体 merge，列清单按需摘取**（cherry-pick / 手工移植，流程见 `UPSTREAM.md`），分叉改动集中在 `desktop`、`gui-extensions`、`app` 的界面层和品牌资源。

## 分层（硬规则，见 AGENTS.md）

`schema` → `core` / `protocol` → `server` → `sdk`。`client` 的运行时只依赖 `schema` 和 `protocol`，**不依赖** `core` / `server`；`sdk` 才负责组合。

## 包职责

| 包 | 管什么 | 注意 |
| --- | --- | --- |
| `schema` | 共享 schema 与 branded ID（`SessionID`、`Model.ID`…） | 谁都能依赖；别放运行时逻辑 |
| `protocol` | HTTP / wire 协议、RPC 定义 | 改公开 API 后 `cd packages/client && bun run generate` |
| `core` | 会话、配置发现、文件系统、provider、工具调用引擎 | 上游文件：改一行加 `// SiCode:`，动手前先读 `UPSTREAM.md` |
| `ai` | 模型 / 图片客户端、流式、缓存策略 | 同上 |
| `server` | HTTP API 与后台服务 | |
| `client` | 生成的 effect 客户端 | **别手改**，改 `protocol` 后重新生成 |
| `sdk` | 对外 SDK，组合 client + core + server | |
| `cli` | 命令行入口 | |
| `tui` | 终端 UI | |
| `app` | Solid 渲染层：会话界面、设置、命令、路由 | 浏览器 / 终端等面板不在这一层，见 `gui-extensions` |
| `session-ui` | 会话时间线组件 + 设计源 `design/*.html` | 改视觉先对着 design 里的 html |
| `ui` | 设计系统组件（Button / Icon / Menu / Textarea…）、图标表 `icons/catalog.ts` | 手写图标加 catalog；`enter` 这类在生成的 `additional-icons.ts` |
| `theme` | 主题 token（只有 `src/tui`） | 应用侧的 `--v2-*` token 在 `ui/src/styles/tokens/theme.css`，**不在这个包** |
| `desktop` | Electron 主进程 / preload / 渲染壳：窗口、托盘、深链、sidecar、更新 | `src/main`、`src/preload`、`src/renderer`、`src/shared` |
| `gui-extensions` | 桌面和 web 的功能扩展：terminal / review / files / browser / ssh / wsl / updater | 只准用 `src/sdk`；lint 禁止 import `@opencode/app`、`@opencode/desktop` |
| `plugin-browser` | 浏览器插件：agent 侧工具 + 隧道（`tunnel.ts`） | 和 `gui-extensions/src/browser` 是一对：插件在 server 侧，pane 在 Electron 侧 |
| `plugin` / `plugins` | 插件 SDK / 官方插件 | |
| `identity` | 应用图标与 mark（`mark.svg`、`mark-192x192.png`、`mark-512x512-light.png`…） | 安装包和网页图标用；`logo-mark.png` 不在这，在 `ui/src/assets/brand/` |
| `util` | 通用工具（base64、binary、artifact、activity-calendar…） | |
| `latex` / `merman` | LaTeX 与 mermaid 渲染，markdown 用 | |
| `codemode` / `http-recorder` / `httpapi-codegen` / `effect-drizzle-sqlite` / `simulation` | 代码执行沙箱 / HTTP 录制回放 / API 代码生成 / Drizzle + SQLite / 模拟后端 | 各有 README |
| `web` / `posts` / `console` / `stats` / `storybook` / `containers` / `script` | 文档站 / 博客 / 云控制台 / 统计站 / 组件预览 / CI 镜像 / 构建脚本 | 与桌面端功能无关 |

## 常见需求去哪

| 要改… | 去… |
| --- | --- |
| 会话界面、时间线、输入框 | `app/src/session/`，时间线组件在 `session-ui/` |
| 侧边面板（浏览器、终端、审查、文件） | `gui-extensions/src/<name>/` |
| 桌面窗口、托盘、菜单、更新、`sicode://` 深链 | `desktop/src/main/`（品牌常量在 `constants.ts`） |
| 品牌、图标、安装包名 | `desktop/src/main/constants.ts`、`script/brand/`、`ui/src/icons/catalog.ts` |
| 模型、provider、工具调用 | `ai/` + `core/`（上游文件，改要加注释） |
| 公开 HTTP API | `protocol/` → `server/` → `client` 重新生成 |
| 设计系统组件 | `ui/src/<category>/`，CSS 同目录 |

## `.sicode` 自身的目录约定

这个目录除了下面两个工具链文件，其余全是 agent 工作产物，**必须按类型归入子目录，禁止堆在根目录**：

| 路径 | 放什么 |
| --- | --- |
| `notes.md` / `structure.md` | 工具链管理（本文件与笔记），固定路径，脚本依赖，勿动 |
| `demos/` | 写给人看的 HTML demo / 可视化对比页（会话侧边浏览器会打开的那种）。**自包含单文件**：CSS/JS 内联进 .html，不拆 .css/.js |
| `shots/` | CDP / 无头浏览器截图（`*.png` / `*.jpg`） |
| `scratch/` | 一次性测量与验证脚本（`*.mjs` / `*.sh`）及其输出（`*.json`） |

## 更新规则

包增删、职责变化时改这个文件。**文件级**的坑、链路、为什么这么改，写 `notes.md`，不要在这里展开。
