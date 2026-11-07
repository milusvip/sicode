# 跨会话记忆：最好方案（质量上限）

> 2026-10-31 · 目标：**质量上限**，不是最快落地。  
> 范围：会话/项目/人的**记忆**（facts、偏好、决策、时效断言），**不是**代码库语义索引（那条见 `cursor-parity-search.md`）。  
> 合序与 Flash 双轨：`flash-dual-track.md`。
> 现状锚点：`packages/core/src/session/project-memory.ts` + `recall` 工具（KV 事实袋、路径命中打分、无向量、无时序、无图）。

---

## 0. 一句话

**时序事实图 + 多信号混合检索（BM25 ∥ 本地向量 HNSW ∥ 实体/图 ∥ 时间窗）+ 后台巩固（合并/作废/矛盾）+ 热路径毫秒本地读。**

对标合成：**Letta**（分层与可解释）× **Graphiti**（时序事实）× **Hindsight**（多路并行 + RRF/rerank）× 本地持久化与内存 HNSW。

**明确不做终局：** 只接 Mem0 / 只有向量 top-k / 只有 FTS / 每轮同步云 embed / 把代码库再 embed 一层当记忆。

---

## 1. 为什么「最好」不是 Mem0，也不是「FTS 就够了」

| 维度 | 最快落地 | 次优常见 | **最好** |
| --- | --- | --- | --- |
| 存什么 | 聊天切片 / 向量块 | 无时效的 bullet 事实 | **原子命题** + episode 出处 + `valid_at` / `invalid_at` |
| 冲突 | 堆 ADD | 去重键覆盖 | **巩固**：合并、作废、矛盾检测、重要性衰减 |
| 检索 | 云向量 or 纯 FTS | 单路打分 | **并行多路** dense + sparse + 图 hop + 时间过滤 → 融合 |
| 对模型 | 黑盒塞 top-k | 工具 `recall` | **有预算的被动注入 + 主动工具**（search / reason / remember） |
| 延迟 | 热路径出网 | 热路径纯本地但召回弱 | **读本地毫秒**；embed/巩固全部后台 |
| 可解释 | 无 | 弱 | 每条标注命中哪一路、为何入选 |

Mem0 = 产品捷径与生态；Honcho = 对人建模产品化最好用；  
**质量上限** = 上表「最好」列。SiCode 演进应以该列为终态，现有 `project-memory` 是可迁移的事实袋雏形，不是终态。

---

## 2. 与相邻能力的边界

| 能力 | 职责 | 本方案是否覆盖 |
| --- | --- | --- |
| **Codebase retrieval** | 在仓库里定位符号/文件/概念 | **否**（见 `cursor-parity-search.md`；trigram/BM25F/agentic） |
| **Session compaction** | 单会话上下文预算 | 输入源之一；不替代记忆层 |
| **Working context** | 当前打开文件、未决目标 | **Working 层**，TTL，默认不进向量 |
| **Project / persona memory** | 跨会话仍为真的事实与偏好 | **是，本方案核心** |
| **History 工具** | 读归档原文 | 保留为 episodic 深挖；不与 semantic 混库 |

原则：**代码检索与记忆检索分库分索引。** 记忆库不存源码块；代码索引不存「用户偏好 / 决策」。

---

## 3. 目标架构

```text
┌──────────────────────────────────────────────────────────────┐
│ Working memory（会话内，热，TTL）                               │
│ 当前目标 / 打开文件 / 未决决策 —— 默认不持久、不进向量            │
├──────────────────────────────────────────────────────────────┤
│ Episodic（回合 / 压缩摘要 / 原文指针）                           │
│ session_id · project_id · time · 可选摘要块                     │
├──────────────────────────────────────────────────────────────┤
│ Semantic / Belief（巩固后的事实）                               │
│ 原子命题 · 实体边 · 有效期 · 重要性 · 出处 · 矛盾链              │
└──────────────────────────────────────────────────────────────┘
         │ 写入（异步）                         │ 读取（同步热路径）
         ▼                                      ▼
  LLM 抽取 → 巩固队列                    FTS5/BM25  ∥  本地向量 HNSW
  矛盾检测 / 失效旧事实                   ∥ 实体图 1～2 hop  ∥ 时间窗
         │                                      │
         └──────── RRF / 加性融合 + 可选 rerank ──→ top-k（带 provenance）
```

### 3.1 延迟契约

| 路径 | SLA 目标 | 允许 |
| --- | --- | --- |
| 热路径召回（注入 / `memory.search`） | **P95 ≤ 5–20ms 本地**（不含主模型） | 内存索引；禁止同步云 API |
| Embed / 巩固 / 矛盾推理 | 后台，秒～分钟级可接受 | 出网或本地模型均可 |
| 首轮「等人建模完再答」 | **禁止** 作为默认产品行为 | Honcho 式阻塞不属于本方案 |

