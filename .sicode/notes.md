# 调研笔记

给 agent 看的。只记**事实**：功能在哪个文件、谁渲染谁、为什么这么改。

不记项目简介、不记进度、不记"当前正在做什么"——那些会过期，而过期的笔记比没有更糟。

## 写法

**不要直接编辑这个文件。** 仓库里同时有几个 agent 在写它，整文件保存会丢掉别人刚写的段落（已经发生过两次）。用命令写：

```bash
# bash / zsh：直接管道
printf -- '- 新事实：`packages/core/src/session/compaction.ts:159` 做什么\n' | bun script/notes.ts add --area "侧边栏浏览器"

# PowerShell 或编辑器里没有管道时：先写进临时文件
bun script/notes.ts add --area "侧边栏浏览器" --file /tmp/notes-input.md

bun script/notes.ts list     # 有哪些区域、各几条
bun script/notes.ts verify   # 笔记引用的路径是否还存在
bun script/notes.ts merge    # 把「区（2026-10-23）」并回「区」
```

命令会加锁、原子写入、按区域合并、跳过重复的 bullet。所以**可以每轮都写**，不会覆盖别人。

四条要求：

1. **一个区域一段**。`--area` 只传区域名，不带日期——日期会让同一个区域裂成两段。结论反转时删掉旧行，留一句「原来…为什么改」。
2. **带路径**。`文件:行号` 比文字描述有用得多，下次可以直接跳到那里。`verify` 只校验能落到仓库文件的路径（命令、包名、占位符会被跳过，免得天天误报）。
3. **命中就跳过搜索**。开新任务先 `bun script/notes.ts list` 扫一眼，这一块记过就直接从结论开始，不要再 grep 一遍。
4. **不记进度**。"正在做 / 还没做"会过期，那些去 `.workbuddy/memory/YYYY-MM-DD.md`。

## 结构

两个文件，分工不同：
| 文件 | 回答什么 | 什么时候改 |
|---|---|---|
| `notes.md`（本文件） | 那个包里**怎么改**：链路、坑、为什么这么改 | 每次调研，`add --area` 一段 |
| `structure.md` | **该改哪个包**：包职责、常见需求去哪、分层硬规则 | 包增删或职责变化 |
- 按天的流水（今天改了什么、验证到哪一步）不写这里，去 `.workbuddy/memory/YYYY-MM-DD.md`（已 gitignore，本地）。这里只留"下次还用得上"的结论。
- 超过约 300 行、或某个区域占了一半以上，再按**区域**拆成 `notes/browser.md`、`notes/session-timeline.md`…，本文件留一张索引（一区域一行）。**不要按日期拆**——检索维度是"这块代码在哪"，不是"哪天改的"。
- `.sicode` 是配置目录（`packages/core/src/config/discovery.ts:17`），被递归监听（`packages/core/src/config/watch.ts:29-33`），写一次文件会触发一次 config reload。所以把这一轮的结论凑齐后一次 `add`，别每查到一条就调一次。
- 写入走 `script/notes.ts`（`add` / `list` / `verify` / `merge`）：加锁 + 原子 rename + 按区域合并，多个 agent 同时写不会互相覆盖；`verify` 只校验能落到仓库文件的路径
---

## 记录

<!-- 从这行下面开始追加 -->

## 会话审查 / 侧边栏

- 审查是 gui-extension panel：`gui-extensions/src/review/renderer.tsx`，壳在 `app/src/runtime/extension/side-region.tsx`
- 侧边栏滚动条用 `@opencode/ui/scroll-view`（和对话时间线同一套 overlay 拇指）；diff 在 `session-review-file-preview-v2.tsx`
- 标题栏按钮管整列：关 side，且 `terminalPlacement===side` 时一并 `dock.close()`；再打开时按收回前的 side/dock 状态还原（`session-header-actions.tsx`）；审查从 + 菜单进
- 空面板：`side-region.tsx` 的 `EmptyPanel` 居中列出 `session.panel` 菜单项（含终端，`terminal/renderer.tsx`）
- 关完标签收回：`createRegion.close` → `view().side.close()`；不要对「keys 为空」做 effect（空侧边栏也是 keys 空）
- 终端滚动条：ghostty 画在 canvas 上；`gui-extensions/src/terminal/scrollbar.ts` 在 `open` 后替换 `renderScrollbar`，画成 ScrollView 同款 4px 圆角拇指
﻿- 对话栏宽度：`packages/ui/src/styles/tailwind/index.css` 的 `--container-session`（默认 744px）；`appearance.sessionWidth` default/wide/full 写到 documentElement；设置项在外观页 settings-session-width

## About

- `packages/app/src/settings/about/about.tsx`；字标用 `@opencode/ui/logo` 的 `Logo`，不要 Inter 文字动画
- 文案 `settings.about.*`（en/zh/zht）；搜索锚点 `.settings-about-brand`

## 侧边栏浏览器

- UI：`gui-extensions/src/browser/panel.tsx`；地址栏回车按钮 `type="submit"` + `enter` 图标，走同一条 `onSubmit`
- 粘贴登录：`SiteCookies` → Ipc `BrowserPane.setCookies` → `chromium.ts`；Cookie 在 pane 内存分区，重开即失效
- 系统浏览器打开、添加到会话在 ⋯ 菜单；搜索引擎在 `address.ts` 的 `SEARCH_ENGINES`

## 过程壳 / 时间线

