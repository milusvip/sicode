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

## 冲突怎么解

| 冲突文件 | 处理 |
| --- | --- |
| `README.*.md` | 保留我们的（品牌名） |
| `bun.lock`、`nix/hashes.json`、`patches/*` | 取上游，再 `bun install` 重建 |
| `packages/desktop/electron-builder.config.*`、`resources/linux/*.desktop` | 保留我们的（appId、安装包名、可执行文件名） |
| `packages/*/src/**` 源码 | 逐个人工看，默认取上游，再补回我们的改动 |
| 其他 | 默认取上游 |

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