### 3.2 对模型的接口形态

1. **被动注入（有预算）**  
   每轮在系统/会话前缀注入短事实列表（路径 + 一句命题 + 有效期提示），token 硬顶（建议起步 400–800 tokens）。
2. **主动工具**  
   - `memory.search`：多路检索，返回带 provenance 的事实  
   - `memory.remember`：显式写入候选（进巩固队列，非立刻当真理）  
   - `memory.reason`（可选）：对一小团实体做局部推理/矛盾说明  
3. **现有 `recall`**  
   过渡期保留；终态并入 `memory.search` 或成为其别名。

---

## 4. 数据模型（schema 草案）

### 4.1 作用域

```text
Scope
  workspace_id?     // 将来 placement；省略 = 隐式本地
  project_key       // 现有 project-memory 的 directory / 稳定项目键
  persona_id?       // 可选：跨项目的人设/偏好命名空间
  session_id?       // episodic 绑定；belief 可跨 session
```

### 4.2 Episode（情景）

```text
Episode
  id
  scope
  kind: "compaction" | "user_turn" | "tool_trace" | "manual"
  created_at
  text?             // 摘要或片段；大原文可只存指针
  source_ref?       // transcript / message id
```

### 4.3 Belief / Fact（语义事实）— 终态核心

相对现有 `Fact { kind, text, paths, misses, seen }` 扩展：

```text
Belief
  id
  scope
  kind: "decision" | "file" | "context" | "preference" | "assertion"
  proposition       // 原子命题（短句）；不再把进度写进来
  paths[]           // 关联路径（可空）；保留 verify 机械失效
  entities[]        // 规范化实体 id 或表面名
  valid_at          // 起效时间
  invalid_at?       // 作废时间；null = 仍有效
  importance        // 0..1 或有序档；衰减与保留策略用
  confidence        // 抽取置信；巩固可调整
  misses            // 路径校验连续失败（继承现状）
  seen_at           // 最近确认
  superseded_by?    // 指向替代 belief
  contradicts[]     // 未解消的矛盾边
  provenance[]      // episode_id + span / quote
```

**禁止进 Belief：** Work State、Next Move、一次性进度（与现 `parseSummary` 纪律一致）。

### 4.4 Entity + Edge（轻量图）

```text
Entity
  id
  scope
  name
  type: "file" | "symbol" | "person" | "project" | "concept" | "other"
  aliases[]

Edge
  id
  from_entity / to_entity
  rel: "mentions" | "depends" | "decided" | "prefers" | "located_in" | ...
  belief_id?        // 边由哪条事实支撑
  valid_at / invalid_at?
```

图不必一上来做成完整 Graphiti；**最小可用 = 实体表 + 1～2 hop 邻接**，巩固阶段再加关系类型。

### 4.5 索引视图（派生，可重建）

| 索引 | 内容 | 用途 |
| --- | --- | --- |
| FTS5 / BM25 | `proposition` + `paths` + 实体名 | 词法主召回 |
| 向量 HNSW | `proposition`（及可选短 provenance）embedding | 释义/跨语言 |
| 时间倒排 | `valid_at` / `invalid_at` | 「当时为真」 |
| 实体邻接 | edge 表 | 图扩展召回 |

向量维与模型版本写入 meta；换模型则后台全量重嵌，热路径不阻塞。

---

## 5. 写入路径（异步巩固）

```text
触发源
  ├─ session.compaction.ended（现有 project-memory 钩子）
  ├─ 显式 memory.remember
  ├─（可选）高置信用户偏好语句检测
  └─ 定时 / 空闲 dream 任务

步骤
  1. Extract     从摘要/候选抽 Belief 草案（可先规则+小节，后上 LLM）
  2. Normalize   实体对齐、路径规范化、去进度污染
  3. Merge       同命题确认 → 刷新 seen / confidence
  4. Supersede   新事实否定旧事实 → 设 invalid_at + superseded_by
  5. Contradict  无法自动判定 → 记 contradicts，检索时降权或并列展示
  6. Index       写 FTS + 入队 embed → 更新 HNSW
  7. Cap         按 importance × recency 裁剪；继承 MAX 量级但按 scope 分桶
```

**同步热路径禁止跑 1–5。** 现有 `merge` / `verify` / `misses` 是巩固里的机械子集，应保留并升格。

---

## 6. 读取路径（混合检索）

