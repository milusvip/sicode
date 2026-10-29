# 方案 B：语法回灌（治「瞎试」）——已实现

> 状态：**已落地**（`packages/core/src/plugin/syntax-check.ts` + `packages/core/src/syntax-check/`）
> 本文档记录「为什么最终这么做」，包括被实测推翻的原方案。

## 问题

模型写完代码从不回头确认。改错了，要等下一轮自己想起来才检查——常常想不起来。

Cursor 的解法是**编辑器替它检查**：写代码 → 编辑器跑检查 → 诊断回灌 → 自动修。它不靠模型自觉，靠**管道**。

## 原方案被实测推翻：不是 tsgo，也不是只查 TS

原方案是「编辑后 spawn tsgo 检查 TS，把 error 塞进 `metadata.diagnostics`」。**实测数据把它否掉了。**

在本机 session 库（`~/.local/share/opencode/opencode-local.db`）里统计 687 次编辑器调用（edit/write/patch）：

| 扩展名 | 次数 | 占比 |
| --- | --- | --- |
| `.js` | 227 | 33.0% |
| `.cpp` | 193 | 28.1% |
| `.ps1` | 78 | 11.4% |
| `.md` | 42 | 6.1% |
| `.py` | 29 | 4.2% |
| `.sh` | 22 | 3.2% |
| `.html` | 19 | 2.8% |
| **`.ts` + `.tsx`** | **0** | **0.0%** |

**tsgo 方案命中率 0%，写出来永远不会触发。** 所以改为**按扩展名分发到已有检查器**。

另外 1746 次 shell 调用里 **0 次**是 typecheck 类命令、**0 次**结果含 `error TS`——模型从不主动跑类型检查。这反过来证明回灌确实填了一个空白。

## 关键发现：模型只看 `content`，不看 `metadata`

这是整个方案最关键的一处架构约束：

- `packages/core/src/session/runner/to-llm-message.ts:130`：`const content = tool.state.content`
- `toolResult()` 只用 `state.content` 构造 `ToolResultPart`

**只写 `metadata.diagnostics` 会让 UI 亮起来而模型依然瞎**——那恰好是本方案要解决的问题本身。所以**两边都写**：

- `content` 追加一段人类可读的错误摘要 → 给模型
- `metadata.diagnostics` → 给 UI（`tool-renderer.tsx` 早就准备好渲染了）

## 挂载点：一个插件，而不是改三个工具

`execute.after` 钩子的事件是**可变的**（`plugin/plan.ts:44` 已经在用 `event.error = ...`），且对每个工具都会触发。所以一个插件（~120 行）覆盖 `edit`/`write`，不用改三个工具文件、不会三份代码各自漂移。

注册位置在 `plugin/internal.ts` 的 `pre` 数组**末位**（`WriteTool.Plugin` 之后），保证它看到的是所有写入者产出的最终内容。

`patch` 显式排除：它一次写多个文件，`input` 里没有单一的 `path`，猜是错的。

## 检查器选择（每个决定都有实测依据）

| 类型 | 用什么 | 为什么 |
| --- | --- | --- |
| `.js/.jsx/.ts/.tsx/.mjs/.cjs/.mts/.cts` | `bun build --no-bundle` | 实测 ~270ms，**只报语法错**；缺失模块/缺失文件/css import/现代语法**零误报**。会误报模块解析的检查器比没有检查器更糟——模型会去「修」一个正确的文件 |
| `.py` | `python -c "ast.parse(...)"` | 不写 `__pycache__`（优于 `py_compile`） |
| `.sh/.bash` | `bash -n` | |
| `.ps1/.psm1/.psd1` | `tree-sitter-powershell` | 仓库已有依赖，**在进程内解析**，不用起 PowerShell 进程。实测对 here-string / class / 管道 / try-catch-finally **零误报** |
| `.json` | 进程内 `JSON.parse` | 不用 spawn |

**明确不覆盖 `.cpp`（占编辑 28%）**：本机无 `clang`/`gcc`/`cl`/`zig`，仓库也没有 tree-sitter-cpp 语法。**不假装覆盖**——留空比查错好。

**`node --check` 不作为 bun 的 fallback**：它把 TS 当 JS 解析，每个类型注解都会误报。没有 bun 的机器宁可不查。

## 门槛

- 最多 5 条（UI 只渲染 3 条，多留 2 条给模型）。
- 3 秒超时（约等于本机最慢检查器的 10 倍）；超时/工具自身失败 → 静默跳过，**绝不让检查拖住它所描述的那次编辑**。
- 解析不出诊断的非零退出 = 工具自己坏了，不是文件坏了 → 跳过。
- `OPENCODE_SYNTAX_CHECK=0` 关闭（默认开）。

## 测试

39 个测试，4 个文件：

- `test/syntax-check.test.ts` — 解析层，fixture 全部是**本机各工具的真实输出**（手写期望值会和真实格式漂移）
- `test/syntax-check-powershell.test.ts` — PowerShell 检查器，含 7 个「不该误报」的正面用例
- `test/plugin/syntax-check.test.ts` — 插件逻辑（跑真实服务层）
- `test/plugin/syntax-check-integration.test.ts` — **走 `Plugin.Service.activate` + 真实工具注册表**，即线上 `write` 的真实路径

> 第 4 个文件是有价值的：它第一次跑就抓到了「插件根本没激活成功」（`Service not found: @opencode/FSUtil`）。前三个文件全都通过，因为它们直接调钩子、绕过了激活。**单元测试证明逻辑对，集成测试证明它真的会被调用。**
