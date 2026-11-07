# DeepSeek Flash 双轨：检索 + 记忆

> 2026-10-31 · 用户定调：**代码定位要像 Cursor 现款**，且要 **越用越懂项目/偏好**；两轨都以 **DeepSeek Flash 为验收与优化重心**。  
> 详案：`cursor-parity-search.md`（检索）· `memory-architecture.md`（记忆）。

---

## 0. 一句话

**检索让 Flash 少空转找代码；记忆让 Flash 少重复问偏好/决策。**  
两边都是「硬能力优先、短纪律、连败注入」，不靠给 Flash 加长 system。

---

## 1. 为什么必须双轨

| 痛 | 只做检索 | 只做记忆 |
| --- | --- | --- |
| 猜中文词 / 搜空转 | ✅ 对症 | ❌ |
| 换会话忘决策、不懂偏好 | ❌ | ✅ 对症 |
| Flash 不主动调工具 | 要 multi-pattern / 注入 / 连败 | 要 **被动注入**，不能只靠 `recall` |

「越用越懂」= 记忆轨；「像 Cursor 找得到」= 检索轨。都要。

---

## 2. Flash 共同原则（两轨强制）

1. **硬能力 > 提示词**（multi-pattern、FTS、时效、限幅、预算注入）  
2. **工具 description 短纪律 > 加长 `deepseek.txt`**  
3. **元规则预算**：不新增与现有 4 条互搏的长规则  
4. **Golden 默认用 Flash 轨迹**录基线、做回归  
5. **热路径本地毫秒**；embed/巩固后台，不堵首轮  

---

## 3. 推荐落地次序（错峰，不互相堵）

```text
阶段 A（先体感，检索为主）
  检索 P0  multi-pattern + 短扩词纪律 + 连败注入
  检索 P1  索引失效 + 空候选回退
  记忆 M0  Belief/scope 契约（project + persona）钉死
  记忆 M1  KV → SQLite 表（可迁移现有事实）

阶段 B（懂项目/偏好开始可见）
  记忆 M2  FTS/BM25 召回替换字面 +3/+1
  记忆 注入  每轮有预算被动注入（Flash 关键）
  检索 P2–P3  分字段排序 + 洪水治理

阶段 C（形态对齐 + 记忆质量上限）
  检索 P4  Explore 子任务
  记忆 M3  时序 valid/invalid / supersede
  记忆 M4+ 向量腿与图（可再拍板节奏）
```

**并行规则：** A 里检索 P0/P1 与记忆 M0/M1 可两人/两 PR 并行；B 里记忆注入与检索 P2 可并行；合并以「Flash golden 不回退」为准。

---

## 4. 做完你得到什么（合并体感）

| | 检索轨 | 记忆轨 |
| --- | --- | --- |
| 短期 | 少猜词、少搜错、少灌噪声 | 表与契约就位，旧事实可迁 |
| 中期 | 候选更准、轮次下降 | **每轮带上项目/偏好要点**（不用等 Flash 想起 recall） |
| 后期 | Explore 隔离探查 | 决策可作废、越用越干净，而非越堆越脏 |

---

## 5. 明确不做（避免偏航）

- 用全仓代码 RAG 冒充「越用越懂」  
- 记忆与代码索引混库  
- 主路径接 Mem0 Cloud / 同步等 embed  
- 只加长 deepseek 提示、不改工具与注入  

---

## 6. 工程默认（2026-10-31 开工锁定）

1. **grep `patterns[]`：** 做（工具 Input；不强制动 Protocol 生成，除非共享 schema 需要）  
2. **索引：** commit 世代 + dirty/指纹重嵌；**空候选必须回退全量 rg**  
3. **Explore：** **不进阶段 A**；A/B 之后（阶段 C / P4）  

记忆侧拍板见 `memory-architecture.md` §13。阶段 A 交付：检索 P0–P1 + 记忆 M0–M1。

### 阶段 A 落地状态（2026-10-31）

| 项 | 状态 | 要点 |
| --- | --- | --- |
| 检索 P0 multi-pattern | ✅ | `grep.patterns[]`，上限 8；工具描述引导 Flash 一批同义词 |
| 检索 P0 连败注入 | ✅ | `search-miss.ts` → `selectSteer` / `llm.runStep` |
| 检索 P1 空候选回退 | ✅ | `usablePrefilter`：`[]` 等同 null，全量 rg |
| 检索 P1 commit 世代 | ✅ | trigram meta `commit` = `git rev-parse HEAD` |
| 记忆 M0 Belief | ✅ | `session/memory/belief.ts`（project + persona scope） |
| 记忆 M1 SQLite | ✅ | `memory_belief` 表 + KV→表迁移；双写 KV 过渡 |
| 验证 | ✅ | `bun typecheck`；tool-search / grep-patterns / search-miss / steer / memory-belief 全绿 |

### 阶段 B 落地状态（2026-10-31）

| 项 | 状态 | 要点 |
| --- | --- | --- |
| 记忆 M2 BM25F 召回 | ✅ | `session/memory/search.ts`；path > entity > proposition；CN→EN expand；`recall` 已改走此路 |
| 记忆被动注入 | ✅ | `project-memory-inject` 插件；`CHAR_BUDGET=2400` / max 8；`OPENCODE_MEMORY_INJECT=0` 可关 |
| 检索 P2 分字段 | ✅ | 沿用 SearchRanked BM25F；concepts 补记忆相关中文短语 |
| 检索 P3 洪水 | ✅ | grep 工具描述强制 files_with_matches/count 先于 content |
| 验证 | ✅ | typecheck 干净；memory-search / inject / belief / search-ranked 全绿 |

