# 上游同步

SiCode 是 [sst/opencode](https://github.com/sst/opencode) 的桌面端分支。这份文档说明怎么跟进上游更新，以及改代码时该守什么纪律。

## 分支结构

| 分支 | 用途 |
| --- | --- |
| `main-sicode` | 默认工作分支。挂在上游历史上，可以 cherry-pick 上游提交 |
| `main` | 重建血缘前的旧历史（单根提交），仅作对照，不要在上面开发 |
| `backup/pre-rebase` | 重建血缘前的备份，勿删 |

- 上游 remote：`upstream` → `git@github.com:sst/opencode.git`，分支 `dev`
- 分叉起点：`76fd05ff45`（2026-10-22 14:33）。`main-sicode` 首个提交 `54b053cb` 的父提交就是它
- **当前同步基线：`450e7b9241`（2026-10-25）。** 分支后来重定到更新的上游基线上，`76fd05ff45..450e7b9241` 之间的 160 个提交已经是我们的祖先，**算增量必须用 `450e7b9241`**，用旧值会多算 160 条。真正的判据是 `git merge-base HEAD upstream/dev`，每次同步前跑一次，别照抄这里的哈希
- 分叉内容：相对基线改了 601 个文件 —— i18n 文案 258、图标 206、代码 137（内核仅 7 个）

## 同步策略：列清单，按需摘取

**不整体 merge `upstream/dev`。** 上游活跃度高、改动铺得深，整体跟进的冲突代价长期大于收益；本分支独立演进，落后不是问题。

现在的工作流：

### 1. 拉清单

```bash
git fetch upstream dev
MB=$(git merge-base HEAD upstream/dev)   # 当前同步基线，不要写死哈希
git log --oneline $MB..upstream/dev
```

把新提交按四类整理成一张清单，标注影响面：

| 类别 | 例子 | 影响面 |
| --- | --- | --- |
| 内核修复 | mcp client、session、ai 协议的 bugfix | 看是否命中我们也有的 bug |
| 新功能 | 新工具、新协议能力 | 用户要不要 |
| 桌面端 / UI | app、session-ui、desktop 改动 | 通常和我们的分叉文件重叠最大，最要慎选 |
| 文档 / CI / i18n | README、workflow、翻译 | 基本可以跳过 |

单个提交动了哪些文件：`git show --stat <sha>`。

### 2. 挑选

只挑真正需要的。判断标准：

- 修的是我们也存在的 bug（先在我们这边复现确认）
- 是用户想要的功能
- 不选的代价可接受（上游继续跑，我们的分支独立演进，落后不是问题）

### 3. 移植

- 提交没碰我们的分叉文件（i18n / 图标 / 桌面壳 / 我们加的 SiCode 功能）→ 直接 `git cherry-pick <sha>`
- 碰了 → 手工移植：看懂上游 diff，把等价改动落进我们这边，**保留 `// SiCode:` 注释**
- 涉及 `bun.lock` / 依赖变更的，移植完 `bun install --linker=hoisted` 重建
- 移植完跑 `bun run check` 和相关包的测试

## 冲突怎么解（cherry-pick / 手工移植时同样适用）

| 冲突文件 | 处理 |
| --- | --- |
| `README.md` | 保留我们的（品牌名） |
| `README.{lang}.md` | 保持删除，不要恢复上游版本 |
| `.opencode/skills/opencode-dev/SKILL.md` | 保持删除 |
| `packages/desktop/resources/linux/*.desktop` | 保持我们的（已改名为 `sicode-desktop.desktop`） |
| `bun.lock`、`nix/hashes.json`、`package.json`、`packages/*/package.json` | 取上游，再 `bun install` 重建 |
| `patches/*` | 上游删掉的补丁跟着删（说明已上游化），删完 `bun install` 验证 |
| 根 `AGENTS.md` | 上游内容照收，我们新增的 `## Web UI` 节追加在 `## Branch Names` 之前 |
| `packages/{ui,session-ui,app}/AGENTS.md` | `## Localization` 与 `## Design tokens` 两节以本仓为准（上游那三份已经漂移），其余照收上游 |
| `packages/*/src/**` 源码 | 逐个人工看，取上游结构、再补回我们的改动 |
| 其他 | 默认取上游 |

## 不维护的部分

根 `AGENTS.md` 里这几节是上游 TUI 与内核开发者的日常。本 fork 不改内核、不改 TUI，日常用不上，但**不要删** —— 删了每次同步上游内容都会冲突：

- `## Live TUI Testing`、`## TUI Stories`、`## TUI Theme Tokens`（共 12 条）
- `## Session Core`（11 条）

冲突时整段取上游，不做本地改写。

## 改代码的纪律

优先级从高到低，越靠上，以后同步越省事：

1. **新增文件 + 单点注册** —— 例如在 `packages/core/src/plugin/` 下加一个插件，在 `optimize.ts` 的数组里加一项
2. **改工具实现** —— 例如 `packages/core/src/tool/plugin/read.ts`，冲突是局部的、可识别
3. **改 session 主循环、协议降级层** —— `packages/core/src/session/**`、`packages/ai/src/protocols/**`，冲突面大且难分辨

另外两条：

- 所有本地改动加 `// SiCode:` 注释，同步时能机械识别哪些是我们的
- 改完用 `git diff $(git merge-base HEAD upstream/dev) -- <file>` 看一眼，确认改动范围小到能读懂

## 查看我们改了哪些内核文件

```bash
git diff --name-only $(git merge-base HEAD upstream/dev) main-sicode -- packages/core packages/ai
```

截至 2026-10-23 的清单：

- `core/src/config/discovery.ts` — 新增 `projectDirectories = [".sicode", ".opencode"]`，让 `.sicode/` 与 `.opencode/` 等价（配置、agent、command、skill、tool、plugin、theme 全套），`.sicode` 优先
- `core/src/mcp/client.ts` — 接受 output schema 不是根对象的 MCP 工具（上游 `c41c3a0d8b` 已修同样问题，需要时单独 cherry-pick）
- `core/src/pty/ticket.ts` — PTY 票据处理
- `core/test/mcp.test.ts`、`core/test/pty/ticket.test.ts`、`core/test/fixture/mcp-union-output-schema.ts`、`core/test/config/config.test.ts` — 对应测试

## 品牌常量

改名前先看这些，避免漏改：

- 应用名 `SiCode` / `SiCode Dev` / `SiCode Beta`；appId `com.sicode.desktop[.dev|.beta]`
- 深链注册 `sicode://`，同时兼容解析 `opencode://`（`desktop/src/main/constants.ts`）
- 安装包名 `sicode-desktop-${os}-${arch}.${ext}`；更新源 GitHub Releases（`milusvip/sicode`）
- 文案里保留 "OpenCode Zen / Go / Console" —— 那是上游托管服务名，不要替换
