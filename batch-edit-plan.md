# 方案：让批量修改成为 agent 的默认路径

状态：设计文档，未实施。
问题来源：agent 面对「已知要改 8 个地方」的 md 计划时，仍然逐条 `edit`、每改一处就停下来跑检查，而不是一次发完全部编辑、只在末尾检查一次。

---

## 1. 先说清楚哪些不是问题

harness 本身已经支持批量落地，这一层不需要改：

| 事实 | 位置 |
| --- | --- |
| 一条消息里的多个 tool-call 各自 `forkScoped`，最后统一 `Fiber.awaitAll` | `packages/core/src/session/runner/step.ts:122-134`、`:151` |
| 同一文件的多次 `edit` 串行安全：锁键是解析后的绝对路径，模块级锁表跨 Location 共享 | `packages/core/src/file-mutation.ts:60`、`:71-74` |
| 不同文件的 `edit` 互不阻塞：按排序后的路径逐个加锁 | 同上 `:72-74` |
| `SystemPrompt` 已经写了「编辑点确定后，所有编辑放在一条消息里，检查放在整批之后」 | `packages/core/src/session/runner/prompt/system.txt:20-31` |

所以「一条消息发 8 个 edit」不是冒险行为，是官方支持的形态。问题在于 **agent 不愿意这么做**，不在 harness 能不能。

## 2. 四个候选动因，逐个判定

| # | 动因 | 现状 | 是否缺口 |
| --- | --- | --- | --- |
| 1 | 修改点还没定，按 md 直接改就是在猜 | prompt 已要求「证据足够时才批量」 | **不是缺口**，这是正确行为 |
| 2 | 批量 `edit` 失败是部分成功，回滚边界不清楚 | `edit` 每次独立读→匹配→写，前面成功的不回退 | **是缺口，但 `patch` 已解决** |
| 3 | 用 `patch` 批量改，改完没有任何语法反馈 | `SyntaxCheckPlugin` 只认 `edit` / `write` | **是缺口** |
| 4 | `patch` 语法门槛高（要写 `@@` 上下文锚点），写偏就整体失败 | 无缓解 | **是缺口，只能部分缓解** |

动因 2 的关键证据：

- `packages/core/src/tool/plugin/edit.ts:268-297`：每个 edit 自己 `findOccurrences` → 替换 → 写盘。0 匹配或多匹配都会 `ToolFailure`，但**同批次里更早的 edit 已经落盘**，没有跨调用事务。
- `packages/core/src/tool/plugin/patch.ts:109-212`：所有 hunk 先解析成 `Prepared` 并完成预校验，`:219` 才请求权限，`:233` 才开始逐文件写。解析失败、目标不存在、同一文件重复写入，都在**任何写盘之前**失败。

也就是说：`patch` 天然具备「要么全改成、要么一个没改」的语义，`edit` 没有。模型为了拿到清晰的回滚边界而选逐条 `edit`，这个动机是合理的。

动因 3 的关键证据：

- `packages/core/src/plugin/syntax-check.ts:31`：`WRITERS = new Set(["edit", "write"])`
- 同文件 `:94-99`：`writtenPath()` 只读 `input.path`
- `packages/core/src/tool/plugin/patch.ts:21-25`：`patch` 的输入只有 `patchText`，没有 `path`

结论：**唯一具备批量原子性的工具，恰好也是唯一没有即时语法反馈的工具。** 这会持续把模型推回逐条 `edit`。

补充一条容易被忽略的成本事实，它决定了改动的形状：
`packages/core/src/syntax-check/runner.ts:108-118` 为**每个文件 spawn 一个子进程**（`bun build --no-bundle` / `python -c` / `clang++ -fsyntax-only`），单次 timeout 3 秒；`Effect.forEach` 默认顺序执行。一次 patch 改 10 个 ts 文件，就是顺序 10 次子进程。

## 3. 改动 A：描述层（零代码风险，建议先做）

模型不知道 `patch` 的原子性优势，也不知道 `patch` 已经被推荐，`packages/core/src/tool/patch.txt:34-35` 只写了「prefer one patch」，**没给理由**。

### A1 `packages/core/src/tool/patch.txt`

在第 34-35 行的现有规则后补一句理由，而不是加新段落：

```
- When the same change spans several files whose contents you already know, prefer one patch with
  all file sections over a tool call per file — apply the whole change at once and check afterwards.
  A patch validates every hunk before writing any file, so a bad hunk leaves the tree untouched;
  a batch of separate edits can leave half of them applied.
```

### A2 `packages/core/src/session/runner/prompt/system.txt:28`

在 batching 段的 `- When edit points are settled, ...` 之后加一条，把 patch 作为批量路径的默认建议：

```
- If several settled edits touch files whose contents you already know, one `patch` call carries
  them all and applies them atomically; use separate `edit` calls when you need each match verified
  against the file on its own.
```

### 成本与风险

- 每次请求多约 200 token（system prompt 每轮都发）。要克制：只加这两处，不新开章节。
- `patch.txt` 属于工具描述，只在模型名单里包含 patch 时下发，成本可控。
- 无行为变化，不需要测试。

### 预期效果

