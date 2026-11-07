# 对齐 Cursor 现款检索：实施方案

> 2026-10-31 · 目标：体感接近 **Cursor 2026-07 之后**的代码定位（Instant Grep + Agent 探查），**不是**已废弃的全仓 embedding。  
> 合序与 Flash 双轨：`flash-dual-track.md`。  
> **范围外**：跨会话记忆见 `memory-architecture.md`；二者分库，互不替代。

---

## 0. 一句话

**巩固毫秒倒排（正确失效）+ 强制查询扩展 + 分字段排序 + 控洪水 + Explore 式只读探查。**  
不内建全仓向量；概念题兜底交给可选 MCP。

---

## 1. 对标与非目标

### 1.1 对标（Cursor 现款）


| Cursor               | 含义                      | 本方案                   |
| -------------------- | ----------------------- | --------------------- |
| Instant Grep / Crepe | 本地 trigram，内容搜 ~10–20ms | 已有 trigram；补 **可靠失效** |
| Agent 会搜             | 模型扩词、并行、限幅              | **查询扩展纪律** + 工具能力     |
| Explore              | 隔离只读搜，摘要回主会话            | **P4 子任务**            |
| （旧）语义索引              | 全仓 embedding            | **明确不做默认**            |


### 1.2 非目标

- 全仓 embedding 增量索引、自托管向量库当主路径  
- 「毫秒直接给出根因」（毫秒只保证候选检索；根因仍靠读+推）  
- 用 project-memory / 向量记忆冒充代码定位  
- 推倒重写现有 trigram / ripgrep 栈

### 1.3 成功标准（可测）

相对真实痛点会话（猜关键词 7 次、21 轮才碰到根因一类）：

1. **零命中后扩词再搜**成为默认行为（工具日志可证，不靠体感）
2. 概念型中文问（如「侧栏底部留白」）在 **≤3 次搜工具调用**内进入正确目录/文件（golden 集）
3. 索引在「仅改文件内容、路径不变」后 **不再静默 0 命中**
4. 宽查询默认不灌爆上下文（先文件列表 / 硬帽生效）
5. 热路径内容预筛仍 **P95 毫秒～数十毫秒**（本仓量级），不引入同步云调用

---

## 2. 现状基线（已有，勿重做）


| 能力           | 位置                                               | 备注                     |
| ------------ | ------------------------------------------------ | ---------------------- |
| trigram 候选预筛 | `packages/core/src/filesystem/trigram-search.ts` | 与 Crepe 同档毫秒；盘占用更小     |
| grep 两阶段     | `packages/core/src/tool/plugin/grep.ts`          | literal → trigram → rg |
| grep context | 同上 + `ripgrep.ts`                                | 已通                     |
| 文件名模糊        | `filesystem/fff.ts`                              |                        |
| 结构注入         | `config/plugin/project-map.ts` 等                 | structure / notes 标题   |
| repo-map 缓存  | `repo-map/`                                      | 符号导览，非 Instant Grep    |


**已证伪的差距叙事：**「没有毫秒索引」。真差距在 **扩词、排序字段、失效正确性、洪水、探查形态**。

### 2.1 模型适配：DeepSeek Flash 为一等公民

本方案 **明确服务** `deepseek-v4.1-flash`（及同类偏快、遵从较弱的模型），不是只为 Claude/GPT 写长提示。

**结论：** Flash **能明显受益**——收益主要来自索引/工具硬能力（P1–P3、multi-pattern），不依赖它有多强的推理；但 **落地姿势必须按 Flash 改**，不能照抄「再拉长 system」。


| 层                  | 对 Flash         | 依据（仓库已踩坑）                                |
| ------------------ | --------------- | ---------------------------------------- |
| P1 失效 / 空候选回退      | 模型无关，全收益        | 静默 0 命中与模型无关                             |
| P2 分字段 / P3 控洪水    | 全收益；洪水治理尤重要     | 定位任务常 7–15 轮工具，噪声放大空转                    |
| P0 multi-pattern   | **降对智商的要求**     | 一次丢多词，少串行猜                               |
| 长 system 纪律        | **弱**；宜短        | 「Say what you found」加了仍整轮不写；元规则约 4–5 条上限 |
| 工具 description 短纪律 | **强于**加长 system | 既有结论：引导优先放工具描述，少打断 cache                 |
| 连败框架注入             | **必要后手**        | 提示词 alone 管不住时，N 次近零命中注入「换词/扩词」          |


**Flash 落地优先级（写进实施，不是可选建议）：**

```text
工具硬能力（multi-pattern、空结果回退、限幅、排序）
  > grep/glob description 短纪律
  > searchGuidance / deepseek.txt 极短补丁（不新增长篇）
  > 连败 N 次确定性行为注入
```

**已有锚点（P0 在此上演进，勿重复造）：**  
`session/system-prompt.ts` 的 `searchGuidance()`、`OPENCODE_SEARCH_GUIDANCE`、grep/glob 的 `QUERY_EXPANSION_NOTE`（`OPENCODE_QEXPAND=0` 可关）。P0 应加强 **multi-pattern + 可观测 adoption + 连败注入**，而不是再堆一段同义说明。