```text
Query q（用户本轮话 / 工具 query）
  │
  ├─① BM25/FTS5(q)           → 候选 A
  ├─② HNSW(embed(q))         → 候选 B   // embed 可缓存；查询向量可本地小模型
  ├─③ Entity link(q) → 1–2 hop → 候选 C
  └─④ Time filter            → 丢掉 invalid_at < now（或按 as_of）
  │
  ├─ Fuse: RRF(A,B,C) 或 加权加性（词法权重大于纯向量，尤其路径/专名）
  ├─（可选）cross-encoder rerank top 50 → top k
  └─ Budget: 截断到 token 预算；附 provenance 一行
```

### 6.1 融合建议（起步）

- 路径精确 / 符号命中：强加分（继承现 `search` 的 +3 思路）  
- BM25 与向量：RRF，`k=60` 级默认  
- 已 `invalid_at`：默认剔除；`as_of` 查询保留历史窗  
- `contradicts` 未消：并列返回并标注，禁止静默只留一条  

### 6.2 中文与跨语言

记忆命题建议**存储规范化优先**（决策可中英并存，检索双侧建索引或概念扩展）。  
可与现有 `search-ranked/concepts` 思路对齐：查询侧 CN→EN 扩展进 BM25，向量腿吃释义差。  
**不要**用「只 embed 中文原文」赌跨语言。

---

## 7. 存储与部署形态

### 7.1 推荐终态（本机优先）

| 组件 | 选择 | 理由 |
| --- | --- | --- |
| 主存 | SQLite（单项目）或 Postgres（多租户/重图） | 与 SiCode 本地优先一致；FTS5 成熟 |
| 向量 | 进程内 HNSW（或 usearch 级）+ 磁盘可重建快照 | 热查询毫秒；免每问出网 |
| Embed | 本地小模型 **或** 后台批处理云 API | 写入侧；版本钉死 |
| 图 | 同库表（实体/边）起步；必要时再拆 | 避免过早上专用图库 |

### 7.2 明确拒绝的默认

- 热路径依赖 Mem0 Cloud / 任意远程 memory SaaS  
- 每用户问题同步等待远程 embed  
- 用代码 embedding 索引冒充 project memory  

第三方 Mem0/Honcho/Hindsight **可作为对照实现或可选后端**，但产品默认契约必须是「本地可读、可解释、可巩固」。

---

## 8. API 契约（对内）

命名示意；落地时挂 `packages/core` Session/Location 作用域，遵守 Schema → Core 方向。

```ts
// 写入：admit only；巩固异步
Memory.admit(input: {
  scope: Scope
  source: "compaction" | "remember" | "import"
  episode?: EpisodeDraft
  candidates?: BeliefDraft[]
}): Effect<AdmitReceipt>

// 检索：热路径
Memory.search(input: {
  scope: Scope
  query: string
  limit?: number
  asOf?: number          // 默认 now
  budgetTokens?: number
}): Effect<SearchHit[]>

// SearchHit: belief + score + channels["bm25"|"vector"|"graph"] + provenance

Memory.verifyPaths(scope, exists): Effect<VerifyReport>  // 升格现有 verify

// 工具面（对模型）
// memory.search / memory.remember  （recall 过渡别名）
```

事件建议（durable 保持克制）：

- `memory.admitted` — 入队事实  
- `memory.consolidated` — 巩固批次完成（可投影刷新读模型）  
不把每次 HNSW 更新打成业务事件。

---

## 9. 从现有 `project-memory` 的迁移路径（仍朝最好，不朝最省）

| 阶段 | 交付 | 仍坚持的最好原则 |
| --- | --- | --- |
| **M0 契约** | 定 Belief schema、scope、禁止进度入记忆；文档与测试钉死 | 不引入 SaaS 热路径 |
| **M1 存储升格** | KV 事实袋 → 正式表/文档（SQLite）；保留 `kind/paths/misses/seen` | 可重建索引 |
| **M2 词法主召回** | FTS5/BM25 替换「路径 +3 / 正文 +1」；`recall` 走新 search | 词法是一等公民 |
| **M3 时序** | `valid_at` / `invalid_at` / `superseded_by`；巩固合并 | 事实可演化 |
| **M4 向量腿** | ✅ `feat-hash-v1` + `memory_vector` 缓存 + RRF；本地 ONNX/MiniLM 已撤回（成本不划算）；`OPENCODE_MEMORY_VECTOR=0` | 查询不出网 |
| **M5 实体图** | ✅ 内存邻接 + 持久 `memory_entity`/`memory_edge`（replace 重建）；词法种子 1-hop + RRF；`OPENCODE_MEMORY_GRAPH=0` | 可解释扩展 |
| **M6 工具与注入** | ✅ 被动注入 + `remember` 写入 + `recall` 搜 project/persona（冲突可见）；窄义 Fact-only recall 已升格 | 双通道 |
| **巩固机械** | ✅ prose 同题决策自动 `linkContradicts`；`verifyBeliefs` 路径 miss→invalidate；未上异步 LLM 巩固 | 热路径可跑 |