### 阶段 C 落地状态（2026-10-31）

| 项 | 状态 | 要点 |
| --- | --- | --- |
| 记忆 M3 时序 | ✅ | `invalidate` / `supersede`；同 kind+共享 path 的新事实自动作废旧事实 |
| 检索 P4 Explore | ✅ | 已有 explore 子代理；PROMPT 补 patterns 批搜 + 洪水纪律（对齐 Flash） |
| 记忆 M4 向量腿 | ✅ | 本地 `feat-hash-v1` embed + 暴力余弦（≤200）+ RRF 与 BM25 融合；`OPENCODE_MEMORY_VECTOR=0` 可关；无出网 |

### 收口补丁（2026-10-31）

| 项 | 状态 | 要点 |
| --- | --- | --- |
| Persona 被动注入 | ✅ | `PERSONA_PROJECT_KEY=""`；`loadForInject` + 默认 persona `local`（`OPENCODE_PERSONA=0` 关） |
| 注入按问句相关 | ✅ | `render({ query })`：项目信念 BM25 对齐最新用户句；persona 预留 `PERSONA_RESERVE=2` |
| Persona 写入 | ✅ | `preference.ts`：用户「记住/偏好」→ prompt hook；compaction `## Requirements` → `recordPersona` |
| Flash golden（硬能力） | ✅ | `packages/core/test/flash-golden.test.ts`：概念扩词 / patterns / 空候选回退 / search-miss / 注入+BM25 |
| Flash golden（会话轨迹） | ✅ | `flash-trajectory.ts` + `test/fixtures/flash-trajectory-baseline.json`（ses_e6d429…）；median≤5 / p90≤8 / expectHit≥0.8；重录：`.sicode/scratch/export-flash-trajectory.ts` |
| patterns 采用（`a\|b\|c`） | ✅ | `expandPatternAlternation`：明文同义词 OR 展开为多 pattern；工具描述承认两种批搜 |
| 中文空搜早 nudge | ✅ | `SearchMissStreak.early`：CJK 空 grep 第 1 次即注入；英文仍 ≥2 |
| 记忆 M4 向量腿 | ✅ | `embed.ts` / `vector.ts`：`feat-hash-v1` + RRF；本地 ONNX/MiniLM 已撤回 |
| 记忆 M5 实体图 | ✅ | `graph.ts`：路径/实体派生邻接 + 词法种子 1-hop；RRF 第三腿；`OPENCODE_MEMORY_GRAPH=0` 可关 |
| 记忆 M6 工具面 | ✅ | `remember` 显式写入；`recall` 搜 project+persona 并标注 conflicts；`linkContradicts` + 注入冲突标记 |
| 巩固机械子集 | ✅ | `mergeBeliefs` 自动 prose 矛盾链接；`verifyBeliefs`/`verifyPaths` 路径时效（MISS_LIMIT→invalidate）；recall 热路径调用 |

**双轨检索 + 记忆 M0–M6 + 巩固机械子集已收口。**

### 可选增强（2026-11-01）

| 项 | 状态 | 要点 |
| --- | --- | --- |
| 真本地 MiniLM embed | ❌ 已撤回 | CPU/RAM 对 ≤200 记忆袋不划算；中英靠 BM25+概念扩词；embed 仅 `feat-hash-v1` |
| 向量缓存表 | ✅ | `memory_vector` 缓存 feat-hash；`syncVectors` 随 `replace`；`recall` 热读 `loadVectors` |
| 持久 Entity/Edge | ✅ | `memory_entity` / `memory_edge`；`syncGraph` 随 `replace`；`loadAdjacency` 空表回退内存 `buildAdjacency` |

### Flash 体感收口 PR1–PR3（2026-11-02）

| 项 | 状态 | 要点 |
| --- | --- | --- |
| PR1 探查硬收口 | ✅ | soft 后再读 → `exploreForce` 收窄工具；locate≥8 → `toolChoice: subagent` + 去 grep；golden median≤3 / firstUseful≤8 |
| PR2 同一步多工具 | ✅ | 连续 2 步单工具 look → `batchNudge` + 只留 grep/glob/read；golden `minBatchedRate`≥0.8 |
| PR3 代码块被动挂载 | ✅ | `code-chunks.ts`：线索路径后预算摘录进请求；`OPENCODE_CODE_CHUNKS=0` 可关 |

### 值得做、排后面（2026-11-06 用户定调）

骨架 / 止损 / PROMPT 已齐 ≠ 这两项收口。**P0–P3 检索硬能力稳住后再开**；开干时不许再堆表。

| 项 | 为何排后 | 开干时做什么 |
| --- | --- | --- |
| **Explore 只读子任务 · 探查形态对齐 Cursor** | 阶段 C 的「已有 explore + 批搜纪律」只是入口；Cursor 形态是隔离并行搜、主会话只回收路径+短摘录+下一步。现有 exploreForce / soft 是主链止损，不是子任务产品形态。 | 按 `cursor-parity-search.md` P4：只读子任务、步数上限、摘要回主会话；与 `explore-budget` 计账写清。验收看主会话工具次数下降，不看又加一段 prompt。 |
| **记忆注入质量（已有骨架）** | M0–M6 / 注入 / 冲突标记 / 机械巩固已在；体感「越用越懂」仍弱——巩固不狠、冲突不显、时效不醒目。再加 `memory_*` 表是偏航。 | 在现有 Belief / inject / consolidate / recall 上把 **巩固合并、矛盾可见、valid/invalid 时效** 做成人能感知的质量；默认不开新表。 |