**预期边界：** 方案把「搜得蠢」压下去；根因推理、一次读对调用链，Flash 仍可能比大模型多几轮——**不以齐平 Opus 为验收**。Golden 与回归 **默认用 Flash 轨迹录基线**（用户主模型），避免只在强模型上「看起来像 Cursor」。

---

## 3. 分阶段交付

### P0 — 查询扩展与搜工具纪律（体感最大，成本最低）

**做什么**

1. **工具描述为主**（grep / glob）：写死「0 命中 → 扩同义词 / 拆词 / 改 path」；禁止只换标点重试。Flash 主读这一层。
2. **系统侧保持短**：沿用/收紧现有 `searchGuidance()`；`deepseek.txt` 若需补丁，**≤一小段**，不新开长章。禁止靠加长 system 堆纪律（元规则预算）。
3. **多 pattern 一次搜**（优先硬能力）：`grep` 支持 `patterns: string[]`（或由工具展开并行、合并去重），避免模型串行猜 7 次。
4. **连败注入（Flash 后手）：** 同会话连续 N 次（建议 2）搜工具近零命中 → 框架插入短提醒「换词/扩词/改 path」，不依赖模型自觉。
5. **adoption 护栏**：golden **以 deepseek-flash 轨迹为默认基线**；断言中文概念问路径上出现扩词或 multi-pattern，而不是 7 次单关键词。

**落点（预期）**

- `tool/plugin/grep.ts` / `glob.ts`（schema + 描述 + 并行合并）  
- `session/system-prompt.ts` 的 `searchGuidance`（短更新）  
- 可选：runner/插件级连败注入（与既有 nudge 模式对齐，防重复造）  
- 测试：`packages/core/test/tool-search*.ts` 或新建 golden runner

**验收**

- golden（Flash）：≥N 条中文概念问，工具调用中位次数下降（基线先录再比）  
- 无新原生依赖、无模型下载

**默认拍板：** 工具描述 + 短 searchGuidance + multi-pattern + 连败注入；**不**以加长 `deepseek.txt` 为主路径。

---

### P1 — 索引失效正确性（快且不错）

**问题**  
mtime/size 指纹仍可能漏；路径不变、内容变 → 复用旧 trigram → 预筛丢掉真文件 → **静默 No matches**（notes 已踩过）。

**做什么**

1. **内容指纹或 commit 锚定（二选一，可组合）**
  - **推荐 A（贴近 Cursor）：** 有 VCS 时以 `HEAD` commit 为索引世代；换 commit → 整库或世代切换，避免细比对漏更新。  
  - **推荐 B（无 VCS / 工作区脏）：** 对变更文件用内容 hash（或 mtime+size **且** 订阅 watcher 强制 upsert）；启动时对 dirty 集重嵌。
2. 预筛得到空候选且 pattern 为 literal 时：**回退全量 rg**（或跳过预筛），禁止「空候选当最终答案」——审 `grep.ts` 对 `[]` truthy 的分支，保证回退路径永远活着。
3. 单测：改文件内容不改路径 → 再搜新 token 必命中。

**落点**

- `trigram-search.ts` / `trigram.bun.ts`  
- `tool/plugin/grep.ts` 回退语义  
- 回归测试固定「静默 0 命中」复现再锁死

**验收**

- 上述复现用例永绿  
- 建索引耗时与盘占用不显著劣化（本仓量级：建库仍约数十秒内可接受；查询仍毫秒级）

**默认拍板：** VCS 下 commit 世代 + dirty 文件强制更新；空候选必须回退 rg。

---

### P2 — 分字段检索（BM25F 思路，少猜词）

**做什么**

1. 在现有 SQLite/FTS 或旁路索引上，为候选排序引入字段权重，例如：
  - 符号名 / 导出标识符 > 路径片段 > i18n key / CSS class > 正文
2. 新工具或扩展现有 search：`code.search` / 增强 `grep` 的 `mode=ranked`（先返回排序文件列表 + 短摘录）。
3. 复用 tree-sitter / repo-map 已有符号表，**不**为这一层引入 embedding。
4. 与 trigram 关系：trigram 继续做 **候选超集**；BM25F/字段分做 **排序与截断**，正确性仍以 rg/读文件为准。

**落点**

- `filesystem/` 或 `search-ranked/` 旁路（注意与 context-hints 的 SearchRanked 职责分离：hints ≠ 全仓代码）  
- grep/search 工具出口

**验收**

- 固定 20 问基线：正确文件进入 top-K 的比例相对「纯路径+正文字面」提升（先录基线）  
- 查询延迟仍本地、无出网

**默认拍板：** 做；与 P0 并行设计、P1 之后合并，避免在错误索引上调权重。

---

### P3 — 洪水治理（先窄后宽）

**做什么**

