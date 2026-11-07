# 长上下文「用得好」优化方案

> **For agentic workers:** 实现时用 `superpowers:subagent-driven-development` 或 `executing-plans` 按任务推进。步骤用 `- [ ]`。  
> 2026-11-04 · 对症：**记得住，但用不好**（Lost-in-the-Middle / 指令漂移 / 噪声幻觉 / 混来源 / 错误传播 / 延迟成本 / 位置偏差）。  
> 相邻方案（**不重复做**）：`flash-dual-track.md`（检索+记忆总序）· `cursor-parity-search.md`（找代码）· `memory-architecture.md`（跨会话事实）· `perf/latency-plan.md`（端点 TTFT；P3 少步数）。

---

## Goal

让长会话里的 Flash **少漏关键约束、少混来源、少空转轮次**，墙钟和 token 同步下降——不是把窗口再做大。

## Architecture（一句话）

**Working 摘要钉在尾部 + 工具噪声分级降级 + 关键约束结构化落库（非长 system）+ 闸门逼检索式动作。**  
硬能力优先；禁止靠加长 `deepseek.txt` / 系统提示「提醒模型注意中间」。

## Tech stack

- `packages/core/src/session/`：history-degrade、compaction、context inject、runner gates  
- 既有模式：`SessionDecisionFreeze` / `SessionTopicSwitch` / `browser-drive-hint`（request-only synthetic + metadata）  
- 验收：本机 DB 会话回放 + `sicode stats --latency` + Flash golden 轨迹（不回退）

## Spec 锚点（已证事实，方案必须服从）

1. 本地调度开销 ≈ 0；墙钟大头是 **端点 TTFT + 轮次数**（每多一步 ≈ 5–8s）。  
2. 工具输出常占上下文 ~70%；历史 reasoning 回放曾放大 prefill（已停回放旧思考）。  
3. 高缓存命中下「盲目压 context」收益弱；有界窗口 + 少步数 > 无限堆窗口。  
4. Flash 对软提示常无视 → **结构闸门 / 工具收窄 / 写入拒绝** 才算优化。  
5. 记忆轨与代码检索分库（见 memory / cursor-parity）；本方案只管 **单会话 working context 质量**。

## Global constraints

- 不改动上游 owned 文件除非带 `// SiCode:` 注释。  
- 不新增与现有 Flash 元规则互搏的长段落。  
- 热路径禁止同步云 embed / 全库重排。  
- `OPENCODE_*` kill switch 每个新闸门都要有。  
- 改 degrade / inject 必须带纯函数单测；改 runner 接线补 fingerprint 测。

## Review focus（测试容易漏、线上会咬人的）

1. 压缩后 prefix cache 被整段打掉（tools.definitions / system 同步变）。  
2. degrade 过狠 → 模型重跑整工具（历史已踩：read 21 次）。  
3. 尾部 working 摘要与 compaction 摘要语义打架。  
4. 来源标签进 prompt 后模型当指令执行（必须标 untrusted）。  
5. gate 误伤「合法长读文档」类任务（explore 已用 spinning/locating 区分，新闸同标准）。

---

## 不做清单（写进方案才叫「真」）

| 诱惑 | 为什么否决 |
| --- | --- |
| 再加长 system / deepseek.txt 讲「请注意中间」 | Flash 稀释更严重；违双轨原则 |
| 默认把 context 窗口拉到 200k+ | 固定税 + 噪声↑；已测过有界更好 |
| 每轮全历史向量重排进窗口 | 热路径延迟与缓存粉碎 |
| 自动切端点「谁快用谁」 | 打碎前缀缓存；越权改用户选择（latency-plan P1） |
| 把记忆库当代码检索 | 边界已定，见 memory-architecture |

---

## 问题 → 杠杆映射

| # | 症状 | 真杠杆（本方案） | 已有、只维护不重做 |
| --- | --- | --- | --- |
| 1 | Lost in the Middle | **P1 Working pin**（本回合事实钉尾） | compaction ceiling |
| 2 | 指令漂移 | **P2 Constraint ledger**（结构化约束 + 写入拒绝扩展） | decision-freeze、browser/planning gates |
| 3 | 噪声 / 幻觉 | **P0 Tool-noise tiers**（按工具分级 degrade） | history-degrade、不回放旧 reasoning |
| 4 | 混来源 | **P3 Provenance tags**（工具/文件结果带来源头） | — |
| 5 | 错误传播 | **P4 Checkpoint nudge**（多步后强制「已证实 vs 假设」） | step limit、explore hard、continue-intent |
| 6 | 成本延迟 | **P5 Batch-or-stop 强化**（少步；与 latency P3 合流） | stats --latency、batch-pace |
| 7 | 位置 / 格式 | P0–P3 自然形成「头=system 尾=pin」；不另开项目 | inject 插在最新 user 后 |

---

## 落地次序（错峰）

