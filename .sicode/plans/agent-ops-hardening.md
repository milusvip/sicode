# Agent 真问题硬化（机制优先）

> **For agentic workers:** 用 `superpowers:subagent-driven-development` 或本会话按 Task 推进。步骤用 `- [ ]`。  
> 2026-11-07 · 对症：参数/空结果/截断/约束漂移/翻车不可回归——**不是模型不够聪明**。  
> 相邻方案（**不重复做**）：`cursor-parity-search.md` · `long-context-use.md` · `harness-slim`（notes）· `flash-dual-track.md`。

---

## Goal

把日常 Agent 可用性从「Demo 能跑」拉到「翻车可测、约束可过压缩、截断不可装全量」——**只靠数据契约与纯函数折叠，不再叠硬编码提示词 / soft harness / 手填同义词表。**

## Architecture（一句话）

**契约进工具结果与会话 metadata → 压缩/收工只读契约 → golden 回放锁死；禁止新 OPENCODE_* soft nudge、禁止加长 system、禁止手扩 concepts 当主路径。**

## Tech stack

- `packages/core/src/tool-output.ts` / `tool/plugin/grep.ts` / `read-filesystem.ts`
- `packages/core/src/session/compaction.ts` + 新纯函数 `session/user-constraints.ts`（或并入 working-pin 旁）
- `packages/core/test/flash-golden.test.ts` + 新 `test/fixtures/session-replay/`
- 既有：`search-miss`、`completion-gate`、`working-pin`、`topic-switch`（**只复用，不加软文案闸**）

## Spec 锚点（必须服从）

1. `harness-slim` 已定调：体感变笨主因是 soft harness 肥胖 + 砸前缀缓存；soft 默认关。  
2. Flash 扛不住长 system（元规则 ~4–5 条饱和）；引导优先工具 description / 结构化结果，不进 `system.txt`。  
3. 概念表手填已踩假映射坑（emit/validate）；**本方案禁止再加 BEHAVIOR 行当「优化」**。  
4. 真问题清单里相对 Cursor 仍弱的四刀：**检索诚实、压缩保约束、截断诚实、翻车回放**——其余 21 项已强或非主战场，本方案不做。

## Global constraints（硬纪律）

| 禁令 | 原因 |
| --- | --- |
| 新增默认开启的 soft steer / nudge 文案 | 已证明稀释 + 可无视；与 harness-slim 对撞 |
| 加长 `system.txt` / provider txt「请注意空结果/截断/约束」 | Flash 稀释；违双轨 |
| 手写扩 `concepts.ts` / `BEHAVIOR` 表当主修复 | 假映射历史；不可维护 |
| 新 `OPENCODE_*` 默认=开的行为开关 | 开关税；优先无开关的数据契约 |
| 再造 completion 式「再想一步」软闸解决截断 | 信号糊；用结果契约代替 |
| 把记忆库 / persona 当代码检索 | 边界已定 |

**允许的机制形态（白名单）：**

- 工具 `metadata` + `content` 模板改写（模型每次必读工具结果）  
- 用户消息 → 结构化 metadata 折叠（纯函数，单测）  
- compaction 摘要 **schema 槽位**合并（Requirements 从 metadata 灌入，不靠模型自觉抄）  
- 无模型 golden / session-replay 单测  
- 已有硬闸（searchCap / stepLimit / completion-gate）的**接线修正**，不加新 soft

## Review focus（线上会咬、单测易漏）

1. 截断契约过狠 → 模型反复 read 同一文件烧步数（必须：同 path+同 offset 不重复逼）。  
2. 约束提取误伤普通叙述（「不要太长」≠ 生产禁令）→ 只抽显式边界句。  
3. Requirements 灌入后砸跨回合 prompt cache（约束块必须稳定排序 / 增量差分）。  
4. replay 夹具绑死模型文案 → 只断言工具序列与 metadata 契约。  
5. grep 空结果契约与 search-miss 硬停双重打扰 → 契约改 content，不新开 soft。

---

## 不做清单（写进方案才叫真）

| 诱惑 | 否决 |
| --- | --- |
| 「空结果时再 nudge 一句」 | search-miss 已有；再叠 = 硬编码 |
| 「压缩前提醒模型保留不要操作生产库」 | 进 prompt = 必丢；要进 metadata |
| 再加 20 条中英同义词 | 手表债；用 golden 驱动**已有** expand，缺测再补测不补表 |
| 用户模糊时默认 clarify 闸 | harness-slim 已关；编码 Agent 偏干 |
| temperature / seed 产品化 | 非编码主战场 |
| 提示词 SaaS 版本面 | git 即可 |

---

## 文件职责图