**禁止的「假捷径」：** M0 直接接 Mem0 当终态；跳过 M2 只上向量；把 codebase embed 塞进同一索引。

每阶段可独立验证：召回集 fixture（中英查询、路径查询、过期事实、矛盾对）。

---

## 10. 质量验收（比「能不能搜到」更严）

1. **时效正确**：作废事实默认不再注入；`as_of` 能还原历史信念。  
2. **冲突可见**：矛盾对不会被静默单选。  
3. **路径纪律**：文件类事实继续 `verify`；无路径散文不因「猜不到文件」被删。  
4. **跨语言**：中文意图能打到英文命题/路径（词法扩展 ∪ 向量）。  
5. **延迟**：热路径 P95 本地毫秒级；巩固失败不阻塞会话。  
6. **可解释**：每条命中可回答「哪路召回、哪条 episode」。  
7. **边界**：记忆 top-k **不含**源码块；代码定位失败不归咎记忆层。

建议固定一套 golden queries（从真实会话抽），每次改检索/巩固跑回归；与 `context-hints` 的 baseline 方法论同构。

---

## 11. 社区参照（调研结论摘要）

| 系统 | 适合学什么 | 不适合当什么 |
| --- | --- | --- |
| **Letta** | 分层、agent 可管记忆、可解释 | 原样嵌入 SiCode 运行时 |
| **Graphiti** | 时序事实、失效与演进 | 唯一存储（过重可裁） |
| **Hindsight** | 多路并行检索、RRF、巩固叙事 | 必须照搬其栈 |
| **Mem0** | 抽取 ADD 流水线、生态 | **质量终态 / 默认热路径** |
| **Honcho** | 对人建模产品体验 | 阻塞式首轮、云默认 |
| **Cortex 类本地 RAG** | 毫秒 HNSW 工程经验 | 单独当记忆 OS |

---

## 12. 非目标

- 替代 codebase Instant Grep / BM25F / Explore  
- 云端「永久记忆」同步为默认  
- 用更大 embedding 模型换正确性（优先巩固与多信号）  
- 一次 PR 吞下 M0–M6  

---

## 13. 已拍板（2026-10-31）

用户明确：**要「越用越懂项目/偏好」**，且 **DeepSeek（Flash）着重优化**。与 `cursor-parity-search.md` 双轨并行，合序见 `flash-dual-track.md`。

| 项 | 决定 | 理由 |
| --- | --- | --- |
| 作用域 | **`project_key` + `persona_id`** | 项目事实与跨项目偏好分开；「越用越懂」两边都要 |
| 主存 | **单机 SQLite 默认**；Postgres 仅预留接口不挡路 | 与 SiCode 本地优先一致 |
| Embed | **M4 再上**；默认不挡 M0–M3；上则优先后台批处理或可选本地小模型 | Flash 主收益在 FTS/注入/巩固，不在先下模型 |
| 被动注入 | **默认开，硬 token 预算** | Flash 常不主动 `recall`；只靠工具 = 记忆等于没做 |
| 对外同步 | **SiCode 内闭环**；暂不做 DSH/Cursor 共享契约 | 先把本机质量做满 |
| 验收模型 | **golden / 回归默认 deepseek-flash 轨迹** | 与检索方案同一原则 |

### 13.1 Flash 落地姿势（记忆侧，与检索同构）

```text
硬能力（表结构、FTS、时效、预算注入、空结果回退）
  > 工具 description 短纪律（memory.search / remember）
  > deepseek.txt 极短补丁（不新增长篇元规则）
  > 连败/该召回未召回 → 框架短注入（后手）
```

禁止：指望 Flash 自己记得调 `recall`；禁止记忆热路径出网等 embed。

---

## 14. 结论

**最好方案**是把记忆做成**带生命周期的信念系统**，用**多信号检索**读、用**后台巩固**写，热路径保持**本地毫秒**；**被动注入对 Flash 为必选项**。  
现有 `project-memory` 是正确方向上的最小事实袋；演进应沿 **M0→M6** 升格，而不是换成第三方记忆 SDK。

下一步：按 `flash-dual-track.md` 与检索错峰落地；记忆轨先拆 **M0–M2 + 预算注入** 的实现切片（DDL、API、Flash golden）。
`)