```text
P0  Tool-noise tiers          ← 最快可测，直接砍中间噪声
P1  Working pin               ← 尾部钉住本回合决策/路径/目标
P2  Constraint ledger         ← 冻结类约束可扩展，不靠长提示
P5  Batch-or-stop（可与 P0 并行）← 少步 = 少 TTFT 税
P3  Provenance tags           ← 降混来源；prompt 增量要控预算
P4  Checkpoint nudge          ← 防错误传播；最后做，防误伤
```

验收总闸：**同一类长会话回放**（选 2 个本机长会话 ID）对比  
- 步数 / queueP50 / 工具输出注入字符数  
- 「约束被违反」次数（freeze 拒绝、gate 触发后仍 0 工具）  
- Flash golden 不回退  

---

## File map

| 文件 | 职责 |
| --- | --- |
| `packages/core/src/session/history-degrade.ts` | P0：分级降级策略 |
| `packages/core/src/session/working-pin.ts`（新） | P1：从尾部消息折叠 pin 文本 |
| `packages/core/src/session/context.ts` | P1/P3/P4：inject 接线 |
| `packages/core/src/session/decision-freeze.ts` (+ 扩展或旁路 ledger) | P2 |
| `packages/core/src/tool/plugin/{read,grep,shell,edit}.ts` 或统一 output 包装 | P3 来源头（优先在 degrade/to-llm 层包，少改每个工具） |
| `packages/core/src/session/runner/{batch-pace,steer,llm}.ts` | P5 |
| `packages/core/src/session/checkpoint-hint.ts`（新） | P4 |
| `packages/core/test/*.test.ts` | 各 P 纯函数测 |
| `.sicode/scratch/long-context-baseline.mjs`（新，可选） | 回放基线脚本 |

---

## P0 — Tool-noise tiers（噪声）

**Goal:** 中间历史的工具结果按「可引用价值」分级砍，而不是一刀切 25+15。

### 分级（初值，可调）

| Tier | 工具 | 旧消息策略 |
| --- | --- | --- |
| A 保留结构 | `edit`/`patch`/`write` 成功摘要、`todowrite` | 尽量保留；超长才头尾 |
| B 可再取 | `read`/`grep`/`glob` | 现 degrade；省略文案**禁止**「再跑整工具」，只引导 offset/limit 或更窄 pattern（已部分做） |
| C 高噪声 | `shell` 成功长输出、`browser.snapshot` 大树 | 更狠：HEAD 15 + TAIL 10 或只留 exit/命令行；browser 只留 focused 区摘要指针 |
| D 丢弃正文 | 已失败且已有 failure-streak 覆盖的重复失败输出 | 一行 status + error 首行 |

### Tasks

- [x] **T0.1** 单测：shell vs edit 同长、browser_snapshot、error 一行（`session-history-degrade.test.ts`）。  
- [x] **T0.2** `tierFor` + PRESERVE/REOPEN/NOISY + error 折叠。  
- [ ] **T0.3** 用本机一会话回放：注入模型的工具字符数下降 ≥30%，且 edit 摘要完整。  
- [ ] **T0.4** Commit：`perf(core): tiered history degrade for tool noise`

**成功标准：** 回放注入字符↓；无「整文件重读爆炸」回归（现有 read 相关测仍绿）。

---

## P1 — Working pin（Lost in the Middle + 位置）

**Goal:** 每轮请求在最新 user 后注入 ≤1.5k 字符的 `<working-pin>`：本回合目标、冻结路径、已确认文件/URL、未决问题。来源是折叠 transcript，不是新模型调用。

### 规则

- 只在 `turnStart`（尚无 assistant）注入，与 browser-drive-hint 同插槽，**pin 在前、专项 hint 在后**。  
- 字段：`goal`（最近 user 截断）、`frozen[]`（decision-freeze）、`anchors[]`（最近成功 edit/read 路径 ≤5）、`open[]`（clarify 未决，可空）。  
- `OPENCODE_WORKING_PIN=0` 关闭。  
- **禁止**把整段工具输出拷进 pin。

### Tasks

- [x] **T1.1** `working-pin.ts` + `working-pin.test.ts`。  
- [x] **T1.2** `context.ts` 最外层 `SessionWorkingPin.inject`（钉在最新 user 后）。  
- [ ] **T1.3** 人工 3 个「中间埋了别动 X」的会话：开启 pin 后不应再改 X（可配合 freeze）。  
- [ ] **T1.4** Commit：`feat(core): working-pin inject for long turns`

**成功标准：** 约束类回归「改了不该改的文件」次数下降；pin 本身 <1500 chars。

---

## P2 — Constraint ledger（指令漂移）

**Goal:** 把「别动 / 只改 Y / 不要开新浏览器」一类约束从散文提示升级为 **metadata + 工具边界**（扩展 decision-freeze 模式，不新造意图引擎）。

### 范围（闭集，宁缺毋滥）

1. 路径冻结（已有）  
2. **范围锁定**：用户点名文件/目录后，`edit`/`write`/`patch` 拒绝锁外路径（需显式「也可以改 Z」解锁）——仅当本回合有 `@` 附件或明确路径列表时启用，避免误伤探索。  
3. 浏览器已挂接：已有 browser-drive；本项只保证 pin/ledger 里出现 `browser: attached` 状态位，不重复造 gate。