1. grep 默认或工具指引：**宽查询先 `files_with_matches`（或等价：只返回路径列表）**，用户/模型确认后再 `content`。
2. 硬帽：匹配数、每文件行数、总字符（对齐 Cursor 量级思路：避免单次 15k+ 噪声）。
3. 常见噪声：import 行占比过高时，在 content 模式提示或降权（可选）。
4. 系统提示：禁止对 `function`/`the` 等极宽 token 直接 content 灌上下文。

**落点**

- `grep.ts` schema：`output_mode` 或明确的两步 API  
- 工具描述 + 截断文案

**验收**

- 宽查询单次工具输出 token 分布：P90 明显下降（用现有会话探针或合成）  
- 定位类任务平均工具轮次不升反降

---

### P4 — Explore 式只读探查（产品形态对齐）

**做什么**

1. 只读子任务：给定自然语言目标，内部并行 glob/grep/read（有步数上限），向主会话只交 **路径列表 + 短摘录 + 下一步建议**。
2. 不写盘、不改权限；计入 explore-budget 或独立预算。
3. 主会话提示：概念不清或连搜失败时优先唤起 Explore，而不是在主链上堆 20 次 grep。

**落点**

- 新 tool 或 runner 子路径（命名避免与上游冲突；SiCode 注释标明）  
- 与 `explore-budget.ts` 的关系写清，防止双计或绕开止损

**验收**

- 合成「侧栏留白」类任务：主会话工具次数下降，子任务内完成扩词与定位  
- 子任务超时/步数上限可测

**默认拍板：** P0–P3 稳定后再做；这是「像 Cursor」的形态件，不是索引件。

---

### P5 — 可选加分（非主路径）


| 项                 | 说明                                                          |
| ----------------- | ----------------------------------------------------------- |
| 相关文件预算注入          | 高置信路径短列表塞进用户消息侧，防污染 system 缓存前缀                             |
| unsaved buffer 并搜 | 编辑器未保存内容对工具可见时并入候选                                          |
| 语义 MCP 文档         | `claude-context` / ChunkHound 配置示例；SiCode **不**内建 embedding |
| 调用边加强             | 少「谁引用我」的二次摸索                                                |


---

## 4. 依赖与安装


| 阶段        | 用户是否要装额外东西                             |
| --------- | -------------------------------------- |
| P0–P4     | **否**（Bun / 现有 SQLite FTS / ripgrep 栈） |
| P5 语义 MCP | 仅当用户自愿挂 MCP；可能需其自身的 embed API 或本地模型    |
| 全阶段       | **不需要** Mem0、不需要为代码定位下载 embedding 模型   |


---

## 5. 与相邻方案的边界

```text
flash-dual-track.md         ← 双轨合序与 Flash 原则
cursor-parity-search.md     ← 本文件：仓库内「找到相关代码」
memory-architecture.md      ← 跨会话信念/事实；禁止与代码索引混库
```

记忆再强也不能替代 Instant Grep；倒排再快也不能替代巩固后的决策记忆。

---

## 6. 风险与纪律

1. **Adoption（Flash 加重）：** 只加长 system → Flash 常不当真；P0 必须以工具硬能力 + 短工具描述 + 连败注入为主，golden 用 Flash 录基线。
2. **静默错答：** 预筛空集当最终结果是 P0 级事故；P1 优先于调参。
3. **范围膨胀：** 禁止借本方案重新打开「全仓向量二期」（notes 已用本仓数据收束过）。
4. **上游文件：** 改 `packages/core` 上游拥有文件须带 `// SiCode:` 注释。
5. **验证：** 每阶段先录基线再改；禁止无数字宣称「更像 Cursor」；禁止只在强模型上验收通过。
6. **提示词预算：** 不把检索纪律写成第 5、第 6 条互搏元规则；与既有「Check before you commit」四条共存时优先工具侧。

---

## 7. 建议排期（工程顺序）

```text
Week 形态（示意，非承诺人天）
  P0  查询扩展 + multi-pattern + 双通道纪律     ─── 立刻体感
  P1  失效 + 空候选回退                         ─── 正确性
  P2  分字段排序                                ─── 少猜
  P3  洪水 / output_mode                        ─── 省轮次与 token
  P4  Explore 子任务                            ─── 产品对齐
  P5  按需
```

可并行：P0 文案与 P1 复现测试设计；P2 设计可与 P1 实现重叠，**合并须在 P1 绿之后**。

---

## 8. 产品定调与仍待工程确认

**已定（2026-10-31）：** 检索与记忆双轨都要；Flash 为优化/验收重心；合序见 `flash-dual-track.md`。

实施前仍需点头的工程项：

1. **P0 多 pattern：** 接受改 grep schema（protocol/client 可能需 `bun run generate`）？  
2. **P1 失效：** commit 世代 + dirty 重嵌？  
3. **P4 Explore：** 进本里程碑，还是检索 P0–P3 + 记忆注入先收口再开？  

确认后按 `flash-dual-track.md` 阶段 A 拆 PR（分支名三词以内）。
`)