| 文件 | 职责 |
| --- | --- |
| `session/user-constraints.ts`（新） | 从 user 文本纯函数抽出 `ConstraintFact[]`；无 I/O |
| `session/context.ts` / prompt 投影 | 把 facts 写入最新 user（或 session）metadata；compact 可读 |
| `session/compaction.ts` | buildPrompt 时把 **已抽取 facts** 填进 Requirements，不靠摘要模型从散文里「想起」 |
| `tool-output.ts` + grep/read render | 统一 `Evidence` 契约：`complete \| truncated \| empty` |
| `test/fixtures/session-replay/*.json` | 翻车会话精简轨迹（工具名/入参/metadata，无长正文） |
| `test/session-replay-contract.test.ts`（新） | 对夹具跑纯函数断言 |

---

## Track A — 检索诚实（对应痛点 4，部分 5）

### 设计

不教模型「空结果要换词」。把工具结果做成**不可装成命中**的形状：

```ts
type SearchEvidence =
  | { kind: "hits"; count: number; truncated: boolean; spill?: string }
  | { kind: "empty"; patterns: string[]; hint: "wrong_token" }  // hint 是枚举，不是散文规则堆
  | { kind: "timed_out"; partial: number }
```

- `toModelContent` **第一行**固定机器头：`[search empty | patterns=…]` / `[search truncated | showing N of M | file=…]`  
- 正文可以短；头不可省略。  
- **不**新增 search-miss soft 文案；既有 hard stop 保留。  
- **不**扩 concepts；Track D 的 golden 若失败，只允许：(1) 修排序/失效 bug，或 (2) 单测证明某 expand 行有仓库文件实证后再改表（PR 必须附 probe 输出）。

### Task A1: Evidence 头契约

**Files:**  
- Modify: `packages/core/src/tool/plugin/grep.ts`（render）  
- Modify: `packages/core/src/tool/plugin/glob.ts`（若有空结果路径）  
- Test: `packages/core/test/tool-search.test.ts`

- [x] **Step 1:** 失败测：空 hits 的 content 必须以 `[search empty` 开头；truncated 必须以 `[search truncated` 开头。  
- [x] **Step 2:** 实现 render 前缀；零散文「请换词」。（落地于 smart-no-spin 刀3 / grep+glob）  
- [ ] **Step 3:** `bun test test/tool-search.test.ts` 全绿（抽测 evidence/empty 已绿；整文件按需再跑）。

### Task A2: 与 search-miss 去重

**Files:** `search-miss.ts` 注释 + 测：empty 头已存在时 soft 文案不得重复解释同一事实（若 soft 仍可通过 env 打开）。

- [ ] 断言：默认 slim 下仅 content 头变化；无新 steer。

---

## Track B — 压缩保约束（对应痛点 7、8）

### 设计

约束**先结构化再压缩**，摘要模型只合并槽位，不负责「发现」禁令。

```ts
// user-constraints.ts — 纯函数
export type ConstraintFact = {
  readonly id: string          // 稳定 hash(text)
  readonly kind: "forbid" | "require" | "scope"
  readonly text: string        // 原句截断
  readonly sourceMessageID: string
}

export function extractConstraints(text: string, sourceMessageID: string): ConstraintFact[]
export function mergeConstraints(prev: readonly ConstraintFact[], next: readonly ConstraintFact[]): ConstraintFact[]
```

**抽取规则（机制，不是 prompt）：** 只匹配显式边界句，例如：

- 禁止/不要/别/严禁 + 动词短语  
- 只许/仅/只能 + 范围  
- 英文 `do not` / `don't` / `only` + 短宾语  

误伤控制：句长上限、排除「不要太…」程度副词套话（白名单否定）。**禁止**再写一大段「模型请遵守」。

落点：

1. 每次 user prompt 投影：`metadata.sicode.constraints = merge(prev, extract(latest))`  
2. `working-pin` 可多一行 `constraints:`（短列表）——复用尾部钉，**不新开 soft steer**  
3. `compaction.buildPrompt`：Requirements 段 **预填**当前 constraints 列表，并写明「保留下列条目，删改须与用户新消息对账」；摘要输出后用 `mergeConstraints` 校验，丢失 → 测失败（单元测模拟，不跑真 LLM）

### Task B1: extract + merge 纯函数

**Files:**  
- Create: `packages/core/src/session/user-constraints.ts`  
- Create: `packages/core/test/user-constraints.test.ts`

- [ ] 测：`不要操作生产库` → forbid；`只看 A 类` → scope；`不要太长` → 不抽取。  
- [ ] 测：merge 去重稳定 id；新用户句可 clear 同 kind（显式「不限 / 取消」类，复用 constraint-ledger 已有 CLEAR 口径若仍适用）。

### Task B2: 写入 metadata + pin

**Files:** `context.ts` 或 prompt 投影路径；`working-pin.ts`  
- [ ] 测：fold 后 pin 含 constraints 行；`OPENCODE_WORKING_PIN=0` 时仍保留 metadata（压缩要用）。

### Task B3: compaction Requirements 预填