### Tasks

- [x] **T2.1** `constraint-ledger.ts` + `sicode.constraintLedger`；单测 fold/blocked。  
- [x] **T2.2** edit/write/patch 读 ledger；文案含「也可以改」。  
- [x] **T2.3** working-pin 展示 `scope:`；context 合并 freeze+scope 一次 metadata 发布。  
- [ ] **T2.4** Commit：`feat(core): constraint ledger for scoped edits`

**成功标准：** 「成品别动」类会话 0 次越权写入；无附件纯聊天不被误锁。

---

## P5 — Batch-or-stop（成本 / 延迟）（与 P0 可并行）

**Goal:** 降低「一步一工具」比例，直接少付 TTFT 税。

### 已有

`batch-pace.ts`、explore-budget、planning-gate。缺口见 notes：write-to-scratch 曾打断 streak（已修一轮）；仍要盯 Flash 单工具步占比。

### Tasks

- [x] **T5.1** 基线：`sicode stats` + 脚本统计最近 N 会话「每步工具数」分布。  
- [x] **T5.2** `SERIAL_SINGLE_STEPS` 2→1；单工具 look 后下一步即 batch 收窄。  
- [x] **T5.3** system/tool description **各一行**「独立 read/grep 同步并行」，不新增长节。  
- [ ] **T5.4** Commit：`perf(core): tighten batch-pace for single-tool streaks`

**成功标准：** 同任务步数 p50 ↓≥15%，或单工具步占比 ↓≥10pt；latency stepP50 不升。

---

## P3 — Provenance tags（混来源）

**Goal:** 进入模型的工具/文件块带稳定来源头，降低 A/B 张冠李戴。

### 设计

在 `to-llm-message` 或 degrade 输出外包一层（示例）：

```text
<source kind="tool" name="read" path="packages/app/...">
...
</source>
```

- 标 **untrusted data**（browser 已有口径，对齐）。  
- 预算：只对 **最近 RECENT_MESSAGES** 打满标签；更旧的 degraded 块一行 `source` 摘要即可。

### Tasks

- [x] **T3.1** 单测：两条 read 不同 path，序列化后模型可见路径均在标签上。  
- [x] **T3.2** 实现包装；量一次平均增量 token，超 5% 则只标 path 行不包全文。  
- [ ] **T3.3** Commit：`feat(core): provenance wrappers on tool results`

**成功标准：** 混文件结论类人工抽查改善；增量 token <5% 或已降级为摘要标签。

---

## P4 — Checkpoint nudge（错误传播）

**Goal:** 长回合每 K 个 assistant 步（建议 K=6），若仍无最终答、且工具在转，注入一次短 synthetic：列出「已证实 / 假设 / 下一步只选一个」。**只 nudge 一次 per fingerprint**，可忽略；`OPENCODE_CHECKPOINT=0` 关。

### Tasks

- [x] **T4.1** `checkpoint-hint.ts` + 测：第 6 步触发，第 7 步不重复。  
- [x] **T4.2** 接 `llm.ts` Completed，优先级低于 step-limit / explore-hard-stop，高于 final-answer。  
- [ ] **T4.3** 回放：空转会话更早出现「收束」行为或被其他 hard gate 接住。  
- [ ] **T4.4** Commit：`feat(core): checkpoint nudge on long tool turns`

**成功标准：** 超长空转墙钟↓；短任务（<6 步）零触发。

---

## 度量面板（每 P 合并前填）

| 指标 | 如何取 |
| --- | --- |
| 步数 / 单工具步占比 | DB `session_message` 或 stats |
| queueP50 / stepP50 | `sicode stats --latency` |
| 注入工具字符数 | scratch 回放脚本 |
| freeze/ledger 拒绝次数 | 日志或测 |
| gate 触发次数 | synthetic metadata.notice |

基线会话：选 2 个用户侧「又长又吵」的 `ses_*`，脚本进 `.sicode/scratch/`，**不进 git**。

---

## 与双轨方案的关系

```text
本方案 = 单会话 working 质量（窗口里怎么摆、怎么砍、怎么钉）
检索轨 = 少空转找代码（cursor-parity）
记忆轨 = 跨会话少重复问（memory-architecture）
延迟轨 = 端点可见 + 少步（latency-plan P3 ≈ 本方案 P5）
```

合并冲突时优先级：**少步与降噪（P0/P5）> pin/ledger（P1/P2）> 标签与 checkpoint（P3/P4）**。

---

## 建议执行方式

1. 先开 **P0 + P5** 一个 PR（可测、用户体感：更快更干净）。  
2. 再开 **P1 + P2**（「别改我定过的」类投诉对症）。  
3. **P3/P4** 单独 PR，带 kill switch，灰度看 Flash golden。

若只做一个：**做 P0**。噪声不砍，pin 和 ledger 都会被中间垃圾淹死。
