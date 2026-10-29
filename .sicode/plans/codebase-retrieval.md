# 代码库语义定位：方案讨论稿 v2

> 2026-10-29 · 起因：真实会话（ses_e789451abffe）33 次工具调用 88% 花在探索，
> 7 次搜索全是猜关键词（`settings-footer|settings-nav-footer`…），21 轮才碰到根因。
> v2：全网重新调研后的重大更新——**Cursor 已于 2026-07 废弃 embedding 语义索引**，
> 行业格局与 v1 调研时（各家营销稿）明显不同。

## 一、重大事实修正（v1 里的过时信息）

| v1 的说法 | 实际（截至 2026-10） |
|---|---|
| Cursor = 向量+词法混合的标杆 | **2026-07 起不再计算/存储 embeddings**，语义索引逐步停用；检索改为 **Instant Grep（本地 trigram/sparse n-gram 倒排索引）+ Explore 子代理** |
| Windsurf SWE-grep 子代理 | 公司被 Cognition 收购，现名 **Devin Desktop**；检索是 **Fast Context 子代理（SWE-grep RL 模型）**，仍保留 768 维 embedding 给 `@codebase` 兜底 |
| Zed「刚放弃」embeddings | 2024 年试过 OpenAI embedding 原型后**从未落地**，官方立场「不要索引，按需发现」；可通过 ACP/MCP 挂第三方语义索引补回 |
| Cody「主动放弃 embeddings」 | 仅 **Enterprise ≥5.3** 移除（换 Sourcegraph Search + Code Graph）；Free/Pro 仍保留本地 embeddings |

**Cursor 转向的官方理由**（论坛原话）：模型已经足够会用 grep，「旧的专用语义路径很快就没有明显帮助」。它 2026-01 的博客还在讲 Merkle 树语义索引工程（首次查询 7.87s→525ms，P99 4h→21s），**半年后整套弃用**——网上大量「Cursor embedding 索引」文章（含本稿 v1 引用的部分中文解读）已过时。

## 二、当前行业四条路线（2026-10 实况）

| 路线 | 代表 | 核心 | 硬数据（注明口径） |
|---|---|---|---|
| **A 本地倒排索引 + agentic** | **Cursor Instant Grep**（新）、Claude Code、Zed | trigram 倒排先筛候选再跑正则；Explore 子代理隔离搜索上下文 | 正则搜索 16.8s → 13ms（vs ripgrep，官方口径无第三方对照） |
| **B 预建语义图** | **Augment Context Engine**（唯一还在加码的大厂） | 语义依赖图 + 跨仓理解 + commit 历史索引（Context Lineage）；2026-02 起可作 MCP 挂任意 agent | **SWE-bench Pro 51.80% 第一**（Cursor 50.21 / Claude Code 49.75，三者同用 Opus 4.5 → 差距归因检索层；厂商自测） |
| **C 模型化检索** | Devin Desktop Fast Context | RL 训练的检索策略模型：每轮 8 并行 grep/read/glob、上限 4 轮 | 比传统 agentic search 快 ~20×、比 embedding RAG 快 ~10×（厂商口径）；mini 版 2800+ tok/s |
| **D 词法/图检索（企业级）** | Cody Enterprise（Search + Code Graph） | BM25F 分字段加权 + Zoekt trigram + 精确 find-references | 「最重要是拿到正确的文件，而不是具体算法」（官方 FAQ） |

**MCP 生态**（可挂到任何 agent 上，包括 SiCode）：
- **claude-context（Zilliz）**：BM25+稠密混合、Merkle 增量、AST 分块；要 OpenAI key + Milvus/Zilliz Cloud（可配 Ollama 本地）
- **Serena**：LSP 符号级语义导航（find_referencers/definition），全本地；宣传省 70% token
- **ChunkHound**：tree-sitter + DuckDB 全本地，语义+正则
- **code-index-mcp**：tree-sitter + ChromaDB + ONNX MiniLM 本地 embedding，免钥
- ⚠️ 实测坑（repowise）：**agent 经常不用装好的 MCP 检索工具**，默认还抓内置 grep；必须在提示词/rules 里明确指示才有稳定 adoption

## 三、Benchmark 真相（两边证据都要看）

**支持 agentic/词法的一侧：**
- SWE-bench 历史曲线：chunk-embed-topk RAG 基线 **1.96%** → 工具化 SWE-agent **12.47%**；2026 年 Verified 榜前列无纯向量架构
- Amazon Science（AAAI 2026）《Keyword Search Is All You Need》：agentic 关键词检索达到完整 RAG **94.5% 的 faithfulness**，零向量库
- Braintrust 实测（MS TypeScript 仓库 20 个 bug 任务）：**准确率相同，向量贵 4 倍**（向量返回片段缺 import/调用上下文，agent 反复补搜）
- MTEB 官方 BM25 基线：**BM25 在 SWE-bench code retrieval 上击败 8 个神经 embedder 里的 6 个**