- 竖线：`message-part.css` 的 `[data-slot="context-tool-group-item"]:not(:last-child)::after`；过程展开且 grouped 才有；相关 overflow 要 `visible`
- 默认展开：`workShellDefaultOpen` 仅 running/disconnected/error；`processDefaultOpen` 仅最后过程且 working 或 error
- 样式补丁在 `message-part.css` 的 `[data-process-shell]`；`--background-stronger` 不能当主题 token（浅色会变深灰），用 `--v2-background-bg-layer-02`
- 设计对照：`session-ui/design/toolchain-shell-preview.html`
- 链上思考行：摘要在 `basic-tool-tool-subtitle`，展开时也要显示。`info-main` 必须 `display:block` + 标题/摘要 `inline`，否则 `flex:1` 会把短摘要推到行尾，看起来像「思考」后面空一大块
- 过程壳字号：头和链共用 `--process-shell-size: 12.5px` / weight 440 / sans。标题、路径、思考摘要、秒数同一档，不要再分 13/12.5/11/10。总栏秒数在 `work-shell.css` 的 `work-shell-meta`，也曾是 10px mono，要跟这一档走
- 过程行和总栏同宽：不要给 `[data-process-shell]` 加 `padding-inline`。trigger 仍是 demo 的 `3px 6px 3px 0`
- 总栏和过程条上下间距：虚拟行不是 DOM 兄弟。间距写在 `[data-timeline-row="WorkShell"] { padding-bottom: 8px }`，测高会算进去
- 收回总壳漏过程：`insertWorkShells` 只包 `isProcessGroup`（带工具的组）。compact 下 read 是 `read` 组、思考是纯 `context` 组，思考会落在 WorkShellEnd 后面。`isReasoningWork` 把纯 reasoning 的 context 和 `Thinking` 行扩进 first/last，中间的 Notice/TurnDivider 跳过但会包进壳里
- 过程条文案永远是「过程 · …」，「已完成 N 个工具」只出现在总壳头上，避免收起后两条都写已完成
- 读取组要补 `glasses` 图标，否则标题会顶到图标列
- 总栏完成用 `circle-check`（`work-shell.tsx` StatusIcon）；过程行 `pending` 转圈，完成才 `check`，不要展开时改成 `bullet-list`
- 总栏/过程对齐：过程 trigger `padding: 3px 8px 3px 5px`（补上总栏 1px 边），链 `padding-inline: 5px 8px`；箭头用和总栏一样的 `chevron-right`，藏掉 Kobalte 的 triangle
- 过程壳折叠往下开：头和链上的 edit/write/patch/思考 都不 sticky。`message-part.css` 里 `[data-process-shell]` 把 trigger / `sticky-accordion-header` 设 `position: static`，并 `overflow-anchor: none`。`CurrentContextToolGroup` 不再在收起时 `scrollBy` 补偿钉住的头（那会把行拽上去）
- 过程链里的编辑行走 `CurrentFileToolGroup` → patch 渲染（`tool-renderer.tsx`）。原先 `apply-patch-tool` 整块缩进 `ind-col+8px`，文件图标被挤出指示列，看起来像没图标
- 文件名旁的「已创建/已更新/已删除」在 `FileChangeTriggerHeader`；write 没有 metadata 时 `status: "added"`，否则会一直当 modified
- 文案键 `ui.patch.action.updated`（en/zh/zht）；过程壳里动词用 muted，加减行仍用右侧 DiffChanges
- 引导消息：执行未 idle 时交付的后续 user 在 `projection.ts` 标 `UserMessage.steer`；排队未交付的不算，仍保留 TurnGap
- 渲染：`session-timeline-row` → `SessionUserMessage` → `data-steer` + `user-message-steer-badge`；文案 `ui.message.steer`（en/zh/zht）
- 样式在 `message-part.css` 的 `[data-steer]`：左对齐细描边条，压过蓝气泡主题用 `:not([data-steer])`
- demo：`session-ui/design/steer-message-preview.html`
- 失败不上报：`workShellStatus`（`timeline/projection.ts:754`）只看 `lastAssistant.error` / idle；过程头 `status={pending() ? "running" : "completed"}`（`tools/tool-renderer.tsx:601`）且图标 `fallback={<Icon name="check"/>}`（同文件 :615）→ 含失败工具的过程仍画绿勾。`countTools`（`projection.ts:741`）也不区分失败。`metadata.exit !== 0` 只在 `SessionMessageShell` 生效（`projection.ts:868`），shell **工具**（bun test 失败）完全不认 → 总壳头写「已完成 N 个工具」
- 状态色走 legacy token：`work-shell.css` 用 `--icon-success-base` / `--icon-critical-base` / `--border-critical-base`，这些只跟 `@media (prefers-color-scheme: dark)`（`ui/src/styles/theme.css:363`），不跟应用内 `[data-color-scheme]`；v2 对应值是 `--v2-state-fg-success` / `--v2-state-fg-danger` / `--v2-state-border-danger`（`ui/src/styles/tokens/theme.css:60-67`）。浅色下 success 是 `#7add71`（`theme.css:267`），白底约 1.7:1
- 标题对比度：总壳头 `--v2-text-text-faint`(#808080) 落在 `layer-02 70%` 底（合成 #272727）上 = 3.78:1，低于 4.5；同样字号的过程行在页面底（#161616）上是 4.64:1。改 muted 可到 6.7:1
- 键盘焦点：`ui/src/components/collapsible.css:57` 的 `:focus-visible{outline:none; background:var(--surface-raised-base-hover)}` 被 `message-part.css:790` 给同一 trigger 的 `background:transparent` 压过 → 过程行聚焦实测 bg 透明 / outline none / 无阴影；`work-shell-head` 没有自定义焦点样式，只剩 UA `outline:auto 0.57px`
- 链条竖线：`[data-slot="context-tool-group-item"]::before` 是 rgba(128,128,128,.4) 1px，合成到 #161616 约 1.76:1（75% 才到 3:1）；`::after` 遮罩块填 `--v2-background-bg-base`，过程壳若落在非 base 面（卡片/抽屉）会在图标后露方块
- 工具体三种左边界：diff 块贴图标列（93）、终端块 +24（117）、`tool-loaded-item` +34（127），文字列是 127；diff 右边界还超出行右（965 > 945）
- `DiffChanges`（`ui/src/data-display/diff-changes/diff-changes.tsx:30-31`）恒输出 `+N` 和 `-M`，deletions=0 时出现「-0」
- 过程头 `cursor: default`（`message-part.css:659`），总壳头 `cursor: pointer` —— 同一个折叠语义两种手感
- `label()` 的 `open` / `closed` 目前是同一份文案（`tool-renderer.tsx:524`），想做「展开时不再列工具名」改这里
- 预览壳复现：`http://localhost:5199/?doc=<edit|terminal|thinking|patch|fail|errshell|large>&open=1&probe=chev&scheme=light`；`probe=chev` 会打右列/焦点/竖线的实测值。起服务前 root `node_modules` 要有 vite、vite-plugin-solid、@tailwindcss、katex、@opencode/{ui,session-ui}、@pierre/theming 的 junction（`mklink /J` 指向包内版本），否则 5199 上只会看到 vite overlay 报错
- 失败语义（修完后的口径）：只有「最后一次失败之后没有任何助手文本」才算回合失败。`projection.ts` 的 `unresolvedFailure` 按 part 顺序取最后一个 failed tool 和最后一个非空 text，`lastFailed > lastAnswer` 才把 `failed` 计数交给 `workShellStatus`。失败后已经交付回答的回合保持「已完成 N 个工具」绿勾，失败只在展开的链里红 —— 原来一有失败就把整条头染红，用户看到的是一句话答案上面顶着「完成 28 个工具，1 个失败」，那是错的
- `TimelineRow.WorkShell` 多了 `failedCount`，`status` 多了 `"failed"`（回合交付但工具没全过）；`workShellDefaultOpen` 和 `processDefaultOpen` 都认 `failed`，所以未解决的失败会自己展开
- 行级失败：`currentToolStatus`（`message/current-tool-state.ts`）把 `shell` 的 exit≠0 / timeout 折成 `"error"` 喂给 `data-status`，行就红了；**不能**改 `state.status` 本身，`currentContentDefaultOpen` 等处还依赖它
- 顶栏总耗时永远显示，展开时也显示。过程条上的秒数是工具跨度（`toolSpanElapsed`），和顶栏的回合墙钟不是一回事，两个数并存是设计，不要为了「不重复」把顶栏那个藏掉（藏过一次，用户当场指出）
- 展开动画：只给过程壳的 `[data-slot="collapsible-content"]` 加 180ms 开 / 140ms 关的高度动画（`--kb-collapsible-content-height`）。`overflow: hidden` 写在 keyframes 里而不是规则里：它是离散属性，动画期间生效、结束自动回到链需要的 `visible`，否则规则里的 hidden 会长期压掉竖线需要的 overflow。diff 的 `accordion-content` 不发布高度变量，靠父级 content 一起动；时间线本身是虚拟行，折叠靠过滤，没有动画
- 状态色、对比度、竖线、焦点这几条都改过了（上面「失败不上报」「legacy token」「标题对比度 3.78」「键盘焦点为零」「竖线 1.76」那几条描述的是修复前的状态）：状态色走 `--v2-state-fg-success` / `--v2-state-fg-danger`，总壳头标题改 `--v2-text-text-muted`（6.7:1），竖线 40%→75%，两级都补了 `:focus-visible` 环（`outline: 1px solid var(--v2-border-border-focus)`，实测 outline-color 已是 focus 蓝）
- 过程头展开时不再列工具名（`label()` 里 `props.open` 决定用 `ui.processShell.count.*` 还是 `ui.processShell.open.*`），收起时那串名字是唯一的预览所以保留
- 预览壳 `?doc=recovery` 是「失败后已交付回答」的场景（`recoveryDocument`），`?doc=errshell` 是「失败后什么都没交付」，两者对照才能验证上面的失败语义
- 贴顶这种 app 层行为，预览壳测不到，但**运行中的桌面端可以**：它开着 9333 远程调试，`.preview-shell/cdp.mjs`（Node 22 自带 WebSocket，无需 ws 包）能直接 `Runtime.evaluate` 读 DOM/滚一屏/查 `[data-slot="work-shell-pin"]` 有没有出来。`GET /json/list` 里 target 是 `http://localhost:5173/index.html`；HMR 已生效时 `document.styleSheets` 里能搜到 `process-shell-open` 这类新规则，用来确认应用吃到了改动
- 总栏是**手风琴**：同时只展开一个。`openWorkShellOnly(rows, disclosure, keep)`（`timeline/work-shell.tsx`）把其它回合显式写成 `false` —— 不能只靠「当前 id」推断，因为运行中的回合是 `workShellDefaultOpen` 默认展开、store 里没有值，不显式关就会两个同时开着
- 贴顶只对**展开**的总栏生效：`syncWorkShellSticky` 里先算 `toolOpen[workShellDisclosureKey(id)] ?? workShellDefaultOpen(status)`，关着就 `continue`。收起的总栏只有头一行，但它的回答行还在同一个 userMessageID 下，跨度会一直算到下一回合，不判断展开就会把一条「已完成 N 个工具」压在回答上面
- 手风琴有跳屏风险：关掉的若是在点击位置**上方**的长跨度，那块高度消失会把刚点的栏顶飞（可能上千 px）。所以 app 层把整套动作收进 `openWorkShell(userMessageID)`（`virtualizer.tsx` 的 disclosure 里）：先记下该行 `[data-timeline-key="work-shell:<id>"]` 的 `getBoundingClientRect().top`，关完其它、开自己，再在 rAF 里按位移补 `scrollTop`。session-ui 的 `disclosure.openWorkShell?` 是可选的，没有就退化成纯 `openWorkShellOnly`
- 预览壳验证：`?doc=two`（`.preview-shell/fixtures.ts` 的 `twoTurnDocument`，两轮）配 `open=1`，结果 `["done:false","done:true"]` —— 只有后点的那栏开着。另外那条 `disconnected:true` 是 `message-timeline.tsx` 的 pending working 头，不属于时间线行，不参与手风琴
- 折叠总栏**不能连助手正文一起收**：回合常见形态是「工具 → 写答案 → 再来一个工具（todowrite / 收尾验证）」，答案就夹在两个工具之间，属于壳的成员行。原来 `filterCollapsedWorkShellRows` 只放行 TurnDivider/Error/Retry，答案被一起藏掉，只剩「已完成 N 个工具」。现在 `isWorkShellProse`（`AssistantPart` 且 `group.type === "part"` 且 key 匹配 /text:/d+$/）也放行 —— 折叠只收工具链，正文永远可见。手风琴让更多回合处于折叠态，所以这个坑更容易撞上
- 注意 `group.type === "part"` 的分组用的是单数 `ref`（`{ key, type: "part", ref }`），不是 `refs`；写测试时别搞错
- 结算（done/interrupted/error/failed）且整轮没有任何正文时，头部追加一个 `[data-slot="work-shell-note"]`：「未生成回复」。判定是纯函数 `workShellSilent(status, hasReply)`（`timeline/work-shell.tsx`，有单测）；`hasReply` 由 `TimelineRow.WorkShell` 携带，投影里用 `hasAssistantReply(input.assistantMessages)` 扫整轮非空 text。running/disconnected 不显示（那时没正文是正常的）。目的是把「看起来像渲染坏了」变成「明确说没有正文」
- 证据链：`思考强度按钮悬停背景` 194 条消息里只有 3 条带 text（seq 311/524/1661）；被中断的那轮（18m43s）一条都没有。所以「没有助手文本」在数据层是真的没有，不是 UI 吞
- 注意 `WorkShellHead` 的 props 每次新增都要同步三处：`session-timeline-row.tsx`、`app/.../virtualizer.tsx` 的浮层、`app/.../message-timeline.tsx` 的 pending 头，并在 `packages/app` 跑 `tsc -b`
- 「助手文本没了」的定量口径：按小时统计「同一轮里 text 出现在最后一个 tool 之前」的数量（`边干边说`）。10-23 16~19 时是 1.4~3.0 段/轮，23 时降到 0.71，00 时 0.08，**01 时起恒为 0**；同时「收尾正文」仍是 ~1 段/轮。也就是说模型不是不写正文了，是不再在干活途中说话，长工具链中间全空；用户中断后连收尾也没有，只剩「已完成 N 个工具」
- 同期 UI 层是干净的：最近 15 个会话跑 `constructSessionMessageRows` + `filterCollapsedWorkShellRows`，被折叠隐藏的正文行 **0 条**。所以别再从 UI 找这个 bug
- 处置：`core/src/plugin/system-prompt/deepseek.txt` 末尾加 `## Say what you found`（工具批次开头一句话、收尾必须有正文、以工具调用结尾视为未完成）。这是模型行为层，重启 sidecar 才生效（`.txt` 是 import 进 `plugin/optimize.ts`，按 `model.id` 含 deepseek 才附加）
- 复测脚本：`.preview-shell/stats-midtext.ts`（中途正文/收尾正文/步数按小时），`.preview-shell/stats-hours.ts`（字数/段数/工具）
- 「有时有正文有时没有」的判定口径：按回合结局分组统计（最近 40 小时）。`succeeded` 62 轮 **100%** 有正文、`failed` 2 轮 100%、`aborted` 8 轮 75%、**`running`（还没结束）7 轮只有 29%**。所以规律是：跑完必有正文；还在跑的基本没有（模型最后一步才写）；中途停掉看停在哪。别把「正在跑的那几十秒没字」当 bug——除非把「边干边说」的提示词加回去
- 复测脚本：`.preview-shell/stats-outcome.ts`
- 提示词不够：`deepseek.txt` 加了 `## Say what you found` 之后，用户 03:31 重启过（进程启动 03:31:01，晚于文件 03:25），03:33 那轮 15 步仍然一句话没写。所以光靠提示词管不住
- 硬兜底（core 主循环，唯一一处）：`session/runner/narrate.ts`（新文件，`NARRATE_EVERY_STEPS = 6` + `NARRATE_PROMPT`），`llm.ts` 里 `silentSteps(messages)` 从末尾往前数「连续没有非空 text 的 assistant 消息」（遇到 user 或第一个说过话的 assistant 停），`silent % 6 === 0` 时把 `Message.system(NARRATE_PROMPT)` 追加到 `transcript.messages`。**不改 toolChoice**，所以不会像 `MAX_STEPS_PROMPT` 那样把回合提前收掉
- `Message.system` 走 `toLLM-message.ts` 的 `case "system"` → `Message.system(text)`，OpenAI 兼容协议（deepseek）允许中途 system；这条只影响第 6/12/18… 步的请求尾部，前缀缓存不受影响
- 验证口径：core `tsc -b tsconfig.json` 干净（`test/variant-deepseek.test.ts` 是别人未提交的文件，本身有类型错，别当成自己的问题）；`bun test test/session-runner.test.ts test/session-step.test.ts` 235 过
- 兜底验证通过（03:43:23 重启后）：`03:45:05 / 03:45:09 / 03:45:25` 三步都是 `reasoning + text + tool`，正文是「我来找一下它在系统里的所有踪迹…」「进程 PID 3372 正在运行，但拿不到路径。我换个方式…」「进程路径读不到（很可能以管理员权限运行）。我用端口、自启动项和文件搜索交叉确认。」——这就是边干边说。之前同一条链路是 `reasoning + tool` 没有 text
- 注意：已经中断的老回合不会补正文（数据里本来没有），所以「有栏没文」只剩两种情况：中断、还在跑。别再拿老会话当回归样本
- 总栏位置 bug：`insertWorkShells` 的 `first` 原来只往前吞 `isReasoningWork`，所以「先说一句再调工具」的回合（很常见）会把那句正文留在壳外面 → 视觉上总栏落在回合中间，顶部只有正文没有栏（用户原话「有助手文本的时候没有顶部过程总栏」）。改成 `isWorkShellLead`（= isReasoningWork ∪ 单 part 的 text 行），`first` 一路前移到用户消息后面
- 前移是安全的：折叠时正文本来就被 `isWorkShellProse` 放行，不会因为进了壳而被藏
- 实测（`Cursor client.log explained` 第二轮）：`user-message → work-shell(已中断 6m12s) → 4 段正文 → turn-divider`，总栏在顶部、正文在下面
- 回归测试：`rows-current.test.ts` 的「puts the work shell above a turn that opens with prose」
- 贴顶口径改了（用户拍板）：**整轮都贴**，不再要求展开。`syncWorkShellSticky` 去掉了 `opened` 判断，只按「滚动边缘是否落在该回合跨度内」决定。跨度仍然从 head 一直算到该回合最后一行（含答案正文），越过下一个 UserMessage/WorkShell 就松手
- 收起态也能贴，是因为正文行本来就保留（`isWorkShellProse`），跨度没变短；被钉住时原位那份靠行属性 `data-work-shell-pinned="true"` 隐藏，实测 `hiddenHeads: 1`，不会出现两条栏
- 实测（`Cursor client.log explained`）：滚到答案中间时顶部浮出「已完成 9 个工具 31s」，正文在下面继续滚
- 编辑卡左侧对齐：链条里文件卡的标题列是 `--ind-col(19) + 8 = 27`（`basic-tool-tool-trigger-content` 的 gap 8 + indicator 19；`tool-loaded-item` 也用 27）。我之前给 diff 体设的 `margin-inline-start: var(--ind-col)` 只有 19，于是 diff 比文件名整体左移 8px —— 就是「左边没有竖对齐」。改成 `calc(var(--ind-col) + 8px)`
- 注意 `--ind-col` 只在过程壳作用域里定义（967 行），这条规则也只在 `[data-process-shell]` 里生效；顶层的 edit 卡仍是 `padding-inline-start: 0`（diff 贴图标列），如果哪天要统一，得连顶层一起改
- 体感三连（04:30 那轮）：
  - 正文底部 meta 去掉时长。`message-content.tsx` 的 `AssistantTextContent` 里那个 `duration()` memo 整个删了（含 `numfmt`），底部现在只有 `Build · model`。原因：总栏已经印了同一段时间，且格式还不同（`6m 11s` vs `6 分钟 11 秒`）。**注意**：原来的注释写着「截断方式和 formatElapsed 对齐，避免同一轮两个读数不同」——说明之前是刻意保留的，这次是按「一处只显示一次」的原则推翻它
  - `read` 单文件也用完整相对路径：抽了 `readDisplayPath(raw, directory)`（`tool-renderer.tsx`，和单条 read 行共用），`CurrentReadToolGroup` 里 `entries.length === 1` 时用它，多文件仍用文件名（三个全路径会被省略号吃掉）
  - 过程头工具名超过 3 种折叠成 `{前三种} 等 {总数} 种`（zh）/ `{前三种} +{n} more`（en），key `ui.processShell.moreKinds`，参数同时给 `count`(总数) 和 `more`(超出数)
- 键盘焦点那条**本来就有**：`[data-component="collapsed-tool-group"][data-process-shell] [data-slot="collapsible-trigger"]:focus-visible` 是后代选择器，链条里的工具行也被覆盖。别重复加
- 贴顶栏切换加了淡入：`stuckShellID()` 用 `<Show keyed>` 包住浮层，换回合时整块重挂载，CSS `@keyframes work-shell-pin-in`（140ms，opacity + translateY(-4px)）就会重放；`prefers-reduced-motion` 下关闭。注意 `keyed` 只在 id 变化时重挂，同回合内滚动不会闪
- 为什么**没做**「总栏展开时内容淡入」：总栏的成员行是 `filterCollapsedWorkShellRows` 过滤出来的虚拟行，滚动时行本来就会反复挂载/卸载；给链条加挂载动画会在快速滚动时整片闪。过程行（点开「过程 · 读取和 Shell」）本来就有 180ms 高度动画，那一层已经有反馈
- 为什么**没做**「回合末尾文件清单 vs 链条编辑卡统一缩进」：两者不是同一个容器。链条卡片在 `[data-slot="context-tool-group-item"]` 里，图标贴 item 左缘（+0，和同级工具行对齐），标题 +27；回合末尾的清单在消息正文列，行起点 = 文字列，图标 +12.6、徽章 +36.6、路径 +70。要对齐得重写其中一个组件，不是改个数字
- 文件行两处其实是**同一个组件**（`apply-patch-tool` + `[data-component="accordion"][data-scope="apply-patch"]`），差别只有 trigger 的 `padding-inline-start`：过程壳里被重置成 0，回合末尾保留默认 12px。实测回合末尾：文字列 225.1 / 卡片 225.1 / trigger 225.1 / 图标 237.7（+12.6 就是那 12px）
- 修法：把 `padding-inline: 0` 提到全局 `[data-component="accordion"][data-scope="apply-patch"] [data-slot="accordion-trigger"]`，两处都归零，图标贴块左缘
- 遗留 3px：回合末尾的文件行图标是 16px（`apply-patch-file-info [data-component="file-icon"]`），链条里标题列是 27（`--ind-col` 19 + 8）。所以展开文件行时，末尾清单的 diff 体（margin 27）会比文件名（16+8=24）右偏 3px。要彻底一致得按上下文给两个数
- 体感巡检（04:50，靠截图看出来的三处）：
- 1. `Grep "x" · /` —— `displayDirectory` 对根路径返回 "/"，行上就多一个无意义的斜杠。改成 `relative === "/" || "\\"` 时返回空串（调用方本来就有 `path() ? [...] : []` 守卫）
- 2. 一个中断回合里「已中断」出现三次（总栏、正文底部 meta、回合分隔线）。正文 meta 里的 `interrupted()` 去掉，只留 agent · model
- 3. **`过程 · {names} 等 {count} 种 · 14 个工具` 原样打印了占位符**：这个 i18n 是 `{{name}}` 双花括号，我按单花括号写的。三语都改了
- 教训：新增 i18n 文案后必须看一眼渲染，`i18n.t` 对单花括号不报错、直接原样输出
- 折叠口径改了（用户拍板）：**收起时只留这一轮的收尾正文，前面的过程旁白一起收进总栏**。原来是 `isWorkShellProse` 一律放行，于是「我先看 common.closeTab…」「中文只需要改这三个…」这些边干边说的旁白在收起后仍然铺满屏幕，总栏反而白收了
- 判定：`trailingProseIndexes()`（`timeline/work-shell.tsx`）算出每一轮**最后一串连续正文行**的下标，只有这些行在收起时保留。用「最后一串」而不是「最后一个 tool 之后的正文」，是因为回合常常先给答案、再跑一个 todowrite/校验命令，答案会落在最后一个 tool 之前
- 注意：`filterCollapsedWorkShellRows` 的入参是**数组**（`projection.rows()`），不是 `constructSessionMessageRows()` 的返回值——后者是 `{rows, ...}` 对象。写探针时踩过一次 `rows.forEach is not a function`
- 实测（`ses_e93afa6acffeuMrBqpXaUMfN3F` 第二轮）：收起后 DOM 只剩 `WorkShell → AssistantPart(改好了，右键菜单现在显示…) → TurnDiff`，两段旁白消失；截图 `.preview-shell/fix-10-fold-answer-only.png`
- 回归测试：`work-shell.test.ts` 新增两条（旁白被折叠只留答案 / 答案后面还有 tool 也保留）
- 链条里三类面的层次（改完的样子）：work-shell 头 = `work-shell.css` 的 layer-02 70%；过程头 = `message-part.css` 的 `collapsed-tool-group[data-process-shell] > collapsible > collapsible-trigger`，layer-01 100%，悬浮只加 `inset 0 0 0 1px border-strong` 的描边（原来 `background: transparent`，只有 hover 才有底色）；编辑行 = 链条 item 里的 `[data-component=apply-patch|edit|write-tool] accordion-trigger`，layer-02 72% 打底 + `border-weak-base 70%` 边框，hover/expanded 到 92%。
- 编辑行左边缘是 item.left，链条竖线在 item.left + `--ind-col`/2 ≈ +9.5，所以卡片会把那一行的竖线盖住（卡片在 item 的 `> *` z1 层，竖线是 ::before z0）。看着是「链条在这一行断开」，可接受。
- **踩坑一**：编辑行原来的 `border-color: transparent` 等规则一直没生效——`accordion.css`（components 层）用四个属性选择器设了同一批属性，消息侧的四个属性选择器打平后按源序输；要 5 个属性才赢。
- **踩坑二**：`message-part.css` 里 `[data-component="accordion"][data-scope="apply-patch"] [data-slot="accordion-trigger"] { background-color: ... !important }` 把每个文件行钉在 bg-base（回合末尾的文件清单靠它保持平铺）。所以链条里的卡片背景必须带 `!important`，否则永远被它按住。
- **踩坑三**：卡片规则写在「`[data-component=apply-patch-tool]` 组」里时，选择器只能往后加；把 `context-tool-group-item` 写到 tool 前面会变成 `item ... tool ... item ...` 的倒序（祖先顺序反了），编译通过但永不匹配。最后选择器写在 item 块内、以 tool 开头。
- 对齐：`apply-patch-file-info` 里的 `file-icon` 原来 13px，标题因此比 Shell/Read 行的标题左 5.4px（tool 行是 19px 指示列 + 8px gap = 27）。把 icon 盒子设成 `width: var(--ind-col, 19px); height: 13px`（字形靠 `preserveAspectRatio` 居中，仍是 13px），标题落到 +27，实测 217.71 vs 218.29（0.58px 残差来自 icon 盒子的亚像素起点，忽略）。
- 视觉验证方法（可复用）：`.preview-shell` 的 vite（5199，必须 `env -u NODE_OPTIONS` 起，否则安全删除拦 `node_modules/.vite`）+ 无头 Chromium 开 `--remote-debugging-port=9444`，用 `.preview-shell/measure-rows.mjs`（量 rect/背景）、`hover-check.mjs`（悬停前后 computed）、`clip-shot.mjs`（局部 3-4 倍截图）、`eval-cdp.mjs`（任意表达式，查 CSSOM 里规则是否编译/匹配）。`?doc=edit&open=1`、`?doc=terminal&open=1`、加 `&scheme=light` 看浅色。
- 原来「贴顶改成整轮都贴，收起的总栏也贴」这条被用户否掉了：**收起的总栏不再贴顶悬浮**。`virtualizer.tsx` 的 `syncWorkShellSticky` 里加回「只有展开才 pin」：抽了 `workShellOpen(userMessageID, status)`（`toolOpen[key]` 优先，否则 `workShellDefaultOpen(status)`），`rows` 过滤、pin 渲染、`syncWorkShellSticky` 三处共用同一个判断，避免三者说法不一致。
- 同一份规则同步到 `work-shell.css`：sticky 规则从 `[data-status="running"]` 收窄到 `[data-status="running"][data-open="true"]`（disconnected 同理）。实测：展开时 `position: sticky; z-index: 22`，收起后 `position: static; z-index: auto`。
- 生效链路：收起 → `toolOpen` 变 → `rows()` memo 变（且 `syncWorkShellSticky` 直接读 store）→ effect 重算 → `stuckShellID` 清空 → 浮层卸载 + `data-work-shell-pinned` 撤掉，原位头恢复可见。
- **流式工具输入**：`currentToolInput` 原来对 streaming 状态用 `JSON.parse`，半截 JSON 直接失败返回 `{}` —— 所以编辑行在写入期间只有「编辑」两个字，没路径、没加减、没卡片。新增 `partialToolInput(raw)`（逐字段扫，值没闭合也返回已到的部分），严格解析失败时回退到它。这一条对所有流式工具都生效，不只是编辑。
- **实时加减**：新文件 `tools/stream-changes.ts` 的 `streamedLineChanges(input)` —— 有 `patchText` 就数 `+`/`-` 行（跳过 `+++`/`---`）；有 `newString`/`content` 就用 `diffLines` 做真 diff（>2000 行退回 head/tail 计数）；`oldString` 为空时 additions = 行数、deletions = 0。`edit` 和 `write` 渲染器的 `actions` 不再等 `!pending()`：pending 用实时值，完成后仍用 completion metadata。
- 验证夹具：`.preview-shell/fixtures.ts` 加了 `streamingEditDocument`（`?doc=streaming`），截图上流式卡片已带路径和 `+2 -1`。
- **时间轴跳转两个真 bug**：① `revealMessage` 用 `projection.messageRowIndex()`（未过滤投影）算索引，而虚拟列表渲染的是 `rows()`（折叠 shell 会丢掉成员行），索引偏大 → 落点在该轮后面，气泡在视口外。改成在 `rows()` 里找 `UserMessage` 行，`align` 由 `center` 改 `start`。② `scrollToElement` 的 `- inset`（粘性标题 64px）会被虚拟化层延迟执行的 `scrollToIndex` 覆盖，气泡贴到视口顶边、正好藏在标题下面；`seek` 改成同步滚一次后再连补 3 帧（`queue` + `"auto"`，已就位时是空操作）。
- 实测（两个刻度）：落点气泡 top = 64，正好在粘性标题下沿。
- 调试坑：① `cdp.mjs` 的 `list.find(type === "page")` 会挑到 `about:blank` 那个目标，改成优先 `localhost:5173`；② 窗口被遮挡时 `visibilityState: hidden`，rAF 暂停、注入的输入无效，先 `Page.bringToFront` + `Emulation.setFocusEmulationEnabled` 才能量。
- 用户给了张多文件链条的截图问「是不是 UI 有问题」。用 `.preview-shell` 的 `?doc=multi` 夹具（3 张卡片 + shell + 3 张卡片，复刻那张图）逐项核对，量到两个客观问题：
  - **相邻卡片粘在一起**：链条 list 的 `gap: 1px`，两张卡片的 1px 边框正好贴成一条，看起来像一整块。卡片 trigger 加 `margin-block: 1px`，现在两张之间有 1px 缝（实测 top 173..201 / 202..230）。
  - **卡片和过程条同一个灰**：暗色下 layer-01 = 36、layer-02 = 46、page = 22（srgb 值 0.141/0.180/0.086）。过程条满色 layer-01 = 36，卡片 72% layer-02 混 page = 39.3，头部 70% layer-02 = 39.3 —— 也就是「头部 ≈ 卡片 > 过程条 > 页面」。卡片靠边框和圆角区分，亮度不能超过头部，别再往上调。
  - 没改的：每张卡片都会把链条竖线盖住一段（卡片 z1，竖线是 item 的 ::before z0）。看着像链条断格，要连成一条就得把竖线提到卡片之上，但那样会穿过文件图标。
- 夹具注意：`metadata.files[]` 必须是完整 `FileDiffInfo`（`changedFileDiff` 要求 `file`/`patch`/`additions`/`deletions`/`status` 全有），少了 `patch` 就退化成没有路径的裸「Edit」行。
- **链条竖线已删**：`message-part.css` 的 `[data-slot="context-tool-group-item"]::before`（rail）和 `::after`（19px 遮罩 chip）都不在了。原来编辑卡是 trigger 当卡片，rail 在 `item.left + 9.5` 落在卡片内侧被盖住、又在卡片下方 27px 缩进区露出来，五行的链条读成「线—空—线」；用户原话「不要左边的竖线了，不然跟编辑卡对不上」。现在行只靠 `--ind-col: 19px` 图标列对齐。`--rail-x` / `--chain-rail` 只服务思考正文的渐变条（`markdown::before`，仍保留）。
- **编辑卡的卡片容器是 `accordion-item`，不是 trigger**：`[data-component="apply-patch-tool"] [data-slot="accordion-item"]` 拿边框 / 圆角 6 / layer-02 72% 底色 / `overflow: hidden`；trigger 改成透明无边框，展开时 `[data-expanded] [data-slot="accordion-header"]` 加 border-bottom 当分隔线。原来 trigger 自己画卡片 → 展开后是「有边框的标题条 + 另一个宽度的 diff」两个盒子，这就是用户说的「宽度也不对」。
- **diff 体不再左缩进 27**：原 `margin-inline-start: calc(--ind-col + 8px)` 只缩左不缩右，实测 acc 317.71→920.71 而卡片 290.71→893.71 —— 比卡片宽 27px，还溢出过程壳右边界 19px。现在 `margin-inline: 0` + `border: 0` + `background: transparent`（`accordion.css` 会给展开的 content 加边框和 layer-01 底，会变成卡片里的第二个盒子）。
- **相邻卡片要覆盖 `-1px`**：`accordion.css` 的 `& + [data-slot="accordion-item"] { margin-top: -1px }` 是让边框合并的，链条里改成 4px，否则两张文件卡贴成一整块。
- **卡片焦点画在 item 上**：trigger 的 outline 会被 item 的 `overflow: hidden` 裁掉，`accordion.css` 本身又是 `outline: none`，所以用 `&:has(> [data-slot="accordion-header"] [data-slot="accordion-trigger"]:focus-visible) { border-color: --v2-border-border-focus }`。
- **编辑卡限高 + 收起条（最终版）**：`FileAccordionItem`（`tools/tool-renderer.tsx`）新增可选 `collapse` prop；传了才给 item 加 `data-scroll`、内容包进 `[data-slot="accordion-body"]`、底部渲染 `[data-slot="accordion-collapse"]`。`patch` 渲染器传 `i18n.t("ui.patch.collapse")`（en/zh/zht 新增 Collapse/收起/收合）。限高 340px，body 内部滚动。
- **条只在溢出时出现**：`ResizeObserver` + `scrollHeight > clientHeight + 1`；**动画期间要跳过**——`fold.getAnimations().some(playState === "running")` 时直接 return，否则展开过程中每一帧的 clientHeight 都很小，每张卡都会被判成溢出。
- **`chevron-up` 这个图标原本不存在**：`Icon` 对未知名字回退成 `plus`，所以第一次做出来的「收起」是个加号（用户两次反馈「图标不对」「上下反了」）。已在 `ui/src/icons/icon/additional-icons.ts` 补一条（chevron-down 的 y 镜像），名字表从 `additionalIcons` 的 key 自动推导，不用改 catalog。
- **折叠动画**：`<Show when={open}>` 换成常驻的 `[data-slot="accordion-fold"]` + `grid-template-rows: 0fr ↔ 1fr`（开 180ms `cubic-bezier(.22,1,.36,1)` / 关 140ms `cubic-bezier(.4,0,1,1)`，和过程壳同一对曲线）。`display:none` 无法过渡，所以内容必须常驻；`visibility` 在关闭时延迟 140ms 变 hidden，把折叠子树移出 tab 序和 a11y 树。实测帧序列 0→140→220→274→306→324→333→340。
- **代价**：内容常驻后，`deferContent === false` 的卡片（回合末尾文件卡）收起时 diff 仍渲染。链条内是 `deferContent: true`，由 `visible()` 控制，不受影响。
- 每轮变更摘要（设置 `settings.general.showTurnDiffs`，默认 false，上游 81d57087a4）：客户端在 `session-ui/src/timeline/projection.ts:337` 用每个 step 的 `snapshot.files` 并集预填，`projection.ts:324` 在 idle 消息上挂 diff 行，`from` = 该轮第一个 prompt（引导并入同一轮，行的 `userMessageID` 是最后那条 steer）
- 摘要的实际算法在 `core/src/session/diff.ts:107-140`：以上一个 idle 标记定位轮次起点，取第一个 step 的 start 快照与最后一个 step 的 end 快照做**整棵工作区**树 diff；路由 `server/src/handlers/session.ts:496`；客户端只传 `from`（`session-ui/src/timeline/session-timeline-row.tsx:779`）
- 所以「该轮更改的文件」= 区间内工作区差异，不是 agent 写过的文件：用户手动改/其他会话改都会算进来；同一轮里改完又改回的文件预填列表有、加载后消失；gitignore 文件被过滤（`core/src/snapshot.ts:166-175`），>2MB 未跟踪文件不捕获（`snapshot.ts:134`）
- 摘要缓存 `app/src/session/timeline/turn-diffs.ts:12`，key = `${sessionID}/${from}`，每 tab 加载一次且永不失效（一轮结束后快照区间不变，所以缓存本身没问题）
- shutdown 中断的那一轮不写 idle（`core/src/session/message-updater.ts:149-150`）→ 它没有摘要，改动会被下一轮的区间吞掉
- 已修（2026-10-25）：每轮变更摘要改成「路径以本轮 step 并集为准、服务端 diff 只补增删数」，改动在 `session-ui/src/timeline/session-timeline-row.tsx:778-798` 的 `changed()`（对 `props.row.files` 做交集）；顺带让加载前后行序一致（原来加载后按 git 顺序重排）
- 实测证据（会话 `ses_e90f7175cffeIL5AKba585f4GC`，DB `~/.local/share/opencode/opencode-local.db`，快照仓 `~/.local/share/opencode/snapshot/a7b03e49.../f52794f6...`）：轮「就是主页会话的选择…」区间差异 3 个但 step 并集只有 `view.tsx`，多出的 `.tmp-gap.db-shm`、`packages/core/gap-bench.tmp.ts` 是别处的写入；轮「UI UX重新设计下…」多出 `packages/core/src/filesystem/trigram-search.ts`，是同一时间窗口里另一个会话改的
- 会话数据取证手法：`session_message` 按 seq 排序取 user/assistant/idle，assistant 的 `data.snapshot.{start,end,files}`；用 `git --git-dir=<快照目录> diff --name-only <start> <end>` 复现服务端区间差异（快照目录是裸仓库布局，没有 .git 后缀）
- 2026-10-25 收尾：#1、#2 都按「一条 prompt 一个摘要」重做。`session.diff` 新增 query `prompt`（`protocol/src/groups/session.ts:527`，`core/src/session/diff.ts:92-108`）：带它时 `start = anchor.seq`、`end = min(下一条 prompt, 本轮 idle)`，不带时行为与上游一致（review 面板走无 `from` 的默认路径，不受影响）
- 客户端：`session-ui/src/timeline/projection.ts` 的 `Turn` 增加 `files: Set<string>`，每步的文件归到它**跟随的那条 prompt**（`record()`），idle 时给本轮每条 prompt 各发一个 diff 行，位置在该 prompt 自己那组的末尾；行类型去掉 `from`（= `userMessageID`），key 从 `turn-diff:${messageID}` 改为 `turn-diff:${userMessageID}`（两条 prompt 共用一个 idle，旧 key 会撞）
- 摘要行不再预填 step 并集：`session-timeline-row.tsx` 的 `paths()` 只取加载后的 `changed()`，`Show` 以它为准 —— 消除「先列后撤」（写了又删的临时文件、外来改动都不会先冒出来）。`pendingFiles` 参数已删
- 缓存 `turn-diffs.ts` 的 key 追加 `:prompt` 后缀，避免同一条 message 的两种范围共用一个槽
- 验证：`packages/{client,protocol,core,server,session-ui,app}` typecheck 全过；session-ui `bun test src` 275 过；core `test/session-diff.test.ts` 过（新增 prompt 切片断言，注意本机跑它要先 `PATH=~/.cache/opencode/bin:$PATH`，否则会去下载 rg 触发网络禁止）；app `turn-diffs.test.ts` 过；`bun run lint` 0 error
- 内部工具适配缺口（2026-10-25 修）：core 注册的 recall（项目记忆）和 todowrite 在 UI 无任何分支——过程头 `names()` 落 default 显示英文原名、`contextToolIcon` 落 default 显示 mcp 插头图标、链上行走 GenericTool「调用了 recall」。todowrite 更甚：`ToolDisplay` 直接 return null，链上出空行但 `countWork` 照计「N 个工具」。
- 修法：`toolTitle` 加 recall/todowrite 分支（`ui.tool.recall`=记忆检索/Recall/記憶檢索、`ui.tool.todo`=待办/Todo/待辦）；`contextToolIcon` 加 recall→brain、todowrite→checklist；注册 recall 渲染器（brain 图标 + query 副标题 + Markdown 输出）。
- 分布数据：最近 25 个会话 recall 出现 5 次、todowrite 0 次（experimental.todo 未开）；其余工具名全部有映射。
- 验证：`?doc=recall` 夹具（`.preview-shell/fixtures.ts`），展开链上「brain 图标 Recall + query 副标题」与 Shell 行对齐；session-ui 275 测试过，ui/session-ui tsc 干净。
- 过程壳视觉重做（2026-10-25，纯 CSS，message-part.css）：链行从裸文本改为安静芯片（bg-layer-02 48% 填充、radius 7、margin-inline -5/-8 拉到壳边缘）——与 edit 卡片同一负 margin 技巧，但 flex 父级下负 margin 不参与拉伸，必须显式 `width: calc(100% + 13px)`（`auto` 在 row-flex 里走内容 sizing，`100%` 解析后忽略负 margin，两个坑都实测过）。图标底座原 bg-base（遮竖轨用）改 transparent，否则在芯片上出现深色方块。头部条：30px 高、radius 8、常驻发丝 inset 边框（hover 才 rim 是旧观感）。排版层级：链标题 12.5/500/muted、副标题与参数 12px/faint、时长类 meta 11.5px + tabular。动效：展开 220ms cubic-bezier(0.16,1,0.3,1) 带 translateY(-6px) 滑入、收起 150ms、chevron 220ms 同曲线。链行间距 gap 1px→3px，edit 卡片间 margin-top 4→3 同步。竖向导轨仍不恢复：芯片自带边界后更不需要。measure 脚本验证头部与芯片 rect 完全一致（185.7–801.7）。
- 过程壳视觉重做（2026-10-25 晚）：纯 CSS 链行芯片化 + 头部条加边框 + 字号层级 + 动效缓出，全部验证过——但用户看了实物反馈「还不如之前的」，已整体 git checkout 回退（备份在 .preview-shell/message-part.css.ux-redo.bak）。原来链行裸文字的形态才是用户要的素净感；过程壳样式未获确认前不要再主动重设计，先出截图/小样让用户选。
- 过程壳设计方向（2026-10-25 晚，两轮被否）：第一轮做减法（去填充条、12.5→12/13、加 1px 导轨）被判「还不如之前的」；第二轮做「轨迹线 + 语义摘要」被判「更难看」。用户明确要求「美化/换样式，不是减法」→ 方向应为加：保留并强化容器（底色 + 1px 描边 + radius 10）、字号提到 14/13/12、标题用 text-base。
- 三个候选方案落在 `.preview-shell/compare-process-shell-v2.html`：A 整块卡片（#2e2e2e 卡 + 40px 头 + 1px 分隔线，链条 161px/5 步）、B 实心头 + #222 内嵌井（头 42px #3a3a3a，井半径 8，链条 175px）、C 每步一张 36px 小卡（链条 214px）。
- 现状实测（预览壳 ?doc=recall，1024 窗口）：列宽 680；气泡 #242424 / radius 10 / padding 8×12 / 15px-22.5；过程条 min-height 26 + padding 3+3 = 32px、radius 6、底色 layer-01；答案与过程条间距 32。
- 硬约束：Windows 上 font-weight 460/500 都落到 400，层级只能靠字号与颜色——之前几次改样式的「一片灰」都源于此。

## 默认 UI 字体

- 设置默认：`packages/app/src/settings/model.tsx` 的 `sansDefault` / `sansFallback`（空值回落到这）
- CSS 初值：`packages/ui/src/styles/theme.css` 的 `--font-family-sans`
- 加载：`packages/app/src/index.css` 的 `@fontsource-variable/noto-sans-sc` + `font-family: "思源黑体"` 的 local()；Inter 仍保留给手动填写
- ???? default ?? 880px?? 744??wide 1040 / full 100%???????
- ?????? IBM Plex Mono ????????? UI ????????????????`index.css` ?? Plex Regular/Text/Medium ??????? Text ???????
- ?????????`SteppedSlider`??????????? `appearance.tsx`??? 12?18??? 15??? `appearance.fontSize` ?? `applyFontSizeTokens` ?? `--font-size-*`

## 全局右键菜单

- `packages/app/src/shell/context-menu/`，挂在 `app.tsx`；原生 `electron-context-menu` 留给 webview，别删
- 用 Kobalte DropdownMenu 程序化打开；开着再右键要先关再开，且不能有退场动画
- ???????????? `packages/app/src/shell/ui-inspect/`?? app DOM ? ?? ? `composer.context.add` note?origin `ui`????? Electron `webContents.inspectElement`
- ???`context-menu.tsx` ? `view.inspectElement` ? `startUiInspect()`????? `app.tsx`?`UiInspectComposerBridge` ?? session/draft ? `ComposerPersistenceProvider` ?
- F12 /???????????? `view.toggleDevTools`

## 对话区这几块的美化

- 会话错误行：`SessionError` 用 `<Card variant="error">`，但 `session-turn.css` 把 `--card-pad-*` 全设 0 且隐藏了 `::before`，所以只剩一行红图标 + 裸文字。改成 `--v2-state-bg-danger` 底 + `--v2-state-border-danger` 边 + 8/10 padding + 8px 圆角（和 `[data-component="diagnostics"]` 同一套危险态 token），文字仍用 `--v2-text-text-base` 保可读，图标用 danger 色并 `margin-top: 1px` 对齐首行
- 问答体：`question-answers` 原来 `padding: 8px 0`，正文和行标题不对齐。现在自己带 `padding-inline-start: calc(--ind-col + 8px)`，并用 `[data-slot="collapsible-content"][data-expanded]:has(> [data-component="question-answers"])` 把父级那 12px 通用缩进清零（`[data-expanded]` 是为了压过 basic-tool.css 的 4 级选择器）。问句 12.5/muted，答句 13/base 且挂 2px 左边线（`--v2-border-border-strong`，base 太淡）
- 时长文案：整分钟不再带 "0 秒"/"0s"。`ui.message.duration.minutes`（en/zh/zht 新增）+ `formatElapsed` 的 `rest === 0` 分支
- `question` 工具在 `toolGroupType` 里恒返回 undefined，所以它永远是独立行，不会进 process chain——上面的 `:has` 其实只需要独立行那种情况
- 沙盒坑：`.preview-shell` 里改完 CSS 再热构建会挂在 `packages/ui/src/styles/index.css` 的 `@import "katex/dist/katex.min.css"`（root 没有 katex，只有 `packages/ui/node_modules` 有）。所以沙盒只能吃到已生成的缓存 CSS；要重新构建得先在 root 装 katex 或换个入口
- ?????`AssistantTextContent` ? `duration`?`message/message-content.tsx`??? `Math.round(ms/1000)`??? `formatElapsed`?`timeline/work-shell.tsx`?? `Math.floor`??? `turnDurationMs` ? 371.x ??????6m 11s???6 ?? 12 ????????? floor?? `<1s` ????????????????????????

## 项目记忆

- 抽取：`core/src/session/project-memory.ts` 的 `parseSummary` —— 只取 `## Decisions` / `## Relevant Files` / `## Important Context`，丢掉 Work State / Next Move（进度不出会话）。纯函数，无模型调用。
- 存储：`project-memory-store.ts` 走现有 KV 表，key 是 `project-memory:<项目目录>`，不建表、不改 schema、不写仓库。
- 淘汰：`verify(facts, exists)` 对每个路径跑存在性检查，连续 2 次缺失才删；无路径的散文事实不参与校验（没证据就不猜）。
- 接线：`config/plugin/project-memory.ts` 订阅 `session.compaction.ended`（事件带 `text`），`internal.ts` 单点注册。**没改 `session/compaction.ts`**。
- 召回：`core/src/tool/plugin/recall.ts`，工具名 `recall`，输入 `query` + `limit`。打分在 `project-memory.ts` 的 `search`：路径命中 +3、正文命中 +1、失效 -1，同分看 `seen`。输出是行文本（事实 + 路径），agent 直接照路径去读。
- 已知边界：路径校验只能发现「文件没了」，发现不了「文件还在但结论错了」（`packages/theme` 就活下来了）。
- 演示：`bun packages/core/script/project-memory-demo.ts .preview-shell/summary-sample.md "工具栏 按钮"`，跑真实抽取 → 校验 → 召回。
- 已落地 repo map + notes 索引注入（2026-10-24 01:45）：新增 `packages/core/src/config/plugin/project-map.ts`，在 `session.hook("context")` 里把 `.sicode/structure.md` 全文 + `.sicode/notes.md` 的 `## ` 标题列表作为**新的 system part 追加到末尾**（不改 system[0]，保住 provider 缓存前缀）。注册在 `packages/core/src/plugin/internal.ts` 的 post 数组。
- 实测注入体积 **3296 字符 ≈ 1030 token**，每轮成本 0.077s；换掉的是「读 structure.md + 跑 notes.ts list」那 1-2 轮（10-25s）。净收益 5-20s，主要价值是模型从第一轮就知道东西在哪。
- **不注入 notes.md 全文**：它已 27.8KB ≈ 8.7K token，每轮 0.65s × 55 轮 = 36s，和省下的探索时间基本打平，还会稀释注意力。
- AGENTS.md 同步改了两条：Repo map / Investigation notes 从「去读」改成「已经在上下文里，别再读」，并新增 `## Delegating exploration`（不知道在哪就先派 explore，两次 grep 没收敛就派，已知文件/小改不要派）。
- 验证：`test/project-map.test.ts` 4 例全过；optimize/verbosity/plugin 36 例、session-runner 270 例全过；`tsc -b --force` 0 错误。
- **`tool/plugin/history.ts`（SiCode 自研，2026-10-25）**：压缩后回溯压缩前的原文。读 `SessionStore.messages()` 全量（不限 seq），`boundaryOf` 取**最后一条 status=completed 的 compaction** 的索引作为边界，之前的消息经 `SessionRecentText.messageToText` 转文本后做关键词匹配（query 按空白/逗号/分号切词，任一命中即算命中），不给 query 返回最近 limit 段；单段超 1500 字符保留头+尾。返回 marker 形如 `N of M archived exchanges, from before the last compaction`。注册点 `plugin/internal.ts` 三处：插件表、`SessionStore.Service`、`SessionStore.node`；`session/` 内核零改动。边界必须是**最后**一条 compaction 而不是第一条——SiCode 的摘要是全量覆盖而非增量，取第一条会漏掉中间段（测试里踩过：期望 `[middle]`，实际 `[old, middle]` 且实际行为才对）。
- **`tool-output.ts` 截断策略（2026-10-25 改）**：`TAIL_SHARE = 0.4`，head 先取 60% 行预算 + 全量字节预算，tail 再取剩余行/字节预算且不回头吃 head；marker 形如 `[showing lines 1-1200 and 2202-3001 of 3001; full output saved to …]`。含 `file` part（图片）的结果走 `boundedHead`，只留头部以保住图文原顺序。默认限额 `MAX_LINES=2000` / `MAX_BYTES=50KiB`。
- 验证纪律：这类截断改动**不要用「让模型跑大输出」的 E2E 去证**——模型会在 shell 里用变量/管道自己过滤，`metadata.truncated=false`，截断层根本没跑（2026-10-25 实际踩到）。要用服务层确定性测试：`test/tool-output.test.ts` 里直接调 `ToolOutput.Service.truncate`，默认限额 + 3001 行样本。

## 工具执行并行

- 结论：引擎层同 step 内的工具调用本来就是并行的，不是穿插串行。`packages/core/src/session/runner/step.ts:122-134` 每收到一个 `tool-call` 事件就 `Effect.forkScoped` 起一个 fiber；`:151` 用 `Fiber.awaitAll` 收口。`:103` 注释「Provider and tool fibers retain per-source order without a shared writer queue」说明没有共享写队列。
- 真正让 write/edit 看起来串行的三处：
- 1. 权限闸门（主因）。`tool/plugin/write.ts:78`、`tool/plugin/edit.ts:275` 每次写都 `permission.assert({ action: "edit", save: ["*"] })`；`permission.ts:78-83` 未命中规则时默认 effect 是 `ask`，工具 fiber 卡在 `Deferred.await`（`permission.ts:238`）。UI 一次只呈现一个：`app/src/session/requests/model.ts:71-79` 的 `permissionRequest` 用 `sessionPermissionRequest` → `session-request-tree.ts:13-17` 的 `.find()` 取第一个，`session-permission-dock.tsx` 只渲染单个 DockPrompt。所以 N 个并发 edit 会有 N 个 pending，但要逐个点。
- 2. 同文件互斥。`edit.ts:315` `fileMutation.withLock([path])`；`file-mutation.ts:71-74` 是按 resolve 后路径排序加锁的 KeyedMutex。同文件必须排队（防丢更新），不同文件不排队。
- 3. 模型侧一次只发一个 tool call → 落到不同 step，天然串行，与 SiCode 无关。系统提示词 `session/runner/prompt/system.txt:6` 只是「Prefer parallelizing independent tool calls」。
- 放开并行的三种做法：点「始终允许」→ `save: ["*"]` 存下 action=edit/resource=* 的 allow 规则（`permission.ts:290-296` + `permission/saved.ts:69-84`），之后直接 allow 不生成请求；或开「自动接受权限」（命令面板 `permissions.autoaccept`，`app/src/session/requests/auto-approve.ts:139` 客户端代答 once，仍有往返）；或配置 `permission: { edit: "allow" }`（v1 形态，`config/normalize.ts:180` 迁到 permissions 规则）。
- 若要让 UI 真正批量呈现，只需改 `app/src/session/requests/`：`session-request-tree.ts` 返回列表、`model.ts` 暴露数组、dock 渲染多条。纯 app 层改动，不碰 core。
- 原来以为权限闸门是本机观感串行的主因，实测**不成立**：本机 `%APPDATA%/com.sicode.desktop.dev/drafts.sqlite` 的 `state` 表 `settings.v3` 里 `permissions.autoApprove = true`（默认值是 false，见 `app/src/settings/model.tsx:301`），`model.tsx:76` 一旦 `autoApproves()` 就直接 return，dock 根本不渲染，`auto-approve.ts:139` 自动回 once。所以本机从来没有权限等待，edit/write 的 `permission.assert` 走的是客户端代答而非人工点击。
- 推论：本机剩下的串行只有「同文件 KeyedMutex」+「模型一个 step 只发一个 tool-call」。后者才是主因——历史会话统计 79% 的轮次只发 1 个工具调用（平均 1.1、最大 3）。
- 设置项语义：`permissions.autoApprove` 是**客户端本地**默认值（存 drafts.sqlite，不跨机器同步），`autoApproveProjects` 是 per-project 覆盖；`autoApprovesOnServer()` 用于决定是否挂事件监听。开启后所有工具（含 shell）都不再询问，只影响"要不要等点击"，**不影响并发度**。

## 会话性能诊断

- 数据源：`~/.local/share/opencode/opencode-local.db`（当前 local 通道）。`session_message` 按 `seq` 排；assistant 的 `data.time` 有 `created`/`streamed`/`completed`，`data.tokens` 有 `input`/`output`/`reasoning`/`cache.read`/`cache.write`；`content[]` 里 `type=="tool"` 的 part 带 `state.metadata.toolCalls`（codemode 内部调用）。
- 关键口径：**`time.streamed` 不是首字时间**，它在 `runner/step.ts:149` 于 provider 流结束后才发布，所以 `created→streamed` 是整段模型调用，`streamed→completed` 是工具等待与落库（中位 0.7s）。别把 streamed 当 TTFT。
- 分离固定开销与生成本钱的方法：对每轮拟合 `dur = a + b·(output+reasoning)`。实测 `ses_e96a7a3e8ffeVS06Z9J92snwZq`（档位滑动变阻 demo）：`dur = 9.91s + 0.0041s/token`，边际 244 tok/s，**每轮固定开销 9.9 秒**，125 轮合计 1288s = 总时长 81%；生成 token 只占 309s。固定开销来自 provider 首字延迟 + prefill 排队，与 SiCode 无关。
- 压缩触发口径：`compaction.ts:1104` `calculateCeiling` = `window - max(floor(window*0.15), window>=32000 ? 16000 : 0)`。配 `limit.context: 48000` → ceiling **32000**，context 一到 32K 就压。该会话 30 分钟压了 13 次，每次 10-20s（约 180s / 10%），且压缩重写前缀会打断 prompt cache。
- `limit.output` 配小了会让 reasoning 吃满预算：该会话 2 轮 `finish=="length"`、`output=0 / reasoning=8000`，白等 49.5s + 39.4s 并触发 synthetic 续写。
- `deepseek-v4.1-flash` 在 `models-dev/snapshot.txt` 里的真实上限是 context 1048576 / output 384000（多数 provider），配 48000/8000 只用掉 4.6% / 2%。
- （已撤除，见本段末）read 会话级去重曾落地：新增 core/src/tool/read-cache.ts（纯函数 + 模块级 Map，指纹用 FNV-1a，只存 hash 不存正文，每 session 最多 512 条、最多 64 个 session），`tool/plugin/read.ts:112-128` 在成功读取后比对 `(sessionID, resolved path, offset, limit, content 指纹)`，命中则用 `ReadCache.notice()` 返回一行指针而不是全文。
- 关键实现细节：**只替换 `content`，`output` 仍返回完整内容**。因为 `tool/runtime.ts:259 normalizeContent` 对 string 直接用 content，而 codemode 的 `execute` 读的是 `output`，这样两边都不受影响。`typeof content !== "string"` 用来跳过图片/PDF（base64 分支返回数组）。
- 失效：`config/plugin/read-cache.ts` 订阅 `session.compaction.ended` 调 `ReadCache.forget(sessionID)`。理由：压缩会把已读内容从请求里删掉，此时返回「你已读过」就是错的。注册在 `packages/core/src/plugin/internal.ts` 的 `post` 数组，紧跟 project-memory。
- 配套 prompt：`packages/core/src/plugin/system-prompt/deepseek.txt` 新增「## No repeated reads」段（未修改不重读、只读改动区段、同轮不重复同路径、压缩摘要不等于文件变了）。
- 验证：read-cache 单测 8 例全过；core `tsc -b --force` 0 错误；tool-execute/model-plugins/plugin 相关 41 例全过。
- 注意：这项**不减少轮次**，只减少每轮注入的上下文体积。回归 `dur = 6.79 + 0.00418·gen + 0.000122·ctx`，上下文每省 1000 token ≈ 每轮省 0.12s。
- 回放模拟（按实现的 key+指纹+压缩清空逻辑重跑历史 read）修正了收益预期：`档位滑动变阻 demo` 163 次 read，**按现实现命中 0 次**；只有「不因压缩清空」时才有 43 次命中（26%，少注入 304K 字符）。原因很关键：**精确重复（同 path+offset+limit+同内容）全部跨压缩边界**，而跨边界正是内容被删的时刻 —— 所以去重必须和不压缩配套，单独存在时收益为零。
- 另发现模型几乎不重复「同一 offset/limit」：它会用不同区段反复读同一文件（如 seq 1678 一轮读 1-120/300-420/700-940），所以按区段命中的天然上限不高。若要覆盖「重叠区段」，得改成按行区间合并判断，复杂度显著上升，暂不做。
- 实测对照（`ses_e964f39bfffemD628K1XVV1Q8I`「思考强度语言不跟随设置」，00:55 起，重启后首个会话）：**压缩 0 次**（旧会话 30 分钟压 13 次），证明删 `limit` 生效；上下文末值涨到 102913 仍未撞 200K 默认窗口。多工具轮 29/48 = **60%**（旧 36%）。但**每轮固定开销 8.97s 几乎没变**（旧 9.9s），模型占墙钟 **100%**（工具耗时≈0）。
- **read 去重第二次实测仍是 0 命中**。原因在 `read 明细` 里很清楚：22 次 read 覆盖 14 个文件，同一文件的重读全部换了区段（editor.tsx 依次 320/90、None/40、355/45、357/40；model.ts 240/60、380/60、None/60）。模型从不重复「同 offset+limit」。按区间覆盖判断可多抓 8 次，但折合上下文仅约 14K token ≈ 1.1s，不值得实现。
- 结论修正：**read 去重对 DeepSeek 无价值**，可撤；真正可动的只有轮次数（24 轮/需求）与 provider 的 9s/轮。
- **read 去重已按实测撤除（2026-10-24 01:10）**：删除 tool/read-cache.ts、config/plugin/read-cache.ts、test/read-cache.test.ts（均已删除），并还原 `packages/core/src/tool/plugin/read.ts`、`packages/core/src/plugin/internal.ts`、`packages/core/test/tool-read.test.ts` 的改动（internal.ts 只留原有的 project-memory / recall 注册）。两次实测 0 命中，模型从不重复同 offset+limit，该路径无产出。
- 保留的改动只有 `packages/core/src/plugin/system-prompt/deepseek.txt` 的「## No repeated reads」段（实测会话多工具轮从 36% 升到 60%，但样本 1 个、任务类型不同，不能算证实）。
- 撤除后验证：core `tsc -b --force` 0 错误；tool-read / tool-read-filesystem / model-plugins 共 59 例全过；`grep -rn "read-cache|ReadCache"` 无残留。
- **原来「删掉 limit 让上下文不压缩」对速度是错的**，实测反证：把 `ses_e964f39bfffemD628K1XVV1Q8I` 的 48 轮按上下文大小分桶，**gen 归一后每轮耗时随上下文单调上升** —— ctx 17.8K → 5.3s/轮；43.9K → 7.0s；82.3K → 10.6s；100.6K → 11.5s。即 **约 0.075s / 1000 上下文 token**，而缓存命中率已有 96.2%，说明命中的 prefill 也不是免费。
- 推论：不压缩时上下文会一路涨（该会话末值 102913，且历史会话累计注入 369K token），每轮被 prefill 拖慢 6-10s。压缩的价值不是"省一次调用"，而是**把每轮 prefill 按住**。压缩成本约 15s，按 0.075s/1000 算，只要剩余轮次 ≥3 轮就回本 —— 所以低阈值压缩对延迟其实有利，代价是丢上下文导致重读（已实测 74% 重复读）。
- 结论修正：最优不是"不压缩"也不是"32K 就压"，而是**有界中间值**。建议 `limit.context: 96000`（`calculateCeiling` = 96000 − 16000 = 80000），兼顾 prefill 成本与压缩次数。当前配置（删掉 limit → 默认 200000 → ceiling 170000）偏高，长会话会变慢。
- **上下文构成实测**（`ses_e964f39bfffemD628K1XVV1Q8I` 累计注入 271K 字符，末轮 ctx=102913，能对上）：**工具输出 70%**（read 73K、grep 63K、shell 43K、glob 8.7K 字符）、**思考 30%**（80K 字符 ≈ 25K token）、助手正文 1%、用户 0%。
- 由此确认两件事：① 思考内容**确实被回放进请求**（`session/runner/to-llm-message.ts:174-185` 把 reasoning part 原样输出）；若只算工具+正文，上下文只有约 75K，实测 100K 证明 reasoning 在里面。② 想压 prefill 就得压工具输出和思考，别的地方没有肉。
- 降级现状：`session/history-degrade.ts` 只处理「超过 8 条之前的、单条超 120 行」的工具结果，保留头 25 行 + 尾 15 行。阈值偏保守，grep/shell 的大段输出基本没被削。
- `tool/plugin/patch.ts` 已存在且已注册（`packages/core/src/plugin/internal.ts:239`），是 unified diff 形态的批量增删改，等价于 fast-apply 的输出侧收益；但实测会话里模型一次都没用它，全走 `edit`/`write`。
- 已落地「不回放历史思考」（2026-10-24 01:25）：`packages/core/src/session/runner/to-llm-message.ts` 的 `toLLMMessages` 用 `findLastIndex` 找出最后一条 assistant，只给它 `keepReasoning: true`；`assistant()` 里 reasoning 分支加一条 —— **没有 provider state（`native` 为空）且不是最后一条就整段丢弃**。带 `native` 的（Gemini thought signature、OpenAI encrypted reasoning）无论哪条都保留，因为丢了无法重建。
- 收益重算（原来说 15-20% 是高估）：推理是**累积**进上下文的，不是每轮都有满额。参考会话末轮 ctx 102913、其中思考约 25.2K token（80346 字符 ÷ 3.19），改后末轮降到约 78.4K；按线性累积平均每轮少 12.3K token，× 0.08s/1000 × 48 轮 ≈ **47s ≈ 8%**。会话越长收益越大（末轮每轮省 2s）。
- 验证：`session-runner-message.test.ts` 新增 2 例（旧消息丢弃 / 带 native 保留）通过，31 例全过；runner 相关 4 文件 242 例全过；`tsc -b --force` 0 错误。
- **「不回放历史思考」第一版没生效，根因已定位并修正**：DeepSeek 每段 reasoning 都带 `native: { reasoningField: "reasoning_content" }`，而我原来的条件是「带 provider state 就保留」，于是全部保留。`reasoningField` 只是告诉适配器写回哪个字段（`ai/src/protocols/openai-chat.ts:386`），没有重建价值。改成 `Object.keys(item.native).some(key => key !== "reasoningField")` 才算「有 state」。
- 验证方法（可复用）：对每轮做增量回归 `Δctx = a + b·(上一轮工具+正文字符) + c·(上一轮思考字符)`。若思考被回放，c ≈ b ≈ 0.31 token/字符；若被丢弃，c ≈ 0。实测 `ses_e961dd5d6ffe…` 得 b=0.3172、c=0.2919 → 判定仍在回放。
- 同一会话其它结论：repo map 注入**生效**（首轮 ctx 11459 → 13041，+1.6K 与注入的 1030 token 吻合）；**subagent 委派一次都没发生**（48 次 grep + 43 次 read 全在主会话，AGENTS.md 的规则对 DeepSeek 无效）；「不压缩」代价显形 —— 上下文冲到 **169745**（ceiling 170000）才自动压缩，压缩本身耗时 17.7s，之后掉到 32723。
- 配置定稿（2026-10-24 02:16）：`~/.config/opencode/opencode.jsonc` 的 ddssd/deepseek-v4.1-flash 加回 `limit: { context: 96000, output: 32000 }`，`calculateCeiling` = 96000 − 16000 = **80000**。备份 `opencode.jsonc.bak-20261024-021614`。理由见上：ceiling 170000 会拖到上下文 169745 才压缩（压缩本身 17.7s），且每轮 prefill 被拖慢。
- AGENTS.md 的 `## Delegating exploration` 段已删除（实测对 DeepSeek 无效，48 grep + 43 read 全在主会话）。保留 Repo map / Investigation notes 两条改写（对应注入已生效）。
- 第二次验证（`ses_e96015977ffd4Xf4QH8mMl4eaj`「SiCode 思考强度面板高度」，sidecar 02:17:22 重启后）：
  - **ceiling 80000 完全生效**：上下文 12838 → 峰值 76827 → 压缩 → 30535 → 再涨到 68396，全程没超 80K，1 次压缩。对比旧配置冲到 169745 才压。
  - 时间：65 轮 / 439s / 中位 5.7s / 均值 6.8s。改前那个会话（medium 变体）中位 8.8s / 均值 14.9s。**但两者变体不同（low vs medium），不能全归因于改动。**
  - **思考回放是否真的丢弃：仍无法用会话数据确证**。原因是结构性缺陷：被保留的正是「紧邻上一条 assistant」，而增量 Δctx 永远包含它，所以 delta 回归无论改不改都会得到 ~0.3 token/字符；绝对值又依赖未知的固定提示大小（首轮 ctx ≈ 12800）。单测已锁住真实数据形状（`native: {reasoningField}` → 旧消息丢弃），代码路径可信，但端到端未证。
  - 要确证只能加临时日志统计每次请求里 reasoning part 的数量，跑一轮后删掉。
- 该会话仍未出现任何 subagent 调用（31 grep + 30 read 全在主会话），符合「已删除委派规则」的预期。
- **耗时构成变了（ceiling 80000 之后）**：`ses_e96015977ffd4Xf4QH8mMl4eaj` 80 轮 612s，按 `dur = 3.50 + 0.00624·gen + 0.000006·ctx` 拆解 → **固定 280s (46%) / 生成 295s (48%) / 上下文 24s (4%)**。上下文已经从最早的 43% 降到 4%，不再是瓶颈。
- 生成里 **思考占 78%**（37,040 / 47,327），而助手正文只有 **25 字/轮**。所以「让它少说废话」类 prompt 完全没用；唯一有杠杆的是**压思考长度**。
- 这条路径的重要性被放大：如果 `reasoning_effort` 在中转上确实失效（见上一条的疑似结论），那么 **prompt 是唯一还能控制思考量的手段**。
- 已被实测证伪的 prompt 方向（别再试）：让它并行发工具、让它把探索交给 subagent、让它别重读（72%→45%→61% 的变化主要由压缩频率解释，不是 prompt）。
- 思考强度滑杆失效的**根因找到并已修**：变体协议按 `model.package` 查 `PROTOCOLS`。自定义 provider 的 package 经 `aisdk-native.ts` 解析后是 `@opencode/ai/providers/openai-compatible` → 走 `openaiChat`，只发 `reasoning_effort`。`aisdk-native.ts:101` 里只有 **providerID 恰好叫 `deepseek`** 才会映射到 `@opencode/ai/providers/deepseek`（deepseekChat 协议，发 `body.thinking`）。用户 provider 叫 `ddssd`，所以拿不到。
- 没走「改名 provider」这条路：凭据表 `credential.integration_id` 存的是 `ddssd`，改名会直接丢鉴权。改成在 `packages/core/src/variant.ts` 的 `openaiChat` 里加分支 —— modelID 含 deepseek 时，effort 变体同时带 `body.thinking: {type: enabled/disabled}`。**只有显式选中档位才带这个字段**（default 不变体，不触发 overlay），所以默认路径字节不变，出问题的面最小。
- 验证：`test/variant-deepseek.test.ts` 3 例（deepseek 带 thinking、none 关闭、其他模型保持原样）；catalog / model-plugins 共 35 例全过；`tsc -b --force` 0 错误。
- 待验证：中转是否转发 `thinking` 字段。重启后选 low 与 high 各跑一轮，比 `tokens.reasoning` —— 差 2 倍以上说明通了。
- 5 ????????????`ses_e95e92762ffeWQGYp5al1XfsTH`????????2026-10-24 02:47??3:06???????314s ?????**34 ???????????199s??3%?? ?????? 69s??2%?? ??? 44s??4%??*???????????? 13.2s ???????? 31s????????372s ??????39 ?????227s + ??? 143s?????`question` ??? 71s ????????????????????- ?????103 ?????? `llm = 3.54s + 0.00548s/token`??83 tok/s???**?????? 3.54s ????????? 56%**????????? 91 token ?????? 4.1s?????????????????????????????? ? 3.5s?????token ??- ?????????? 66%??3777 token ??9106 ??reasoning??edium ?????????????? 7.11s / 658 token??????????? 4.14s / 91 token ????????????????????44%???????????????- ????????????????????bunx playwright test --config playwright.components.config.ts` ??? 35??5s??torybook WebServer ????????bun typecheck` 2.5??.7s???????????? playwright ??? 80s
- ????????? `%TEMP%/opencode/sicode-*.ts`??urn ??? / ?????? / ?????????tool part ?????? `content[].time.{created,ran,completed}`?????`state.time`
- 补充量化（2026-10-24 04:20，1701 步 / 19 会话 / 82 用户轮）：用户轮次墙钟中位 125s，其中模型时间 125s、工具间隙 0.4s；每轮中位 9 次 LLM 调用。长尾：22 步 >60s（1.3%）合计 5465s = 总等待 21.9%，最慢一步 975s 只生成 368 token —— 中转站卡死，客户端无解
- **原来「read 重复率 61-72%」是统计口径错误，已作废**：只按 `path` 分组，没看 `offset`/`limit`。实测 `review.spec.ts` 在 `ses_e9a12ddd5ffePfDrtUsZPnebXI` 被读 21 次，**21 个 (offset,limit) 全部唯一**（offset 从 1 到 1002 逐段覆盖，每次 30-230 行）。所以不是重复读，是**碎片化读取**：一个文件要 21 次往返才能读完，每次往返都要等模型决定下一段读哪
- 这也解释了为什么 read 去重两次实测都 0 命中（模型从不发同一个 offset+limit），真正可优化的是「一次读完整文件」而不是去重。按每步 9.8s 算，一个文件碎片化到 21 次 ≈ 3.4 分钟纯等待
- **碎片化读取的两个结构性原因（已定位到行）**：① `packages/core/src/tool/read-filesystem.ts:15` 的 `MAX_READ_BYTES = 50 * 1024`，文件超过 50KB 就强制分页，`review.spec.ts` 63KB 因此被切成 21 段（每次 40-110 行，跟着 `[Output truncated. Continue reading with offset: N]` 走）；② 没超限的文件模型也主动要小段 —— `host-apis.tsx` 901 行 / 33KB，14 次读的 limit 全是 35-120 行。所以「一次读更多」要同时改字节上限和默认行为
- **并行度实测**：1500 条 assistant 消息里工具调用数分布 `{1:1053, 2:320, 3:51, 4:10, 5:2}`，平均 **1.32 个/消息**，73% 的往返只做一件事。工具执行本身只占 0.4s，所以「并行执行工具」没有收益；有价值的是**一次往返带多个工具调用**和**单工具内部批量**（如 read 多路径）—— 后者不依赖模型学会并行，更可靠
- **重读的真正来源找到了：`session/history-degrade.ts`**。只保留最近 8 条消息，更早的 assistant 工具结果若超 `MIN_LINES=120` 行就截成 `HEAD_LINES=25` + `TAIL_LINES=15`，中间替换成 `[... N lines omitted ...; run it again if you need them ...]`。**这句提示等于明示模型「需要就重新跑」**，所以模型读过的文件在 8 条后内容消失，它只能重读 —— 这是 offset 逐段推进、同一文件读 21 次的直接成因
- **由此推出的硬约束**：放宽 `MAX_READ_BYTES` 的收益会被 degrade 削掉一大截（首次读全文 → 8 条后只剩 40 行 → 仍要重读）。而**取消/大幅放宽 degrade 是负收益**：上下文每涨 1000 token 每步多 0.075s，45k→150k 就是每步多 7.9s × 9 步 ≈ 71s/轮，比省下的重读还贵。所以 degrade 的阈值接近当前最优，不要动数值
- **可以零成本改的只有措辞**：把 `run it again if you need them` 换成「用 read 指定 offset/limit 重新打开某个区间」，把「全量重跑」引导成「精确重读」
- `tool/plugin/grep.ts` 没有 `context`/`-A`/`-B` 参数（只有 pattern 和 path），所以模型 grep 完必须再 read 一次才能看到上下文 —— 加一个默认 2-3 行的 context 参数可以直接省掉一部分「grep→read」的两步
- **已落地（2026-10-24 04:25）：read 一次给全文**。`read-filesystem.ts:14-19` `MAX_READ_LINES 2000→3000`、`MAX_READ_BYTES 50KB→128KB`、新增 `WHOLE_FILE_MIN_LINES=150`；`:170-176` 在「整份文件已进内存 + 总行数 150..3000 + 调用方 limit*2 < 总行数」时把 limit 提到 `MAX_READ_LINES`，从当前 offset 一次给到末尾
- **关键：只放宽上限是无效的**。模型几乎每次 read 都显式传 `limit`（实测 35-210 行），而 `limit = Math.min(page.limit || MAX_READ_LINES, MAX_READ_LINES)` 优先用 page.limit，所以 50KB→128KB 对这类读毫无影响。真正起作用的是上面那条「小 limit 放大」，上限只负责让文件不被字节截断
- 阈值选择依据：`limit*2 < total` 保证放大后至少省掉一半以上的往返；`total>=150` 防止对本来一两次就读完的小文件做无谓放大；`total<=3000` 与 `MAX_READ_LINES` 对齐。测试文件都 < 150 行，所以不影响既有分页语义（`many-lines` 用 2001 行 + limit 2000，2000*2>2001 不触发）
- `session/history-degrade.ts:47-49` 截断提示由 `run it again if you need them` 改为 `re-open only the range you need (for read, pass offset and limit)`，不再诱导全量重跑
- 回放（3 个最长会话 490 次 read）：**490 → 174，省 316 次往返 ≈ 51.6 分钟**；review.spec.ts 42→1、stepped-slider-preview.html 42→1、host-apis.tsx 18→1、tool-renderer.tsx 14→1
- 验证：`tool-read-filesystem` / `tool-read` / `session-history-degrade` / `session-runner-message` 共 92 例全过；`tsc -b tsconfig.json tsconfig.tests.json --force` 干净。新增 1 例锁住放大行为（900 行文件传 offset=40 limit=55 → 返回 861 行 truncated=false）
- **grep 加上下文参数评估后没做**：要改 `packages/schema/src/filesystem.ts` 的 `Match`（加 before/after）+ `ripgrep.ts` 的 JSON 解析（处理 `type:"context"` 事件）+ `grep.ts` 输出格式，3 个文件且动共享 schema；而 read 往返已从 490 降到 174，剩下的多是新文件，收益不确定
- **已落地（2026-10-24 13:10）：探索预算**。新增 `packages/core/src/session/runner/explore-budget.ts`：`readOnlySteps()` 纯函数统计「当前轮尾部连续只读步」（只读工具集合 = read/grep/glob/list/webfetch/websearch/recall；遇到 write/edit/patch/execute 或「无工具步」就断），阈值 `EXPLORE_SOFT_STEPS=12` / `EXPLORE_HARD_STEPS=24`
- 注入点在 `session/runner/llm.ts:245-270`，优先级 **stepLimitReached > exploreHard > narrate > exploreSoft**。软阈值走 `Message.system(EXPLORE_SOFT_PROMPT)` 只提醒汇报；硬阈值走 `Message.assistant(EXPLORE_BUDGET_PROMPT)` + `toolChoice: "none"`，和 MAX_STEPS 一样收掉回合，逼它交「已确认 / 还缺什么 / 下一步」
- 和 `narrate.ts` 的分工：narrate 治「不说话」（每 6 步提醒说一句），explore-budget 治「说了话但一直在读、没有任何产出」。两者条件独立，可以同时命中，优先级已定
- 验证：`test/explore-budget.test.ts` 9 例全过（含「write 打断」「无工具步打断」「user 边界」）；`session-runner-message` + `explore-budget` + `session-history-degrade` 共 47 例全过；`tsc -b tsconfig.json --force` 干净
- 注意：`tsc -b tsconfig.tests.json` 会报 `test/variant-deepseek.test.ts` 的类型错，那是别的会话留下的未提交文件，不是这次改动引入的

## 代码检索 / LSP

- 面向 agent 的检索只有两层：`packages/core/src/tool/plugin/grep.ts:79` 是 ripgrep 正则/字面，返回 path:line 文本；`packages/core/src/filesystem/search.ts:38` 的 fff 索引是 fuzzysort 打文件路径。没有符号/定义/引用级检索。
- LSP 实现不在仓库里：`packages/core/src` 无 lsp 目录，`lsp` 字样只出现在配置解析 `packages/core/src/config/normalize.ts:539` 和 `packages/core/src/file-mutation.ts:131` 的 TODO。131 行那个 TODO 不是「接了没通知」，是 runtime 本身不存在，别被它误导。
- 配置面已经完整：`packages/schema/src/config.ts:73` 有正式字段 `lsp: ConfigLSP.Info`，结构定义在 `packages/schema/src/config/lsp.ts`（command/extensions/disabled/env/initialization，外加 boolean 全禁用）；`packages/core/src/config/normalize.ts:539` 的 normalizeLsp 还处理了 legacy 形态。用户今天就能写 lsp 配置并过校验，只是没有消费方。
- 事件面留了位但没有发送方：`packages/schema/src/lsp-event.ts:5` 定义 `lsp.updated`，注册在 `packages/schema/src/event-manifest.ts:89`。
- 旧实现可以回收：`git show 44b6938b2a^:packages/opencode/src/lsp/` 下有 6 个文件共 3311 行（client 650 / server 1983 / lsp 507 / language 121 / diagnostic 29 / launch 21），上游 `44b6938b2a removed packages/opencode` 时整包删除。它已经是 v2 shape（LayerNode + LspEvent + InstanceState），不是老架构代码，移植接近改 import。
- 旧 Interface 覆盖全部结构检索：init/status/hasClients/touchFile/diagnostics/hover/definition/references/implementation/documentSymbol/workspaceSymbol/prepareCallHierarchy/incomingCalls/outgoingCalls；server.ts 内置 38 个语言 server（Typescript/Vue/Gopls/Pyright/RustAnalyzer/Clangd/JDTLS...）。
- 移植只有 3 处真实摩擦：① import 命名空间 @opencode-ai/* 要改 @opencode/*，InstanceState 改 Location.Service，LayerNode.make 改 makeLocationNode（`packages/util/src/effect/app-node.ts`）；② 进程流只有 3 处碰 Node stream（旧 client.ts:133/134 建 reader/writer、643 stop），桥接先例在 `packages/core/src/aisdk.ts:223`；③ 依赖 vscode-jsonrpc + vscode-languageserver-types 当前 package.json 里完全没有。
- 注册点：`packages/core/src/plugin/internal.ts` 的 node 列表（Tool.node 那段）加服务节点，pre 数组里 GrepTool.Plugin 附近加工具插件；`packages/core/src/tool/AGENTS.md` 写了工具对象的构造与权限约定。
- 远端 location 要降级：有 workspaceID 时 LSP 不可用，照 `packages/core/src/filesystem/search.ts:189` 对 fff 的处理方式。
- win32 默认禁用 fff 的来源是 `e4300e9b74`（fix(core): disable fff by default on windows，2026-06-10 10:22，Dax Raad），提交 body 为空、无任何原因说明；它紧跟在 `538cfaff0d`（feat(core): enable fff by default，10:21:25）之后 35 秒，中间无其他提交——是「默认开启时补一刀排除 Windows」，不是踩坑后回退。改动只有 `Flag.OPENCODE_DISABLE_FFF` 默认值变成 `process.platform === "win32"`。
- fff 在 Windows 上是可用的，不是不支持：`@ff-labs/fff-bin-win32-x64` / `-arm64` 都在 `packages/cli/package.json:70-71` 和 bun.lock 里；本机实测 `FileFinder.isAvailable() === true`、`create` 成功、`fileSearch` 有结果。
- 索引是异步建立的：`Fff.create()` 返回后立刻查是 0 条，实测本仓约 306ms 后才有结果。原来 fffLayer 从不调 `waitForScan`，首次查询静默返回空（所有平台都有这个缺陷）；现已改为在第一次 `find` 时等待初始扫描（`packages/core/src/filesystem/search.ts:139-152`，5 秒超时后放行部分结果），`Picker` 接口在 `packages/core/src/filesystem/fff.ts:45-52` 补了 `waitForScan`。
- 手动开启：`OPENCODE_DISABLE_FFF=0`（`packages/cli/src/server-process.ts:138-141`，truthy 只认 `1`/`true`，`0` 表示不禁用）→ `fs.fff: true` → `packages/server/src/routes.ts:121` 注入 `configured({ fff: true })` → `search.ts:190` 的两个条件都不成立，只剩 `Fff.available()` 把关。
- 旧实现 `a0409e64d8` 里 `enableFsRootScanning` 只在 win32 打开，注释说 unix 用户几乎不需要扫根目录所以直接让 fff 创建失败回退 rg，Windows 反而要允许盘符根扫描；现在 core 调 fff 时固定 `disableMmapCache: true` + `disableContentIndexing: true`（`packages/core/src/filesystem/search.ts:121-126`），把最吃资源的两项都关了。
- grep 的 context 已接通（P0）：参数在 `packages/core/src/tool/plugin/grep.ts:36-38`（0-50，默认 0），透传到 `packages/core/src/ripgrep.ts` 的 `--context=N`。`Ripgrep.grep` 现在的返回类型是 `GrepRow[]`（`{ kind: "match" | "context", match }`），不再是 `Match[]`。
- grep 的 limit 语义是「匹配数」，不是输出行数：context 行与匹配共用同一条 stdout 流，所以 ripgrep 层把 `Stream.take` 的上界放大成 `limit * (2*context+1) + 1`，工具层再用 `findIndex` 数到第 limit+1 个 match 精确截断（`packages/core/src/tool/plugin/grep.ts:158-166`）。给 ripgrep 传的是 `limit + 1`，多出来那一条专门用来判断 truncated。
- grep 的 content 格式：匹配行 `  Line N: text`，上下文行 `  Line N | text`；截断文案从 "results" 改成 "matches"。机器输出（`output`）仍然只含匹配，context 只进 content。
- context 的测试在 `packages/core/test/ripgrep.test.ts`（"emits context rows around each match"，验 kind 序列与行号）和 `packages/core/test/tool-search.test.ts`（"includes context lines around each match"，验 content 标记与 output 只含匹配）。
- 注意 `run` 的可选参数 `pattern` 是 InvalidPatternError 的触发条件，grep 调用它时必须显式传，漏了会让非法正则静默变成空结果（`packages/core/src/ripgrep.ts:145`）。
- read 的多路径已接通（P1）：`packages/core/src/tool/plugin/read.ts:20-24` 的 `path` 是 `Union([String, Array(String)])`，输出是 `Union([Single, Array(Single)])`（`read.ts:28-33`）。offset/limit 对每个路径分别生效。
- 多路径的失败语义：逐条读（`Effect.forEach` 默认顺序），用 `Effect.result` 收集，**只有全部失败才抛错**；部分失败在 content 末尾追加各条的 `File not found: x`，metadata 带 `files`（`read.ts:145-172`）。
- AGENTS.md 的向上发现可以重复调用：`packages/core/src/session/instructions.ts:39-44` 自己做了 in-flight claim + synthetic metadata 去重，注释写明是为「same-step parallel reads」设计的。
- UI 崩溃点（已修）：`packages/session-ui/src/tools/tool-renderer.tsx:945` 原来直接把 `input.path` 扔给 `getFilename`，而 `packages/util/src/path.ts:3` 内部 `path.replace(...)`，传入数组会 TypeError。现在先归一成逗号分隔字符串。`readImagePath`（`packages/session-ui/src/message/current-tool-state.ts:86`）本来就有 `typeof !== "string"` 守卫，多路径图片按普通文件行显示。
- 多路径 read 在桌面端显示为一行逗号分隔的文件名，不会展开成多行。
- 测试：`packages/core/test/tool-read.test.ts` 的 "reads several paths in one call" 与 "keeps the readable paths when another path in the batch is missing"。
- 工具描述里给 context 加了用量约束（输出按 `2*context+1` 膨胀），避免在宽泛搜索时把输出撑爆（`packages/core/src/tool/plugin/grep.ts:38-41`）。
- LSP 接线的运行时门槛：旧实现的 TypeScript server 不是直接用 tsserver，而是 `Npm.which("typescript-language-server")` + `--stdio`，只把 `tsserver` 路径放进 initialization（`git show 44b6938b2a^:packages/opencode/src/lsp/server.ts:115-143`）。本机 `typescript-language-server` 未安装，所以接线后第一件事是要装这个 npm 包，否则 spawn 返回 undefined、静默无诊断。
- LSP 各项能力的价值不均等：diagnostics 是「把验证成本从一次包级 tsc（带缓存数秒、冷启动几十秒）降到亚秒」，属于加速现有能力；references / definition / documentSymbol / hover 才是 tsc 拿不到的新能力。实测 `makeLocationNode` 在本仓有 154 处代码命中，其中 73 处是 import 行（47%），这是 references 相对 grep 的精度差。
- 这个仓库是 project references + `@opencode/*` 路径别名的 monorepo，tsserver 能否正确解析需要先验证，再决定要不要搬那 3311 行。
- **结论纠正**：先前判断「本仓 TypeScript 无 tsserver，LSP 不可行」是错的。`node_modules/typescript` 是 6.0.2 的 shim（`lib/tsserverlibrary.js` 全文一行 `module.exports = require("@typescript/old");`），真身在 `node_modules/.old_modules-e7abc80b28e1926f/@typescript/old`：TypeScript 6.0.3，**带 `lib/_tsserver.js` 与 `bin/tsserver`**。`require('typescript/lib/tsserverlibrary.js')` 能拿到完整 `createLanguageService`。
- 之前探针超时的两个原因都不是「没 tsserver」：① 探针目录里另装的 `typescript` 是原生 7.0.2（确实没有 tsserver），服务端加载错了实现；② 探针没应答服务端反向请求（`workspace/configuration` 等），tls 卡在初始化阶段一条诊断都不推。补上应答后立刻出结果。
- `typescript-language-server` 会自己告警：`The TypeScript of the workspace (TypeScript 6.0.2 at .../node_modules/typescript/lib) provides no tsserver.js`，这时它 fallback 到「bundled」实现。**接入时必须显式把 tsserver 路径指到 `.old_modules/.../@typescript/old/lib/tsserver.js`**，否则行为不可预期。
- 实测（本机；目标文件 `packages/core/src/filesystem/search.ts`，符号 `makeLocationNode`）：initialize 318–417ms；**首次诊断 12.1s**（冷，等工程图加载完，0 条=文件本身干净）；`didChange` 注入 `const __probe_bad: number = "not a number"` 后**增量诊断 1.7s**，正确回 `Type 'string' is not assignable to type 'number'`（TS2322）。
- 语义请求实测：definition 2–9ms；hover 3–4ms；**references 首次 17.8s、热 63–83ms（115 项）**。结论：references 必须预热，别在冷会话第一次就调。
- 对照组：`tsc -b packages/core/tsconfig.json` 暖态 **2.118s**（注入同样的类型错误 2.129s，报出 `error TS2322`），口径是**全工程**；`git grep` 同符号全仓 **1.667s / 154 命中**（rg 通常再快一档）。
- 由此：**诊断不是 LSP 的价值点**——1.7s（单文件增量）vs 2.1s（全工程 tsc），LSP 并无实质优势且覆盖面更小。LSP 的真实价值在导航：references 热态 63–83ms 比文本检索快 20 倍以上且去掉 154→115 的字符串误命中，definition/hover 只有 2–4ms、没有廉价替代。
- LSP 的代价也量化了：tsserver 常驻 **~683MB RSS**（本仓 packages/core 工程图），冷启动 12s 才出首条诊断，且首次 references 另需 17.8s。桌面端还要同时跑 electron + sidecar，这个常驻内存需要单独权衡。
- 因此 P2 的取舍：**不移植上游那份 3311 行完整 LSP**。完整实现的大头是「文档同步 + 全量诊断采集 + 注入 prompt」，而诊断恰恰是唯一被证明没有收益的部分。若将来要做，只做薄导航客户端（definition/references/hover，约 500–600 行，懒启动、显式 tsserver 路径），不做诊断。
- 已上线的 P0（grep `context`）已经吃掉了导航需求里最急的一块：`makeLocationNode` 的 154 命中里有 73 行是 import（47% 噪声），带上下文后模型能直接分辨 import 与使用点，不必再发一次 read。
- **fff 与 glob 不是一条路**：`glob` 工具直接调 `Ripgrep.glob`（`tool/plugin/glob.ts:93`），**绕过 `FileSystem.find`**，所以启用 fff 不会让 glob/grep 变快。fffLayer 服务的只是 `FileSystemSearch.Service.find`（`filesystem/search.ts:19`），经 `filesystem.ts:113` 注入 `FileSystem.Service`，用途是文件模糊搜索/补全。
- 因此 Windows 上禁用 fff 的真实代价不是「glob 慢」，而是：`ripgrepLayer` 的 `refresh` 每 `REFRESH_INTERVAL`（10 秒，`search.ts:23`）fork 一次 rg 全量重扫。本仓 8576 个受控文件，实测全仓遍历 **617–673ms**（`git ls-files` 近似），即闲时每 10 秒白烧一次数百毫秒的子进程。
- 实测 fff（本仓 8576 文件，`disableContentIndexing: true`）：`create` **10ms**、`waitForScan` **103ms**、`fileSearch` **1–4ms**（5 次连测）。同一台机器上全仓遍历 617–673ms，**量级差约 200 倍**。
- fff 索引常驻内存实测 **只 +9MB**（RSS 52MB → 61MB）。这与 LSP/tsserver 的 683MB 是两个量级，此前把「fff 内存占用」当顾虑是不成立的。
- 启用 fff 的两个前置条件：① `disableWatch: true`（否则它自带的 watcher 与 core 的 `@parcel/watcher` 双监听同一目录）；② 首次 `find` 等 `waitForScan`（已修，`SCAN_TIMEOUT` 5s）。剩下唯一的真实风险是**崩溃半径**：它是进程内 Rust dll（`@ff-labs/fff-bun` 经 Bun FFI），native abort 会带走整个 server，而 ripgrep 是子进程、崩了只损失单次工具调用。这一条是推断，未做实测；上游 `e4300e9b74` 禁用时留空 commit body，真实原因仍无记录。
- 未做的三项及其理由：patch 工具（只对 gpt-* 开放且 `usePatch` 会删掉 edit/write，收益看模型、批量改错的面被放大）、ast-grep 结构检索（现有 lint 用途以外收益不确定，多一个工具就多一份模型选择成本）、prompt/工具 schema 的固定成本（每个请求都随行，但尚未测准，暂不动）。
- **更正上一条**：说「闲时每 10 秒 fork 一次 rg 全量重扫」不准确。`refresh` 只在 `find` 内部触发（`search.ts:108`），且 `initialized && now < settledAt + REFRESH_INTERVAL` 时直接跳过（`search.ts:97`）。真实行为是**懒扫描 + 10 秒节流**：首次 find 扫一次（数百 ms），10 秒内的后续 find 走内存索引（快），超过 10 秒的下一次 find 再重扫一次。所以代价不是持续烧 CPU，而是「每次隔一会儿再搜，都要重新付一次几百毫秒」。
- 开关位置（若要做）：`Options.fff` 这条通道**现在是死的** —— `search.ts:211` 的 `export const node = configured()` 没传 options，而 `layer()` 里 `options?.fff === undefined && win32` 才落到 ripgrepLayer。要接就得给 `configured()` 的 deps 加 `Config.node`（现在只有 `[Location.node, Ripgrep.node]`），在 `layer()` 的 `Layer.unwrap` 里 `yield* Config.Service` 读配置；注意先验证 Config 层反向依赖 FileSystem 造成环的可能性。
- 更优替代（不加开关、不碰 native）：core 已有成熟的 `Watcher.Service`（`filesystem/watcher.ts:61`，`subscribe` 返回 `Stream<Update>`，Windows 走 parcel 的 `windows` backend，能递归监听并给 create/update/delete）。改造 `ripgrepLayer`：启动扫一次建索引 → 订阅 Watcher 增量维护 → 删掉 10 秒节流重扫。收益：把「隔一会儿首搜 600ms」降到内存查表的毫秒级，且纯 TS 逻辑、零新增 native 崩溃面、不引入新依赖；代价只剩首屏 600ms（fff 是 103ms，差一次性的 500ms）。
- **VS Code / Cursor 对照（用于校准方案预期）**：分三层，别混为一谈。① 文件监听层：VS Code（Cursor 的底座）确实用 `@parcel/watcher` 递归监听，与本仓同一个库（本仓锁 2.5.1，实体在 `node_modules/.old_modules-*/@parcel/watcher`）。② 文件搜索层（Ctrl+P / @ 提及）：VS Code 是**每次开 rg 扫一遍**拿全量列表再缓存全量结果 + 按输入前缀缓存过滤结果（bpasero 在 vscode#79909 的解释），并非常驻索引——也就是说它和本仓「懒扫 + 缓存」是同一类做法。③ Cursor 另有 codebase index（embedding 语义检索），那是第三套东西，与文件名搜索无关。
- **反向证据（这条最有用）**：vscode#201842（2024-01，Windows 10 / 10 万文件）用户抱怨 Ctrl+P 每次要 ~2 秒，并建议「缓存文件列表、用文件夹监听实时更新」。**这正是我们这轮要做的方案，而 VS Code 到 2024 年初还没做**。此后是否改动未找到公开记录，引用时须标注时间边界，不要断言"至今仍是如此"。
- **两条对方案有利的核实**：① 本仓 `watcher.ts:214` 显式传了 `backend`（win32 为 `"windows"`），对应 parcel 的 ReadDirectoryChangesW，不是 README 里那个 FindFirstFile 暴力遍历，所以 Windows 上是真事件驱动。② parcel 在 C++ 层有 `Debounce.cc`，对 git checkout / npm install 这类洪泛会合并去重（README：每个文件只发一条，create+delete 相互抵消），所以方案里「坑 6 事件洪泛」的严重度下调——JS 侧收到的是已合并的批次，阈值兜底仍要留但触发概率低。
- **值得借鉴的一点**：VS Code 把 watcher 放在独立 UtilityProcess（官方 File Watcher Internals 明确写 "Since file watching is compute intense, we leverage UtilityProcess to host the file watchers in a separate process"）。本仓的 watcher 与搜索索引同处 core server 进程，洪泛时共享同一个事件循环；当前规模不必拆，但如果将来事件量成为问题，这是现成的参照解。
- Cursor 与 VS Code 的真实关系：微软在 `microsoft/vscode` 开源的是 **Code - OSS（MIT）**，"VS Code" 本身是 Code - OSS + 微软专有层（Marketplace 集成、Remote 扩展、C#/.NET 调试器、遥测键、更新服务）。Cursor 是 Anysphere 对 Code - OSS 的 fork，只能 fork 开源那一层，所以走 Open VSX（经 `marketplace.cursorapi.com` 代理）而不是微软 Marketplace。
- 同步节奏（官方文档原话）："We regularly rebase Cursor onto the latest VS Code version... Cursor often uses slightly older VS Code versions"；第三方测到上游特性滞后约 2–4 周。⇒ 版本号对不上是结构性的，不是 bug。
- Cursor 3（2026）已把**主界面围绕 agent 从零重写**，但仍保留切回 Cursor IDE，编辑器内 LSP 跳转仍在。⇒ 判断"Cursor 怎么做文件索引"时，只能引用它的 IDE 那一半，新 agent 界面那半与 Code - OSS 无关。
- 对本项目的意义：能照搬的只有 Code - OSS 那一层（进程模型、Monaco、扩展 API、`@parcel/watcher` 文件监听）；照搬 Marketplace/专有扩展那层不合法也不可能。
- Cursor 的索引**不是文件索引，是语义索引**（官方博客 `cursor.com/blog/secure-codebase-indexing`）：三层 = Merkle 树做变更检测 → 文件切语法块算 embedding → 按块内容缓存 embedding（异步后台生成，最贵的一步）。
- Merkle 树细节：每文件一个加密哈希，每目录一个「子哈希聚合」哈希。改一个文件只变该文件 + 到根的一路父哈希。客户端与服务器比两棵树，只走哈希不同的分支；5 万文件工作区光「文件名 + SHA-256」就 3.2MB，有树只传差异部分。
- 另有索引复用：客户端算 `simhash`（整棵树的摘要）→ 服务器在团队向量库里找相似索引 → 背景复制，期间用 content proofs 过滤，保证客户端看不到自己没有的代码。官方称同组织内同一仓库克隆相似度平均 92%。
- **对我们最重要的对照**：Cursor 用「比两棵树」而不是「听 watcher 事件」来检测变更——因为它要跨客户端/服务器比对，事件在新进程里就丢了、多端也不一致。我们是单机单进程，watcher 更实时，但可以借它的思路：**收尾用目录哈希校验一次**，就能兜住「扫描期事件丢失」那个坑（占位方案里的坑 3）。
- 结论：Cursor 没有做「文件名快速查找表」这一层，Ctrl+P 那套继承上游；它把工程预算全押在语义层。⇒ 我们的监听增量不是「重复造 Cursor 的轮子」，是在它没覆盖的那一层做事。
- **真实使用行为实测**（本机 `~/.local/share/opencode/sicode.db` 的 913 条 assistant 消息、1142 次工具调用，其中 797 次落在本仓）：工具分布 shell=299 / grep=156 / read=140 / execute=68 / edit=37 / glob=27。shell 里绝大多数是 `bun test` / `typecheck` / 临时脚本，检索确实走 grep 工具而非 shell 绕过。
- grep 质量（本仓 156 次）：**零命中 20 次（13%）**、**命中 >20 条 52 次（33%）**、**被 limit 截断 37 次（24%）**。命中分布：0→20，1-5→45，6-20→81，21-50→68，51-200→12。
- 零命中不是死路：20 次零命中之后 16 次换 pattern 重搜、7 次直接读文件、1 次 glob、1 次 shell、1 次转问用户、1 次会话结束 ⇒ **约 59% 靠换词自愈**，真正的"卡死"极少。
- **被截断的 37 次多数是同义词 OR 兜底**（如 `suggestion|Suggestion|快捷|chip|Chip|followup`、`open|Open`、`file|File`、`name|id:`）⇒ 词不确定时模型的应对是 OR 一堆近义词，于是从"零命中"变成"洪水"，两种症状同源。
- **重复读取**：重放 36 轮有命中的真实 grep（`git grep -lE` 取文件列表），紧跟其后的 21 次 read 中 **10 次（48%）读的是该 grep 已经返回过的文件**；逐轮平均 53%。这是 P0（grep 带 context）真正对准的浪费，量级大于零命中。
- 搜索片段 139 轮，平均每轮 1.90 个检索调用，45% 是多轮试探；grep:read = 1:1.33。
- 结论：**检索的主要成本是"结果太多/截断"和"搜到了还要整篇读"，不是"搜不到"。** 任何以"救零命中"为目标的方案，天花板都很低。
- P0??rep ??`context` ?????packages/core/src/tool/plugin/grep.ts:38`???????????026-10-24?? ?????32 ??grep???????????? 13/32=41%???**???????????*????? context ???????????? 3/13??3%?????? 4/19??1%?????????????- ???????????opencode.db` ?????7 ??????????59 ??grep???grep ???????????? 49%??20 ??40%?????16%?????? 7%?????? 22% / 38% / 16% / 12%??9%??2% ????????context?????context ??? 19 ?????21%??????????????- `glob` ?????????`glob "**/tool/grep*.ts"` ??? `No files found`????`packages/core/src/tool/plugin/grep.ts` ????????A ??1 ????????????????- ???????? grep?????B ?????3 ??PowerShell `Select-String` + 1 ??`rg --version`?????? 5 ??grep ??4 ?????? 20 ????- ???????????? D 12 ??grep ??5 ??? 20 ????????`limit` ??? 200 ???????????? 17 ???????
- read ??????`packages/core/src/tool/plugin/read.ts:19`??path` ??? string | string[]?????**0 ???**?? ?????36 ??read ???????????description ????????"Pass an array to read several paths in one call"???????????????????????????????????????A ?????B ????????????"???????????????????????
- ????????A/B??026-10-24 20:36??0:57????? 4 ???????????grep ?????????????ontext ?????79 ??? / 487K token / 509s??? ??? `context=5` 52 ??? / 877K token / 379s??? ????????+ ????????63 ??? / 559K token / 560s??rep ???????????22% / 8% / 36%??- **??????**?????????????7 ???B ??? 303s ??42s??????????????????????????4 ??????????????????????- ???????????? grep ?????????????????? `context=5` ??grep ?????198K ?????? 499K??152%???read ??? 18%??81K??96K????? +32% ??**???????????????????**??- ?????????`toModelContent` ?????????????????????????????????? ?????????????`Files by hit count: path(n), ??????????????`tool-search.test.ts` 29 ??????????
- Cursor ????????????????????026-10?????????????Merkle ????????hash?????????????????`.gitignore`/`.cursorignore` ?????? ??????????????ree-sitter ??? ??Cursor ?????? embed ????Turbopuffer ??per-codebase namespace??? ???????????? simhash??????????????? `copy_from_namespace` ????????? ?????? 3?? ?????? Merkle ??diff??? re-embed ???????????????????????????????trigram / sparse n-gram ???????????? git commit ?????????????? agent ?????*?????????????*????????????????????? agent ????????????????? Turbopuffer???????????????????????????????????????????- **??????**?????????"?????????"???????????**???**?????? agent ??????**???????????*??CP ??? A/B ?????token -46.9%?????????????Cursor ???????????????????????SiCode ???"???+???"?????????????????????????????"??- ?????? SiCode ?????????**Merkle ?????*?????5119 ????????? 10.4s?????????????????????????? + ?????????**trigram ?????*?????grep ???????????100??00ms???????????*???????????"????????????*????????? 10%??20 ??34%?????????????embedding ??????Cursor ????????+ ??? GPU?????? Merkle??
- ????????? `D:\????????cursor??????\???\Cursor-????????????????md`??ursor 3.24.18???/??/?????????????????????????????
  - **?????????**??. Crepe Instant Grep?????`.git/cursor/crepe/<commit>/` ??CRP2 ?????index.bin`+`postings.bin`??*?????document**???????????????B. Codebase Snapshot + Merkle???????????????C. ???????????/managed local??opK ??? 25????  - **??? 1**??ursor ??Agent Grep **?????? `-A/-B/-C` ????????*??output_mode`??ontent / files_with_matches / count????head_limit`???????????ipgrep ??? `:`/`-`??? ?????P0??rep ??context?????????????????????????????????????????"??  - **??? 2**??rigram ??????**????????????*??????????????????**???????cap ?????????**????????????? ????????????????????????? `>20 ??34%`???????????/?????????  - **??? 3**?????????????????????????????????? **Grep ???????????? unsaved / out-of-workspace active editors**?????? `(unsaved)`???????????git commit??? ??????????????SiCode ?????? buffer ?????????????  - **??? 4**?????????**??? `content proof` ?????*????????????????????????????"6 ??????????????????? ?????????????????  - ??? Grep ???**????????Merkle / ??????**??????5???5 ?????? ??????????????????????????????????????????**??????**?????grep ???????  - **????????????*??output_mode` ??? + `head_limit` ????????????????????`count` ??`files_with_matches`?????? `content`?????????context"????????`>20 ?? ???????????????????
- ???????????026-10-24?????8654 ????????? `rg -F` ??? **1.0??.1s**??repe Indexed ???????**14??3ms??70???*??function` 195??26ms??5?????the` 250??20ms??3????????????????????0.7??.95s??????????- `output_mode` ??????Zod enum `.default("content")`???????????**??? description** ?????prompt ?????????????????????????????? mode??- ?6 ??????????? **doc_id ???**??*???????????*??GrepSearchOptions.sort` ??? `none/path/modified/accessed/created`??ipgrep ?????????????????- **????????grep 100??00ms?????????????*?????? path ?????????**????????1 ??*?????trigram ??????????- **?????????????????**?????12 ?????? 110 ??grep??*92% ??`path`??8% ??`include`** ?????????????????????????????trigram ??????????????"?????**????????????????????**??????????????0%???????????????- ??????"??????????????????????????????????????ngram ??????????????????????????????????????the`/`function`??ursor ?????3?????????????**????????????**?????`>20 ?? ??? Cursor ??????????
- ??? trigram ????????????2026-10-24??bun:sqlite` FTS5 `tokenize=trigram`?????8482 ??? / 71MB ????????? **28.8s**?????? **248MB**?????? 3.5x?????????????**<1ms**??toModelContent`/`DEFAULT_SEARCH_LIMIT`/`waitForScan` ??0ms?????? `rg -F -l` ??? **3.5??.4s**????????rg **???????*??0/10??/4??/2??/6??9/19???????Cursor Crepe??? **6.85s**??*87MB**?????~15ms ????FTS5 ???????????? 4x?????? 2.8x??- FTS5 trigram ???**?????????**??function` ??? 3186 ??? vs rg ????????3107????? `case_sensitive=1`????????????????????????"????????????????????????? rg"??- ?????????????? Cursor ???"??????????????10 ??grep ??? P50 **4.0K** ?????90 **21K**?????94K??*15% ??15k**??ursor ?????????????????????????**18%** ???????????????????????79% ?????*?????limit**??0/50/60 ?????? 21% ?????100???????????????????????????????????- ????????rigram ???????????? **2.6s/???**??% ?????? ? 3.6s?????? 379??60s ??????????????*???????????**???????????????????????????????????????"????????????????????????
- Phase 1??utput_mode ??? + offset ??? + 15k ??????????????????2026-10-25 ????? ?????????
- ??? A??ODO/FIXME ????????????????mode=count ??? 79 ???????????KB???????????????????????12 ??grep + ??17 ?????????????????? D????- ??? B??????????????files_with_matches ??? 180 ?????? 15k ?????????????????? 50 ????? offset ??????????????content ???????????????????- ??? C?????????????????files_with_matches ??4 ???????content ????????? 8 ??????????????- ??? 33 pass??ool-search + ripgrep???tsc ????????- ????????????????????P0/P1/Phase 1 + ??? UI ??????Phase 2 trigram ???????????????????
- **索引复用判据（2026-10-25 修）**：`trigram-search.ts` 原来的 reuse 只比路径集合（`indexed.size === current.size`），`m` 表也只有 `id/p`。这条判据有两个洞，而且互相掩盖：
  - 洞一（更早就存在）：二进制文件被 `replaceAll` 的 `continue` 跳过、不写行，而 `current` 来自 `rg --files`（`hidden:true`）会把它们列出来 ⇒ 集合大小永远不相等 ⇒ **复用从来没生效过**，每次启动都在后台做一次全量重建（约 10s，用户看不见）。本仓 269 个 `.png` 就足以触发。实测旁证：缓存 `m` 表 11432 行 vs 当前 `rg --files --hidden` 8970 个，两边方向都不一致。
  - 洞二：路径不变、内容变了（SiCode 关闭期间的外部编辑，或只改内容不加文件的 `git pull`）⇒ 复用旧 trigram ⇒ 预筛把该文件从候选里丢掉 ⇒ grep 报 0 条命中，**静默错答**。放大点：`tool/plugin/grep.ts:312` 的 `else if (chunks)` 对 `[]` 是 truthy，空候选既不进 rg 也不走内存匹配。服务层探针实测：文件里确有 `tokenZZZ`，结果 `{"matches":0,"prefiltered":true}` + `No matches found`。
- **修法**：`m` 加 `t`（mtime，floor 到整毫秒）与 `s`（size）；`NOT_INDEXED = -1` 表示「已枚举但没索引」（二进制/不可读），只比存在性；`SCHEMA_VERSION` 1→2，`open()` 里用 `ALTER TABLE ADD COLUMN` 就地迁移，旧行 `t=0` 语义为「无法担保内容」→ 触发一次重建（不要用删库，旧索引仍有内容）。`build()` 先 `fsp.stat` 全部文件（并发 `BUILD_CONCURRENCY`；本仓 8101 文件实测：串行 44ms / 并发 27ms，相对 10s 重建可忽略），reuse 条件 = root + version + 集合相等 + 逐个指纹相等。`flushDirty` 必须把已 stat 到的指纹传给 `upsert`，否则一次编辑就把指纹写成 0、下次启动又重建。`TrigramIndex.indexed` 是新加的真「已索引文件数」（`size` 现在是「已知文件数，含二进制」）。
- **验证纪律**：这类判据改动，回归测试必须能在旧代码上失败才算数。两条都做过基线对照：`reindexes when a file's content changed since the last run`（旧代码 `matches:0`）、`reuses the index when nothing changed, even with a binary file present`（旧代码 `built_at` 会变）。后者用缓存库里的 `meta.built_at` 断言「没有重建」，因为服务层没有别的可观测点；`built_at` 只由 `replaceAll` 写。
- **不能用来兜底的方案**：「候选为空就退回全量 rg」。那会把每次未命中的成本从 0 变成 3.5–4.4s 全扫，把预筛的主要收益打掉。只能修索引时效性本身。
- **grep 字符截断落盘（2026-10-26，对齐 Cursor「长输出落盘 + 回填路径」）**：grep 的 `cap()`（`CHAR_BUDGET=15000`）按字符预算切掉的行，`offset` 翻页拿不回来——offset 按 match 单元跳、cap 按页面内字符切，两者粒度不同，被切掉的中间行只能重跑更窄搜索。这是 24% 截断 + 48% 重复读的根因之一。修法：`cap` 改为返回 `{text, hidden, fullText}`，`toModelContent` 重构为 `render`（返回 `{text, spill}`）薄封装 `toModelContent`（保持纯函数 string 返回，兼容既有测试）；execute 里 `spill !== undefined` 时用 `ToolOutput.save(Buffer, ".txt")` 落盘（复用已有 tool-output 目录 + 7 天保留），回填 `[Full results saved to <file>; read it...]`。`grep.ts` 新增 `yield* ToolOutput.Service`。测试 `tool-search.test.ts` 加 `spills the full result to a file when the character cap hides lines`（验 spill 含 `needle 99`、可见文本长度受 cap 约束），grepToolNode/localGrepToolNode 的 deps 补 `ToolOutput.node`。
- 相关事实（复核）：`ToolOutput.truncate` 落盘基建本就完整（`tool-output.ts` 的 `boundedEnds` 首尾保留 + `markerOf` 回填 + `outputPath` metadata），但 grep/glob/read/shell 自带 `metadata.truncated` 在 `truncate` 第一行短路。其中 shell 自己落盘（`shell.ts` 的 `info.file`）、read/glob 有 offset 分页能读回，唯一真缺口就是 grep 的 cap 字符截断。
- **编辑工具面全模型族通吃（2026-10-26，对齐 Cursor「单一编辑语义，不做模型族分支」）**：上游 opencode 的 `patch.ts` 用 `usePatch` hook 按 `model.id` 互斥切换编辑工具——`gpt-*`（非 oss/gpt-4）只留 `patch`、删 `edit`+`write`，其余模型删 `patch`。这是 Cursor 逆向文档《四层工程逻辑对照》§0 明确点名的 opencode "band-aid"（#34491）：工具面随模型切换而漂移，换模型就 cache 失效 + 提示失效。Cursor 的做法是 `ToolCall` oneof 只给「str_replace + 整文件写」一套工具面全模型通吃、让模型自选。\n  - 改法：`patch.ts` 的 `hook` 从「互斥 delete」改成 no-op（`void event`），`edit`/`write`/`patch` 三个工具全模型族同时暴露，加 `// SiCode:` 注释说明理由。`internal.ts` 的「Render model prompts after the patch plugin selects the available editing tools」注释同步改为「...registers (it no longer prunes editing tools)」。\n  - 测试：`tool-patch.test.ts` 原测试「selects the same edit tools...」断言 `gpt.tools=["patch","read"]`、`claude.tools=["edit","write","read"]`（互斥锁），改为「keeps edit, write, and patch available to every model family」断言两者都 `["edit","patch","read","write"]`。\n  - 注意：`optimize.test.ts` 里 GPT 模型 tools 列表含 edit+patch+write 的断言，是因为 `OpenAIToolsPlugin`/`AnthropicToolsPlugin` 已「disabled intentionally」（`optimize.ts:33-34` 注释掉不导出），与本次无关，勿改回。\nEOF
- echo "EXIT: $?"

## 侧边栏文件树

- 「打开文件」侧边栏的树是 `gui-extensions/src/file/tree-v2.tsx`，行由 `tree-model.ts` 的 `flattenLiveFileTreeV2` 从 `screen.file.tree.list(dir)` 拼出；数据源是 app 侧 `workspaces/files/tree-store.ts`。
- 目录只列一次：`tree-store.ts:42-48` 的 `listDir` 在 `dir[dir].loaded` 为真时直接返回；折叠再展开走 `expandDir`（`:138-145`）→ `listDir` 无 force → 同样不重读。`tree-v2.tsx:186-195` 只在根 `loaded` 为假时才 `sync("")`。
- 能让已加载目录重列的只有 `filesystem.changed`：`workspaces/files/model.tsx:263-281` → `watcher.ts:16-41`（unlink 时刷事件文件的父目录，且要求该目录已 load）。
- 服务端全仓只有一处发这个事件：`core/src/filesystem/location-watcher.ts:28-32`，订阅目标是 `<gitdir>/HEAD` 单个文件（`:38`、`:69`）。上游 e5ef00b8b8（bound project filesystem watches）已经删掉了整个工作区的递归监听，只剩 HEAD。
- HEAD 事件到客户端后路径归一化成 `.git/HEAD`，被 `watcher.ts:21` 的 `.git/` 守卫丢掉；Windows 下反斜杠能绕过守卫，但父目录算出 `.git`，从未 load，`:38` 同样返回。净效果：树除了工作区切换或重启（`model.tsx:97-106` 的 scope 变化重置 tree）不会重新读盘。
- 没有任何手动刷新入口：`gui-extensions/src/file` 里只有 `sidebar.tsx:33` 在目录变化时 force sync，右键菜单只有「用其他应用打开」。
- 同一机制也管文件内容：已打开的 tab 不会因为磁盘上文件被改/被删而更新。
- 原来「没有任何手动刷新入口」：现在侧边栏 header 有刷新按钮（`gui-extensions/src/file/browser.tsx` 的 `stats` 槽，i18n `tree.refresh`），点它和自动刷新走同一个 `refreshFileTree`（`gui-extensions/src/file/refresh.ts`）。
- `tree-v2.tsx` 两处触发：挂载时一次（覆盖关掉面板再打开），以及 `session.status` 转 `idle` 时一次（写法照抄 `review/model.ts:552` 的 `idled` memo）。
- `refreshFileTree` 只对 `state(dir).loaded` 为真的目录 `sync(force)`，沿已加载节点递归，**不动 `expanded`、不动滚动**，所以刷新不会收起目录也不会跳位置；行数变化由虚拟化自己处理。
- 已打开的文件 tab 内容仍然不刷新（`file.sync` 未接），删掉的文件 tab 会停在旧内容。
- 刷新按钮有转圈反馈：`refreshFileTree` 改成返回 Promise（`Promise.all` 所有 `sync(force)` 的结果，单个失败被吞），按钮在 `refreshing()` 时把 `Icon` 换成 `Spinner`（`@opencode/ui/spinner`，`size-4` 与 `Icon` 默认 16px 同尺寸不跳），并有 `aria-busy` / `aria-disabled`。
- `minRefreshSpin = 450`ms：列目录通常 10–30ms 就回来了，不等这个时长根本看不见，所以 `finally` 里补足剩余时间再收起。刷新中重复点击被 `if (refreshing()) return` 挡掉（不设真 `disabled`，避免键盘焦点被摘掉）。
- 自动刷新（挂载 / 每轮 idle）不点亮转圈，只有点按钮才有。
- 原来「转圈用 `Spinner`」是错的：那个是 16 格方块闪动，用户要的是图标自己转。改成 `<Icon name="refresh" class={refreshing() ? "animate-spin" : undefined} />`。
- **`animate-spin` 这个 utility 原本不存在**：`packages/ui/src/styles/tailwind/index.css` 的 `@theme` 里有 `--*: initial`，只补了 `--animate-pulse`，Tailwind 默认的 `--animate-spin` 被清掉了。已按 pulse 的同一套写法补：`styles/animations.css` 的 `:root` 加 `--animate-spin: spin 1s linear infinite` + `@keyframes spin`，`@theme` 里加 `--animate-spin: var(--animate-spin)`（theme 层被 utilities 层的 `:root` 覆盖，pulse 就是这么生效的）。
- 验证方式（不用起应用）：`node .preview-shell/tw-print.mjs` 用 `tailwindcss` 的 `compile()` 直接编译 `styles/tailwind/index.css`，确认 `.animate-spin { animation: var(--animate-spin) }`、两条 `--animate-spin` 声明顺序（theme 在前、utilities 在后）、`@keyframes spin` 都在产物里。补之前同一脚本对 `animate-spin` 返回 false。
- 停止时机：`refreshSpinPeriod = 1000`，结束时把总时长向上取整到整数圈再收起，所以图标永远停在 0°，不会转到一半被拽回去；代价是 Click 到收起最短 1 秒。

## 会话历史脊

- 组件是 `app/src/session/timeline/turn-rail.tsx` + `turn-rail.css`（未提交，SiCode 新功能），挂载点 `message-timeline.tsx:497` 的 `<SessionTurnRail>`，`<Show when={props.active !== false}>` 里。
- 数据：`turnRailMessages` = `selectVisibleSessionUserMessages(selectSessionUserMessages(history.messages()), revert?.messageID)`；`turnRailFailed` 只看该轮最后一条 assistant 的 `error`。点击 tick → `onUnpin()` + `scrollToMessage(message,"smooth")`（`use-session-hash-scroll.ts:99`，靠 `#msg_` 锚点 + `revealMessage` 重试 4 帧）。
- 高亮当前轮：`activeTurnID` 每帧 `scroller.querySelectorAll("[data-message-id]")` + 每行 rect，取 `scroller.top + 100` 那条线上的行。`data-message-id` 在 `session-ui/src/timeline/session-timeline-row.tsx:533`，值是所属 user message id，所以每行都能对上一个 tick。
- 门槛 `minTurns = 2`：一轮的会话完全不渲染（`<Show>` 卸载，CSS 里的 `[data-visible="false"]` 是死规则）。tick 间距固定 14px，放不下就 `overflow-y:auto` 且隐藏滚动条（`track[data-scrollable="true"]`）。
- 定位：`nav` 绝对定位 `inset-block: 56px 12px; inset-inline-end: 14px; width: 28px; z-index: 50`；`nav` 本身 `pointer-events:none`，只有 track 收事件；`<768px` 整条隐藏。
- 无单测、无 story：`packages/app` 和 `session-ui` 的测试目录里都没有 turn-rail；`.preview-shell` 只渲染 session-ui 的 `SessionTimeline`，不带这条脊，所以视觉只能在实际应用里看。
- 调试注意：桌面端窗口最小化时 `document.visibilityState === "hidden"`，CDP 的 `Input.dispatchMouseEvent` / `dispatchKeyEvent` 全部无效（点标题栏、发 alt+arrowup 都没反应），`Page.bringToFront` 也救不回来；`history.pushState` + popstate 也不驱动路由（桌面端是内存路由，路由是内存的，`location.pathname` 恒为 index.html）。要实测必须先让用户把窗口还原。
- 首轮审查后用户批准修 1-4，已落地（都在这两个未提交文件里，另加 `message-timeline.tsx` 的一个 memo 和 en/zh/zht 的 `session.historyRail.jump`）：
  - 轮次编号：新增 `complete` prop，由 `message-timeline.tsx` 的 `turnRailComplete`（`!server.ctx.data.session.message.more(id)`）给。历史分页没加载完时不再显示「第 N 轮」（`more()` 为真说明还有更早的页，编号会差），改用该轮提示词做 aria-label 兜底；加载完才编号。
  - 预览夹取：`previewHeight` 由 effect + rAF 量 `[data-slot="session-turn-rail-preview"]`，`clampPreview(top)` 把气泡限制在 nav 高度内，靠上/靠下的 tick 不再被窗口裁掉。
  - 无障碍：去掉 track 的 `role="list"` 和 tick 上的 `role="listitem"`（后者会把 button 语义盖掉），现在是 nav 里一串带 aria-label 的 button。
  - 自动滚动：`scrollIntoView` 换成直接算 `tick.offsetTop` 设 `track.scrollTop`，不会再去带动别的滚动容器。
  - 顺手：track `onScroll` 时按保存的 tick 元素重算 hover（梯子滚动时气泡跟着走）；删掉死规则 `[data-visible="false"]` 和同名常量属性。
- 仍未做：每帧 `querySelectorAll("[data-message-id]")` + 每行 rect 的抽样方式没动（`activeTurnID` 保持原样，rAF 节流，实测不了了）。

## 语义索引

- 语义索引的基础设施盘点（2026-10-24 查证）：**有 SQLite**（`@effect/sql-sqlite-bun` + drizzle，`#sqlite` 条件导出分 workerd/bun/node 三实现）；**有 web-tree-sitter 0.25.10** 但只带 bash/powershell 语法，TS/TSX 语法包需另加；**没有 embedding 调用路径** —— provider 层只在 lmstudio 的 model type 字面量里出现过 "embedding"，`models.dev` 快照里 embedding 模型几乎为零，AI SDK 的 `EmbeddingModelV2` 接口没被任何 provider 实现。
- 规模基准（本仓）：5146 个 `ts/tsx` 文件、**914,146 行**。按 25–40 行/语法块估 ≈ **2.5–3.6 万块**；384 维 float32 每块 1.5KB ⇒ 向量库约 **37–54MB**（内存或 SQLite blob 都放得下）。
- 首次索引成本估算：本地 CPU 小模型（bge-small / all-MiniLM 量级）单块 5–15ms ⇒ 2.5 万块约 **2–6 分钟**；走 API（text-embedding-3-small 量级）约 100 万 token，费用可忽略但代码要出本地。
- **关键判断：Cursor 的「懂整个项目」= 语义索引 + 自动注入，两件事缺一不可。** 我们现在的架构是 agent 主动调工具，模型必须自己想到去搜；只补索引不补注入，体感不会有 Cursor 那种「它自己就把相关文件带进来了」。这条比 embedding 选型更影响最终效果。
- 「为什么需要语义检索」的实测证据（`packages/core/src`，`*.ts`）：问「上下文压缩什么时候触发」时，grep `compress` 只命中 **4 个文件**，且全是 OpenAI/Copilot 的 API 参数（`openai-responses-api-types.ts`、`openai-responses-prepare-tools.ts`、`plugin/provider/chatgpt.ts`、`plugin/provider/openai.ts`），跟上下文压缩毫无关系；真实实现在 `session/compaction.ts`，文件名里**没有 compress**。而 grep `compact|summariz|prune` 命中 50+ 文件（截断值）。⇒ 一个概念只有一种叫法，**猜错词不是命中率下降，是零命中 + 4 个误导项**，模型据此会得出「这个项目没有上下文压缩」的错误结论。
- 对照：grep `retry` 命中 **25 个文件**，候选池大到模型只能挑几个读；语义检索的价值在这里是「把池子从几十个文件降到 8 个块」。
- 一期收益的真实边界：只救「grep 猜错词」这一类失败。若一次任务里多数搜索都能靠 grep 猜对，一期收益接近零。⇒ 价值必须靠测试集度量，不能靠感觉。
- 切块实测（5119 个 ts/tsx，`web-tree-sitter 0.25.10` + `tree-sitter-wasms 0.1.13`，**ABI 匹配**；0.27.1 配同一语法会报 `getDylinkMetadata` 失败，必须用 0.25.x）：解析耗时 **10.4 秒**，失败 3 个文件；顶层节点 35,292 → 二次切分后 40,361 → 相邻合并后 **19,941 块**。块长 P50=38、P90=80、max=236、均值 43 行；平均 1751 字符，文本合计 **34.9MB**；384 维向量约 30.6MB ⇒ 库约 **65MB**；首次建索引按 10ms/块估 ≈ **3.3 分钟**。
- **切块质量问题（必须修）**：`#part` 碎片 **6804 块，占 34%**，是长函数按行硬切出来的。按行切会把 `if`/`switch` 拦腰截断，语义断裂。方案里写的「按内部语句边界切」尚未实现 ⇒ 真实实现要改成沿 AST 语句节点切，块数会下降但质量上升。
- 长度分布严重偏向 51–80 行（7149 块，36%），因为硬切都顶到 80 上限；1–10 行仍有 2219 块（11%）。
- grep 基线（20 条意图查询，范围 `packages/core/src`，按命中次数取 top5 = 对 grep 最有利）：**零命中 0 条、答案在候选里 17 条（85%）、进 top5 13 条（65%）、排第 1 仅 7 条（35%）**。3 条完全失败：`compress`→上下文压缩（真实文件是 `compaction.ts`，返回 6 个无关的 OpenAI/Copilot API 文件）、`emit`→消息推送（实得 `config.ts`/`bus.ts`）、`validate`→工具参数校验。
- **测试集偏差要说明**：20 条里大部分「功能名 ≈ 模块名」（retry→retry.ts、permission→permission.ts），对 grep 极其有利。真实查询多为行为描述，失败率会高于 35%。
- 结论修正：grep 没有原先假设的那么差，语义检索的增量空间是那 35%（低排名 4 条 + 零命中 3 条）。一期仍值得做，但预期应从「明显改善」下调为「补上猜不到名字时的兜底」。
- **二期（自动注入）不需要改 session 主循环**——之前判断"必须动内核"是错的。`model-request.ts:401` 的 `agentHook` 是 `hooks.trigger("session", name, { ...draft, agent, tools })`，浅拷贝保留了 `system` 数组引用；`SessionRequest.system` 是可变 `Array<SystemPart>`，插件 push 进去的 part 会经 `LLM.request({ system: shaped.system })`（同文件 289 行）真实发出。⇒ 追加 system part 可以纯插件实现（`session.context`），追加到用户消息可以走 `session.prompt`（`prompt: DeepMutable<PromptInput.Prompt>`）。
- 注入位置有缓存语义差别：塞进 `system` 会改整个 prompt 前缀、每轮打断 prompt cache；塞进最后一条 user message 的 parts 只影响末段。后者是 Cursor 那种"context attachment"的做法，应默认选它。
- 二期真正的门槛不是工程量（50–150 行 + 一处注册），是**精度**：主动检索失败模型能看到空结果并重试，自动注入失败是**静默污染**——模型默认注入内容是权威的，不会怀疑。⇒ 二期要求的命中精度高于一期，而当前切块 34% 是硬切碎片，数据质量反向。
- 决定顺序：先修切块（沿 AST 语句边界）→ 用 FTS5/BM25 重跑 20 条基线（零新依赖，可判"问题在排序还是在词表"）→ 仍不够再测 embedding 的 recall@8（采样 2000 块，不建全量索引）→ 达标才进二期。
- `model.request` hook 只给 `baseURL`/`headers`，是 provider 定向用的，改不了 prompt 内容，不要拿它做注入。
- **结论（用真实数据判死二期）**：不做二期，且语义索引整条线建议收手。真实数据把它的目标缩到很小：零命中只占 13% 且 59% 自愈，真正可救空间约 5%；而 33% 的洪水 + 24% 截断 + 48% 重复读，一个都不靠向量解决。
- 一期/二期的定位被证伪：二期的卖点是"模型没想到去搜"，但实测平均每轮 1.90 次检索调用、45% 是多轮试探 ⇒ **模型一直在搜**，缺的不是"被动注入"而是"搜得准、收得窄"。
- 若仍要做语义，前置顺序不变且更硬：先修切块（当前 34% 是硬切碎片），否则注入的是失真块，属于静默污染。
- 比语义索引更划算的下一步（不碰索引、不引依赖）：① grep 结果做文件级摘要 + 排序（按文件名命中、命中密度、测试文件降权），直接压 33% 的洪水；② 截断时把"还有更多，请加 path/include 收窄"写进结果而非只给 `truncated:true`；③ 已完成的 context 行对准 48% 的重复读。
- 探针基建结论（复用价值）：`serve` 子命令可无界面起服务，鉴权是 `Basic base64("opencode:<password>")`，也接受 `?auth_token=<same base64>`；但**纯 `serve` 模式不会消费 session_inbox**，POST `/api/session/:id/prompt` 只会入队不跑 agent loop（消息停在 inbox，assistant 消息为 0）。要跑真实 agent 需桌面端/TUI 附着。⇒ 以后想自动化跑 agent，别从 `serve` 走，直接读历史会话库更快：`session_message.data` 里 `content[].type==="tool"` 带 `state.input` 与 `state.output`（grep 的输出元数据是 `{matches, truncated}`）。
- **fff 已自带内容搜索，只是没接（2026-10-24 查证）**：`@ff-labs/fff-bun@0.10.5`（Rust + FFI，MIT，`node_modules/.bun/@ff-labs+fff-bun@0.10.5`）导出 `grep(pattern, GrepOptions)` 与 `multiGrep(MultiGrepOptions)`，选项含 `mode: "plain" | "regex" | "fuzzy"`、`pageSize` + `cursor` 分页、`timeBudgetMs`、`beforeContext`/`afterContext`、`classifyDefinitions`（把命中行标为定义并给 `isDefinition`）、`smartCase`、`maxMatchesPerFile`；`multiGrep` 是 SIMD Aho-Corasick 多模式 OR 匹配；结果按 frecency（最近/最常访问优先）排序。
- SiCode 只用了它的 `fileSearch` / `directorySearch` / `mixedSearch`（`packages/core/src/filesystem/search.ts:149-190`），**grep 工具完全没走 fff**：`packages/core/src/tool/plugin/grep.ts` 直接 `import { Ripgrep }` → `packages/core/src/ripgrep.ts` spawn rg 进程。
- `fffLayer` 初始化时显式关了内容索引与 mmap 预热：`search.ts:127` 的 `disableContentIndexing: true`、`disableMmapCache: true`。这两项开着才是"索引化 grep"，关着就只是"索引化文件名搜索"。
- 生效条件卡得很死（`search.ts:195-207`）：`location.workspaceID` 有值 → 必须 ripgrep（远程沙箱，fff 只索引本地目录）；`options.fff === false` 或未指定且 `process.platform === "win32"` 或 `!Fff.available()` → ripgrep；非 VCS 或 home 目录 → ripgrep。⇒ **本机（Windows）开发时 fff 一次都没跑过**，任何基于本机的对比都要显式打开。
- 类型面在 `packages/core/src/filesystem/fff.ts`（只声明了 `Picker` 的三种搜索），`GrepOptions` / `GrepResult` 等类型没有进这层适配，接 grep 需要在 `fff.ts` 补接口、三套后端（`.bun.ts` / `.node.ts` / `.workerd.ts`）里 `.workerd.ts` 仍需保持 unavailable 降级。
- 与已量化痛点的对应关系：`classifyDefinitions` 对"grep 命中排第 1 仅 35%"；`pageSize` + `nextCursor` 对 24% 截断；`multiGrep` 一次搜多个同义词对 45% 的多轮试探；内容索引预热对"一次给出代码块"。⇒ 这条路不需要自建切块索引（那套是 19,941 块 / 10.4s 的既有成本），也不涉及 embedding。
- **修正上面「Cursor = 语义索引 + 自动注入，两件事缺一不可」（2026-10-25，Cursor 3.24.18 逆向，`D:/软件丨工具/cursor逆向专区`）**：原来把 Cursor 想成一条管道，实际是**三条并行** —— A `Crepe` 本地 trigram 倒排（`.git/cursor/crepe/<commit>/`，`CRP2` 的 `index.bin` + `postings.bin`，**文件级 posting**，命中后仍要回读文件做行级正则）；B Merkle / codebase snapshot（增量与同步）；C 语义检索（向量 + rerank，`topK` 默认 25、结果带 `score`，**在云端 / managed local client**）。⇒ **Cursor 本地也没有 embedding**，「语义索引」不是它本地能力的一部分。
- 自动注入同样不成立：`Cursor-本地检索与索引全链路.md` §4 结论原文是「暴露成工具，不靠把 grep 结果灌进系统提示」「不把整库检索结果当隐式上下文自动塞进 prompt」；Grep / Glob / Read / SemanticSearch 四工具分立，靠工具描述教模型自己选。Cursor 只注入**用户手动选的 `selectedContext` + rules/skills 索引**，不注入检索结果。⇒ SiCode 的 `config/plugin/project-map.ts`（每请求 push repo map + notes 标题索引）反而比 Cursor 激进，这一项不用对齐。
- 索引层实测对照（归档里 Crepe 的测样本就是本仓 SiCode worktree，可直接对读）：Crepe 8019 文件 / 全量建 6.85s / 产物 87MB（index 44.7 + postings 42.7）/ 稀有符号查询 ~15ms，约为全库 rg 的 1/70；SiCode `filesystem/trigram-search.ts` 8232 文件 / 建 10s / 盘上 15MB / 查询 5–85ms。**查询同档、盘上小 6 倍**，索引层没有落后，不需要重做，差距不在这一层。
- **与 Cursor 的差距全景（2026-10-26 收口，替代此前散落的「该抄失效策略」等旧结论）**。五条，只有一条该对齐：
  - ① 索引失效策略 —— 唯一该抄的。Cursor 按 commit 分目录（`.git/cursor/crepe/<commit>/`），换 commit 即整目录失效；SiCode 是 fingerprint 逐个比对（mtime+size，`trigram-search.ts:244-260`），更细但每次启动要 `stat` 全仓 ~40ms。方向无对错，Cursor 更省心。
  - ② 后台摘要不落盘 —— 记账透明度换的能力差。Cursor `persisted` 落盘复用、跨进程不丢；SiCode held 只在内存 `Map`，退出即丢，浪费率更高。这跟默认关是同一套逻辑（花用户 key 的钱、被弃摘要又不进成本），不照抄。
  - ③ 语义检索（embedding+rerank）—— 不是差距，是被数据证伪：零命中 13%、59% 自愈、可救 5%；33% 洪水 + 24% 截断 + 48% 重复读一个不靠向量。本地双方都没有 embedding。
  - ④ grep 排序/收窄 —— 纯收益、零依赖、该做没做。裸 rg 输出 + `truncated:true`，无文件级摘要排序、无「还有更多请收窄」引导。
  - ⑤ fff 内容搜索 —— 「手里有牌但成本高」。`fff.ts` 适配层只声明了 `Picker` 的 file/directory/mixed 三种搜索，`grep`/`multiGrep`/`classifyDefinitions` 内容 API 没进这层，接它要补 `fff.ts` 接口 + 三套后端（.bun/.node/.workerd），workerd 还得保持 unavailable 降级。不是轻量动作。
  - 结论：真差距只有 ①（该抄失效策略）和 ②（能力差但刻意）；④ 是最划算的下一步（不碰索引不引依赖），⑤ 收益不明确且成本重，暂不动。
- **grep 结果排序已加「文件名命中优先 + 测试降权」（2026-10-26）**：`packages/core/src/tool/plugin/grep.ts` 的 `toModelContent` content 模式排序从「纯命中数降序」改成「rank 优先、命中数次之」——rank 0=实现文件且文件名命中 pattern（`nameStem(file).includes(patternStem)`，pattern 含正则元字符则跳过该信号）、rank 1=其他实现文件、rank 2=测试/夹具文件（`isTestPath` 匹配 `__tests__`/`test`/`tests`/`spec`/`__mocks__`/`__fixtures__` 及 `*.test.*`/`*.spec.*`）。预览标题「Files by hit count」改「Files by relevance」。`toModelContent` 签名加了 `pattern` 参数。count/files_with_matches 模式不变（走独立分支）。测试 `tool-search.test.ts` 加 `ranks files by filename hit first, demotes tests`。
- 修正旧笔记「裸 rg 输出、无排序」：命中数排序和截断引导其实早已有（`truncatedNote` 写「narrow with path or include」），本轮只补了文件名命中 + 测试降权两档。

## 字体与排版

- 会话面字号/字重的唯一调节点是 packages/ui/src/styles/theme.css（:root 的 --font-size-small/-x-small/--font-weight-regular）；组件层 CSS 一律应引用 var()，勿硬编码 px。
- 2026-10-25 起 token 值为 small=14px、x-small=12px、regular=460（针对 Windows Chromium 下思源黑体可变字体小字号发虚的问题调大），14 个会话面 CSS 已从硬编码 13px/11px/440 切到 token。
- packages/app/src/index.css 里 IBM Plex Mono 的 @font-face（weight 400/440 两段）是字体注册，不是文本样式。
- 终端默认字体 JetBrainsMono Nerd Font Mono 定义在 packages/app/src/settings/model.tsx（bundled woff2）。
- 对照组 WorkBuddy（本机安装目录实测）：无内置 webfont，UI 走系统栈 PingFang SC/微软雅黑（--sc-ui-font-family，--sc-content-font-family 同栈带 emoji 兜底），等宽 ui-monospace/Menlo/Consolas、部分组件 Source Code Pro；有用户可调的字体大小滑块（--sc-font-scale）。
- 2026-10-25 深夜：用户嫌思源黑体不如 WorkBuddy 好看，--font-family-sans 已改为 WorkBuddy 同序的系统栈（-apple-system/PingFang SC/微软雅黑优先，Noto 系降到末位兜底）。Windows 上 UI/正文实际渲染=微软雅黑；weight 460 在雅黑下回落 Regular 400（雅黑只有 300/400/700），medium 500 同理回落 400。IBM Plex Mono 等宽栈未动。bundled @fontsource Noto 仍在 index.css 里注册，作为无雅黑机器的兜底。

## 过程壳与时间线

- 过程壳展开动画现由 data-animating 门控（tool-renderer.tsx change() 设置，240ms 自清除；message-part.css 选择器同步）：只在用户点击折叠/展开时播放，会话打开/失败回合默认展开/流式自动展开均不播。
- 会话打开文字跳动根因（2026-10-25）：virtualizer.tsx 冷挂载 visibility:hidden 保护仅限 pinned 会话，非 pinned（滚动停在中间）冷首开裸奔——行高先按 60px 估算渲染、ResizeObserver 实测后逐行纠正，可见区文字整体下移。修复：coldMount(=!cache) 广义门控 reveal，拆 coldRevealPending（reveal）/coldPending（pinned bottom-settle）。已 tsc 通过。
- 指令更新通知（packages/session-ui/src/timeline/session-timeline-row.tsx `notice()`）：system 消息 metadata.notice=="instructions" + instructionSources 由 message-updater.ts:151 从 session.instructions.updated 事件生成；InstructionState.prepare 在 runner/llm.ts:224 每个 step 边界重读指令源，core/git-status 快照一变就发事件，所以通知总贴在刚结束的助手回复下面（时间线=事件日志，按时间点追加）。
- SiCode 改动：`notice()` 过滤 `core/*` 前缀的源（git-status/date/environment 是给模型的内部上下文，不是给用户看的），全 core 的 delta 返回 undefined 不渲染通知卡片；混合源只显示用户级（AGENTS.md 等）；同时覆盖旧格式 description "Instructions updated: " 前缀分支。模型侧上下文更新不受影响（system 消息仍进时间线与请求）。
- 勿改回：return undefined 时 grouped 路径会建空 part 但 `Show when={content()}` 渲染为空，与 model-switched 先例一致；不能让它落到 `message.description ?? message.text` 兜底，否则会把裸文本 "Instructions updated: core/git-status" 打出来。

## shell 输出编码

- **中文 Windows 下 shell 输出乱码的根因（2026-10-25）**：宿主默认 `[Console]::OutputEncoding` 是 **gb2312 / codepage 936**（本机实测），ps 家族与原生控制台程序都按这个代码页写 stdout/stderr；而 `shell.ts` 的 `output()` 原来用 `buffer.subarray(...).toString("utf8")`，于是每个中文字符都变成 U+FFFD —— 恰好是解释命令为什么失败的那一行。例：`$($null.Count)` 的报错原文「无法对 Null 数组进行索引。」被存成 `�޷��� Null �������������`。
- **修法一（根因）**：`shell/select.ts` 的 `args()` 给 ps 家族加前置 `try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}; `（`PS_PRELUDE`）。它同时修正两个方向：ps 自己写出的错误消息、以及 ps 解码原生程序输出时用的代码页。带 `try/catch` 是因为无控制台宿主下赋值可能抛错，不能让它连带整个命令失败。
- **修法二（兜底）**：新增 `packages/util/src/decode.ts` 的 `Decode.outputText(bytes)`：先按 UTF-8 严格解码，失败且平台是 win32 时退到 `TextDecoder("gbk")`。关键细节是 `completeEnd()` 先剔掉尾部不完整的多字节序列再判断 —— 否则分片读取把字符切成两半时，合法 UTF-8 会被误判成 GBK，反而整段变乱码。放在 util 而不是 core，是因为 `util/src/process.ts` 的 `requireSuccess`/`requireExitIn` 也要用（`stderr.toString("utf8")` 是同一个 bug），而 util 不能依赖 core。
- **修法二落点**：`core/src/shell.ts` 的 `output()`（shell 工具结果与增量读取共用这一处）、`core/src/config/plugin/command.ts`（`!command` 插值，原来也是 `toString("utf8")`）、`util/src/process.ts` 两处错误消息。
- **顺带修正一个此前记错的结论**：shell 工具**本来就保留尾部** —— `Shell.result` 自己按 `maxBytes` 从文件末尾分页、再 `lines.slice(-maxLines)`，并写好 `[showing lines N-M of T; full output saved to …]`，metadata 也带 `truncated`。而 `ToolOutput.truncate` 见到 `metadata.truncated !== undefined` 会直接原样返回（`tool-output.ts` 开头第一段逻辑）。所以：**shell / read / grep / glob 都走各自的截断，`ToolOutput` 的 head+tail 只作用于 MCP 工具（`tool/mcp.ts`）和没自己写 `truncated` 的插件结果**。之前把「补尾部」说成修 shell 报错栈是错的。

## 压缩遥测

- **为什么默认关（代码依据，2026-10-25）**：`schema/src/config/experimental.ts` 的 `precompute_compaction` 描述原文就写了「Background summaries that are never used still cost tokens」，同目录 `portable_shell_scanner` / `todo` 也都是默认 false，experimental 这一档的约定就是显式 opt-in。更硬的一条是记账：`session/compaction.ts` 的 `held.usage.forEach(addSpent)` 只在 `usePrecomputed` 成功换入时执行，所以**被丢弃/失败/会话结束的后台摘要不进会话成本、也不发 `UsageRecorded`** —— provider 照扣费，界面上看不见。默认关本质是不让用户在一笔无法反查的账上花钱。
- **兑现路径很窄**：`usePrecomputed` 的 `usable` 要求 `trigger.reason !== "overflow"`，即 provider 报上下文超限后的恢复性压缩**永远不用** held 摘要；native compaction 也不用。触发还要过 `estimateContext >= ceiling × PRECOMPUTE_RATIO(0.85)` 且实测 prompt ≥ `PRECOMPUTE_MIN_TOKENS(64k)`。`tailLimit = min(max(keep*2, 30000), budget*0.25)`，默认 keep=15000 → 恒为 30000；而 85%→100% 的余量是 `0.15 × 窗口`，所以**窗口 > ~200k 时可能在到点前又聊超 30k，held 过期重算**（日志里记作 `superseded`）。
- **遥测落点（新增，零侵入）**：`core/src/compaction-metrics.ts` 只监听 Bus 的 `Compaction.Started` → `Ended`/`Failed`，用 `sessionID` 配对算耗时，不需要改 `session/` 主循环；注册在 `plugin/internal.ts` 的 node 列表（依赖 `Bus.node`，已在列表中）。因为 `Compaction.Ended` 的 schema 本身没有 duration 字段，配对是唯一不用改内核的算法。没有 Started 配对的 Ended 直接丢弃（重启后恢复的压缩，算出来是假的）。
- **precompute 生命周期三条**（`session/compaction.ts`，新增 `Precomputed.startedAt` + `Effect.timed` 包 `summarize`）：`state=started` 带 `windowRatio`/`tailTokens`/`tailLimit`；`state=used` 带 `savedMs`（摘要自身生成耗时 = 真省下的等待）与 `leadMs`（提前多久准备好）；`state=discarded` 带 `reason`，取值 `precompute-off` / `overflow` / `native` / `stale-session` / `stale-tail` / `superseded` / `failed`。fiber 的返回类型因此从 `Result` 变成 `{ result, durationMs }`，`usePrecomputed` 里 `exit.value` 相应改成 `exit.value.result`。
- **日志格式与解析契约**：`util/src/observability/logging.ts` 的 formatter 会把 `Effect.logInfo("msg", {obj})` 的**第二个参数 flatten 成平铺字段**，标量不加引号（正则 `/^[^\s="\\]+$/` 才免引号）。实际落盘形如 `message=compaction.timing outcome=completed reason=auto durationMs=41200`。`script/compaction-stats.ts` 就是按这个形状解析的；改任何一侧都要同步另一侧。Effect v4 里替换 logger 的 API 是 `Logger.layer([logger], { mergeWithExisting: false })`，`Logger.replace` 不存在（踩过）。
- **判据（脚本自动给）**：`waste = discarded / (used + discarded)`，>50% 保持关；25–50% 记作 marginal；<25% 且累计 `savedMs ≥ 30s` 才判 justified。`unsettled = started - used - discarded` 代表会话结束或仍在跑、从未结算的那部分，是这套统计的固有盲区（进程退出即丢 held）。
- **和 Cursor 的结构差异**：Cursor 的 9 个指标里有 `persisted`，说明它的后台摘要算完会落盘复用（`BackgroundAndPersistIfCompleted`）；SiCode 的 held 只在内存 `Map`（`compaction.ts` 的 `precomputed`），进程退出即丢，**所以它的浪费率天然更高**。这既解释了默认关，也说明「开关默认值」不该照抄 —— Cursor 的成本在自己账上，SiCode 的在用户 key 上。
- **路径更正**：本文件（含「项目记忆」区域）里出现的 `packages/plugin/internal.ts` 都应读作 `packages/core/src/plugin/internal.ts` —— 插件表、node 列表、`SessionStore.Service` 注册全在 core 包内，仓库里没有前者这个路径；`bun script/notes.ts verify` 会把它报成 missing。
- **后台摘要落盘（2026-10-26，对齐 Cursor 的 `persisted`）**：`session/compaction.ts` 新增最小落盘层。fiber 完成时 `Effect.tap` 把 `{text, keepID, firstID, model, initial, tailLimit, failures}` 写到 `global.cache/compaction/<sessionID>.json`；`precompute` 入口在内存 Map 无值时读盘重建一个「已完成」的 held（`fiber = Effect.succeed(...).pipe(forkIn(scope))`，`usage=[]`、`startedAt=now`），`heldIndex` 校验通过就复用、跳过重新 summarize。消费时 `compact` 开头 `deletePersisted`（`usePrecomputed` 的 discarded/failed 分支不需要再删，因为文件已在 compact 开头删掉）。`superseded` 分支同步删盘。`node` deps 加 `Global.node`。
- 语义边界：恢复摘要的 `usage=[]` 所以 `usePrecomputed` 不 `addSpent`（上次进程已计费，避免重复扣费）；`durationMs=0`/`leadMs=0` 让 `compaction-stats` 如实显示「落盘复用，非等待已算好摘要」。日志加 `state=recovered` 标记。
- 收益面窄：precompute 默认关，只有「开了 precompute + 长会话跨天重启 + 摘要已算完但未 compact」才命中，省一次 LLM 摘要调用。

## 上游同步

- 合并范围：`0133662a23`(v2.1.3) → `450e7b9241`(v2.1.4)，160 提交（66 fix/34 feat/23 docs/19 chore/10 refactor/3 perf/3 ci/1 test/1 sync），净改动 1056 文件 +23335/-56338。合并提交 `efeb0f2e22`（在 `merge/upstream-2026-10-26` 分支），43 冲突已解决。
- **数据层（最影响合并）**：`70c69f06f9` 附件从内联 base64 改成 `media:<hash>` 内容寻址 blob 表 + 新迁移 `20261025123711_blob.ts`，`history/inbox/projector/runner` 一起改。`f523f77138` 压缩配置键 `precompute_compaction`→`background_compaction`（无旧键别名）。合并后必须跑迁移，老会话附件才读得出来。
- **桌面端 UI**：`06dc6a0c73` mermaid→Pele 图表渲染（`markdown-mermaid.ts` 重写）；`5be4b1642b` shell 输出加复制按钮；`5ed03ad137` 压缩分隔线安静化；`9e8c5f5402` 行内评论卡片改文本框；`1873fbe304` 会话花费 0 时显示 Go 额度；`199ad46421`+`5f79a2aaf7` heap 快照 app+server 抓同一文件夹+原生内存分解。
- **AI/Provider**：图像生成三连——`861a2cf479` 阿里 / `23cd3109b4` Vercel AI Gateway / `4386838922` Cloudflare Workers AI(Run API)；`b7321f7fcc` Anthropic fast mode；`ed623cc648` OpenAI Responses 推理模式+context 选项；`8fd2ec1b72` xAI `min_p`；`50989519c7` 便携图像 shape(aspect+resolution)；`097a93e511` 实验评估换成 Decision（42 文件，最大单个 feat）。
- **MCP**：`4535146139` `connectClientMcp` helper + `4a6dacec5e` server websocket 端点 + `0b93f0b749` TUI 暴露 `open_terminal`（实验性客户端托管 MCP 三连）；`53f83e77fc` `serverInfo.title` 透出；MCP SDK 升 2.3.1。
- **Console/成本**：`a41d09bc78` Console 配置作为一层 config 合并进来（config 优先级有变）；`4cba1b7f5d`+`e42f6d1016`+`5e4aa55cda` 记录 reported cost/Go allowance、读用量上限、预算拒绝分类；`3330b3cf38` 不带 OpenAI key 用 Console 连 GPT-Live。
- **CLI/服务**：`6102079a0e` debug heap-dump；服务关停 10s 上限 + `port-owner.ts` 报端口占用者（治本机 3084 竞态）。
- **取舍口径（合并时）**：compaction/fff 搜索/附件存储/Provider/MCP 生命周期**取上游**；trigram 检索/循环检测/work-shell 时间线/输出瘦身/`write` 事务锁**保留 SiCode**。上游 160 提交里循环检测、旧工具输出裁剪、git status 注入、write 锁均为零对应。

## 会话审查 / 压缩

- **完成闸门 completion-gate（2026-10-26，对齐 Cursor `<completion_spec>` 结构化闸门）**：Cursor 用 `<completion_spec>` 强制 `summary`/`finish` 工具「仅 todo 全 resolved 且无 pending 工具结果时可用」。SiCode 无 finish 工具（回合结束 = 模型停止调工具），todo 工具（`todowrite`）又是无状态的（`execute` 只回显，不持久化）。所以闸门做成 nudge：模型「准备结束」（`needsContinuation===false`）但最近一次 todowrite 还有 pending/in_progress 时，注入一条 synthetic 提醒并强制继续一轮。\n  - 新模块 `session/runner/completion-gate.ts`：纯函数 `detectPendingTodos(messages)`（从后往前扫 `todowrite` 工具，读 `state.input.todos`，过滤 pending/in_progress；「Todos cleared」空列表覆盖更早列表）、`completionFingerprint`（按 status:content 做 key）、`completionGatePrompt`（列出未完成项）。\n  - 挂点 `session/runner/llm.ts`：`drain` 加 `completionNudged:Set<string>`（防死循环，同指纹只拦一次），传入 `runStep`；`Outcome.Completed` 分支在 `!needsContinuation` 时先查 todo，有未完成项且指纹未拦过 → `bus.publish(SessionEvent.Synthetic, {text: completionGatePrompt})` + `return true` 强制继续。synthetic 消息经 `to-llm-message.ts` 转成 `role:"user"` 进下一轮，`CONTINUE_AFTER_INCOMPLETE_STREAM`/`OUTPUT_LIMIT` 是既有先例。\n  - 安全默认：todo 未启用（`experimental.todo!==true`）则历史无 todowrite，`detectPendingTodos` 返回空，闸门不触发。\n  - 测试 `test/completion-gate.test.ts`：9 项（open todos / in_progress / 全 completed 或 cancelled / 清空列表覆盖 / 忽略非 todo 与空 / 忽略 streaming / fingerprint 稳定性与 status 参与 / prompt 列出项）。\n  - **注意**：`loop-detection.ts` 的 `NEVER_NUDGE = Set(["todo"])` 用的是旧名 `"todo"`，实际工具名是 `"todowrite"`（`todo.ts` 的 `name`），未匹配上——既有无害 bug，未动（本次不涉及）。\n  - **既有失败（非本次/上轮引入）**：`session-runner.test.ts` 两条 `automatically compacts into a completed summary and retained recent turn`、`caps an excessive provider retry-after delay at fifteen minutes` 在 stash 掉 llm.ts 与 compaction.ts 后仍失败，判定为上游 merge `dfe20c594b` 或更早就存在，与 completion-gate / 摘要落盘无关。\nEOF\necho "EXIT: $?"
- **历史文件引用 transcript 落盘（2026-10-26，对齐 Cursor「压缩前 transcript 文件位置 + 尾部指向」）**：Cursor 压缩时把「压缩前完整 transcript」写文件、在尾部带文件位置（`transcript` 行，可关），模型降智后能 read 回被摘要丢弃的原文。SiCode 之前没有：被丢弃消息在库（append-only）里还在，但 `SessionHistory.load(boundary:"latest")` 只读 compaction 之后（`history.ts` 的 `messageEntries` 用 `gte(seq, compaction.seq)`），模型无读回路径。\n  - 落点 `session/compaction.ts`：`summarize` 里 `!background && keepID` 且 `keepIndex > 0` 时（真正 compact 才落，precompute 后台摘要原文还在上下文不落），把 `messages.slice(0, keepIndex)`（keepID 之前的被丢弃原文）用 `SessionRecentText.messageToText` 序列化落盘 `global.cache/compaction/<sessionID>.transcript.txt`（复用上轮 persistDir 基建，新增 `writeTranscript`/`transcriptPath` 闭包辅助），并把 `transcriptPath` 塞进 `result.metadata`。\n  - 注入 `session/runner/to-llm-message.ts`：compaction case 读 `message.metadata.transcriptPath`，是 string 时在 `<conversation-checkpoint>` 里加 `<full-transcript>` 段（「完整原文已存 <路径>，read 工具读回」），让模型真正看到路径（metadata 只给 provider，模型读不到，必须写进 content 文本）。\n  - 测试：`session-runner-message.test.ts` 加 3 项（有路径注入 / 无路径不注入 / 纯函数 content 含 full-transcript）；`session-compaction.test.ts` 加 1 项集成（compact 后 transcript 文件真实写出、含被丢弃原文、不含保留 recent、metadata.transcriptPath 正确）。\n  - 踩坑：`it.effect` 里不能直接 `yield* Global.Service`（SessionCompaction 是 location 节点，Global 走 location tag，测试 effect 环境里无顶层 Global），改成从 `store.context` 读 checkpoint 的 `metadata.transcriptPath` 拿路径再 `fs.readFileSync`。`Global.node.replace(tempGlobalLayer)` 对 location 节点不生效（同因）。\n  - 既有失败不变：`session-runner.test.ts` 两条（compaction recent turn / retry-after 时钟）仍是既有失败，本次改动未增未减。\nEOF\necho "EXIT: $?"
- **never-nudge 旧名修复（2026-10-26）**：`loop-detection.ts:50` 的 `NEVER_NUDGE` 原来写 `"todo"`，实际工具名是 `"todowrite"`（`tool/plugin/todo.ts:11`），导致循环检测没有豁免 todowrite——模型每轮正常刷新 todo 可能被误判成死循环挨 nudge。本轮 completion-gate 正依赖 todowrite 状态，两条线撞上了，已修（`"todo"`→`"todowrite"`，测试同步）。
- **retry-after cap 测试失配（2026-10-26）**：`model-retry.ts` 的 `RETRY_AFTER_MAX` 早前对齐 Cursor 时从 15 分钟改成 1 分钟，但 `session-runner.test.ts` 的 `caps an excessive provider retry-after delay at fifteen minutes` 还断言 15 分钟，一直红。已把测试改成 `one minute`（`TestClock.adjust("59999 millis")` 边界）。这不是 merge 引入，是之前改 cap 没同步测试。
- **calculateCeiling 保护被 merge 误删（2026-10-26）**：`dfe20c594b`（merge 适配提交）在解决冲突时把上游 `33726e8fc1`（#58313）加的 `&& buffer < window` 保护改回了 `if (buffer !== undefined)`，会让 buffer>=window 时 ceiling 变负数。已恢复保护（`compaction.ts:1305`）。
- **`automatically compacts into a completed summary` 失败根因（已定位，不修）**：该测试在 HEAD 基线（merge 后、任何 SiCode 改动前）就失败，上游 450e7 是绿的。二分定位：不是 llm/compaction/history/to-llm-message/tool-output 任何一处的改动，而是 SiCode 有意扩大的 system prompt——`runner/prompt/system.txt`（`cbb88ae973`）追加的 RE/破解/授权指令段约 780 tokens，让 compaction 请求的 system 估算从上游 249 涨到 1029。于是 `deliver` 里 `estimateRequest(prepared.request)(3093) > fit(2628)`，触发 `shrink.history` 降级，丢掉 recent tail（"Recent exact request"），破坏了上游 `fd6589239e`(#57091) 的「whole conversation summary 复用 prompt cache」意图。真实场景（200k context）下 780 tokens 影响可忽略，只有测试的 4000 小窗口才触发，属可接受的行为差异，不修（改 deliver 排除 system 或调 fit 都是侵入上游逻辑）。