**Files:** `compaction.ts`（`// SiCode:`）  
- Test: `packages/core/test/session-compaction-constraints.test.ts`（纯函数：给定 facts + buildPrompt 片段，断言 Requirements 含原句）

- [ ] **禁止**为「丢约束」加 runner steer。

---

## Track C — 截断诚实（对应痛点 5、19）

### 设计

1. **工具侧**：所有经 `ToolOutput.truncate` 的结果统一：

   - `metadata.evidence = "truncated"`  
   - content 首行 `[output truncated | lines=… | file=…]`  
   - **删除或降级**诱导「run it again」的全文重跑措辞（history-degrade 已改过方向，对齐为 offset/limit）

2. **用户消息侧**（若存在窗限裁切）：裁切处必须产生可见 synthetic notice + UI；**禁止静默**。若当前无服务端裁用户消息，本 Task 先加「探测：是否存在静默裁」笔记结论，有则修、无则只锁工具侧。

3. **不做**「截断后禁止收工」硬闸（易误伤）——诚实头足够；Track D 回放锁「截断后直接下结论」的坏轨迹若仍出现，再议**单点**硬信号。

### Task C1: ToolOutput 统一头

**Files:** `tool-output.ts`；测 `tool-output.test.ts`  
- [ ] 任意超预算截断 → content 匹配 `/^\[output truncated/`；metadata.truncated === true。

### Task C2: grep/read 与全局头一致

**Files:** grep render、read-filesystem  
- [ ] 字符 cap spill 与 ToolOutput 头同形，避免两种方言。

### Task C3: 用户输入静默裁切审计

**Files:** 调研 `packages/app` composer / `packages/core` prompt 边界  
- [ ] 产出 notes 一条：有/无静默裁；若有，最小补丁 = notice，不加 prompt 规则。

---

## Track D — 翻车回放集（对应痛点 25，锁 A–C）

### 设计

不测「模型聪不聪明」。夹具只保留：

```json
{
  "id": "ses_e4e536-shape",
  "turns": [
    { "user": "…", "tools": [{ "name": "grep", "input": {}, "metadata": { "evidence": "empty" } }] }
  ],
  "expect": {
    "afterCompactRequirements": ["不要…"],
    "grepEmptyContentPrefix": "[search empty",
    "noSoftSteerNames": ["narrate", "clarify"]
  }
}
```

从真实翻车会话**手工精简**（e4e536 / e58cab / e74d20 类），进 `test/fixtures/session-replay/`。  
断言只打 **纯函数 / 契约**（extract、render 头、completion fingerprint 形状），不打 LLM。

### Task D1: 夹具格式 + 加载器

**Files:**  
- Create: `packages/core/test/fixtures/session-replay/README.md`（三行：如何从 db 精简）  
- Create: 至少 2 个 json 夹具  
- Create: `packages/core/test/session-replay-contract.test.ts`

- [ ] 测：夹具 empty grep → render 头；夹具 forbid 句 → extract 命中；夹具 open-todo idle → completion-gate 仍 refuse（复用现有 detect 函数）。

### Task D2: CI 入口

**Files:** `packages/core/package.json` 或既有 test 脚本无需改则 skip  
- [ ] `bun test test/session-replay-contract.test.ts test/user-constraints.test.ts test/tool-search.test.ts` 一条命令可跑。

---

## 实施顺序

```
A1 → C1 → C2 → B1 → B2 → B3 → A2 → D1 → D2 → C3
```

先出「模型必读的结果头」，再出「压缩可读的约束槽」，最后用回放锁住。全程 **零新 soft harness**。

## 成功标准（可测）

1. 空 grep / 截断输出：单测锁 content 前缀；人工会话里模型若仍瞎编，属模型问题，**不**用再加 nudge 掩盖。  
2. 含「不要操作生产库」的会话经 compact 纯函数路径后 Requirements 仍含该句。  
3. `session-replay-contract` ≥2 夹具稳定绿；新增翻车只加夹具不加提示词。  
4. `bun test` 上述文件全绿；`packages/core` typecheck 绿。  
5. diff 审查清单：无新增默认开 soft；无 system.txt 段落；无无 probe 的 concepts 行。

## 与 Cursor

- Cursor 强在检索体感与换题成本；本方案 **不抄** 其闭源索引，只把「空/截断/约束」做成 SiCode 可测契约。  
- Cursor 少 soft harness；本方案与其对齐的是 **少提示词、多结构**，不是再堆闸门。

---

## Self-review

| Spec 项 | Task |
| --- | --- |
| 空结果诚实 | A1 |
| 截断诚实 | C1–C2 |
| 压缩保约束 | B1–B3 |
| 禁止叠硬编码 | Global constraints + 成功标准 5 |
| 回放回归 | D1–D2 |
| 用户静默裁 | C3 |

比例：机制说明 > 代码正文；实现体由测试断言锁定。