**反对弃向量的一侧（关键！）：**
- arXiv:2608.01507（2026-08）：720 问 × 15 仓库 × 4 模型，**语义索引 65.2% vs 深度 agentic 搜索 46.2%（+19pp）**，且成本 2.3× 低、token 22× 少；「更努力≠更好」——工具调用越多两种范式都越差
- CORE-Bench：issue→edit 定位从 71.7 塌到 20.3，**现有 embedding 基准高估了对 coding agent 的用处**
- 分歧根源三个变量：①任务类型（定位标识符 → agentic 胜 3.7×；「哪些文件实现了 Y」概念型 → 向量略胜）②是否带结构（赢的其实是「结构+工具」不是裸 grep）③成本口径（无独立统一基准）

**对我们痛点的直接映射**：真实会话里「侧栏底部留白」正是**概念型 + 中文意图**查询——恰好落在向量赢的那一侧。而 agentic 阵营赢的证据全是英文标识符定位任务。

## 四、SiCode 方案（v3 修订）

**不做 embedding 模型选型**——SiCode 不内建任何 embedding（本地模型隐私论不成立：主模型本来就看得见代码），向量检索交给 MCP 生态，模型由 MCP 方案自带，与 SiCode 无关。

v1 的「分阶段混合」方向仍对，但参考点要换：**不是抄 Cursor 的向量索引（它自己都撤了），而是抄它的 Instant Grep 分层 + Augment 的结构图 + 保留一路语义 fallback**。

### 分层架构（v3，用户拍板后修订）

```
① 本地确定性索引（第一层，必须做）
   BM25F 字段加权（Cody 思路）：内容/符号/路径/i18n键/CSS类名
   + tree-sitter 符号表（repo map 已有，直接复用）
   trigram 倒排（Instant Grep 思路）缓做：本仓 ripgrep 全扫 250ms，
   1万+文件仓库才显著，等用户反馈
   → 职责：把「猜 7 次关键词」变成一次结构化查询

② 查询扩展（第二层，主模型自己当语义层）
   在系统提示词/工具描述里教模型：搜不到时先做中英扩展
   （「侧栏底部留白」→ sidebar / footer / empty space / flex / spacer）
   + 同义词、再考虑问用户。零新依赖、零索引、零模型。
   依据：Cursor 2026-07 弃向量的同款逻辑——模型够聪明，
   缺的是指引不是检索系统。
   → 职责：中文意图→英文代码的跨语言对齐（本会话痛点）

③ 语义 fallback（第三层，纯可选，不内建）
   想要向量检索的用户自己挂 MCP（claude-context / ChunkHound）。
   SiCode 不内建本地 embedding 模型——本地模型唯一剩余价值是
   「没有 embedding API 的用户兜底」，属锦上添花；隐私论不成立
   （主模型本来就看得见代码）。
   → 职责：重度概念型查询的兜底，交给生态
```

### 与 v2 的差异（用户质疑「本来就是对接的 AI，本地模型有意义吗」后修订）

1. **砍掉内建本地 embedding 模型**：主模型可见代码，embedding API 不构成新增隐私暴露；「本地」唯一剩余价值是无 embedding API 用户的兜底，不值得 400MB~1.2GB 下载和一套索引工程
2. **新增查询扩展层**：主模型自己把中文意图翻译成英文候选词再搜——这是「对接的 AI」最便宜的用法，Cursor 弃向量同理
3. 语义检索完全交给 MCP 生态，SiCode 不重复造
4. 保留 **adoption 警惕**：repowise 实测 agent 不用装好的检索工具——查询扩展的提示词同样要防「模型不照做」，需验证

### 需要拍板（更新版）

1. ① 层 BM25F 字段加权现在做吗（2~3 天）？trigram 倒排等反馈
2. ② 层查询扩展做成什么形态？——system.txt 静态指引（所有模型可见）vs 工具描述内嵌（grep 描述里写「没结果先扩展同义词」），还是两者都做
3. ③ 层是否在文档里给 MCP 配置示例（claude-context / ChunkHound），方便想要语义检索的用户自助

## 附：主要来源

- Cursor: Search docs（Instant Grep）/ Securely indexing large codebases（2026-01，已属旧架构）/ 论坛语义索引停用确认
- internalsdecoded: Claude Code vs Cursor（2026-10，含两工具检索现状对照）
- Augment: Auggie tops SWE-bench Pro（厂商自测，数据集公开可复现）；Context Engine MCP 发布
- Cognition/Windsurf: Fast Context + SWE-grep docs
- Sourcegraph: Cody FAQs（Enterprise 5.3 移除 embeddings 的四条理由）
- Amazon Science AAAI 2026: Keyword Search Is All You Need；Braintrust 向量 4× 成本实测；arXiv:2608.01507（语义 +19pp）；CORE-Bench（arXiv 2606.11864）
- theairankings: Best Embedding Models（2026-10，vendor 数字不可信的三个实锤）
- repowise: Claude Code codebase indexing MCP options（MCP adoption 实测）
- MCP 生态：zilliztech/claude-context、oraios/serena、ChunkHound、code-index-mcp