模型开始在「已知内容的多文件修改」上选 `patch`。这一条本身就可能解决大半问题，因为它同时提高了动因 2 的覆盖率并降低了逐条 `edit` 的吸引力。

## 4. 改动 B：给 `patch` 补语法诊断（中等成本，取决于 A 的观察结果）

### 目标

`patch` 结果里携带它所写文件的语法诊断，与 `edit` 的体验对齐。**这不是提速，是补齐短板**：如果模型已经愿意并行发 `edit`，这个缺口就不存在。

### 实现

`packages/core/src/plugin/syntax-check.ts`，把 `execute.after` 分支从「按 `input.path` 单文件」扩展为两条路径：

```ts
const files = writtenFiles(event.tool, event.input, event.result)
if (files.length === 0) return
const outcomes = yield* Effect.forEach(
  files,
  (relative) => SyntaxCheckRunner.run({ ... }).pipe(Effect.map((outcome) => ({ relative, outcome }))),
  { concurrency: CHECK_CONCURRENCY, discard: false },
)
const failed = outcomes.filter((item) => item.outcome.status === "errors")
if (failed.length === 0) return
// 合并成一段 describe，metadata.diagnostics 按文件键合并
```

三个必须带的防护，缺一个就会在 Windows 上拖出几十秒：

| 防护 | 值 | 理由 |
| --- | --- | --- |
| 文件数上限 | 10 | 超过就跳过并明说「其余 N 个未检查」，不要静默截断 |
| 并发 | 4 | `runner.ts` 每文件一个子进程，顺序执行会线性叠加 |
| 跳过删除文件 | `status === "deleted"` | `FileDiff.Info.status` 有三个值，见 `packages/schema/src/file-diff.ts:6-12` |

多文件诊断的合并格式要与现有单文件 `describe` 保持一致（`syntax-check.ts:102-109` 的「N syntax errors in <file>:」加行号列表），否则编辑器卡片和模型看到的会分叉。`metadata.diagnostics` 已经是「以路径为键」的形状（`:112-118`），多文件直接合并即可。

### 需要确认的实现细节

1. **`event.result.metadata` 的类型**：`patch` 返回 `{ files, applied }`（`patch.ts:302`），插件读 `metadata.files` 要处理 `undefined`（工具失败时没有 metadata）。
2. **格式化后的内容**：`patch` 在写盘之后跑 formatter（`patch.ts:278-296`），诊断读的是磁盘上的最终内容，顺序是对的，不要改成读内存文本。
3. **诊断与 `edit` 路径不能两套形状**：`writtenPath()` 现在的入参是 `unknown`，扩展时应保留「不认识的工具返回空数组」的语义，不要引入新的分支类型。

### 成本与风险

| 风险 | 量级 | 处理 |
| --- | --- | --- |
| 大 patch 拖慢工具返回 | 10 文件 × ~0.3s，并发 4 约 1s | 上限 10 + 并发 4 |
| Windows 上 `bun build` 冷启动更贵 | 可能到 0.5-1s/文件 | 同上；仍低于一次模型往返（数秒） |
| 诊断淹没正文 | 每文件最多 5 条，已有 `MAX_REPORTED` 上限 | 多文件时按文件分段 |
| 检查器误报导致模型「修」正确的文件 | 现有设计已规避（`runner.ts:25-30` 只做纯语法） | 保持只报语法错，不引入类型检查 |

### 验收

1. 单元测试：构造一个 `patch` 结果，`metadata.files` 含 3 个 `modified` + 1 个 `deleted`，其中 1 个文件有语法错 → 结果正文只出现该文件的诊断，`deleted` 文件不被检查。
2. 单元测试：`metadata.files` 超过上限 → 检查被跳过，正文明确说明未检查数量。
3. 回归：`edit` / `write` 的单文件路径行为不变。
4. 手工：一次 `patch` 改 3 个 ts 文件、其中 1 个故意留语法错，确认工具结果里直接带出该文件的错误行。
5. 从 `packages/core` 跑 `bun typecheck`。

## 5. 明确不做

- **让 `edit` 变成跨调用事务**：多个 `edit` 之间没有共享状态，`step.ts` 每个调用独立 fork，做不了；要做就是重写工具执行模型，收益不足以支撑。
- **只保留 `patch`、删掉 `edit`**：`patch.ts:319-333` 的注释已经说明，按模型家族切换编辑工具会让工具面漂移、破坏 prompt cache。三个工具都留着，选择权交给模型。
- **在 system prompt 里再加一段「请批量」**：`system.txt:20-31` 已经写了，重复只会增加每轮 token 而不改变行为。要改的是**理由**（`patch` 原子性），不是重复结论。

## 6. 执行顺序

1. **先做 A**（约 30 分钟，纯文本，无测试）。观察若干个会话里 `patch` 与 `edit` 的使用比例，以及「改一处跑一次」是否减少。
2. **再看 B**。如果 A 之后批量 `patch` 已经出现，但失败排查仍靠逐条 `edit`，说明诊断缺口是剩下的瓶颈，做 B；如果 A 无效，说明真正的原因是动因 1（修改点没定）或动因 4（patch 难写），那 B 白做。

判断依据要落在实际会话上，不要因为「B 看起来更完整」就先做 B。
