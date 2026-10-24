# 上游同步

SiCode 是 [sst/opencode](https://github.com/sst/opencode) 的桌面端分支。这份文档说明怎么把上游更新合进来，以及改代码时该守什么纪律。

## 分支结构

| 分支 | 用途 |
| --- | --- |
| `main-sicode` | 默认工作分支。挂在上游历史上，可以直接 merge 上游 |
| `main` | 重建血缘前的旧历史（单根提交），仅作对照，不要在上面开发 |
| `backup/pre-rebase` | 重建血缘前的备份，勿删 |

- 上游 remote：`upstream` → `git@github.com:sst/opencode.git`，分支 `dev`
- 分叉基线：`76fd05ff45`（2026-10-22 14:33）。`main-sicode` 首个提交 `54b053cb` 的父提交就是它
- 分叉内容：相对基线改了 601 个文件 —— i18n 文案 258、图标 206、代码 137（内核仅 7 个）

## 同步上游

```bash
git fetch upstream dev
git merge upstream/dev
bun install          # 上游常改 bun.lock，合完必须重装
bun run check
```

不想动工作树、只想先看会撞多少冲突：

```bash
git merge-tree --write-tree --name-only main-sicode upstream/dev
```

第一次合并后的实测：42 个冲突，22 个是 `README.*.md`，其余是 `bun.lock`、`nix/hashes.json`、desktop 打包配置和 `patches/*`，**没有核心源码冲突**。

## 要不要直接合并

判据不是「改了多少」，是「我们的改动和上游的改动碰不碰面」。跑一次预演就知道：

```bash
git merge-tree --write-tree main-sicode upstream/dev 2>&1 | grep -c "^CONFLICT"
```

2026-10-25 实测：我方改动 716 个文件，上游自基线起 728 个，**重叠只有 82 个（11%）**，直接合并预演 **32 个冲突**，其中 **3 个需要看代码**。原因是我们只动品牌、i18n、图标和桌面端，上游动内核，两边铺在不同文件上，git 能自动合掉 88%。

所以默认动作是 `git merge upstream/dev`，不是按需抄。按需抄的代价：上游的修复收不到（例如 `core/src/mcp/client.ts` 的 MCP output schema 问题上游已修，merge 后本地补丁自动消解，cherry-pick 则要一直背着），而且差距会随时间放大。

**但「能合」不等于「合完就推」。** 80% 的风险在没报冲突的地方：两边都改、git 静默合掉的文件。2026-10-25 实测 50 个静默合并文件里有 42 个源码，其中 21 个是本仓真实改动，内核占 3 个。合完必须验：

```bash
bun run check
cd packages/core && bun test
git diff 76fd05ff45 upstream/dev -- packages/core/src/mcp/client.ts
```

最后一条最重要：看上游这次想怎么改，再判断本地补丁还要不要。**别让两份修复并存**——能编译、能跑、但多一层冗余逻辑，以后没人敢删。

嫌在主分支上试合不可逆，就先在旁路跑一遍：

```bash
git worktree add ../sicode-merge-check main-sicode
cd ../sicode-merge-check && git merge upstream/dev
# 解冲突、跑 check 和测试；通过后回主分支做同样的 merge
git worktree remove ../sicode-merge-check
```

## 冲突怎么解

| 冲突文件 | 处理 |
| --- | --- |
| `README.md` | 保留我们的（品牌名） |
| `README.{lang}.md`（22 个多语言） | 保持删除，不要恢复上游版本 |
| `.opencode/skills/opencode-dev/SKILL.md` | 保持删除 |
| `packages/desktop/resources/linux/*.desktop` | 保持我们的（已改名为 `sicode-desktop.desktop`） |
| `bun.lock`、`nix/hashes.json`、`package.json`、`packages/*/package.json` | 取上游，再 `bun install` 重建 |
| `patches/*` | 上游删掉的补丁跟着删（说明已上游化），删完 `bun install` 验证 |
| 根 `AGENTS.md` | 上游内容照收，我们新增的 `## Web UI` 节追加在 `## Branch Names` 之前 |
| `packages/{ui,session-ui,app}/AGENTS.md` | `## Localization` 与 `## Design tokens` 两节以本仓为准（上游那三份是复制粘贴出来的，已经漂移），其余照收上游 |
| `packages/*/src/**` 源码 | 逐个人工看，默认取上游，再补回我们的改动 |
| 其他 | 默认取上游 |

## 不维护的部分

根 `AGENTS.md` 里这几节是上游 TUI 与内核开发者的日常。本 fork 不改内核、不改 TUI，日常用不上，但**不要删** —— 删了每次 merge 都冲突：

- `## Live TUI Testing`、`## TUI Stories`、`## TUI Theme Tokens`（共 12 条）
- `## Session Core`（11 条）

冲突时整段取上游，不做本地改写。

## 改代码的纪律

优先级从高到低，越靠上，以后 merge 越省事：

1. **新增文件 + 单点注册** —— 例如在 `packages/core/src/plugin/` 下加一个插件，在 `optimize.ts` 的数组里加一项
2. **改工具实现** —— 例如 `packages/core/src/tool/plugin/read.ts`，冲突是局部的、可识别
3. **改 session 主循环、协议降级层** —— `packages/core/src/session/**`、`packages/ai/src/protocols/**`，冲突面大且难分辨

另外两条：

- 所有本地改动加 `// SiCode:` 注释，merge 时能机械识别哪些是我们的
- 改完用 `git diff 76fd05ff45 -- <file>` 看一眼，确认改动范围小到能读懂

## 查看我们改了哪些内核文件

```bash
git diff --name-only 76fd05ff45 main-sicode -- packages/core packages/ai
```

截至 2026-10-23 的清单：

- `core/src/config/discovery.ts` — 新增 `projectDirectories = [".sicode", ".opencode"]`，让 `.sicode/` 与 `.opencode/` 等价（配置、agent、command、skill、tool、plugin、theme 全套），`.sicode` 优先
- `core/src/mcp/client.ts` — 接受 output schema 不是根对象的 MCP 工具（上游 `c41c3a0d8b` 已修同样问题，合并后自动消解）
- `core/src/pty/ticket.ts` — PTY 票据处理
- `core/test/mcp.test.ts`、`core/test/pty/ticket.test.ts`、`core/test/fixture/mcp-union-output-schema.ts`、`core/test/config/config.test.ts` — 对应测试

## 品牌常量

改名前先看这些，避免漏改：

- 应用名 `SiCode` / `SiCode Dev` / `SiCode Beta`；appId `com.sicode.desktop[.dev|.beta]`
- 深链注册 `sicode://`，同时兼容解析 `opencode://`（`desktop/src/main/constants.ts`）
- 安装包名 `sicode-desktop-${os}-${arch}.${ext}`；更新源 GitHub Releases（`milusvip/sicode`）
- 文案里保留 "OpenCode Zen / Go / Console" —— 那是上游托管服务名，不要替换
