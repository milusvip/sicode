# 聪明不空转（重做：禁止再叠会话闸）

> 2026-11-07 · 作废上一版「DeliveryFact + adviseHard + 工具拒收 + steer」——那是 **又往 `llm.ts` / `steer.ts` 堆一条会话 harness**，和 idle-ask / reply-style / completion 同构，已否决。  
> 对症会话：`ses_e4b5bd`（问办法 → 28min write/execute，`syn=0`）。  
> 相邻已定案、**不重复造闸**：`agent-ops-hardening.md`（证据/约束契约）· `harness-slim`（soft 默认关）· 现有唯一反空转会计 `explore-budget.ts`。

---

## Goal

体感：**该答就短答，该改才改；改的时候不靠热闹工具假装有进展。**  
工程约束：**零新增 runner steer / 零新增 `OPENCODE_*` 行为开关 / 零从用户散文猜 intent 的会话闸。**

## 为什么上一版是错的

| 上一版招数 | 为何算堆叠 |
| --- | --- |
| `delivery.ts` 分类 advise/diagnose | 又一个会话侧意图引擎（idle-ask 近亲） |
| edit/write/execute `blocked()` | 在工具上打补丁躲分类错误，不减少 drain 复杂度 |
| `ADVISE_HARD_STEPS` → `selectSteer` | **明确往 steer 优先级表再插一行** |
| 与 completion / explore / reply-* 并存 | 闸门互相抢 `toolChoice`，回归只能靠 vignette |

`syn=0` 已证明：28 分钟不是「缺闸」，是 **偏干 + 假进展定义** 下模型自愿干满。再加闸 = 治错层。

## Architecture（一句话）

**模式在入队边界选，不在 drain 里猜；空转只修唯一进度会计；聪明只靠工具结果契约——runner 不再长新枝。**

```
用户/Composer 入队
  └─ delivery 显式：ask | agent   （UI 或 agent 配置，写入 prompt metadata）
       │
       ├─ ask：本回合工具表在 **admit/load** 就去掉突变集（非 steer、非逐步 classify）
       └─ agent：全工具；空转只走 explore-budget 一条硬停
工具结果
  └─ Evidence 头（ops Track A）：empty/truncated 不可装成命中 → 少无效步
禁止
  └─ 新 synthetic / 新 soft / 从「有好办法没」正则推断
```

## 三刀（只这三刀）

### 刀 1 — Ask / Agent 入队模式（治「问一句干半小时」）

- **不是**会话中途 NLP。默认保持今天的 Agent（偏干）。  
- Composer（或 agent 预设）显式 `ask`：在 `SessionContext.load` / 工具装配处 **静态去掉** `write|edit|patch|execute`（及等价突变），整回合一致，**不碰** `selectSteer`。  
- 用户说「弄啊」= 新消息以 Agent 入队，而不是闸升级。  
- 验收：ask 模式下工具定义里无突变名；agent 模式行为与今相同。

### 刀 2 — 只修 `explore-budget` 的进度定义（治假进展空转）

唯一反空转主人仍是它。只改正义，不新模块、不新 steer 文案（沿用已有 hard-locate 停）：

- scratch / temp write+run = 非进展（已有，保持）。  
- **`status===error` 的 write/edit/patch/execute = 非进展**（拒收重试不得清零 streak）。  
- 可选同一 PR：连续 **empty search** 计入 spin（与 search-miss 硬停分工：budget 管 streak，miss 管同 pattern——**不新开 soft**）。  
- 验收：回放「失败突变插在中间」时 `readOnlySteps`/`spinningSteps` 不中断；硬停仍走现有 `exploreHardLocate`。

### 刀 3 — 工具 Evidence 契约（治「搜得勤却不聪明」）

完全落在 `agent-ops-hardening` Track A：grep/read 结果机器头 `empty|truncated|hits`。  
**不进** `llm.ts`。让每一步信息更真，步数自然下降。

## 明确不做

- 新建 `delivery.ts` / `*Gate` / `classify(有好办法没)`  
- 改 `steer.ts` 优先级表插 advise 分支  
- 恢复 idle-ask  
- 加长 `system.txt`「先答再干」  
- 新 `OPENCODE_DELIVERY` 之类开关税（Ask 模式用现有 agent/工具装配配置表达）

## 与 agent-ops-hardening 的关系

| 本方案 | ops 方案 |
| --- | --- |
| 刀 1 Ask 入队 | 不做（模式不是检索/约束） |
| 刀 2 explore-budget 会计 | 不做（ops 禁新 soft；本刀只修已有硬会计） |
| 刀 3 Evidence | **即 Track A**，此处不另起炉灶 |

约束进 metadata / replay（ops B/D）照旧；本文件不扩 scope。

## 落地顺序

1. 刀 2（最小 diff，立刻改善假进展）  
2. 刀 3（接 ops A1）  
3. 刀 1（产品面：Ask 切换；无 UI 前可用 agent 工具黑名单配置做同构）

## Review 风险

- Ask 误伤「先读图再给方案但允许写 probe」→ Ask 本就禁写；要写就切 Agent。  
- 刀 2 把一切 error 当非进展 → 权限拒绝刷屏仍停得住，符合预期。  
- 刀 1 若做成逐步 metadata 猜测 → **PR 直接拒**，回到本文纪律。

---

## Tasks

- [x] **T0** 确认本文替换一切「DeliveryFact 会话闸」草稿；仓库内无半成品 delivery 测/源。  
- [x] **T1** explore-budget：error 突变计入只读 + 单测。  
- [x] **T2** ops A1 Evidence 头（grep/glob render；链 hardening Track A）。  
- [x] **T3** Ask 模式：`SessionAskMode` + agent `ask` 权限去突变；**零** steer 改动。  
- [x] **T4** `bun script/notes.ts add` 记「no-spin = 入队模式 + 唯一会计，禁叠闸」。
