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
- agent 侧工具面全在 `packages/plugin-browser/src/rpc.ts:155` 的 `Operations`（43 个 action：tabs/snapshot/find/evaluate/click/fill/press/scroll/wait/screenshot/network/console/trace/cpu/heap/lighthouse/files/dialog/frames）；新增能力只加一条 operation，window 侧在 `chromium.ts` 的 dispatch 里接
- 每个工具 `codemode: true` + `permission: "browser"`（`packages/plugin-browser/src/tools.ts:50-51`），agent 默认被 deny（`connection.ts:27`），只有 desktop 的 attachment 给它加 allow；所以"一段 JS 连打多次"已经走 codemode，不必再仿 ego 的 heredoc
- snapshot 是 `Accessibility.getFullAXTree`（`chromium.ts:1554`），depth 默认 8、上限 500 行；refs 由 `refs.ts:10` 分段预留 `eN`，跨 snapshot 有效、导航失效
- 截图不再要求标签可见/窗口前台：`chromium.ts:995` 的 `case "screenshot"` 用 `content`（`settle()` 里 = 非 about:blank 且未失败）作为「有可拍文档」的门槛，不再等 `view.getVisible()`/`isVisible`/`isMinimized`。about:blank 与失败页必须继续拒绝，否则会返回白图让 agent 误判成功
- 隐藏标签的截图在 `Page.captureScreenshot` 前补一次 `contents.capturePage(undefined, { stayHidden: false, stayAwake: true })` 强制合成（`chromium.ts:1050`），与 `rect()` 的 `:1357` 同一手法。`stayHidden` 语义见 `node_modules/electron/electron.d.ts:23769`：默认 false = 允许页面在捕获期间被视作 visible，不是「把页面显示出来」，所以不会让隐藏视图闪出来，也不会抬窗口
- 隐藏标签的视口固定是 `view.setBounds({ width: 1000, height: 700 })`（`chromium.ts:521`），所以后台截视口和 fullPage 都按 1000px 宽排版，与用户实际看到的侧栏宽度不同；这是已知差异，不是 bug

## 过程壳与时间线

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
- 处置：`core/src/plugin/system-prompt/deepseek.txt` 末尾加 `## Say what you found`（工具批次开头一句话、收尾必须有正文、以工具调用结尾视为未完成）。这是模型行为层，重启 sidecar 才生效（`.txt` 是 import 进 `core/src/plugin/optimize.ts`，按 `model.id` 含 deepseek 才附加）
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
- 实测证据（会话 `ses_e90f7175cffeIL5AKba585f4GC`，DB `~/.local/share/opencode/opencode-local.db`，快照仓 `~/.local/share/opencode/snapshot/a7b03e49.../f52794f6...`）：轮「就是主页会话的选择…」区间差异 3 个但 step 并集只有 `view.tsx`，多出的 `.tmp-gap.db-shm`、`packages/core/` 下的 gap-bench.tmp.ts（临时文件，已删除） 是别处的写入；轮「UI UX重新设计下…」多出 `packages/core/src/filesystem/trigram-search.ts`，是同一时间窗口里另一个会话改的
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
- 编辑行已链条化（`064f2dbc97`）：`CurrentFileToolGroup`（`packages/session-ui/src/tools/tool-renderer.tsx:1056`）不再委托 `patch` 卡片，改为 `FileAccordionGroup` + 每文件一个 `FileAccordionItem`，表头是 `chain-file-row`（28px 行 / 19px 图标列 / 动词+路径 / ±stat / chevron-right）。卡片那套 `-5px -8px` 外扩只在回合末尾文件列表成立，在壳内会压到圆角边框（实测卡片 145..958 vs 壳 144..956 vs 链条行 150..951）。
- 同一个组有两种渲染位置，改样式时必须一起考虑：过程壳内（`[data-slot="context-tool-group-item"]` 里）和直接挂在回合正文（`SessionFileToolGroup` ← `packages/session-ui/src/message/current-message.tsx:127`，祖先只有 `session-turn-assistant-content`，没有壳、没有 `context-tool-group-list`）。所以 CSS 不能只挂 `[data-process-shell]`，要用 `--ind-col` / `--row-min` / `--chain-row-hover` / `--process-shell-size` 的回退值（`packages/session-ui/src/components/message-part.css:1881` 起）。
- 不包 `FileAccordionGroup` 时 `accordion.css` 全部失效（它的规则前缀是 `[data-component="accordion"]`）：行会退化成 UA button，宽度塌成内容宽（实测 221px 而非 800px）、没有 100% 宽和高。`accordion` 的 item/trigger 默认值需要 4 个属性选择器才压得住，`:first-child` / `:last-child:not()` 的 8px 圆角要单独用 6 个属性选择器覆盖。
- 长 diff 底部「收起」栏曾经整段消失：溢出测量在折叠动画期间主动跳过（动画中 body 只有动画帧那么高，短 diff 也会被判成溢出），而动画落地后 `ResizeObserver` 不再回调、没人重测，`overflowing()` 永远 false。修法：`getAnimations()` 里 `playState === "running"` 的等 `finished` 再测（`tool-renderer.tsx` 的 `FileAccordionItem`），并在重测前确认 `props.open && node.isConnected`（关闭态 body 高 0，永远像溢出）。
- 本机主题 `--font-size-small` 是 14px（不是 13px）：壳内链条行 12.5px/440 由 `--process-shell-size` 决定，壳外没有这个变量，回退到 `--font-size-small` / `--font-weight-medium` 才和邻居 Read/Shell 行一致。
- 回归 fixture：`current-tool-group--patch-long-diff`（48 行改动 + 一个新增文件），覆盖 340px 封顶和「收起」栏；短 diff 用 `current-tool-group--patch-follow-ups`，壳外位置用 `current-session-file-changes--edited-and-verified`。
- 链条行改形态时丢了 `FileRowOpenFile`（卡片表头上的「在侧栏打开」），`6a0d5942e1` 补回：外包 `<span data-slot="chain-file-open">`，hover/focus 淡入。**必须用 `opacity` 不能用 `display`**，否则 hover 时统计列横跳 20px；外层要 `&:empty { display: none }`，因为 `FileRowOpenFile` 在 `useData().openFile` 缺失时（story、以及独立投影场景）`<Show>` 不渲染，空的 20px slot 会把箭头往左推。
- 三处间距的实测值（story + CDP 注入同结构节点）：stat→按钮 2px、按钮→箭头 6px、**无按钮时 stat→箭头仍是 6px**。最后一条能成立是因为 `margin-inline-start: 6px` 写在 `[data-slot="chain-file-arrow"]` 自身，不是靠 `[chain-tool-meta] + [chain-file-arrow]` 相邻选择器——插一个兄弟节点就会让它静默失效，且 `display: none` 的元素**仍在 DOM 里**，`+` 照样不匹配。
- 窄窗口（700px 视口 ≈ 350px 行内容）下统计列会贴死文件名：`[chain-tool-meta]` 的 `margin-inline-start: auto` 在有剩余空间时撑开、耗尽时归零，于是渲染成 `...long.ts+48`。修法是给它加 `padding-inline-start: 6px` 当下限——行宽不变（797px 前后一致），只是从路径那里让出 6px。
- **story 环境截不到侧栏按钮**：story 的 provider 不提供 `openFile`，`FileRowOpenFile` 直接不渲染。验证办法是在真实 DOM 位置用 CDP 注入一个同尺寸（20×20）节点量间距，再 `document.body.style.zoom = "2"` 放大截图看视觉。别指望 hover 截图——`aria-expanded` 为 false 时箭头本身也是 `opacity: 0`。

- 过程壳展开动画现由 data-animating 门控（tool-renderer.tsx change() 设置，240ms 自清除；message-part.css 选择器同步）：只在用户点击折叠/展开时播放，会话打开/失败回合默认展开/流式自动展开均不播。
- 会话打开文字跳动根因（2026-10-25）：virtualizer.tsx 冷挂载 visibility:hidden 保护仅限 pinned 会话，非 pinned（滚动停在中间）冷首开裸奔——行高先按 60px 估算渲染、ResizeObserver 实测后逐行纠正，可见区文字整体下移。修复：coldMount(=!cache) 广义门控 reveal，拆 coldRevealPending（reveal）/coldPending（pinned bottom-settle）。已 tsc 通过。
- 指令更新通知（packages/session-ui/src/timeline/session-timeline-row.tsx `notice()`）：system 消息 metadata.notice=="instructions" + instructionSources 由 message-updater.ts:151 从 session.instructions.updated 事件生成；InstructionState.prepare 在 runner/llm.ts:224 每个 step 边界重读指令源，core/git-status 快照一变就发事件，所以通知总贴在刚结束的助手回复下面（时间线=事件日志，按时间点追加）。
- SiCode 改动：`notice()` 过滤 `core/*` 前缀的源（git-status/date/environment 是给模型的内部上下文，不是给用户看的），全 core 的 delta 返回 undefined 不渲染通知卡片；混合源只显示用户级（AGENTS.md 等）；同时覆盖旧格式 description "Instructions updated: " 前缀分支。模型侧上下文更新不受影响（system 消息仍进时间线与请求）。
- 勿改回：return undefined 时 grouped 路径会建空 part 但 `Show when={content()}` 渲染为空，与 model-switched 先例一致；不能让它落到 `message.description ?? message.text` 兜底，否则会把裸文本 "Instructions updated: core/git-status" 打出来。
- 过程容器里的文件/编辑行是"卡片规则"渲染的：`message-part.css` 的 `[data-component="apply-patch-tool"] [data-slot="accordion-item"]` 有 `margin-inline: -5px -8px; width: auto; border/radius/background; overflow: hidden`，这是给回合末尾文件列表调的（卡片要顶到列表边缘），触发区再用 `padding-inline: 5px 8px` 把图标列补回来（1523 行）。放进过程链条时外拉会超出 shell 边框：实测卡片 145..958，shell 144..956，链条行 150..951 → 右侧 2px 压在圆角上，展开的 diff 一起溢出，右侧 ±统计和箭头贴在边框。
- 修复（提交 3a85ad530b）：`[data-component="collapsed-tool-group"][data-process-shell]` 下把 item 复位成链条内容盒（width auto / margin-inline 0 / border 0 / radius 0 / background transparent），trigger `padding-inline: 0`，图标列与 shell/思考行同轴（实测 x=149.6 一致，diff 149.6..950.5 完全在容器内）。
- 测量方法（本机没装 playwright 浏览器）：storybook `bun run --cwd packages/storybook storybook`（根 node_modules 缺 `storybook-solidjs-vite` 时用 mklink /J 从 packages/storybook/node_modules 接一个）+ CentBrowser `--headless --remote-debugging-port=9444` + CDP `Runtime.evaluate` 取 getBoundingClientRect / CSS.getMatchedStylesForNode，比猜 CSS 快得多。
- 已知不一致（未改）：过程链条分支的 `fileOpen` 用裸 key `patch:${path}`（session-timeline-row.tsx:299-302），而分组分支用 `${row().group.key}:file:${path}`（:383）——同一文件在多轮/多个过程容器间共享展开状态。
- 链上编辑行的颜色口径（7706cc3c2f）：用户明确「布局别动，只要颜色醒目」——否掉把链行换成结束卡片样式/复用 patch 渲染器的方案。ChainFileRow 复用 `fileChangeAction`（与 `FileChangeTriggerHeader` 同源映射），title 挂 `data-type=added/removed/modified`，CSS 用 `--icon-diff-{add,delete,modified}-base` 着色（与回合末「更改的文件」同 token），路径从 `text-muted` 提到 `text-base`。注意 `--icon-diff-*` 是 legacy token，只跟 prefers-color-scheme 不跟应用内配色切换。
- **系统提示词新增「Check before you commit」四条（15f93ba805）**：治"闷头干不查资料"。讨论定稿原则：要通用结构信号不要场景清单（枚举版本/报错只会让模型在枚举项才想起查）；"记忆只是假设"说法不对，改"memory is a prior, not evidence"（记忆是合法可错来源，先验/证据之别才自洽）；用户拍板 4 条上限——元规则超 4-5 条会互相权衡变笨。7 个 system-prompt/*.txt（按 provider 家族选）都追加同一段，英文（周边全英文，中文块稀释注意力）。内容：①不确定就查+稳定可推导的别重复查 ②动手前找现成的+至少比一个备选+一行说明为什么 ③同策略败两次换路 ④验证有成本。**重启 sidecar 生效**。
- 「Check before you commit」二稿（726b5527ba，替换 15f93ba805）：用户亲自改的版本。三处收紧——①易变事实门槛明确化："稳定或可推导的直接做，但没查过的易变事实不许断言"；②"败两次"定义精确为"同工具+同参数，或同一思路"；③规则 4 显式声明只对低影响事实放宽规则 1，易变/高影响事实永不放宽。7 个 txt 全量替换，仍是重启 sidecar 生效。
- **web 工具描述补触发场景（8be447379b）**：查证 Cursor 的搜索时机结论=纯模型自判，无框架硬触发器；它做的三件事是工具调优（1.4 轻量模型调优 websearch）、去审批摩擦（CLI autoAcceptWebSearch，默认关）、@docs 预索引。可抄的只有工具描述引导：websearch description 列 4 个触发场景（未验证的版本/价格/现状、不认识或扛过两次修复的报错、没把握的库/API→接 webfetch 官方文档、结果依赖的记忆事实）+ 已知 URL 优先 webfetch；webfetch 加"答案在已知地址就抓"（官方文档/changelog/README/websearch 结果页）。与系统提示词「Check before you commit」分工：规则管该不该查，工具描述管到点想得起来（模型每次工具列表都会读到）。纯 description 字符串改动，重启 sidecar 生效。
- **自主找参考项目（b1179d4976）**：用户截图实证——手动让它搜"deepseek 自动注册项目参考"，它立刻搜到 fork 项目换路线（auth-api 移动端 API 绕 WAF），证明能力在、触发缺。三处引导都没覆盖"难点找参考"：规则 2 被理解成只翻仓库、规则 3 的 research 太笼统、websearch 触发全是事实/报错类。改法（不加新规则，守 4 条上限）：规则 2 点名 "mature libraries and prior art on the web (search for projects that solve the same problem)"；规则 3 的 "research or change methods" 改成 "search the web for how others solved it — an existing project or library usually beats another attempt from scratch"；websearch 加第 5 个触发 "hard or unusual problem you would otherwise grind on — reuse beats trial-and-error"。重启 sidecar 生效。若仍压不住，后手=主循环检测连败 N 次注入"去搜"提醒（框架级确定性行为）。
- **搜索时机三档梯子（c6d35ba14f）**：用户提醒"触发不能太晚"。T0=任务入口（陌生地界：仓库无类似在跑代码+无验证过的做法→先搜再写，15-30s）；T1=第2次失败（规则3）；T2=硬兜底（框架检测连续3次工具失败，变体也算，注入"去搜现成方案"，未实施）。代价论证：一次搜索<一次失败尝试（1-3min），太早不亏；过度触发由规则1"稳定可推导不搜"+规则4"验证有成本"压着。把 websearch 第5触发从主观的"hard or unusual problem"改成操作性条件（仓库无类似代码+无已证明思路），主观难度判断恰是模型最差的。
- **T2 硬兜底落地（59d55ef5c3）**：主循环级失败连击检测。新文件 `session/runner/failure-streak.ts`：`detectFailureStreak` 纯函数扫本回合 trailing 工具调用（user 消息截断），failure=error 状态（排除 aborted=用户拒绝/中断）+ shell completed 结果的 `metadata.exit!==0` 或 `timeout===true`（**shell 非零退出不是 error 状态**，测试反复跑不过这种最常见磨人信号在 metadata 里）。触发=最近 12 次调用（FAILURE_STREAK_WINDOW）里 ≥4 败（FIRST）；重提醒节奏=全回合单调计数距上次 nudge ≥3（EVERY），状态存 `failureNudged={at}` 对象（number 不能按引用传）。接入 `selectSteer` 优先级：loopNudge 之后 narrate 之前，role=system 不停回合。注入文案：别再试变体→websearch 找现成方案→已搜过就换角度/换路/问用户，一行说明为什么。llm.ts 混并行会话的 final-answer-gate 未提交功能（runStep 调用行同线交织），用「cp 备份→git show HEAD 重置→重打我的 5 处→add→还原」拆分提交——比 hunk 拆分稳。steer.test/failure-streak.test 全过，session-runner.test 有 1 个 compaction 失败是并行存量（stash 验证过与本次无关）。
- **推送 main-sicode 到 GitHub（首次建远端分支）**：三件事。①SSH 22 被代理 fake-IP（198.18.x）断连，~/.ssh/config 的 github.com 改走 ssh.github.com:443（认证 milusvip 成功）。②pre-push 钩子跑全仓 check 失败——stats/app 有嵌套 vite 7.3.6（package.json 钉的）vs 根 8.2.2，nitro() 返回 vite8 类型插件喂给 vite7 校验的 plugins 数组；照上一行 solidStart 的先例加 `as PluginOption` 修掉（stats/app + console/app 两处）。③发现 7f627972fc 曾整文件 git add edit.ts 卷入并行会话未提交的 batch-encoding 功能（batch-encoding.ts 是 untracked，推上去必坏构建）——push 前 reset --soft 拆出重提为 640479fd96。**教训：并行会话活跃期，git add 整文件前必须 git diff 检查该文件是否含他人改动**。
- 链行悬浮底色改过（2026-10-28）：原来是 layer-02 满色 100%（暗色合成 ≈46），比过程头（layer-01 100%=36）和编辑卡（≈39）都亮，hover 一行像选中条。现在 --chain-row-hover = layer-01 70%（合成 ≈34，落在面板 45%≈28 和头 100%=36 之间），定义在 message-part.css 的 context-tool-group-list 和 chain-file-group 的 hover 回退两处，图标底座共用同一变量。
- 窄窗口适配（2026-10-28）：回合末尾变更清单的动词（更新/新建，apply-patch-change）在窄窗下被压成一列竖字——CJK 任意字符可断行，而它没有 nowrap 也没 shrink-0；flex 挤压时路径还没到底、动词先塌。修复：shared 作用域 [accordion][data-scope=apply-patch] 的 apply-patch-change 补 white-space:nowrap + flex-shrink:0（链条内作用域本来就有 shrink-0，壳外那份漏了）。挤压全交给路径（directory rtl-ellipsis → filename ellipsis 的收缩链本来就是对的）。右端 open-file/抓手列 shrink-0，极端窄时被 item 的 overflow:hidden 裁掉，可接受。

## 字体与排版

- 2026-10-29：曾试过把会话正文 markdown 改成 `--font-family-mono` 去跟右侧代码面板对齐，用户反馈中文被改坏、整页混成好几套字——已回滚。正文继续 `--font-family-sans`（MiSans 中英一体）。
- 2026-10-29 续：混套的真因是两处——① `--font-weight-bold: 670` 对不上 MiSans 静态档（只有 400/500/600），加粗中文落到思源黑体；已改为 `600`。② 行内 `` `code` `` 强制 IBM Plex Mono，中文句里夹等宽英文像两套字；`markdown.css` 的 `:not(pre) > code` 改为 `font-family: inherit`，灰底芯片保留，整块 `pre > code` 仍用 mono。
- 设置默认：`packages/app/src/settings/model.tsx` 的 `sansDefault` / `sansFallback`（空值回落到这）
- CSS 初值：`packages/ui/src/styles/theme.css` 的 `--font-family-sans`
- 加载：`packages/app/src/index.css` 的 `@fontsource-variable/noto-sans-sc` + `font-family: "思源黑体"` 的 local()；Inter 仍保留给手动填写
- ???? default ?? 880px?? 744??wide 1040 / full 100%???????
- ?????? IBM Plex Mono ????????? UI ????????????????`index.css` ?? Plex Regular/Text/Medium ??????? Text ???????
- ?????????`SteppedSlider`??????????? `appearance.tsx`??? 12?18??? 15??? `appearance.fontSize` ?? `applyFontSizeTokens` ?? `--font-size-*`

- 会话面字号/字重的唯一调节点是 packages/ui/src/styles/theme.css（:root 的 --font-size-small/-x-small/--font-weight-regular）；组件层 CSS 一律应引用 var()，勿硬编码 px。
- 2026-10-25 起 token 值为 small=14px、x-small=12px、regular=460（针对 Windows Chromium 下思源黑体可变字体小字号发虚的问题调大），14 个会话面 CSS 已从硬编码 13px/11px/440 切到 token。
- packages/app/src/index.css 里 IBM Plex Mono 的 @font-face（weight 400/440 两段）是字体注册，不是文本样式。
- 终端默认字体 JetBrainsMono Nerd Font Mono 定义在 packages/app/src/settings/model.tsx（bundled woff2）。
- 对照组 WorkBuddy（本机安装目录实测）：无内置 webfont，UI 走系统栈 PingFang SC/微软雅黑（--sc-ui-font-family，--sc-content-font-family 同栈带 emoji 兜底），等宽 ui-monospace/Menlo/Consolas、部分组件 Source Code Pro；有用户可调的字体大小滑块（--sc-font-scale）。
- 2026-10-25 深夜：用户嫌思源黑体不如 WorkBuddy 好看，--font-family-sans 已改为 WorkBuddy 同序的系统栈（-apple-system/PingFang SC/微软雅黑优先，Noto 系降到末位兜底）。Windows 上 UI/正文实际渲染=微软雅黑；weight 460 在雅黑下回落 Regular 400（雅黑只有 300/400/700），medium 500 同理回落 400。IBM Plex Mono 等宽栈未动。bundled @fontsource Noto 仍在 index.css 里注册，作为无雅黑机器的兜底。
- 代码卡片配色链路：`pre.highlights` 的内联 `background-color` 由 `packages/ui/src/context/highlight-theme.tsx`（OpenCodeTheme）生成，值就是 CSS 变量名去掉 `--`；`marked-parser` 与 `markdown.worker` 共用它。
- 2026-10-29 修：该 theme 原指向 OC-2 的 `color-background-stronger` / `text-base`，而这组变量只写在 `packages/ui/src/styles/theme.css` 的 `@media (prefers-color-scheme: dark)` 里——只跟随系统、不跟随 `data-color-scheme`，于是「应用浅色 + 系统深色」时代码卡是黑块、反之是白块。已改为 `v2-background-bg-layer-02` / `v2-text-text-base`，`marked-parser.test.ts` 断言同步。
- 注意 `--text-base` 有重名：theme.css 当颜色用（#6f6f6f），tailwind/index.css 当字号用（15px）。别再拿它当颜色。
- 2026-10-29 正文排版调整（markdown.css）：h1 → `--font-size-x-large`(20px)、h2 → `--font-size-large`(16px)；blockquote 改 2px accent 左条 + 5% 淡底 + 8/14 内边距；hr 从隐形改为 1px muted 线；`pre` max-height 400px 且恢复细滚动条（原 `scrollbar-width:none` 让长行无法发现可横滚）；任务列表 checkbox 加 `accent-color`；行内 code 底 `--markdown-inline-code-bg-mix` 8%→14%。对照 demo 在 artifacts/markdown-polish-demo.html。
- 等宽栈顺序：`ui-monospace/Menlo/Consolas` 必须排在「思源黑体/Noto Sans SC」之前。字体回退是按字形走的，CJK 照样落到中文字体，但 Latin 不会在 webfont 加载失败时被中文体的比例字形接管。
- Markdown 表格字号在 packages/session-ui/src/components/markdown.css：`[data-component="markdown"] table`（原硬编码 12.5px，2026-10-29 改为 `var(--font-size-small)`=14px、行高 1.6）与 `th`（原 11.5px，改为 `font-size: inherit`，层级只靠 weight/muted 色/底色）；放大浮层 `[data-slot="markdown-table-zoom-scroll"]` 同一套。正文是 15px，差两档会像两份文档。
- 2026-10-29 统一：`--font-family-sans` 与 `sansFallback` 现在都以思源黑体打头，两端逐字一致。生效的是 `model.tsx` 的 `createEffect` 写进 `:root` 的行内样式，`theme.css` 的声明只是初值——两者不同步时前者永远赢，所以改字体必须同时动这两个文件与 `packages/ui/DESIGN.md`。
- 2026-10-25 那条「改成 WorkBuddy 同序系统栈」的记录只动了 `theme.css`，被行内样式覆盖，从未真正生效；Windows 上实际渲染一直是 Noto Sans SC（`index.css` 的 `local("Noto Sans SC")` 命中装机字体），不是微软雅黑。等宽栈同理：CJK 字形落到思源黑体，Latin 走 IBM Plex Mono。
- `packages/app/src/settings/model.test.ts` 的 `prefix: '"思源黑体", '` 用例已经锁住这个前缀，改默认字体时它会先失败。
- 2026-10-29 再统一：`packages/ui/src/navigation/tabs/tabs.css` 两处 `[data-slot="terminal-tab-title"]` 与 `#review-panel [data-slot="tabs-trigger"]` 原本硬编码 `Inter, sans-serif`，让标签页标题绕过 token 用了 Inter（而非思源黑体），已改为 `var(--font-family-sans)` 并加 `// SiCode:` 注释（该文件是上游文件）。同块的 `font-variation-settings: "slnt"` 依赖 Inter 的倾斜轴，思源黑体没有该轴，`.italic` 靠 `font-style: italic !important` 合成斜体，视觉可接受。
- 终端仍是独立一套：`terminalFontFamily` → `terminalBase` = JetBrainsMono Nerd Font Mono，经 `host-apis.tsx:798` 的 `appearance.font()` 传给 xterm 的 `fontFamily`（`gui-extensions/src/terminal/terminal.tsx:443`）。它不属于「统一思源黑体」的范围，等宽终端不应合并。
- 字体栈排查口径：`font-family` 是裸值且非 `var()` 才是漏网之鱼。目前 `packages/*/src` 只剩 `index.css` 的 `@font-face` 声明（那是注册字体，不是使用）、`font-family: inherit`，以及 `var(--v2-font-family-sans, "Inter", sans-serif)` 这类带兜底的写法。
- 2026-10-29 方案 B 落地：`--font-family-sans` 与 `sansFallback` 改为 `"Inter"` 打头、`"思源黑体"` 紧随，用于「拉丁走 Inter、汉字走思源黑体」的混排。依据是字体回退按字形进行，Inter 无 CJK 覆盖，汉字照旧落到思源黑体。实测（Chromium + 真实 `@font-face` 注册）：`Ag` 在候选栈里量出 Inter 的 57.563px，`永` 落在思源黑体——栈内两种字形各取所需。等宽栈未动，仍是真实等宽字体在前。
- 装机 Noto Sans SC 是**可变字体**：注册表里 `Noto Sans SC` / `Medium` / `Bold` 三行看起来像三个静态档，实际都指向同一个 `C:\Windows\Fonts\NotoSansSC-VF.ttf`（17.7MB，fvar 只有 `wght 100–900`，默认值 100）。所以本机 `--font-weight-regular: 460` 是真实插值，不是落回 400/500。判断一个字重是否「真」要看文件的 `fvar` 表，不能看注册表条目数——`.sicode/scratch/font-axes.ts` 就是读 sfnt 表目录做这件事的。
- 修正此前两条错结论：①「460 在装机字体上落到 400」错误，正确规则是目标在 400–500 之间时先向 500 找，静态三档会落 **500**，且本机根本是可变字体、460 直接生效；② 上一轮说「中文字重会与英文不一致」错误，Inter 与 Noto Sans SC Variable 都在 460 上插值，中西一致。
- `packages/app/src/settings/model.tsx` 的 `sansDefault` 从 `"思源黑体"` 改成 `"Inter, 思源黑体"`：它只做设置界面「UI 字体」输入框的 placeholder（`general/controllers.ts:97` → `appearance/appearance.tsx:94`），混排后只写思源黑体名就不完整了。改它会连带 `model.test.ts` 的两处断言。
- `packages/session-ui/component-tests/session-lifecycle.spec.ts` 第 79、83 行 的 `font-family` 断言原本是 `/^Inter,/`（上游 4d72de340f 之前的状态），上一轮「统一思源黑体」时被改成 `/^思源黑体,/`，方案 B 后已改回 `/^Inter,/`。这两行是组件测试，跑它要 playwright，本轮未执行。
- 2026-10-29 定稿 A+400：`--font-family-sans` 与 `sansFallback` 只保留 `"思源黑体"` 打头，去掉 `"Inter"`；`--font-weight-regular` 从 460 改回 400。判据是用户反馈「中英文没统一」——方案 B（Inter 拉丁 + 思源黑体汉字）即便 460 在两种字体上都插值到位，两套骨架并排仍读作两种字体。代价已知并接受：思源黑体的拉丁字形来自 Source Sans 且字族内放大 115%，英文比专用 UI 字体偏大偏松。
- `packages/ui/src/styles/theme.css` 里的 `--font-family-sans` 与 `packages/app/src/settings/model.tsx` 里的 `sansFallback` 必须逐字一致（`.sicode/scratch/font-stack-check.mjs` 可复验，输出 `font-family-sans EQUAL` / `font-family-mono EQUAL`）。原因是 `model.tsx` 的设置 `createEffect` 把同一个变量写成 `:root` 行内样式，行内样式恒赢，`theme.css` 里那份只是首屏初值。等宽栈没动，仍是 `IBM Plex Mono` → `ui-monospace`/Consolas → 思源黑体，顺序是「真实等宽字体在前」，回退按字形进行所以 Consolas 抢不走 CJK。
- `--font-weight-regular` 只管引用该 token 的声明（`utilities.css` 的 `text-*-regular`、`base.css`、各组件 CSS）。上游仍硬编码 `440`（约 77 处，次级文本）和 `530`（约 68 处，标题/标签），这些没随 token 改；在可变字体装机上是真实插值，所以 400 正文和 440/530 层级仍然分得开，但不再是 460/440 那种 20 单位的差距。
- `sansDefault` 是设置界面「UI 字体」输入框的 placeholder（`general/controllers.ts` → `appearance/appearance.tsx`），单一字体后写 `"思源黑体"` 就完整了；改它连带 `packages/app/src/settings/model.test.ts` 的 4 处前缀断言。`packages/session-ui/component-tests/session-lifecycle.spec.ts` 第 79、83 行 的 `font-family` 断言现为 `/^思源黑体,/`。
- `.sicode/demos/font-plan-a-vs-b.html` 已从「A/B 方案二选一」改成「定稿 400 / 旧方案 Inter+460」的对照页，并保留 400/460/500 字重切换。
- WorkBuddy 桌面端（D:\Program Files\WorkBuddy）没有自带 UI webfont：resources/app.asar.unpacked/renderer/assets 里只有 KaTeX 与 SourceCodePro 两类字体文件，UI 正文完全靠系统字体栈。
- 根规则在 asar 内的 renderer/index.html：`body { font-family: var(--vscode-font-family, "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif); font-size: var(--vscode-font-size, 13px) }`，即基准字号 13px。
- `--vscode-font-family` 由 VS Code 系主题文件 renderer/assets/default-dark-*.css 写入，值为 `"PingFang SC", -apple-system, BlinkMacSystemFont, sans-serif`；组件层再覆盖，最密集的两条是 `PingFang SC,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`（55 处）与 `PingFang SC,sans-serif`（51 处）。
- 结果：macOS 中英都落到 PingFang SC；Windows 上 PingFang SC/-apple-system/BlinkMacSystemFont 都不存在，拉丁落到 Segoe UI，中文由 Chromium 回退到微软雅黑。这是 SiCode 改用「思源黑体」单一字面时的主要观感差异来源。
- 例外区域：TDesign 系组件用 `--td-font-family: PingFang SC, Microsoft YaHei, Arial Regular`；数字/标题的 TCloudNumber、个别子应用用 Inter / WeChat Sans SS / Poppins / DM Sans；代码块用自带的 Source Code Pro，回退 ui-monospace / SFMono / Menlo / Consolas。
- 2026-10-29 再改：MiSans 方案整体撤销，回落到 WorkBuddy 那种系统优先栈（即提交 32fe8f6869 的版本）——sans 为 -apple-system / BlinkMacSystemFont / PingFang SC / Microsoft YaHei UI / Microsoft YaHei 前置，思源黑体 + Noto 系（含 @fontsource-variable 的 Noto Sans SC Variable）兜底；`--font-weight-bold` 同时回到 670。依据：用户实测 Windows Chromium 下思源黑体比 WorkBuddy 发虚。代价是 Windows 上 670 被向上取到 700（微软雅黑只有 400/700），加粗中文比 mac 上重。
- 撤销 MiSans 要同时改的四处，漏一处就会出现「半套字」：`theme.css` 的 --font-family-sans/--font-family-mono 与 `settings/model.tsx` 的 sansFallback/monoFallback 必须逐字节一致（后者在设置加载时内联写到 :root，不一致的那份就是死 CSS）；`packages/app/package.json` 依赖与 `src/index.css` 的 @import 要一起换；`sansDefault`（设置页 placeholder）和 model.test.ts 的期望值跟着改。
- `packages/app/src/index.css` 里 Noto 的注册只靠 `@import "@fontsource-variable/noto-sans-sc"` 这一行；删掉它，兜底链里的 "Noto Sans SC Variable" 永远匹配不到。

## 全局右键菜单

- `packages/app/src/shell/context-menu/`，挂在 `app.tsx`；原生 `electron-context-menu` 留给 webview，别删
- 用 Kobalte DropdownMenu 程序化打开；开着再右键要先关再开，且不能有退场动画
- ???????????? `packages/app/src/shell/ui-inspect/`?? app DOM ? ?? ? `composer.context.add` note?origin `ui`????? Electron `webContents.inspectElement`
- ???`context-menu.tsx` ? `view.inspectElement` ? `startUiInspect()`????? `app.tsx`?`UiInspectComposerBridge` ?? session/draft ? `ComposerPersistenceProvider` ?
- F12 /???????????? `view.toggleDevTools`
- 右键菜单扩了三件事（2026-10-28）：①右键消息气泡（user-message-text / text-part-body，closest + innerText 保换行）无选区时给「复制」整条消息，有选区仍是选区复制；②右键 <img> 给「复制图片」（fetch → 非 PNG 用 canvas 转 PNG → navigator.clipboard.write(ClipboardItem)）和「复制图片地址」（写 src）；③层级顺序 link → image → 文本组。i18n 新键 contextMenu.copyImage / copyImageAddress（en/zh/zht）。关键坑：Electron 44 主进程删了 clipboard.writeImage，新 API clipboard.write(ClipboardItem[]) 但 ClipboardItem 构造器只在渲染进程可导出——所以写图不穿 IPC，直接渲染进程 W3C 异步剪贴板（菜单点击即用户激活）；fetch 被 CORS 挡时静默失败，地址项仍可用。模型改动全在 app/src/shell/context-menu/{model,context-menu,icons}.tsx + model.test.ts（9 测试过，app/desktop typecheck 干净）。
- 选区悬浮菜单 + Cookie 登录态识别（2026-10-28）：①对话区拖选出现 复制/引用 小条（app/src/shell/selection-menu/{controller,bridge,popup}.tsx）：mouseup 检测选区，anchorNode 在 [data-timeline-key] 内且非可编辑才显示，锚在选区上方（top<80 翻到下方），scroll/Esc/点外隐藏，bar 上 pointerdown preventDefault 保选区；「引用」复用 ui-inspect 的 note 通道——SelectionQuoteBridge 挂在 session/new-session 路由的 ComposerPersistenceProvider 里，NoteContextItem origin=quote、icon=speech-bubble（图标目录没有 quote，未知名会回退成 plus 的坑），chip 出现在输入框上方。i18n 键 session.quote（en/zh/zht）。②Cookie 粘贴登录：setCookies 写入+reload 后等载入（10s 上限），读两个信号——粘贴的 cookie 名是否仍可读（被站点拒绝通常会被清掉）、页面是否还有 input[type=password]——输出 {cookies, login:{state: likely|unclear|unlikely, kept, pasted}}，ipc/chain/connection/panel 全链路，toast 副标题显示「登录态已生效/无法确认/疑似未登录」。i18n cookies.login.*（en/zh/zht，其余语言回退英文）。

## 对话区这几块的美化

- 会话错误行：`SessionError` 用 `<Card variant="error">`，但 `session-turn.css` 把 `--card-pad-*` 全设 0 且隐藏了 `::before`，所以只剩一行红图标 + 裸文字。改成 `--v2-state-bg-danger` 底 + `--v2-state-border-danger` 边 + 8/10 padding + 8px 圆角（和 `[data-component="diagnostics"]` 同一套危险态 token），文字仍用 `--v2-text-text-base` 保可读，图标用 danger 色并 `margin-top: 1px` 对齐首行
- 问答体：`question-answers` 原来 `padding: 8px 0`，正文和行标题不对齐。现在自己带 `padding-inline-start: calc(--ind-col + 8px)`，并用 `[data-slot="collapsible-content"][data-expanded]:has(> [data-component="question-answers"])` 把父级那 12px 通用缩进清零（`[data-expanded]` 是为了压过 basic-tool.css 的 4 级选择器）。问句 12.5/muted，答句 13/base 且挂 2px 左边线（`--v2-border-border-strong`，base 太淡）
- 时长文案：整分钟不再带 "0 秒"/"0s"。`ui.message.duration.minutes`（en/zh/zht 新增）+ `formatElapsed` 的 `rest === 0` 分支
- `question` 工具在 `toolGroupType` 里恒返回 undefined，所以它永远是独立行，不会进 process chain——上面的 `:has` 其实只需要独立行那种情况
- 沙盒坑：`.preview-shell` 里改完 CSS 再热构建会挂在 `packages/ui/src/styles/index.css` 的 `@import "katex/dist/katex.min.css"`（root 没有 katex，只有 `packages/ui/node_modules` 有）。所以沙盒只能吃到已生成的缓存 CSS；要重新构建得先在 root 装 katex 或换个入口
- ?????`AssistantTextContent` ? `duration`?`message/message-content.tsx`??? `Math.round(ms/1000)`??? `formatElapsed`?`timeline/work-shell.tsx`?? `Math.floor`??? `turnDurationMs` ? 371.x ??????6m 11s???6 ?? 12 ????????? floor?? `<1s` ????????????????????????
- 提示词优化按钮（2026-10-28）：发送键左侧铅笔按钮（仅会话内可用，草稿页无 session 隐藏）。链路：core 新服务 session/prompt-optimize.ts（复用 LLMClient.generate + SessionContext.resolveModel 当前会话模型，system prompt 守则：保持语言/意图/需求、@提及与命令原样、不答不改写不膨胀、只回写文本；带 fence 剥壳）→ protocol 加 POST /api/session/:sessionID/prompt-optimize（session.optimizePrompt）→ server handler（SessionPromptOptimize.Service.use + instances.provide，FailedError→UnknownError）→ packages/client bun run generate → app editor.tsx ComposerEditorOptimize：预览浮层（替换/放弃，composer.set 重建 text part 保留附件 chips，原 setText 语义）+ 失败 toast；不直接覆盖草稿。i18n ui.promptInput.optimize.*（en/zh/zht）。验证：core/server/app typecheck 干净（server 的 client-mcp.test.ts 报错为树上其他会话的既有问题），app composer+右键菜单 63 测试过（4 个 jsxDEV 失败是 solid ESM 测试环境既有问题，与本次无关）。
- 提示词优化浮层返工（2026-10-28，用户截图反馈裁剪+排版差）：原因——面板用 absolute 定位塞在 composer 内部，被输入框容器的 overflow 裁剪掉上半部分。改成 Kobalte Popover + Portal（脱离裁剪，body 挂载），placement=top-end 与发送按钮簇右缘对齐（实测 panel.right 1066 = trigger.right 1065.7），打开即发请求、pending 态显示「正在优化…」+ Loader，完成后显示标题+字符数 31→34+内嵌 layer-01 正文块+底部 hint 与 放弃/替换；Esc/点外关闭走 onOpenChange(false) 自动还原草稿。CDP 实测（9333）：clipped=false、centerInsidePanel=true、insideComposer=false、面板 560×141 完整可见。
- 修正：提示词优化功能已按用户要求整体删除（2026-10-28 下午）——上面那条描述作废。撤回范围：core/session/prompt-optimize.ts（新建文件已删）、instance.ts 注册、protocol 端点、server handler、client 重新 generate、editor.tsx（整文件 checkout 回退，147 行全撤）、additional-icons.ts 的 sparkles 图标、i18n 的 ui.promptInput.optimize.* 7 个键（contextMenu.copyImage/copyImageAddress/session.quote 保留）。core/server/app typecheck 复验干净。
- 左下角工具栏落地（2026-10-28，demo 获认可后）：新增 app/src/shell/dock-toolbar.tsx（Kobalte Popover），挂在 tool-rail 底部替代原「设置齿轮」按钮。**竖栏只有 60px，pill 放不下，所以触发件用 Mark 头像方块，弹层向右上弹出（placement=right-end）**，卡片布局与 demo 一致：身份卡（本地工作区/数据只保存在这台电脑）+ 事实卡（版本 platform.version / 运行环境 桌面版·浏览器）+ 主菜单（模型与提供商→providers、扩展与技能→extensions、外观→appearance、设置→general+Ctrl+,）+ 分隔线 + 次菜单（意见反馈→GitHub Issues 外链、关于 SiCode→about）。按用户要求去掉「退出」。i18n 加 dock.* （en/zh/zht）。token 已核对：text-11-regular / text-v14-medium / icon-faint / layer-03 / overlay-hover 均有先例。
- 左栏升级为真侧栏（2026-10-28，用户确认「升级成真侧栏」）：新增 shell/left-sidebar.tsx（228px，项目列表 + 底部 pill 工具栏），替换并删除 tool-rail.tsx；shell.tsx 在 !verticalTabs && !mobile 时渲染 LeftSidebar。数据源：useGlobal().servers.list() × serverCtx(key).projects.list()（enriched 含 name/worktree/icon）；点击项目 = layout.home.setSelection({server, directory}) + navigate('/')，与主页列表同一套逻辑；顶部保留「主页」行（command.trigger('home.toggle')）弥补删掉竖栏图标后丢失的入口。DockToolbar 加 variant: rail(方形 36px, placement right-end) / pill(整行头像+名称+chevron-up, placement top-start)，弹层内容一致。触发器图标改用新增 add-icons 的 user 人像（原来用品牌 Mark 被指像第二个 app 图标）；意见反馈整行与其 i18n 删除。i18n 新增 dock.projects / dock.projects.empty。
- 左栏 v2 落地（2026-10-28）：①归档修好——home/sessions/controller.tsx 里那条 TODO 是过时的，session.update 早就带 archived，改成 ctx.sdk.api.session.update({sessionID, archived:true}) 并把 remove 接到 queryClient 过滤本地列表；②left-sidebar.tsx 扩成「项目 → 会话」两级：会话来自 ctx.data.session.list() 按 location.directory 对项目 worktree/sandboxes 匹配（pathKey），按 time.updated 倒序，项目头可折叠（chevron 独立按钮，点名称开项目）；③会话右键：重命名（Dialog+TextField，走 session.update + sync）/ 复制标题 / 归档 / 删除（二次确认走 data.session.remove）；项目右键：复制项目路径；④底部「已归档」折叠区，右键可恢复（archived:false）或删除；⑤i18n 新增 dock.archived / dock.time.* / dock.session.* / dock.project.copyPath（en/zh/zht）。未做置顶（无对应能力，已从 demo 去掉）。
- 左栏按 demo 对齐（2026-10-28，用户反馈「跟 demo 不太一样」）：①补头部——项目切换器（folder 图标+当前项目名+chevron，Popover 列「主页 + 各项目」）+ 新建会话按钮（tabs.newDraft({server,directory})）+ 搜索按钮（聚焦搜索框）；②补搜索框（28px 描边、focus 变色，按标题过滤会话，过滤时隐藏空项目）；③去掉原「主页」独立行与分组里的项目头像（demo 里没有，头像只在切换器里）；④会话数据改为 createResource 按项目目录调 sdk.api.session.list({directory, limit:50})，再与 ctx.data.session.list() 按 id 合并（live 覆盖，保证重命名/归档立刻反映）——原来只用本地缓存，没打开过的项目会显示空列表，这很可能是「看起来跟 demo 不一样」的主因。i18n 加 dock.search。
- 左栏视觉返工（2026-10-28，用户反馈滚动条不对+不好看）：列表容器换成 @opencode/ui/scroll-view 的 ScrollView（与会话同款细滚动条，不再用浏览器默认）；行样式重排——项目头 h-28/font-[530]/名称 muted→hover base/数量 tabular-nums，会话行 ps-26px 与项目名对齐、时间列 tabular-nums、选中用 layer-03；列表容器 gap-px + pb-1。
- 左栏视觉第三轮（2026-10-28，用户贴实机截图说没审美）：先做 HTML 稿 v3→v4 用无头浏览器自检，再落代码。关键改动：①默认只展开「当前项目」，其余折叠（openState: id→bool，缺省 = 是否当前项目），解决十几个分组全展开像一堵墙；②去掉每组的会话计数（视觉噪音），改为 hover 才出现的 +（在该项目新建会话，tabs.newDraft）；③分组头 26px / 12px / font-500 / muted，会话行 27px 左右缩进、12.5px、时间列 10.5px tabular 且仅 hover/选中显示；④选中会话加左侧 2px 竖条 + rgba(255,255,255,.08) 底色；⑤搜索框改为无边框浅底 rgba(255,255,255,.05)；⑥底部 pill 去掉边框改透明悬浮行 + 顶部 1px 分隔；侧栏宽 248→224。⚠ 无头截图注意：headless 的 innerHeight 远小于 window-size（1120x1000 视口只有 ~601），截图前要按视口算高度，否则底部被切掉。
- 折叠交互修正（2026-10-28，用户反馈「折叠点击也有问题」）：原来只有 16px 的 chevron 可点，点位太小，点到项目名反而 navigate 到主页。改成整行（chevron+名称）一个大按钮触发 toggle(id, active())；「打开项目主页」下沉到项目右键菜单（加「新建会话」一项），hover 出现的 + 改为绝对定位在行尾，避免挤压文字。toggle 逻辑：openState[id] 缺省回落到「是否当前项目」，三态正确。
- 左栏四项交互修复（2026-10-28）：①滚动条遮挡内容——ScrollView 的 thumb 是绝对定位覆盖式，给列表内容加 pe-2.5 留出右侧水槽；②右键菜单重做：图标+文字、32px 行高、min-w 192、p-1.5、shadow-xl、危险项 #e0a0a0/#d18b8b、分隔线 my-1.5；③侧栏可折叠：头部加 chevron-left 收起，收起后 52px 竖条（展开按钮 + 新建 + 底部 DockToolbar variant=rail），i18n dock.collapse/expand；④右侧边栏打开时左栏自动收起——用 tabs.region(findSessionTab(route), 'side') 读该 tab 的 side 状态，createEffect 里置 collapsed=true。typecheck 干净。
- 侧栏右键菜单统一到应用自带菜单（2026-10-28，用户贴图要求「统一风格」）：不再自绘 div 样式，改用 context-menu.css 的同一套标记——容器 data-component="sicode-context-menu"（min-width 232/padding 4/layer-01 底/0.5px inset 描边/elevation-floating），行 data-slot="sicode-context-menu-item"（30px 高、13px/500、gap 10）+ icon/label/shortcut 三个 data-slot，分隔线用 sicode-context-menu-separator，危险项 data-variant="danger"。CSS 由 app.tsx 里常驻的 AppContextMenu 全局加载，所以样式天然一致；hover 用 data-highlighted（自管 hovered 信号）；补了 ↑↓/Enter/Esc 键盘导航、容器 focus、document 捕获阶段 pointerdown 关闭（点聊天区也能关）。MenuItem 增加 shortcut 字段备用。
- 侧栏右键菜单尺寸/对齐修正（2026-10-28）：菜单项用 <button> 导致文字居中（原生菜单项是 div/role=menuitem 才左对齐），加 text-start 修掉；容器宽度未定，被 max-width 340 拉到很宽，改为内联 width:212px（clamp 边界同步 224）；删掉「复制会话标题」及其 i18n（三语）。
- 菜单宽度（2026-10-28，用户反馈「这么宽」）：根因有两个——全局 context-menu.css 的 min-width:232 会顶掉我设的 212，且用户截图时 HMR 还没应用上一轮的宽度改动。现在内联 width:200px + min-width:0 覆盖全局下限，真正压到 200。
- 「没效果」排查（2026-10-28）：5173 不是 vite transform 服务，是 rolldown-vite 的 bundled-dev（页面加载 /assets/main.js 整包，watcher 改文件后整包重建）。curl 抓包验证 bundle 已含最新改动（200px/minWidth 存在、212px 与 copyTitle 已消失）→ 代码确实生效进包了，用户看到旧效果是窗口没重载。以后排查改了没生效：先 curl /assets/main.js grep 新字符串，再让人 Ctrl+R。
- 菜单实机验证（2026-10-28，CDP 9333 首次闭环）：EPERM 根因是上次会话残留 sidecar（bun）锁着 service-local.json，electron-vite/electron 也残留；杀掉后确认 3084/5173/9333 释放再启动。实测菜单 computed width=200px / min-width 0px / textAlign=start，3 项带图标，视觉与全局菜单一致。.preview-shell/verify-menu.mjs 可复用（dispatch contextmenu + 量宽 + 截图）。
- 右键菜单宽度的真因（2026-10-28 第二次翻案）：① 本机 DPR=1.75（2560x1600@175%），180 css px 在屏幕上就是 315 物理像素，占窗口宽 14%，所以「看着宽」不是错觉但也不是 bug；② 更根本的是死宽度：标签只有 3 个字（重命名），面板右侧留一大截空 gutter，任何固定宽度都难看。改为 width:max-content + min-width:152px + max-width:260px（必须内联压掉全局 context-menu.css 的 min-width:232px）。实测 152 css px（=266 物理 px），收窄 24%。③ 我的轮询验证脚本一直假阴性：bundle 里是编译后的 width:180px（无引号），我 grep '"180px"' 永远 0 命中 —— 构建其实一直是好的。以后查 bundle 用不带引号的模式。
- 右键菜单宽度不一致的根因（2026-10-28 用户提问「是组件吗，怎么宽度大小都不一」）：全应用有**两套**实现——① 全局组件 AppContextMenu（context-menu.tsx，kobalte DropdownMenu，支持快捷键列）；② 侧栏 left-sidebar.tsx:577 手搓的一份 div。两者各自带宽度数字（全局 CSS min-width:232 + 侧栏内联），所以永远不等宽。修法：把宽度规则收敛到唯一一处 context-menu.css → width:max-content + min-width:176px + max-width:340px，把侧栏那份的内联 width/min-width/max-width 全删掉，让它吃同一条规则。实测两菜单均 176 css px（=308 物理 px @dpr1.75），规则来源一致（无内联覆盖）。
- 侧栏会话行两处修正（2026-10-28）：① 时间常驻问题——时间 span 上有 data-[active=true]:opacity-100，导致当前打开会话的时间永久显示（截图里的「1小时」），删掉该分支改为纯 group-hover 显示；② 缺运行指示——引入 @opencode/session-ui/v2/session-progress-indicator-v2（16x16 APNG，36 帧，标签栏同款，prefers-reduced-motion 下退化为静态方块），判定用 global.serverCtx(key).data.session.status(id)==="running"（serverCtx 注释明确标注 Reactive，响应式链 OK）。声明结构：外层 span[role=status][aria-label=session.timeline.working] 包住图标——组件内部强制 aria-hidden，直接传 aria-label 会被忽略。实测：运行中的会话行走 SPINNER 分支、空闲行走 TIME(hover) 分支，三行时间 opacity 均为 0。
- 侧栏时间显示（2026-10-28 最终版，用户要求「不要悬浮才显示」）：时间 span 去掉 opacity-0 + group-hover 那套，改为始终可见（shrink-0 + tabular-nums，无 opacity 类）。同时保留运行转圈——spinner 与时间是**并列**关系而非互斥（原实现是 Show fallback 二选一，现在 spinner 单独一个 Show，时间永远渲染）。实测：三行时间 opacity 全为 1，运行中的行 spinner+时间并存。
- dock 面板（packages/app/src/shell/dock-toolbar.tsx）2026-10-29 视觉定稿：①底部「关于 SiCode」原来把 platform.version 当右侧 hint，本地构建版 "2.0.0-local-1793207008995" 比标签还宽，行内 truncate 后只剩「关…」；同时上方「版本 … · 桌面版」caption 在 248px 宽会折成两行。②现状=身份区(28px 头像/13px 名称) + 版本 caption + 4 菜单项 + 关于行；新版=30px 头像 + medium 名称，版本改 chip 行（桌面版 / 版本号），版本号用 replace(/-\\d{10,}$/,"") 去掉本地构建戳、完整串放 title，关于行不再带 hint。③面板 248→260、圆角 10→12、p-1→p-1.5、快捷键 tabular-nums。预览 artifacts/dock-preview.png。
- 左栏头部（packages/app/src/shell/left-sidebar.tsx）2026-10-29：header 行(项目切换器+新建+搜索+收起)与下方列表之间原来没有边界，加 1px bg-v2-border-border-weak-base 分隔线（mx-1 mb-2 mt-1）；搜索框底从硬编码 rgba(255,255,255,0.05) 换成 v2-background-bg-layer-02——浅色主题下白色 5% 等于隐形。项目切换弹层原来用 layer-02 + 外描边，是全应用唯一这种表面，改为与右键菜单/dock 一致（layer-01 + inset 0.5px + rounded-10 + 30px 行 + 13px 字号），当前项目右侧加 check-small。预览 artifacts/sidebar-preview.png。
- dock 面板二次改版（2026-10-29 01:20，用户反馈「还是一样」并指出左上角图标）：窗口跑的是旧包（bundle 仍是 w-[248px]），需重启 dev；设计上改为「身份卡 + 扁平菜单」——身份区包一层 layer-02 圆角 9 卡片，左上角人像换 workspace-isolated 图标（文案是「本地工作区/数据只保存在这台电脑」，人像语义不符），版本 chip 收进卡片内，卡片与菜单、菜单与关于之间各一条 1px 分隔线。备选 mark：folder / dot-grid。
- dock 面板最终版（2026-10-29 01:30，用户否掉「身份卡 + 版本 chip」说上面太杂）：顶部回归纯文本两行——工作区图标 + 「本地工作区」/ 描述行右侧挂 mono 版本号，不加任何底色卡片；下面用 **1px 横线** 与菜单隔离，菜单与「关于」之间再一条。
- **踩坑（重要）**：`bg-v2-border-border-weak-base` / `border-v2-border-border-weak-base` 这个 token 不存在（tailwind/colors.css 只映射了 muted / base / strong / inverse / focus），所以写出来的分隔线是透明的——dock、left-sidebar 四条线全都没画出来。分隔线统一改用 `bg-v2-border-border-base`（alpha 10）。选择菜单 popup.tsx 里还有一处同样的无效 border，不是本次改动，待清理。
- dock 面板顶部最终形态（2026-10-29 01:32，用户要求「上面就本地工作区和版本就可以了」）：一行搞定——28px 工作区图标 + 「本地工作区」(13px medium) + 右侧 11px mono 版本号；描述行（数据只保存在这台电脑）与「桌面版/网页版」chip 全部删除，只留横线与菜单分隔。入口按钮（rail 的 36px 按钮、pill 内的头像）也同步换成 workspace-isolated。
- dock 面板宽度 260 → 224px（2026-10-29 01:33，用户说太宽）。224 是「关于 SiCode」+ Ctrl+, 两行里最长的组合仍不截断的下限；顶部「本地工作区 + 2.0.0-local」在 224 下仍有富余。再窄就要开始截断标签或版本号。
- dock 面板顶部彻底去掉版本号（2026-10-29 01:36，用户「版本号去掉吧」）：顶部只剩 28px 工作区图标 + 「本地工作区」一行，宽 208px（版本腾出空间后 224 仍显空）。连带删掉 version() 辅助函数与 usePlatform 引用——版本号只在 设置→关于 里看。
- 左栏头部去掉了项目切换弹层（2026-10-29 01:42，用户问「左上角这个换成什么」）：弹层里的项目列表与下方会话列表完全重复，唯一独有的是「主页」一行。现在左端换成一个 主页按钮（grid-plus，与原弹层那行同图标，command.trigger("home.toggle")），项目名变成纯标签（truncate + title=完整目录，不可点）；切换项目改为在下方列表点会话。连带删除 switcherOpen signal、openProject()、Popover / ProjectIcon / useNavigate 引用。
- 主页入口也撤了（2026-10-29 01:43，用户「不要主页入口了呀」）：头部只剩 项目名标签 + 新建 + 搜索 + 收起。主页鼠标入口随之消失，仅剩 Ctrl+B / Alt+Home（titlebar 注册的隐藏命令）；如需恢复在头部或 dock 加回即可。useCommand 引用一并删除。
- 左栏顶部项目名标签也删了（2026-10-29 01:47）：头部只剩 新建/搜索/收起 三个图标按钮（右对齐，前面用 flex-1 占位），项目名只出现在下方分组头里。这样头部不再读作「菜单栏」，也没有和分组重复的项目名。

## 项目记忆与召回

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
- **`tool/plugin/history.ts`（SiCode 自研，2026-10-25）**：压缩后回溯压缩前的原文。读 `SessionStore.messages()` 全量（不限 seq），`boundaryOf` 取**最后一条 status=completed 的 compaction** 的索引作为边界，之前的消息经 `SessionRecentText.messageToText` 转文本后做关键词匹配（query 按空白/逗号/分号切词，任一命中即算命中），不给 query 返回最近 limit 段；单段超 1500 字符保留头+尾。返回 marker 形如 `N of M archived exchanges, from before the last compaction`。注册点 `core/src/plugin/internal.ts` 三处：插件表、`SessionStore.Service`、`SessionStore.node`；`session/` 内核零改动。边界必须是**最后**一条 compaction 而不是第一条——SiCode 的摘要是全量覆盖而非增量，取第一条会漏掉中间段（测试里踩过：期望 `[middle]`，实际 `[old, middle]` 且实际行为才对）。
- **`tool-output.ts` 截断策略（2026-10-25 改）**：`TAIL_SHARE = 0.4`，head 先取 60% 行预算 + 全量字节预算，tail 再取剩余行/字节预算且不回头吃 head；marker 形如 `[showing lines 1-1200 and 2202-3001 of 3001; full output saved to …]`。含 `file` part（图片）的结果走 `boundedHead`，只留头部以保住图文原顺序。默认限额 `MAX_LINES=2000` / `MAX_BYTES=50KiB`。
- 验证纪律：这类截断改动**不要用「让模型跑大输出」的 E2E 去证**——模型会在 shell 里用变量/管道自己过滤，`metadata.truncated=false`，截断层根本没跑（2026-10-25 实际踩到）。要用服务层确定性测试：`test/tool-output.test.ts` 里直接调 `ToolOutput.Service.truncate`，默认限额 + 3001 行样本。

- SiCode 有三套「索引」，都不叫索引也都没有向量：① `project-memory`（`packages/core/src/session/project-memory.ts`）从 compaction 摘要的三个固定小节提取 fact，KV 存 `project-memory:${directory}`，上限 200 条 × 400 字，`recall` 是它的入口；② `history`（`packages/core/src/tool/plugin/history.ts`）只读 compaction boundary 之前的归档原文；③ `explore-budget`（`packages/core/src/session/runner/explore-budget.ts`）不是检索，是闸门——连续只读步数 12 步催状态、24 步硬停，`READ_ONLY_TOOLS` 里含 recall/webfetch/websearch，即"查"也算消耗。
- 上向量的门槛没有到：200 × 400 = 最多 80KB 全在内存，全量扫描比建索引便宜。真要升级的顺序是 FTS5（`bun:sqlite` 自带，零新依赖，BM25 + 前缀 + 短语）→ 跨会话 history → 最后才考虑向量，且必须混合（纯语义在标识符上漏）。
- **不要给代码库建向量索引**：`filesystem/trigram.bun.ts` 已经是 FTS5 trigram 候选索引（8232 文件 / 56MB：10s 建、15MB 盘、5-85ms 查询 vs 全量 rg 3.5-4.4s），且只做「候选超集」，正确性仍交给 ripgrep 重跑。再加一层 embedding 同步，冲突成本超过收益。（`959d565d62`）
- `search()` 原来的切词是 `split(/[\s,;]+/)`，中文没有词边界 → 无空格查询是单 token → 只能撞「整串恰好是原文连续子串」。实测：`长 diff 底部` 命中、`长diff底部` 落空、`收起栏在底部`（语序变化）落空。**修法不是向量，是二元窗口**：精确通道先跑且不变（逐字命中不能被模糊分重排），0 命中才跑 bigram，覆盖率 0.5 过线；纯拉丁与单字 query 直接跳过 fallback（`ab` 这种窗口几乎命中一切）。（`959d565d62`）
- **同源缺陷还在 `history.ts:104`**：同样的 `split(/[\s,;]+/)` + `terms.some(term => lower.includes(term))`。它搜的是长段原文，不能照搬 coverage 阈值（长文本偶然 bigram 太多），要么 AND 语义（全部窗口命中）要么用「相邻窗口链」判定。未修。
- 回归 fixture：`packages/core/src/session/project-memory.test.ts` 两条 `SiCode:` 测试；肉眼验证用 `bun packages/core/script/project-memory-demo.ts <summary.md> "<query>"`（第二个参数默认 `浏览器 工具栏`）。
- `history` 的匹配缺陷已修（`784d318310`），但修的不是中文，是**英文多词假阳性**：原实现 `terms.some(...)` + `.slice(-limit)`，多个词里命中任意一个就算匹配，所以 `ssl certificate error` 会返回一段只共享 `error`（讲 provider 配置）的旧对话，而 `toModelContent` 报「1 of 6 archived exchanges」——调用方分不出强弱匹配，会把错答案当答案。这是**静默错答**，比 miss 危险。改成**半数词覆盖**（`Math.ceil(terms.length / 2)`）：1 词=全部词（与旧行为完全一致）、2 词仍需 1、3 词需 2。
- **中文无空格在 history 里不修，是判断不是遗漏**：① AND 语义要求所有二元组命中，而跨词边界的窗口（「书错」）中文里不存在 → 永远 miss，等价于现状；② coverage 阈值在 recall 能用是因为 fact ≤400 字短句，history 搜 ≤1500 字长段落，偶然撞的二元组太多，0.5 会变成「什么都召回」；③ 真要解决得用**邻近度**（「证书」与「错误」相距 N 字内），另一套数据结构。④ history 的 miss 是**响亮**的（输出 *"No archived exchange matches that… try another word"*，模型会换词重试），代价一次工具调用，可控。
- 匹配逻辑原先埋在 `Plugin.execute` 闭包里，**零测试覆盖**（`test/plugin/history.test.ts` 原有 9 条全是 archive 边界与输出文案，没有一个 query 用例）。因此这次顺带提成导出的 `search(archived, query, limit)`，和同文件的 `archiveOf` / `clip` / `toModelContent` 风格一致，并补 6 条测试（`packages/core/test/plugin/history.test.ts` 的 `history search` 组）。**教训：一条逻辑一旦在闭包里，就等于默认它不会被测。**
- 阈值行为边界（写测试时容易踩）：`search(archive, "reasoning 配置", 5)` 只命中 `reasoning` 也返回——因为 2 词时 `needed = 1`。想验证「多词拒绝」必须用 **3 词以上**的 query，2 词永远测不出差异。

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
- **2026-10-28 实测基线（2595 条含工具调用的 assistant 消息，53859s 墙钟）**：模型 35897s（66.6%）／工具 18032s（33.5%）；平均每轮 20.8s（模型 13.8s + 工具 6.9s）。**结论：瓶颈是模型出字，不是工具执行，也不是并行度。**
- 工具侧耗时集中度极高：shell 1492 次共 263.6min（占工具总耗时 86.6%，437 次 >5s 合计 241min）；question 9 次 28.7min（单次最长 1147s）；write 3.7min；**edit 385 次仅 0.2min（中位 22ms、最长 0.3s）**。→ 「并行编辑」收益天花板 = 12 秒 = 总墙钟 0.02%。
- 并行度现状：一条消息发 1 个工具 2281 次、2 个 283、3 个 23、4 个 6、5/7 各 1 → **87% 单工具**。`/skill` 与 `tools_browser_*` 各 1-2 次。
- shell 慢命令不是本仓构建，是**网络探测脚本跑满超时**：`node tools\attach-check.js 9333`（300.9s）、`diag-ds-edge.js`（300.5s）、`Get-NetTCPConnection -State Listen`（260.4s）等，300s 是多条命令的统一撞墙点。→ 独立优化项：shell 超时治理（池子 241min，不依赖 A/B/C）。
- 失败率：webfetch 46 次失败 13（**28%**，异常高，值得单查）；shell 1494/36；edit 385/12；write 314/12；read 274/5。
- 数据获取方式（可重复）：直接只读 `~/.local/share/opencode/opencode-local.db`，表 `session_message(id, session_id, type, seq, time_created, time_updated, data)`，工具段在 `data.content[]` 里 `json_extract(...,'$.type')='tool'`。脚本在 `.sicode/scratch/{stats-probe,turn-probe,where-time,shell-what}.mjs`。**注意**：`shell/message` 这类上游表名不适用，本机实际表是 `session_message` / `session_v2`。
- 时间字段可直接算：工具耗时 = `time.completed - coalesce(time.ran, time.created)`（`message-updater.ts:332` 写 ran）；模型时间 = 消息 `time_updated - time_created` 再扣工具耗时。`session/stats.ts:238/337` 已经在算 `durationP50` 了（出口 `schema/src/session-stats.ts:29`、服务端 `handlers/session.ts:85`）——**所以 A2 要补的是 turn 粒度汇总与暴露，不是新埋点**。
- 三份方案文档在 `.sicode/proposals/`（README.md 是总览）：A 耗时统计（A1 已完成）、B 诊断回灌（建议优先）、C 批量编辑（目标需从「并行」改为「减少 round trip」）。
- 服务认证：本地 3084 直接 curl 会 401，`authorization.ts:34` 校验 `credentials.username === config.username`，用 `-u sicode:<password>` 用户名对不上；密码在 `~/.config/opencode/service-local.json`。**直接读 db 比调 API 省事**，绕过认证问题。
- 总账（2026-10-29 全库重测，27 会话 / 4261 次工具调用）：工具执行 20361s + 模型流 74339s ≈ 26.3 小时；工具占 28%，模型占 72%。harness 能改的部分不到总量 4%。
- 唯一确定的可榨浪费是 shell 轮询：模型用 `Start-Sleep -Seconds N; Get-Content <file>` 自己轮询后台任务，182 次吃掉 3380 秒，占 shell 总时长 20361s 的 16.6%。`tool/plugin/shell.ts:110` 的 background 描述里已经明写 "DO NOT poll for completion"，照样不听 → 提示词救不了，只能运行时拦截（窄正则命中后返回错误并指引用 background:true）。
- 两条被推翻的假想优化（实测无收益，别再做）：① `cd X && cmd` 改成 workdir 参数 —— 602 次看着多，但 cd 本身几乎不耗时，慢的是后面那条命令，换了省不了时间；② `ls/cat/find` 换成 read/glob/grep —— 261 次只省约 6 分钟，占 339 分钟不到 2%。原来以为是大头，实测不是。
- 工具耗时分位（字段名 `session_message.data.content[].time.created/completed`，不是 start/end）：shell 中位 2623ms / P90 30665ms / 均值 10879ms；read 487、grep 694、glob 718、edit 1639、write 5951。shell 比专用工具慢 4.5 倍（中位），占工具执行总时长 71.4% 而调用只占 44%。
- batch 并行段落只加在 7 个 provider txt + patch.txt + edit.ts，`session/runner/prompt/system.txt` 里没有；配合 `core/src/plugin/optimize.ts` 的 id 关键词命中规则，自定义 provider / GLM / Qwen / 本地模型一律拿不到。同模型对照（DeepSeek-V4.1-Flash）：无 batch 段并行率 7/9/20%，加段后 32/39/55%。注意 `system.txt:6` 那句 "Prefer parallelizing independent tool calls." 只换来 7-9% —— 空洞口号无效、5 行具体规范有效，修正此前「静态守则是负债」的结论。
- RE/破解授权段落决定不改：8 个 prompt 文件（system.txt + 7 个 provider txt）每份都带 RE+Authorization，system.txt 那份是「无命中」模型（自定义 provider / GLM / Qwen / 本地）的唯一来源；删掉或改成按需注入，意图检测漏判就是灾难性失败（模型道德拒绝正当任务、不可自动恢复）。append 模式（anthropic/deepseek）会读到两份，属可接受啰嗦。
- `<authorization>` 块从未被注入：全仓 grep 只存在于 .txt 引用里，没有任何代码把它塞进 session 的 system 数组，8 处都是死引用。观察项 —— RE 段其余条文独立生效，不影响现有能力。
- 提示词体积：system.txt 1424 tok、工具静态 description 合计 609 tok，整体走极精简路线；RE 段在 system.txt 占 26% 篇幅、在 kimi/trinity/meta 里排到 74% 之后。

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
- 薄导航 LSP 已落地（2026-10-29）：按既有 P2 结论只做导航不做采集，自写约 700 行、零新依赖（未回收 44b6938b2a^ 的 3311 行旧实现，那个带 vscode-jsonrpc 依赖）。四个文件：`packages/core/src/lsp/protocol.ts`（Content-Length 分帧，纯函数 FrameDecoder，字节口径防 UTF-8 多字节截断）、`packages/core/src/lsp/config.ts`（从上游遗留 `lsp` 配置段按扩展名选服务器，extensionOf 兼容反斜杠）、`packages/core/src/lsp/client.ts`（spawn 走 Environment.spawner 照抄 mcp/stdio.ts 模式、initialize 握手 30s / 请求 15s 超时、publishDiagnostics 捕获、didOpen/didChange 全文同步、服务器反向请求 stub 应答）、`packages/core/src/tool/plugin/lsp.ts`（definition/references/hover/diagnostics 四 op，入参出参均 1-based，注册表懒启动+进程死亡自动出表）。
- 注册单点：`packages/core/src/plugin/internal.ts` pre 数组 GrepTool.Plugin 之后。服务器进程挂插件激活 scope（forkIn），配置热重载即回收重启；Entry 声明用同步 claim（Deferred.makeUnsafe + Scope.makeUnsafe）防并发双 spawn。
- diagnostics op 与旧结论「不做诊断」的区别：旧结论反对的是「全量采集+注入 prompt」；这个 op 是模型按需查询单文件（首次 publish 轮询 6s），不做预热不做注入。
- effect 4 的 API 坑：无 Effect.catchAll（用 Effect.catch）、无 Effect.timeoutFail（用 Effect.timeoutOption + Option 判断）、无 Deferred.unsafeMake/Scope.unsafeMake（改 makeUnsafe）、无 Duration.unwrap（用 toMillis）、schema 解码类型取 `typeof X["Type"]`、错误类用 Data.TaggedError（Cause.YieldableError 是 interface 不能 extends）。
- 测试：`test/lsp-protocol.test.ts`（7 条：分帧/跨 chunk/多字节截断/坏帧抛错）、`test/lsp-config.test.ts`（8 条：disabled/unconfigured/扩展名/降权/Windows 路径）、`test/lsp-client.test.ts`（5 条集成，真实 spawn `test/fixture/lsp-server.mjs` mock 服务器）。真实冒烟：typescript-language-server（bun global）+ 全局 typescript@5.9.3，对 src/lsp/config.ts 的 `extensions` hover 返回正确类型、references 3 处命中、干净关闭；tsserver 路径用 initializationOptions.tsserver.path 传（新版 server 已删 --tsserver-path CLI 参数）。
- 冒烟环境注意：repo 的 typescript 6.0.2 无 tsserver.js（与旧结论一致），本机现以 bun global 的 5.9.3 兜底；生产的 tsserver 路径策略待定（旧笔记建议指到 .old_modules 的 @typescript/old）。
- 纠偏：此前认为「fff 内容检索」是待做缺口，实际早已实现。`filesystem/fff.ts` 绑 `@ff-labs/fff-bun`（文件名模糊查找），`filesystem/trigram-search.ts` 是内容倒排，两层都在线。判为待做是错的。
- 当前检索栈是四层：① fff 文件名模糊查找；② trigram 倒排给 grep 做候选预筛（`filesystem/trigram-search.ts:187` 起，默认启用条件 = 非 workspace-backed + 有 VCS + 不在 home）；③ ripgrep 精确扫描兼回退；④ LSP 符号导航。检索路径 see `tool/plugin/grep.ts:282-288` 的两阶段注释。
- grep 两阶段具体流程：literal pattern 先问 trigram 拿候选文件，再只对候选跑 rg；命中回退的条件写在注释里——正则 pattern、索引还在构建、候选集超过 MAX_CANDIDATES、搜索落在索引根之外。rg 进程启动约 150ms，索引预热后路径可省。
- 唯一没跑起来的是 LSP：`tool/plugin/lsp.ts` 提供 definition/references/hover/diagnostics，但工程里没有 opencode.json、没有 lsp 配置，等于没有 language server。实测 4342 次工具调用里 lsp 调用 **0 次**——不是模型不爱用，是压根没得用。
- 检索不是时间瓶颈：探索类（read 566 / grep 436 / glob 32 / lsp 0）合计 1034 次占调用 23.8%，累计执行只有 799 秒（read 387 + grep 389 + glob 23），占 26.3 小时总量 0.8%。grep 436 次空结果为 0——搜得到，问题从来不是搜不到。
- 所以「差索引」的正确表述：差的不是检索速度（已毫秒级），是**符号跳转没上线**。它的价值也不在执行毫秒数，而在减少步数——模型少走几步 grep+read 的往返，每步省约 13 秒模型时间。语义/向量索引那条已决策不做，且没有数据支持它值那个价。
- **P1 结论反转（2026-10-29 定向实测）：不做自动检测接入。** 前提全部满足 —— 本机 `lsp.typescript` 已配且解析 0 错、`typescript-language-server.exe` 已装、工具已注册进 `internal.ts:263` 且对模型可见 —— 用户在 SiCode 仓库（有 tsconfig.json）问 `where is detectPollingWait defined`，模型只调了一次 **grep（0.4 秒、9 命中）**，lsp **0 次**。会话 ses_e79d5813dffdelGJl93tTVdr2U。
- 根因不止「模型习惯用 grep」，更是**结构性限制**：definition / references / hover 三个 op 都要求 `path` + `line` + `character`（`tool/plugin/lsp.ts:44-47`）。模型要找「X 在哪定义」时并不知道行号，必须先 grep 定位；而 grep 一旦跑完答案就已经拿到了（本次 0.4 秒）。**lsp 无法替代「定位」这一步，只能在已知位置后做精确化** —— 对「找定义」这个最高频场景是帮不上忙的。
- 成本对比（同一任务的两种路径）：grep 0.4 秒；TS language server 首次索引几十秒到几分钟 + 常驻 1~2GB 内存。找定义这类任务上 lsp 是**负收益**。
- **撤回此前估计**：「LSP 能替掉 25% 的 grep+read 往返、约省 54 分钟」过度乐观且无依据 —— 全库 lsp 调用 0 次，本次定向验证仍 0 次。以后不要再引用这个数字。
- 不做自动检测的四条理由：① 实测模型不用，接上也摆设；② 结构性限制使其在最高频场景无效；③ 1~2GB 常驻内存是硬成本；④ diagnostics 那部分价值已被 `syntax-check` 覆盖（改动后自动校验，不需要模型主动调用，已随 a43848e4da 提交）。
- 若将来要捡起来，正确形态不是「自动检测接入」，而是：给 grep 加符号级模式（按符号名搜索、不需要先行号），或把 lsp 查询**嵌进既有工具**而不是让模型单独决策调用。
- 保留事项：本机 `~/.config/opencode/opencode.jsonc` 的 lsp 配置无害，留作后续验证；`lsp: true` 仍是上游预留的内置钩子（`lsp/config.ts:49` 目前返回 unconfigured，注释明说 reserved for future built-ins），它是 opt-in 语义，将来做产品化就填这里，不写不付内存代价。
- 1a 查询扩展已落地（2026-10-29）：`packages/core/src/session/system-prompt.ts` 的 `searchGuidance()` 渲染 `# Finding code from a description` 段，占位符 `${OPENCODE_SEARCH_GUIDANCE}` 在 `packages/core/src/session/runner/prompt/system.txt` 的 Batching 段之后；grep/glob 工具描述各加一句「空结果=词猜错了」（`packages/core/src/tool/plugin/grep.ts` 的 `QUERY_EXPANSION_NOTE`、`glob.ts` 的 description 拼接）。开关 `OPENCODE_QEXPAND=0`（只在 system 段生效，工具描述也读同一个 env）。实测总开销 223 token（system 169 + grep 33 + glob 21），卡在方案定的 250 以内。
- 1b 排序检索已落地：新模块 `packages/core/src/search-ranked/`（terms 分词 / score BM25F / index 编排），在 grep 空结果时自动注入「最接近的文件」（`packages/core/src/tool/plugin/grep.ts` 的 `result.total === 0 && !result.scoped` 分支），开关 `OPENCODE_RANKED=0`。
- 字段权重：`path 3 / symbol 2 / content 1`，长度惩罚 `0.4 / 0.6 / 0.75`，k1=1.2（`score.ts`）。i18n 键值对与 CSS 类名（BEM 按 `__`/`--` 拆）都进 symbol 字段——中文意图唯一能接到英文标识符的桥就是字典。
- 不做常驻索引：文件列表走 `ripgrep.find({pattern:"*"})`，其余按需读且有界（字典 30 + 样式 30 个文件、3MB；候选 40 个、单文件 256KB）。本仓 8809 文件实测单次 173~216ms。
- 两个坑（都踩过）：① 字典与样式共用一个配额时，几百个 .css 会把 zh.ts 挤出桶外 → 必须分开配额；② 字典桶内按字母序取前 30 个，`zh.ts` 排在 `am/ar/az/bg/...` 之后永远取不到 → 按语言优先排序（`zh` 优先，其次 `ja/ko`）。
- 中文分词用重叠 bigram（无空格可切），`paddingInline` 先按大写边界切再折叠大小写——顺序反了就只剩 `paddinginline`。
- 本仓实测：`session header actions` → `packages/app/src/session/header/session-header-actions.tsx` 第一；`compaction durable` → `compaction-durable.ts` 第一；`侧边浏览器代理` → 各 `i18n/zh.ts` 前五（browser 那个排第 3）。`行号超出` 无命中（字典里确实没有该词条，属真实空缺）。
- 待验证（方案 v6 的验收线）：改码型任务探索/edit 比 8:1 → 4:1，黄金问题集 recall@5。1a/1b 都要 A/B，数据不支持就撤。
- 阶段二（搜索子代理）已落地（2026-10-29）：无需新建 agent——上游已有 `explore` 子代理（`packages/core/src/plugin/agent.ts:74-94`），权限已锁死 grep/glob/read/shell/webfetch/websearch + `*:* deny` 兜底。增量是三处提示词：① `PROMPT_EXPLORE` 补「输出契约」——只回传结论 + `file:line` 清单、不回传正文（否则子代理把读到的字节又灌回主会话，隔离上下文白做）；② `system.txt` 加 `# Parallelizing search with subagents` 段（大范围定位/中文意图先派 explore，覆盖默认 + DeepSeek/Anthropic 两个 append 模型）；③ `kimi.txt`、`meta.txt` 补同款触发指引。
- 关键发现（方案没料到）：`gpt.txt` / `gpt-astra.txt` 里有上游刻意写的「Do not spawn subagents unless 用户/AGENTS.md/skill 明确要求」——GPT 系模型自动派子代理是负收益，上游主动禁了。所以触发指引**按模型分治**：append 系（default/deepseek/anthropic）加指引、kimi/meta 补指引，gpt 系保持禁派不动。trinity.txt 第 83 行本来就有「file search 时 prefer subagent」。
- 子代理机制：`tool/plugin/subagent.ts` 里 `agents.resolve(input.agent)` + 深度限制（`experimental.subagent_depth` 默认 1）；可用子代理列表由 `tool/plugin/subagent.ts:288` 的 context hook 动态注入工具描述（`mode !== "primary" && !hidden`）。

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
- 「为什么需要语义检索」的实测证据（`packages/core/src`，`*.ts`）：问「上下文压缩什么时候触发」时，grep `compress` 只命中 **4 个文件**，且全是 OpenAI/Copilot 的 API 参数（`openai-responses-api-types.ts`、`openai-responses-prepare-tools.ts`、`core/src/plugin/provider/chatgpt.ts`、`core/src/plugin/provider/openai.ts`），跟上下文压缩毫无关系；真实实现在 `session/compaction.ts`，文件名里**没有 compress**。而 grep `compact|summariz|prune` 命中 50+ 文件（截断值）。⇒ 一个概念只有一种叫法，**猜错词不是命中率下降，是零命中 + 4 个误导项**，模型据此会得出「这个项目没有上下文压缩」的错误结论。
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

## shell 输出编码

- **中文 Windows 下 shell 输出乱码的根因（2026-10-25）**：宿主默认 `[Console]::OutputEncoding` 是 **gb2312 / codepage 936**（本机实测），ps 家族与原生控制台程序都按这个代码页写 stdout/stderr；而 `shell.ts` 的 `output()` 原来用 `buffer.subarray(...).toString("utf8")`，于是每个中文字符都变成 U+FFFD —— 恰好是解释命令为什么失败的那一行。例：`$($null.Count)` 的报错原文「无法对 Null 数组进行索引。」被存成 `�޷��� Null �������������`。
- **修法一（根因）**：`shell/select.ts` 的 `args()` 给 ps 家族加前置 `try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}; `（`PS_PRELUDE`）。它同时修正两个方向：ps 自己写出的错误消息、以及 ps 解码原生程序输出时用的代码页。带 `try/catch` 是因为无控制台宿主下赋值可能抛错，不能让它连带整个命令失败。
- **修法二（兜底）**：新增 `packages/util/src/decode.ts` 的 `Decode.outputText(bytes)`：先按 UTF-8 严格解码，失败且平台是 win32 时退到 `TextDecoder("gbk")`。关键细节是 `completeEnd()` 先剔掉尾部不完整的多字节序列再判断 —— 否则分片读取把字符切成两半时，合法 UTF-8 会被误判成 GBK，反而整段变乱码。放在 util 而不是 core，是因为 `util/src/process.ts` 的 `requireSuccess`/`requireExitIn` 也要用（`stderr.toString("utf8")` 是同一个 bug），而 util 不能依赖 core。
- **修法二落点**：`core/src/shell.ts` 的 `output()`（shell 工具结果与增量读取共用这一处）、`core/src/config/plugin/command.ts`（`!command` 插值，原来也是 `toString("utf8")`）、`util/src/process.ts` 两处错误消息。
- **顺带修正一个此前记错的结论**：shell 工具**本来就保留尾部** —— `Shell.result` 自己按 `maxBytes` 从文件末尾分页、再 `lines.slice(-maxLines)`，并写好 `[showing lines N-M of T; full output saved to …]`，metadata 也带 `truncated`。而 `ToolOutput.truncate` 见到 `metadata.truncated !== undefined` 会直接原样返回（`tool-output.ts` 开头第一段逻辑）。所以：**shell / read / grep / glob 都走各自的截断，`ToolOutput` 的 head+tail 只作用于 MCP 工具（`tool/mcp.ts`）和没自己写 `truncated` 的插件结果**。之前把「补尾部」说成修 shell 报错栈是错的。

## 压缩遥测

- **为什么默认关（代码依据，2026-10-25）**：`schema/src/config/experimental.ts` 的 `precompute_compaction` 描述原文就写了「Background summaries that are never used still cost tokens」，同目录 `portable_shell_scanner` / `todo` 也都是默认 false，experimental 这一档的约定就是显式 opt-in。更硬的一条是记账：`session/compaction.ts` 的 `held.usage.forEach(addSpent)` 只在 `usePrecomputed` 成功换入时执行，所以**被丢弃/失败/会话结束的后台摘要不进会话成本、也不发 `UsageRecorded`** —— provider 照扣费，界面上看不见。默认关本质是不让用户在一笔无法反查的账上花钱。
- **兑现路径很窄**：`usePrecomputed` 的 `usable` 要求 `trigger.reason !== "overflow"`，即 provider 报上下文超限后的恢复性压缩**永远不用** held 摘要；native compaction 也不用。触发还要过 `estimateContext >= ceiling × PRECOMPUTE_RATIO(0.85)` 且实测 prompt ≥ `PRECOMPUTE_MIN_TOKENS(64k)`。`tailLimit = min(max(keep*2, 30000), budget*0.25)`，默认 keep=15000 → 恒为 30000；而 85%→100% 的余量是 `0.15 × 窗口`，所以**窗口 > ~200k 时可能在到点前又聊超 30k，held 过期重算**（日志里记作 `superseded`）。
- **遥测落点（新增，零侵入）**：`core/src/compaction-metrics.ts` 只监听 Bus 的 `Compaction.Started` → `Ended`/`Failed`，用 `sessionID` 配对算耗时，不需要改 `session/` 主循环；注册在 `core/src/plugin/internal.ts` 的 node 列表（依赖 `Bus.node`，已在列表中）。因为 `Compaction.Ended` 的 schema 本身没有 duration 字段，配对是唯一不用改内核的算法。没有 Started 配对的 Ended 直接丢弃（重启后恢复的压缩，算出来是假的）。
- **precompute 生命周期三条**（`session/compaction.ts`，新增 `Precomputed.startedAt` + `Effect.timed` 包 `summarize`）：`state=started` 带 `windowRatio`/`tailTokens`/`tailLimit`；`state=used` 带 `savedMs`（摘要自身生成耗时 = 真省下的等待）与 `leadMs`（提前多久准备好）；`state=discarded` 带 `reason`，取值 `precompute-off` / `overflow` / `native` / `stale-session` / `stale-tail` / `superseded` / `failed`。fiber 的返回类型因此从 `Result` 变成 `{ result, durationMs }`，`usePrecomputed` 里 `exit.value` 相应改成 `exit.value.result`。
- **日志格式与解析契约**：`util/src/observability/logging.ts` 的 formatter 会把 `Effect.logInfo("msg", {obj})` 的**第二个参数 flatten 成平铺字段**，标量不加引号（正则 `/^[^\s="\\]+$/` 才免引号）。实际落盘形如 `message=compaction.timing outcome=completed reason=auto durationMs=41200`。`script/compaction-stats.ts` 就是按这个形状解析的；改任何一侧都要同步另一侧。Effect v4 里替换 logger 的 API 是 `Logger.layer([logger], { mergeWithExisting: false })`，`Logger.replace` 不存在（踩过）。
- **判据（脚本自动给）**：`waste = discarded / (used + discarded)`，>50% 保持关；25–50% 记作 marginal；<25% 且累计 `savedMs ≥ 30s` 才判 justified。`unsettled = started - used - discarded` 代表会话结束或仍在跑、从未结算的那部分，是这套统计的固有盲区（进程退出即丢 held）。
- **和 Cursor 的结构差异**：Cursor 的 9 个指标里有 `persisted`，说明它的后台摘要算完会落盘复用（`BackgroundAndPersistIfCompleted`）；SiCode 的 held 只在内存 `Map`（`compaction.ts` 的 `precomputed`），进程退出即丢，**所以它的浪费率天然更高**。这既解释了默认关，也说明「开关默认值」不该照抄 —— Cursor 的成本在自己账上，SiCode 的在用户 key 上。
- **路径更正**：本文件（含「项目记忆」区域）里凡写作 packages/plugin/internal.ts 的路径都应读作 `packages/core/src/plugin/internal.ts` —— 插件表、node 列表、`SessionStore.Service` 注册全在 core 包内，仓库里没有前者这个路径；`bun script/notes.ts verify` 会把它报成 missing。
- **后台摘要落盘（2026-10-26，对齐 Cursor 的 `persisted`）**：`session/compaction.ts` 新增最小落盘层。fiber 完成时 `Effect.tap` 把 `{text, keepID, firstID, model, initial, tailLimit, failures}` 写到 `global.cache/compaction/<sessionID>.json`；`precompute` 入口在内存 Map 无值时读盘重建一个「已完成」的 held（`fiber = Effect.succeed(...).pipe(forkIn(scope))`，`usage=[]`、`startedAt=now`），`heldIndex` 校验通过就复用、跳过重新 summarize。消费时 `compact` 开头 `deletePersisted`（`usePrecomputed` 的 discarded/failed 分支不需要再删，因为文件已在 compact 开头删掉）。`superseded` 分支同步删盘。`node` deps 加 `Global.node`。
- 语义边界：恢复摘要的 `usage=[]` 所以 `usePrecomputed` 不 `addSpent`（上次进程已计费，避免重复扣费）；`durationMs=0`/`leadMs=0` 让 `compaction-stats` 如实显示「落盘复用，非等待已算好摘要」。日志加 `state=recovered` 标记。
- 收益面窄：precompute 默认关，只有「开了 precompute + 长会话跨天重启 + 摘要已算完但未 compact」才命中，省一次 LLM 摘要调用。

## 上游同步

- 上游 remote `sst/opencode`（dev 分支），分叉基线 `76fd05ff45`（2026-10-22）。策略（用户拍板）：**不整体 merge，列清单按需摘取**。流程：① `git fetch upstream dev` 后 `git log --oneline 76fd05ff45..upstream/dev`，按内核修复/新功能/桌面端 UI/文档 CI 分类列清单并标注影响面；② 用户挑选；③ 没碰我们分叉文件（i18n/图标/桌面壳/SiCode 功能）的直接 cherry-pick，碰了就手工移植并保留 `// SiCode:` 注释；涉及依赖的移植完 `bun install --linker=hoisted`，再跑 `bun run check` 和相关包测试。完整流程在根 `UPSTREAM.md`（README 同步一节链接它）。
- 2026-10-26 那次 upstream/dev 整体合并**已回滚**（`merge/upstream-2026-10-26` 停在 4b4aab66f6，即合并前的 0133662a23 之后若干提交）。合并本身当时是打通的，留档供以后按需摘取：cf2b4a89d5 解掉 174 处冲突，app/session-ui/gui-extensions/core/desktop tsc 全绿；测试 app 892 pass、session-ui 343 pass、gui-extensions 256 pass，core 官方入口 5828 pass / 89 fail 且失败均为环境性（ripgrep 下载被测试框架禁网拦截、MCP 本地 OAuth 回环、recorded 测试超时，合并前基线同样失败）。
- 那次合并的手工回插清单（再合并时会重新遇到）：`diff.ts` 取上游数字 seq + 保留我们的 prompt 语义（数组改名 `promptBounds` 避免与函数重名）；`llm.ts` 的 steer / narrate / loop 全量回插；`session-header-actions` 清死代码（上游删了 terminalPlacement / dock API）；tab-nav 双侧菜单合并；browser 的 ⌘L 地址栏聚焦按新 ipc/connection/pane 结构回插；`SiteCookies` 回插 `panel.tsx`。stash pop 的冲突解法：message-content 的 meta 合成为 `MetaItem[]` + elapsed 追加项、ui i18n 双侧键都保留。
- 合并线上试过但**未保留**的两处：app/src/shell/tool-rail.tsx 整文件删除（该文件已不存在）（左侧工具栏，当时是半成品——删了文件但 `shell.tsx` 还在 import，编译不过），以及 `desktop/package.json` 的 `install-electron` 空脚本（绕过 electron postinstall，hoisted 环境用）。
- `packages/core/src/plugin/warming.ts` 里 `ctx.event.subscribe({ types: [...] })` 的形态来自 `1434464f7e feat(plugin): filter event subscriptions by type`（38 文件 752 行，重写 event 订阅 API、client 生成代码、protocol/openapi）。单独摘 warming 类修复（`2bf756e3ab`）会得到 TS2554「Expected 0 arguments」加 `event.data.sessionID` 取不到，必须先有那条协议级改动。
- `packages/desktop/resources/windows/installer.nsh` 的「各渠道独立目录」（`f4ecbbf71d`）调用 `!insertmacro removeStagedUpdates`，且 diff 上下文建立在 `8d5e6e23c0` 的进程枚举逻辑（`QueryFullProcessImageNameW` 循环）上，两条必须成对摘，单独摘必冲突。
- 「`git diff base..main-sicode -- <file>` 为空就代表能干净 cherry-pick」这个判据不充分。还要看该提交在上游 base 之后的位置：`git rev-list --count 76fd05ff45..<commit>` 越大，中间被别的提交改过同一文件的概率越高。`f4ecbbf71d`（41）和 `c54677bece`（617）都比 `4371c29b5b`（655）更容易撞。
- Windows 渠道隔离的实现是 `packages/desktop/resources/windows/installer.nsh` 的 `customInit` 把 `$INSTDIR` 改成 `$R0\${APP_ID}`，旧共享目录 `$R0\${APP_FILENAME}` 交给 `leaveSharedInstall` 清理。脚本里没有任何品牌字面量，渠道名来自 `electron-builder.config.ts` 的 `APP_IDS`（`com.sicode.desktop` / `.dev` / `.beta`），品牌改名不需要动这个文件。
- 「秒装」的本质是 `patches/electron-updater@6.8.9.patch` 给 `NsisUpdater` 加 `/NCRC`，跳过 NSIS 对整包（约 230 MB）的 CRC 校验——下载时已经验过 SHA-512。另有 `patches/app-builder-lib@26.15.7.patch` 在 `extractAppPackage.nsh` 里插入 `customInstallStagedApp`，让安装器直接装运行中应用已经解包的更新。两个 patch 都要在加依赖后跑 `bun install --linker=hoisted` 才会落到 `node_modules`，验证方式是 grep `/NCRC` 和 `customInstallStagedApp`。
- `packages/desktop/scripts/windows-installer.test.ts` 是真实集成测试：会调 `getMakeNsisPath` 取 NSIS 工具链并编译脚本，其中一条用例要启动 `reg.exe` 改卸载注册表。在启用了程序黑名单的受限环境里那条必然 `EPERM uv_spawn 'reg.exe'`，属于环境限制，不能当代码回归。
- 摘带测试的上游提交时，要检查测试里有没有硬编码「工具名/能力枚举」数组。`packages/core/test/location-layer.test.ts` 的 blocked/allowed location 用例就列全了工具清单，摘入上游版本会把我们的 `history`、`recall` 覆盖掉，测试立刻失败（`c17ae01645` 补回两处清单并加了 `// SiCode:` 注释）。同类风险点：任何断言 `tools.map(t => t.name)`、权限预设列表、provider 列表的测试。
- 位置靠后的提交（`git rev-list --count base..<commit>` 大于 600）明显更好摘：`6135e07fae`(639)、`0ca7885f26`(640)、`dc21f528ac`(642) 三条全部 automerge 无冲突，而同批中位置 183 以后的 server 改动、位置 427 的 desktop 诊断改动都在我们改过的区域里。
- 2026-10-27 上游 `dae4077a96` 把全局 `extension` 改叫 `plugin`：`packages/gui-extensions/` 整包变成 gui-plugins/（旧目录；SiCode 没跟这次改名，仍是 gui-extensions），`packages/app/src/runtime/extension/` 变成 `runtime/plugin/`，共 928 个 rename、1179 文件。我们二开的 `gui-extensions/src/debug/*`（约 +335）和 `gui-extensions/src/browser/*` 必须整体搬到新路径，所有 `@opencode/gui-extensions` import 也要改。这是「跟到底」或「永远不跟」的二选一：不跟的话，以后任何 import `@opencode/gui-plugins` 的 app/desktop 提交都摘不了。
- 上游 `51e4de1da6`（`put dev builds back on the shared service and database`）完整回退了 `8ee9351be9`，dev 构建重新用共享 service 和数据库。当时搁置那条的判断（local 频道不受影响、依赖 3 条链）因此被证实；以后不必再评估它。

## 会话审查 / 压缩

- **完成闸门 completion-gate（2026-10-26，对齐 Cursor `<completion_spec>` 结构化闸门）**：Cursor 用 `<completion_spec>` 强制 `summary`/`finish` 工具「仅 todo 全 resolved 且无 pending 工具结果时可用」。SiCode 无 finish 工具（回合结束 = 模型停止调工具），todo 工具（`todowrite`）又是无状态的（`execute` 只回显，不持久化）。所以闸门做成 nudge：模型「准备结束」（`needsContinuation===false`）但最近一次 todowrite 还有 pending/in_progress 时，注入一条 synthetic 提醒并强制继续一轮。\n  - 新模块 `session/runner/completion-gate.ts`：纯函数 `detectPendingTodos(messages)`（从后往前扫 `todowrite` 工具，读 `state.input.todos`，过滤 pending/in_progress；「Todos cleared」空列表覆盖更早列表）、`completionFingerprint`（按 status:content 做 key）、`completionGatePrompt`（列出未完成项）。\n  - 挂点 `session/runner/llm.ts`：`drain` 加 `completionNudged:Set<string>`（防死循环，同指纹只拦一次），传入 `runStep`；`Outcome.Completed` 分支在 `!needsContinuation` 时先查 todo，有未完成项且指纹未拦过 → `bus.publish(SessionEvent.Synthetic, {text: completionGatePrompt})` + `return true` 强制继续。synthetic 消息经 `to-llm-message.ts` 转成 `role:"user"` 进下一轮，`CONTINUE_AFTER_INCOMPLETE_STREAM`/`OUTPUT_LIMIT` 是既有先例。\n  - 安全默认：todo 未启用（`experimental.todo!==true`）则历史无 todowrite，`detectPendingTodos` 返回空，闸门不触发。\n  - 测试 `test/completion-gate.test.ts`：9 项（open todos / in_progress / 全 completed 或 cancelled / 清空列表覆盖 / 忽略非 todo 与空 / 忽略 streaming / fingerprint 稳定性与 status 参与 / prompt 列出项）。\n  - **注意**：`loop-detection.ts` 的 `NEVER_NUDGE = Set(["todo"])` 用的是旧名 `"todo"`，实际工具名是 `"todowrite"`（`todo.ts` 的 `name`），未匹配上——既有无害 bug，未动（本次不涉及）。\n  - **既有失败（非本次/上轮引入）**：`session-runner.test.ts` 两条 `automatically compacts into a completed summary and retained recent turn`、`caps an excessive provider retry-after delay at fifteen minutes` 在 stash 掉 llm.ts 与 compaction.ts 后仍失败，判定为上游 merge `dfe20c594b` 或更早就存在，与 completion-gate / 摘要落盘无关。\nEOF\necho "EXIT: $?"
- **历史文件引用 transcript 落盘（2026-10-26，对齐 Cursor「压缩前 transcript 文件位置 + 尾部指向」）**：Cursor 压缩时把「压缩前完整 transcript」写文件、在尾部带文件位置（`transcript` 行，可关），模型降智后能 read 回被摘要丢弃的原文。SiCode 之前没有：被丢弃消息在库（append-only）里还在，但 `SessionHistory.load(boundary:"latest")` 只读 compaction 之后（`history.ts` 的 `messageEntries` 用 `gte(seq, compaction.seq)`），模型无读回路径。\n  - 落点 `session/compaction.ts`：`summarize` 里 `!background && keepID` 且 `keepIndex > 0` 时（真正 compact 才落，precompute 后台摘要原文还在上下文不落），把 `messages.slice(0, keepIndex)`（keepID 之前的被丢弃原文）用 `SessionRecentText.messageToText` 序列化落盘 `global.cache/compaction/<sessionID>.transcript.txt`（复用上轮 persistDir 基建，新增 `writeTranscript`/`transcriptPath` 闭包辅助），并把 `transcriptPath` 塞进 `result.metadata`。\n  - 注入 `session/runner/to-llm-message.ts`：compaction case 读 `message.metadata.transcriptPath`，是 string 时在 `<conversation-checkpoint>` 里加 `<full-transcript>` 段（「完整原文已存 <路径>，read 工具读回」），让模型真正看到路径（metadata 只给 provider，模型读不到，必须写进 content 文本）。\n  - 测试：`session-runner-message.test.ts` 加 3 项（有路径注入 / 无路径不注入 / 纯函数 content 含 full-transcript）；`session-compaction.test.ts` 加 1 项集成（compact 后 transcript 文件真实写出、含被丢弃原文、不含保留 recent、metadata.transcriptPath 正确）。\n  - 踩坑：`it.effect` 里不能直接 `yield* Global.Service`（SessionCompaction 是 location 节点，Global 走 location tag，测试 effect 环境里无顶层 Global），改成从 `store.context` 读 checkpoint 的 `metadata.transcriptPath` 拿路径再 `fs.readFileSync`。`Global.node.replace(tempGlobalLayer)` 对 location 节点不生效（同因）。\n  - 既有失败不变：`session-runner.test.ts` 两条（compaction recent turn / retry-after 时钟）仍是既有失败，本次改动未增未减。\nEOF\necho "EXIT: $?"
- **never-nudge 旧名修复（2026-10-26）**：`loop-detection.ts:50` 的 `NEVER_NUDGE` 原来写 `"todo"`，实际工具名是 `"todowrite"`（`tool/plugin/todo.ts:11`），导致循环检测没有豁免 todowrite——模型每轮正常刷新 todo 可能被误判成死循环挨 nudge。本轮 completion-gate 正依赖 todowrite 状态，两条线撞上了，已修（`"todo"`→`"todowrite"`，测试同步）。
- **retry-after cap 测试失配（2026-10-26）**：`model-retry.ts` 的 `RETRY_AFTER_MAX` 早前对齐 Cursor 时从 15 分钟改成 1 分钟，但 `session-runner.test.ts` 的 `caps an excessive provider retry-after delay at fifteen minutes` 还断言 15 分钟，一直红。已把测试改成 `one minute`（`TestClock.adjust("59999 millis")` 边界）。这不是 merge 引入，是之前改 cap 没同步测试。
- **calculateCeiling 保护被 merge 误删（2026-10-26）**：`dfe20c594b`（merge 适配提交）在解决冲突时把上游 `33726e8fc1`（#58313）加的 `&& buffer < window` 保护改回了 `if (buffer !== undefined)`，会让 buffer>=window 时 ceiling 变负数。已恢复保护（`compaction.ts:1305`）。
- **`automatically compacts into a completed summary` 失败根因（已定位，不修）**：该测试在 HEAD 基线（merge 后、任何 SiCode 改动前）就失败，上游 450e7 是绿的。二分定位：不是 llm/compaction/history/to-llm-message/tool-output 任何一处的改动，而是 SiCode 有意扩大的 system prompt——`runner/prompt/system.txt`（`cbb88ae973`）追加的 RE/破解/授权指令段约 780 tokens，让 compaction 请求的 system 估算从上游 249 涨到 1029。于是 `deliver` 里 `estimateRequest(prepared.request)(3093) > fit(2628)`，触发 `shrink.history` 降级，丢掉 recent tail（"Recent exact request"），破坏了上游 `fd6589239e`(#57091) 的「whole conversation summary 复用 prompt cache」意图。真实场景（200k context）下 780 tokens 影响可忽略，只有测试的 4000 小窗口才触发，属可接受的行为差异，不修（改 deliver 排除 system 或调 fit 都是侵入上游逻辑）。

## 权限 / 破坏性命令拦截

- shell 工具每条命令都会过 ShellParse.scan → permission.assert（tool/plugin/shell.ts），resource 是完整命令文本；PowerShell 下 portable 扫描器会拆分复合命令，但管道/脚本块内嵌的调用可能不单独成命令（已知局限）。
- 权限配置格式：opencode.jsonc 顶层 permission.<action> 是 {模式: ask/allow/deny}，last-match-wins（键序即策略，v1/config/permission.ts）；匹配用 util/wildcard.ts，Windows 下大小写不敏感（si 标志）、反斜杠归一化为 /，所以小写 "rd *" 能匹配 "RD ..."。
- 默认放行来自 Agent.Info.default() 的 {action:"*",resource:"*",effect:"allow"}；config 规则在 all=[...agentRules,...savedRules] 里靠后、findLast 后写优先，所以 config 里的 ask 能压过默认 allow。
- 「自动接受权限」是纯客户端行为：auto-approve.ts 监听 permission.asked 一律回 once（无过滤），且 requests/model.ts 的 permissionRequest 在 autoApproves 时直接 return undefined 隐藏弹窗。
- 已实现（2026-10-26）：① opencode.jsonc 的 permission.shell 给 rm/rd/del/erase/ri/Remove-Item/rmdir/unlink/shred 加 ask、根目录 rm -rf 加 deny；② 新文件 session/requests/destructive.ts 的 isDestructiveShell（正则前缀匹配）；③ auto-approve.ts 的 approve() 入口对命中请求跳过自动批准；④ model.ts 的 permissionRequest 在自动接受开启时仍显示破坏性请求（否则跳过后不可见、会话卡死）。两层必须同时改，共享同一判断。
- 事故根因（Greeting 会话）：模型在 PowerShell 脚本里定义 function RD 想当 Read 用，但 RD 是 Remove-Item 内置别名且别名优先级高于函数，所有 RD <路径> 变成删除；配置拦截只能挡直接命令，挡不住这种脚本块内嵌调用——彻底解决要靠删除走回收站的专用工具（未做）。

## 会话时间线 / 指令更新通知

- 「指令已更新 core/codemode, core/git-status」通知（独立 notice 行 + 分组折叠头「✓ 更新 …」）的链路：core 每次模型请求前 InstructionState.prepare 重读指令源（llm.ts:232）→ agent 干活时工作树变化使 core/git-status（builtins.ts:73，SiCode 自加的 git 快照）和 codemode 工具目录产生 delta → SessionEvent.InstructionsUpdated → message-updater.ts:151 生成 system 消息 → UI 两处渲染：session-timeline-row.tsx notice() 的独立行、tool-renderer.tsx:533 纯 notice 分组折叠头（label=ui.messagePart.context.updates「更新」+summary）。
- 该 system 消息同时是模型上下文的一部分（history.ts messageEntries 不过滤 system，模型靠它获得更新后的 git 状态），所以只能做 UI 抑制、不能删 core 事件。
- 已改：projection.ts 新增 isInstructionUpdateNotice()（system + metadata.notice==="instructions" 或 description 以 "Instructions updated: " 开头的旧格式），在全部三个 Notice 行发出点拦截——visibleNotice()（leading + turn entries 两处）和 constructMessageRows 的 case "notice"（651 行）。分组折叠从已发出行聚合，行不发出则胶囊也不会出现。
- 验证：session-ui typecheck 237 文件全绿，timeline 88 测试全过；CDP reload 后 DOM 探针确认「指令已更新」「core/codemode」在渲染页面中零出现（历史消息同样被抑制）。

## 后台终端 / Shell 生命周期

- 生命周期现状：进程句柄 scope 绑定（`shell.ts` create 的 `Effect.scoped` 管理 fiber），显式 `remove(id)` 或服务 finalizer（server 优雅退出）都会杀进程；已退出的 shell 内存保留 `EXITED_LIMIT` 个，输出文件 `sh_*.out` 每小时按 `RETENTION`（7 天）清理（`Shell.cleanup`）。
- 缺口（2026-10-26 补了两个）：① 会话删除不联动——`Shell.remove` 全仓库只有 shell 工具中断时一处调用，shell 是 location 级节点、metadata 记了 sessionID 但无人消费；已修：Shell 服务订阅 `SessionEvent.Deleted`，按 `metadata.sessionID` 匹配 `removeCommand` 回收（`shell.ts`，订阅模式照 `websearch.ts:94` 的先例）。② 模型发起的 background 命令 `timeout ?? 0` 永生；已修：`DEFAULT_BACKGROUND_TIMEOUT_MS = 24h`（`tool/plugin/shell.ts` 的 `resolveTimeout`，显式 timeout 优先、显式 0 仍表示不限时）。
- 刻意不动的：用户在前台命令上手动「转后台」的路径仍 `shell.timeout(id, 0)` 清除超时（用户意图优先）；`SessionShell.start`（用户开的终端）timeout 0 不受影响。
- 残余风险：Unix spawn `detached: true`，server 被 SIGKILL/崩溃时 finalizer 不跑，后台 shell 仍会孤儿化；启动时清前代 pid 的方案没做（需 pid 追踪，改动更大，暂缓）。
- 卡住的后台命令原先对模型是黑洞：完成前只有「moved to background」一句话，模型被指示不轮询，静默卡死时 24h 兜底超时之前不会有任何唤醒（2026-10-26 补齐）。三层机制：① 静默看门狗——`watchForStall`（`tool/plugin/shell.ts`）对后台 shell 每 `stallTimings.pollMs`（30s）轮询捕获 size，静默满 `notifyMs`（5min）注入一条 synthetic 通知，带最近输出（`tail`，同 tool_output 截断规则）+ shellID + 判断指引；每次静默段只通知一次，新输出会重新武装（常驻的 dev server 只被打扰一次）。② kill 能力——shell 工具新增可选 `kill` 字段（传 shellID），走 `Shell.remove` 走 scope 绑定的进程句柄杀，比让模型拼 taskkill/kill 可靠（Unix detached 子进程杀不干净）；`command` 随之改 optional，command+kill 同传报错。③ 通知形态——`ShellResult.notification` 的 state 联合加了 `"running"`。测试：`tool-shell.test.ts` 的 kill/静默通知两条，`stallTimings` 可变对象供测试缩短间隔。
- 跨会话感知（2026-10-26 补）：shell 池是 location 级、模型层会话间完全隔离（WorkBuddy 也是这个分层：UI 全局可见 + 模型互不知 + 异步通道）。补了后台命令的启动时播报 `peerNotice`（`tool/plugin/shell.ts`）：后台化瞬间用 `shell.list()` 过滤掉自己与同 sessionID 的 shell，其余按 command 分两档——相同命令报 "identical...may conflict"（撞车警告），不同命令列 "Other commands already running in this project"（含 shellID）。用户手动终端（SessionShell）无 sessionID 也会被算作 peer，属预期（正是人肉占端口的真实撞车场景）。前台命令刻意不做（碰撞窗口只有秒级）。测试用裸 `shell.create` 伪造异会话 peer，无需真开第二会话。

## 会话时间线 / 问题工具已回答块

- 问题工具的已回答块（tool-renderer.tsx 的 question 渲染器 + message-part.css 的 [data-component="question-answers"]）已从"灰字+绿竖线"改为过程壳行语言：每个问答对渲染成 question-row / answer-row 两行，各带 19px 图标列（help 问号 = faint，check = success 绿），与父行图标列同列对齐；文字色阶 faint/muted/base，字号行距走 --process-shell-* token，与过程链行同构。
- 对齐验证：CDP 向真实时间线注入探针 DOM（含 data-component/data-slot 完整结构）后同步取 getBoundingClientRect——三列图标 x 坐标全部 261（宽 19），与 work-shell-head 图标列（x=266，含 4px 自身内边距）对齐；颜色 computedStyle 确认走 token。探针截图不可靠（Solid 重渲染/虚拟化会挪动），量几何比截图靠谱。
- 注意：真实会话里复现该块很难（虚拟化 + 多 tab + 会话轮次折叠），注入探针法是验证这类时间线样式的可行替代。

## 会话时间线 / 过程壳间距

- 虚拟化时间线里行与行之间没有 gap（session-turn-message-container gap 0px、context-tool-group-list gap 1px），间距全靠 prose 自身 margin——所以两个过程壳面板背靠背时贴脸（实测 2px，全是边框），隔了文字的反而 40px+。
- 修复：message-part.css 给 [data-component="collapsed-tool-group"][data-process-shell] 加 margin-block-end: 8px，统一尾部呼吸。链表内 pitch=8+1=9px，消息级=8px，肉眼等距。margin 会被算进行高（中间全是 flex column 容器，BFC 不塌陷），虚拟化测量安全。
- 验证：CDP 注入三连探针面板，测得相邻间距 [8,8] 等距；真实窗口重启后无面板挂载时，注入探针法是验证时间线样式的可靠替代。

## 会话审查面板

- HTML artifact 内嵌渲染（2026-10-26 落地）：agent write `.html/.htm` → 正文流末尾自动出 artifact 卡（sandboxed iframe `allow-scripts` srcdoc，无 origin）。结构：
  - `session-ui/src/timeline/artifact.ts`（新）：`htmlArtifactsForTurn(messages)` 按 path 去重（Map 首插序，同 path 最后一次 write 赢），快照 = write 工具 part 的 `input.content`（持久化，重启后历史不回写）。
  - `timeline-row.ts` PartGroup 加 `type:"artifact"` 变体（ref 指向 write part，`hasNewer` 分轮标注）。**联合类型扩成员会打漏所有 `type === "part" ? ref : refs` 式窄化**——projection.ts 4 处、rows-current.test.ts 1 处、app 层 message-timeline.tsx 2 处、virtualizer.tsx 1 处都要补。
  - 投影插入点：`constructMessageRows` 的 Thinking push 之后、`lastStep` 守卫之前；hasNewer 后处理在 `constructSessionMessageRows` return 前（rows.map 重建 AssistantPart，别 spread TaggedClass——显式传字段）。
  - 卡片：`components/artifact-card.tsx` + css（styles/index.css 的 layer(components) 里没挂，css 直接组件 import）；iframe 320px 固定高（虚拟行测高稳定），>512KB 显示占位；流式中显示占位不喂 srcdoc（防逐 token 重渲染）。i18n `ui.artifact.*` 加在 en.ts/zh.ts，其它语言 spread en 回退。
  - 旧卡「有新版本 ↓」跳转用 `scrollIntoView` 找 `[data-artifact-path]:not([data-has-newer])`——虚拟行没挂载时找不到，v1 接受。
  - v1 只触发 write；edit 触发需文件读取服务注入（session-ui 够不到 app 的 files 服务，要加 resolver context），未做。
  - 验证：`?doc=artifact` fixture（两轮 write 同一 html）预览壳实测两卡渲染、快照正确、hasNewer 标注正确；截图 `.preview-shell/artifact-verify.png`。`bun test` 全量 22 errors 是 Playwright 文件被 bun 误扫的预存问题（stash 验证过），artifact.test.ts 4 pass + rows-current 55 pass。
  - **未验**：桌面端 Electron 的 CSP 是否允许 srcdoc iframe——预览壳（纯 Chromium）过了，桌面要真机确认。
- artifact 自适应补齐（2026-10-26，紧接上条）：两层适配——
- ① 卡片层：宽度本就流式（iframe 占满容器）；高度从固定 320 改为三档循环（320/560/840，头部 ⤢ 按钮，切换后 `queueMicrotask` 里调 onSizeChange 让虚拟行重测高）；头部 ⛶ 打开放大弹层（`useDialog().show()`，90vw×86vh 的同 sandbox iframe，照 image-preview 的模式）。历史卡（hasNewer）不给这两个按钮。
- ② agent 层：write 工具描述追加一段（`core/src/tool/plugin/write.ts`，SiCode 注释）——写给人类看的 HTML 会被嵌进 ~600×320 的内嵌框渲染，页面必须响应式（流式布局、相对单位、固定宽度不超过 ~600px）。
  - 坑：Solid 的 signal 在 JSX 里当索引要 `heights[mode()]`；测试里 mock 工具 part 缺 `time` 字段，`as SessionMessageAssistantTool` 直接转会被拒（类型不充分重叠），要 `as unknown as`。
  - 实测：宽度 card 616/frame 615 占满；高度循环 320→560→840→320；放大弹层 798×833（90vw×86vh）且图表自适应填满。截图 `.preview-shell/artifact-expand.png`。验法 `.preview-shell/verify-resize.mjs`。
- artifact 滚动条 + 侧抽屉（2026-10-26）：①iframe 内滚动条——沙箱文档进不了外部 CSS，但 srcdoc 我们可控：`decorateArtifactHtml()` 在 `</head>` 前注入 8px 圆角药丸 `::-webkit-scrollbar`（中性半透明灰，亮暗 demo 底都可见）+ Firefox `scrollbar-width:thin`；无头浏览器截图拍不到 overlay scrollbar（拍不出≠没生效），注入已实测进 srcdoc。②⛶ 从居中大弹层改为**右侧抽屉**（WorkBuddy 式）：Kobalte Dialog.Content 定位 `inset-inline-end:0` 宽 min(620px,92vw)，会话在左仍可见；照 image-preview 的结构（Kobalte.Content + CloseButton）。**真并入 app 侧栏 region（review-panel 的 tab 系统）是后续项**——要动 app layout 状态机，当时有并行会话在改 app/core，避开。
- **并行会话覆盖事故（又一次）**：改 projection.ts 中途 tsc 突然报 `isHiddenProcessNotice` 未定义——另一会话用旧 buffer 整文件覆盖了 projection.ts（我的 artifact 插入一度丢失），稍后其自身又写回包含双方改动的版本。教训重复：多会话并行时改共享文件前后都要 grep 关键标记 + tsc 裁决，别信单次读到的状态。

## 设置

- 设置页 TRAE 风格改版（2026-10-26）：结构不变（左竖导航+右内容），纯视觉重排。settings.css：侧栏面板化（bg-layer-01 + 右 0.5px 分隔线，padding 20/16/24，原 50/24/64）；back 键整行+底部细线；新增 .settings-account 品牌卡（navigation.tsx，仅根设置页 searchable() 显示，Mark 头像+SiCode/Desktop 占位，无账号体系）；导航项 28→30px 高、radius 6、gap 10；组标签 12px faint。内容：settings-tab-title 15→18px；settings-section gap 16→10、标题 12.5px/560 带 2px 左缩进；settings-list radius 10、padding-inline 16；行 padding 20→14（catalog 变体仍 16）。general.tsx 偏好设置页拆三卡：常规(语言/标签页/默认环境+扩展段)/权限(自动接受)/输入(智能体/终端位置/后续消息/双指缩放/移动端标题栏)；i18n 加 settings.general.section.permissions、.input（en/zh，其余语言回退 en）。验证：CDP 实截 偏好设置/外观 两页正常；tsc -b 通过（bun check 报 artifact-card.tsx:81 Accessor 索引错误是 oxc 误报，真 tsc 无错）。
- 侧栏大空隙：设置布局原来是 `justify-content: center` 整体居中，窗口一宽工具栏和侧栏面板之间就空出一大块（实测 95px）。修复：`.settings-screen > .settings` 加 `margin-inline-end: auto` 贴左，侧栏紧贴工具栏（x=68）。
- 权限卡补第二行：演示稿承诺的「破坏性命令确认」开关此前没落地（拦截逻辑写死在 auto-approve.ts）。现已做成真设置 `settings.general.destructiveConfirm`（默认开）：关掉后 rm/del 等删除命令跟随自动接受。改 model.tsx（schema+default+context）、auto-approve.ts、requests/model.ts（弹窗显示同步）、general.tsx、i18n en/zh、search-catalog、model.test.ts。
- 注意：本机 dev 的渲染层是 electron-vite 预打包的 `/assets/main.js`（inline style 注入），CSS/tsx 改完 HMR 不一定推进页面，需要整页重载甚至等 watcher 重建；CDP 排查时先确认页面里跑的是不是新规则。多个窗口连 9333 时，`/json` 第一项不一定是应用窗口（可能是 .sicode 下的 demo 页），要按 url=localhost:5173 挑。
- 存量测试失败 3 个（stash 验证过与本次无关）：search-results.test.ts 两个（项目头像/排名）、timeline controller-projection 一个（steer）。

- 三处布局回归都来自 `08cb2c99ed0` 的 TRAE 式侧栏改版：侧栏从「透明 + 64px 尾随内边距」换成「layer-01 面板 + 0.5px 右分隔线 + 24px 尾随内边距」，而内容列仍是按旧的透明侧栏算的。修于 `73966553a6`。
- 内容列：`.settings-content` 上游 `max-width: 720px`，外层 `.settings` 限宽 `1048` 且被 `margin-inline-end: auto` 顶到左边——1280 窗口下右侧空 152px。现在 `.settings` 取 100%，列宽由内容列自己管（880 + `margin-inline: auto`），宽屏时两侧对半分。
- 内容列内边距：`.settings-screen .settings-tab-header { padding: 48px 0 0 }` 和 `.settings-tab-body { padding-inline: 0 }` 上游就是 0，以前没有分隔线所以看不出来；侧栏有了边线后标题和卡片直接压线。改成左右 32px（`packages/app/src/settings/settings.css:63` 附近）。
- 侧栏导航：`.settings-nav { width: 240px }` 原本正好等于「328 - 24 起始 - 64 尾随」的内容宽；尾随改成 24 后内容宽变 288，导航仍是 240，选中胶囊离面板右缘差 48px。改成 `width: 100%`（移动端断点本来就是 100%，现在两边一致）。
- 设置页没有 storybook fixture：`SettingsNavigation` 依赖 `useSettingsSurface`（router + layout + servers），`SettingsSearch` 还依赖 command/global，静态复刻脚手架很容易失效。要目测就起桌面端。
- 外链点击链路（2026-10-29 排查）：`marked` 产出 `<a class="external-link" target="_blank" rel="noopener noreferrer">`（裸网址也自动成链）；DOMPurify 保留 href/target；桌面壳 `windows/security.ts` 的 `wireNavigationPolicy` 同时接了 `setWindowOpenHandler` 与 `will-navigate` → `openExternalURL` → `shell.openExternal`；两个窗口创建点（early.ts / windows/index.ts）都调用。**用裸 Electron 探针验证过** `setWindowOpenHandler` 对 `target=_blank rel=noopener noreferrer` 会触发（`artifacts/link-probe.cjs`）。所以链路本身是通的。
- 原来唯一的问题：这条链路**在 app 里没有主人**——渲染层完全不处理链接点击，成功时没有任何痕迹、失败时也没有反馈，因此既不可测也改不动。新增 `packages/session-ui/src/components/markdown-external-links.ts` 的 `setupExternalLinks()`（挂在 markdown 容器的 click 上，取 `a.external-link[href]` → `history/replace` 不走，直接 preventDefault + 调 host 的 `openExternal`）。host 回调走 `MarkdownProvider` 新增的 `openExternal`，app 侧在 `shell/routes/session-ui-provider.tsx` 接 `platform.openExternal`（桌面 = IPC → `shell.openExternal`，web = `window.open`）。host 没给 handler 时不 preventDefault，web/分享页行为不变。改键点击（cmd/ctrl/shift/alt）与次要键放行给平台。单测 `markdown-external-links.test.ts` 5 条（happy-dom）。
- 顺带发现的真空洞：主会话的 `MarkdownProvider` **没有传 `openLocalFile`**（只有 `runtime/extension/render.tsx` 的 ExtensionLinks 传了），所以正文里指向本地路径的行内链接（`src/app.ts` 这类）点了没反应，`data-local-links` 属性也不会被打开。没动，因为接上会把路径型行内代码变成可点样式（视觉变化），需要用户拍板。
- 内置浏览器开外链目前**做不到**：`gui-extensions/src/browser/contract.ts` 的 Browser 契约只有 `openFile(session, path, {select})`，没有 openURL。要做得加契约方法 + model.openURL + layout select + 设置项 + i18n，属新功能。
- 设置面板加一个「链接打开位置」的正确落点：`packages/app/src/settings/general/general.tsx` + `settings/model.tsx`（照 workspaces.defaultDestination 的写法：Select + 持久化），i18n 三份，另有 `settings/search-catalog.ts` 需补条目。
- 「链接打开位置」设置（2026-10-29 落地）。两档：`system`（默认，系统浏览器）/ `browser`（桌面侧边浏览器面板）。存在 `settings.general.linkTarget`（`packages/app/src/settings/model.tsx`，`Persistence.optional` + `withFallback`，默认 `"system"`），UI 在 `settings/general/general.tsx` 的 `LinkTargetSetting`（Select，仅 `platform==="desktop"` 渲染），i18n en/zh 四条（含 `linkTarget.unavailable` 回退提示），搜索目录 `settings-link-target`。
- 路由只有一个入口：`packages/app/src/shell/routes/session-ui-provider.tsx` 的 `openLink()`，经 `MarkdownProvider.openExternal` 交给 session-ui。规则：只有 `http(s)` 且用户选了 `browser`、且 browser 契约 `status==="active"`、且 `canOpen(session)` 为真，才走 `pane.open(session, url)`；其余（mailto、web、窄屏、面板没打开过）一律回落系统浏览器，并在**首次**回落时弹一条 toast 说明原因（`warnedSideBrowser` 每次运行只提示一次）。
- 契约层不需要新增方法：`Browser.open(session, url)` 早已存在（`browser/renderer.tsx:52` → `model.openURL` → `command(tabs.open, {url})`）。**但 `canOpen`/`openURL` 都要求 pane 已 attach（`registration` 或 `browser` 状态存在）**，也就是这个会话的侧边浏览器至少被打开过一次，否则命令无处可发。这是侧边浏览器方案的硬前提，也是回退提示存在的原因。
- 取舍：默认系统浏览器。理由是链接的语义是「去别处」，用户要的是自己的登录态与扩展；侧边面板适合不想离开应用的少数场景。`⌘/Ctrl/Shift/Alt + 点击` 始终交给平台（不拦截）。
- 验证：app tsc 干净、`vite build` 通过（产物 `shell-*.js` 含 `settings-link-target`）、单测 779 pass / 3 fail（与改动前基线一致：settings search ×2 + visibleTimelineMessages ×1）。
- 侧栏底部大片留白（2026-10-29 修）：`.settings-nav` 是 100% 高的 flex 列，但 `.settings-nav-groups` 只有内容高、没有吃剩余空间，导航组（含「关于」）因此全堆在顶部，下面空一块。改版演示稿 `.sicode/demos/settings-trae-demo.html` 里是用 `margin-top:auto` 把「关于」压在底部的，实装时漏了这一步。修于 `packages/app/src/settings/settings.css`：`.settings-nav-groups` 加 `flex:1`（超长时这一层自己滚）、`.settings-nav-group:last-child` 加 `margin-top:auto`、`.settings-nav-group` 加 `flex-shrink:0`（防止溢出时被压扁）。移动端断点 `.settings-nav { height:auto }`，auto 外边距退化为 0，不受影响。

## artifact 侧边预览

- 二次改向（用户拍板）：demo 打开不走自制 Kobalte 抽屉，走**内置侧边浏览器 pane**（gui-extensions/src/browser）。
- 链路：session-ui `ArtifactPanel`（components/artifact-panel.tsx）检测新 write .html → 注入的 `open(path)` 回调 → app message-timeline.tsx 经 `useExtensionHost().context("browser")?.uses.browser` 拿 Browser 契约（file/renderer.tsx:569 同款模式；`uses` 在公共 Context 类型上没有，需 cast instance context）→ `openFile(session, path, {select:true})`。
- 契约扩展：Browser.openFile 加 `options.select`——model 记 `entry.openingURL`，desktop inventory 回报新 tab 时 `strip.open` 用 `{tab:"select"}`（把 side region 拉起并选中）而非默认 append；command failed 清 openingURL。
- 去重：同一路径重写不再重复 open（ArtifactPanel 的 opened Set），浏览器里 F5 即最新；否则 v2/v3 会堆 tab。新路径（另一个 demo）才开新 tab。
- fallback：web / SSH 远程（canOpen 要求 server.builtin）/ 浏览器扩展禁用时退回自制抽屉（dialog id="artifact"，v2 会替换内容）；预览壳 SessionTimeline 未注入 open，恒走抽屉。
- .sicode 目录整理：demos/（html demo）、shots/（截图）、scratch/（mjs 脚本+测量 json），根目录只留 notes.md/structure.md；约定写进 structure.md（project-map 注入 prompt，agent 自觉遵守）。context-plan/design-demo 两文件被 git 跟踪，用 git mv 保留历史。
- 实测修复（用户报：同文件更新又开新 tab 不刷新）：`openURL`（browser/model.ts）对 file:// URL 先查 `attachment.browser.tabs` 同 URL 标签（`sameURL` decode 后比较，防 encode 差异），命中则 `reload` + `layout.open(select)` 原地刷新并拉起面板，不再 tabs.open；http(s) 保持浏览器新 tab 语义。
- 这层复用治所有链路：artifact 自动打开、agent 的 browser.preview 工具（preview → links.open → file LinkHandler → pane.open → openURL）、点消息里的 html 链接。
- ArtifactPanel 的 opened Set 去重随之撤掉：同路径重写照样触发 open（pane 层变 reload）=「更新即刷新」；seen 仍按 partID 防同 part 重复触发。
- 检测层从「只认 write」扩到「write + edit」：`artifact.ts` 的 `latestHtmlChange(messages)`（原 latestHtmlArtifact/htmlArtifactsForTurn 已删）。write 带 content（抽屉快照），edit 的 content 为 undefined——文件已落盘，pane 直接 reload 磁盘，无需快照。
- ArtifactPanel 语义：**只有 write 能打开新页面**；edit 仅刷新 `opened` 集合里已开过的 path（防止模型编辑某个无关 html 时莫名弹浏览器）。400ms trailing 防抖合并连续步骤（demo 分步构建时不会每步闪一次）。
- 模型分步写 demo 属正常行为（write 是整文件覆盖，每次都是完整重写）；以前每步触发一次打开/刷新 = 体感「一直闪」，且模型若改用 edit 微调则面板完全不刷新（旧 bug，已修）。

## 模型与变体

- 输入框里的「思考程度」滑块 = `packages/app/src/composer/editor/editor.tsx:359` 的 `SteppedSlider`，只在 `view.variant.options().length > 1` 时渲染。options = `["default", ...model.variants 的 id]`（`packages/app/src/composer/model.ts:271`），所以模型没有 variant 就整个不显示，不是被藏起来了。
- `model.variants` 由 config 决定：上游 `d889cb2044`（feat(core): read model reasoning from config）之后，`capabilities.reasoning` 一旦出现在配置里就会**替换**默认变体，改用 `Variant.supports()` 解释。`Variant.supports` 只认 `toggle` / `effort` / `budget`（`packages/core/src/variant.ts:13`），只写 `{"supported": true}` 会返回空数组 → `Variant.resolve` 得 `[]` → 滑块消失。要恢复就写 `"reasoning": { "supported": true, "effort": ["low","medium","high"] }`（官方文档 `services/www/src/docs/content/models.mdx:126` 起就是这个形状）。
- 同一个提交前，配置没写 reasoning 时会走到 `Variant.resolve(model)` 的默认参数 `[{type:"effort"}]`，openai-compatible 包按 `EFFORTS = ["low","medium","high"]` 铺满——这就是「之前有、现在没了」的原因。
- `openai-compatible` + modelID 含 deepseek 时，`effort === "none"` 会额外发 `body.thinking = { type: "disabled" }`（`packages/core/src/variant.ts:90` 的 SiCode 注释）。所以配置里把 `"none"` 加进 effort 数组能拿到真正的「关掉思考」档，其余档位发的是 `reasoningEffort`。

## Cursor 决策逻辑对照

- 四道决策（问/答/查/写）对照落在 artifacts/agent-decide.html；能力维度对照是 artifacts/agent-compare.html（两者别混）。
- 问：SiCode 默认 `{action:"*",resource:"*",effect:"allow"}`，仅 `.env` 读 ask（schema/src/agent.ts:46）；Plan agent 硬只读（core/src/plugin/plan.ts:39 `edit:* deny`）。Cursor 是 auto-run 可配 + 危险确认 + Ask/Plan 三模式 → 结论：默认值不跟，只留「危险命令 ask 规则」的口子。
- 查：SiCode grep/glob + trigram（top5 65%，notes 实测），无语义索引/无自动注入；Cursor 是 Merkle+embedding 索引 + 自动注入。结论：**先补自动注入（塞最后一条 user message，别动 system 前缀），索引层继续 trigram**。
- 写：已对齐（edit 精确匹配 / write / patch 三工具全模型族）；不跟 Cursor 的 apply 容错层。
- 答：SiCode 主 prompt 35 行 + 3 条动态工具指引（core/src/session/system-prompt.ts:10），无策略规则；结论：不加长 system prompt（打断 cache、模型族迁移成本高），引导放工具 description。
- 「问」已落地：`schema/src/agent.ts` 默认权限追加 13 条 shell ask 规则（rm -rf/-fr/-r、sudo rm -rf、rmdir、git push --force/-f、git reset --hard、git clean -f、del /f、del /s、format）——放 `allow *` 之后由 findLast 覆盖。单文件 `rm` 故意保持 allow（日常清理，弹窗成本 > 收益）。
- 规则命中已实测：`Wildcard.match` 13/13 命中目标命令、4/4 不误伤 `rm tmp.txt`/`git status`/`del tmp.txt`。注意 `resource` 是 shell 解析后的**单条子命令全文**（`shell.ts:161` 传 `parsed.commands[].resource`），不是整条 shell 字符串。
- 客户端链条自动复活：请求一产生 → `session-permission-dock` 弹窗；`destructiveConfirm`（默认 true）在 `auto-approve.ts:154` 阻止破坏性命令被自动接受。

## 上下文注入

- 新模块 `core/src/session/context-hints.ts`：把用户请求里提到的文件名/路径/标识符反查出候选文件，作为「线索」注入模型上下文。轻档实现（只给路径，不给内容）。
- 接线点：`core/src/session/context.ts` 的 `load()`——它返回的 messages 只喂给本次请求的 `baseTranscript`，不写库，所以 hint 天然不进历史、不进 compaction、不污染 system 前缀（prompt cache 不动）。
- 注入物 = 一条 `SessionMessage.Synthetic`（`metadata.notice = "context-hints"`），插在最后一条 user 消息之后；`toLLMMessages` 把它转成一条 role:user（`to-llm-message.ts:292`），所以 provider 交替规则/合并由现有适配负责。
- 触发条件（纯函数 `taskStart`）：最后一条消息是本轮 user、其后无 assistant/shell、文本 ≥12 字；进程内 Set 按 messageID 去重（重启最多重复一次）。
- 检索：`FileSystem.Search.find`（fuzzysort 内存索引，每 10s 至多一次 ripgrep 全仓刷新；5 个词并发只触发一次 refresh）。
- 抽词 `hintTerms`：反引号 > 路径 > 带扩展名文件名 > 带大小写/数字信号的标识符；NOISE 停用词表挡常见英文词；上限 5 词 / 6 文件。
- UI 零改动：hint 从不 publish 到 store，时间线里不出现，不需要投影过滤。
- **ripgrep 取不到时整回合死掉（2026-10-29 修）**：`context-hints.ts` 的 `lookup` 用 `Effect.orElseSucceed` 兜查找失败，但 `ripgrep.ts:162` 是 `yield* failure(...)` —— 在 Effect 里抛 Error 进的是 **defect 通道**，`orElseSucceed` 看不见。后果不只是测试红：一台没有网络的新机器首次启动（`global.bin` 里没有 rg.exe）时，**每一个回合都会因为取不到 ripgrep 而整体失败**。改成 `Effect.catchCause`（failure + defect 都吃）。`layer` 一并导出，测试才能注入会 die 的 Search。
- **测试侧**：runner 测试的 layer 图经 `Session.node` 拉到 context-hints → Search，默认 Search layer 用 ripgrep 扫全仓建索引（本仓实测 250ms，可接受），但测试环境临时 `XDG_CACHE_HOME` 里没有 rg，框架的网络守卫又把「尝试下载」记为失败 → 97 个用例红。修法是在 `replacements` 里把 `FileSystemSearch.node` 换成返回空数组的 stub（没有 rg 的仓库本来也拿不到线索，这是诚实替身）。修完 234 过 / 1 败，与基线逐条一致。
- **教训**：任何接进请求路径的可选增强，都要把「依赖不可用」当成必然分支而不是异常——`orElseSucceed` 只兜 error channel，要 `catchCause`。另外别在后台跑全量测试时并发跑别的包测试，Bun 会段错误（RSS 峰值 1.19GB）。
- **demo 页面不再起 localhost server（2026-10-29 落地）**：真实会话里模型亲口说「本地文件不能直接用浏览器标签打开，我起一个临时静态服务来渲染验证」，然后 `python -m http.server 8722 --bind 127.0.0.1` 后台起服务（数据：`browser.preview` 调用 0 次、`browser.openFile` 0 次、起 server 1 次——模型根本不知道 preview 存在）。而 `browser.preview`（rpc.ts:204，HTML/图片/SVG/PDF 都支持）和 desktop 侧 `openFile`（contract.ts，file:// 标签）一直都有，chromium.ts 的 `fileRoots` 就是放行 file:// 文档的。修法两层：① `system.txt` 的 Communication 区加静态禁令（所有模型都读得到，不起 server 展示静态页面，server 只留给真需要后端的）；② `system-prompt.ts` 的 `render` 按 `tools.includes("browser.preview")` 注入三条指引（用 preview 展示 / 自验渲染先 preview 再 screenshot / 同一文件只 preview 一次别开第二个标签）——沿用该文件既有的「按工具存在性注入」模式，web 模式没有 browser 工具就不注入。测试 `test/system-prompt.test.ts` 5 条锁住两边行为。

## 会话时间线 / 回合产出

- 回合末尾那块「更改的文件」不是常驻：行由 `packages/session-ui/src/timeline/projection.ts` 的 `constructSessionMessageRows` 在 `idle` 时插入，条件是 `turnDiffs && execution.files.size`；`turnDiffs` 来自设置 `general.showTurnDiffs`（`packages/app/src/settings/model.tsx`），2026-10-27 起默认 true。
- 原来文件只有一个源：`message.snapshot.files`。快照只在 git 仓库启用（`packages/core/src/snapshot.ts:114`：`enabled = () => location.vcs?.type === "git" && state.get().enabled`）。所以非 git 目录的会话 0 条快照，`files` 恒空，行根本不会插——对话产出了文件，末尾什么也没有。
- 回退数据源是工具结果，不是快照：`edit` / `patch` 的 `state.metadata.files` 就是 `FileDiff.Info[]`（`packages/core/src/tool/plugin/edit.ts:279`、`:319`、`patch.ts:308`）；`write` 的 `metadata.files` 只传给了 permission assert（`write.ts:88`），工具结果里没有，必须拿 `input.path + input.content` 用 `createTwoFilesPatch` 自己造，status 只能恒为 `added`（无从判断是否覆盖已有文件）。
- 渲染侧有三层：`TimelineRow.TurnDiff.diffs`（新增，可选回退）→ `session-timeline-row.tsx` 里 `diffs()` 优先取 git 路由结果，非空才用，否则退回 `row.diffs`，都没有才落到只有路径的 `pendingFiles`。`Show` 条件已改成只看 `paths().length > 0`，不再要求 `data.turnDiff` 存在（storybook / 无该 provider 的宿主也能渲染）。
- 验证方法：直接读 `~/.local/share/opencode/opencode-local.db` 的 `session_message.data`，看 assistant 消息有没有 `snapshot`，以及 write/edit 的 `state.metadata.files`。
- **write 现在自己报 diff（2026-10-27，提交 fbc1fb697e）**：`packages/core/src/tool/plugin/write.ts:34` 的 `Output` 加了 `files`（可选 `FileDiff.Info[]`），执行尾部按 `edit` 的写法对**格式化后**的文本调 `fileDiff(resource, current?.text ?? "", formatted, current ? "modified" : "added")`，`Effect.map` 里带 `metadata: { files: output.files }`。原来本区记的「write 的 metadata.files 只传给 permission.assert、工具结果里没有，必须拿 input 自造、status 恒 added」已作废 —— 那是 2026-10-27 之前的状态。
- 为什么必须是格式化后的文本：`formatter.file` 会改写落盘内容（BOM sync / 格式化器），diff 打 `input.content` 会和文件实际内容对不上。`preview` 变量仍是**审批时**的 diff（`permission.assert` 的 `metadata.files`），两者不是一回事，别合并。
- `files` 用 `Schema.optionalKey` 而不是必填：旧会话的 write output 没有这个字段，必填会让历史消息解码失败（`edit` 的 Output 一直是必填，所以那边可以直接引用）。
- UI 侧不用改：`packages/session-ui/src/timeline/projection.ts:95` 的 `toolFileChanges` 和 `tool-renderer.tsx` 的 `CurrentFileToolGroup` 本来就是「metadata.files 优先、没有才从 input 推」，write 带上字段后自动走前者；from-input 分支只服务加字段之前的旧消息（status 只能 `added`）。
- 回归：`packages/core/test/tool-write.test.ts` 三条（创建 added / 覆盖 modified 且结果 metadata 有值 / 格式化后 patch 含大写内容），`packages/session-ui/src/timeline/rows-current.test.ts` 的「takes a write's reported diff over the one rebuilt from its input」。
- **UnsupportedContentType 报错的真正含义（2026-10-28）**：promise 客户端（`packages/client/src/promise/generated/client.ts` 的 `json()`）在响应 content-type 不是 JSON 时抛 `ClientError("UnsupportedContentType")`。旧服务进程没有新路由 → 404 空 body → toast 显示的就是这个词。所以看到它 = 「服务端没这个端点/响应不是 JSON」，先怀疑进程没重启，不是协议错。
- **「问题 已回答 N 个」卡片（645f51c57c）**：question 在 projection 里被有意排除出过程分组（`toolGroupType` 对 question 返回 undefined），以 BasicTool 裸渲染。现在 `tool-part-wrapper` 带 `data-tool={props.tool}`，CSS 用 `[data-component="tool-part-wrapper"][data-tool="question"]` 借用过程壳的面板语言（同 border/radius/fill，trigger padding 5px 左对齐 19px 图标列）。dismissed 分支没有 collapsible，不会被卡片化。

## 收工闸门 / 最终回答

- 新增 `core/src/session/runner/final-answer-gate.ts`（纯函数 `unansweredPrompt`）+ `llm.ts` 的 `Completed` 分支挂载（`completion-gate` 之后）。回答「改了文件却一句话不说」：`edit`/`write`/`patch` 成功执行且本轮零 assistant 文本 → 注入 `FINAL_ANSWER_PROMPT` 并强制再走一步。
- 触发条件三连（缺一不触发）：最后一条 user 消息之后无 text part；存在 `state.status === "completed"` 的写类工具；未到步数上限。一次/prompt（`answerNudged` 按 prompt messageID），避免空转；steer 是新 prompt，各自检查。
- 只读静默**故意不管**：那是 `explore-budget` 的职责（软 12 / 硬 24 步）。读了一堆不说话不算本次要治的形态。
- 失败/被拒的写入不算改（`providerExecuted` 的 write 被 deny 时不触发）——`test/session-runner.test.ts:3709` 的 projection 用例正是这个形状。
- 顺带统一：`Completed` 分支里 todo 闸、回答闸、`compaction.precompute` 共用一次 `store.context(sessionID)` 快照。原来 todo 闸读 `loaded.messages`（步前快照）会漏掉本步写下的 todo；现在读落库后的真实历史。
- 实测教训（重要）：不设限时 **57 个 session-runner 测试全挂**——上游夹具的回合本来就以「只有工具调用 + `TestLLM.stop()`」结束，零文本是常态不是异常。任何「每回合都触发」的闸都会撞这个假设，闸门必须绑定一个稀有事件（改文件）。收窄后 234/235 通过，唯一失败是 2026-10-26 记录的既有 compaction retained-turn。

## 冷启动 / 首屏加载

- 新会话首屏那两个控件（模型选择器、工作区/分支行）都不是独立加载的，卡在同一批数据上：模型按钮原来整块被 `<Show when={!loading}>` 挡住（`packages/app/src/composer/composer.tsx`，loading = `!selection.ready() || !providers.ready()`，而 `providers.ready()` 要求 provider 与 **model** 列表都到齐）；工作区行 `packages/app/src/new-session/view.tsx` 里的 `<Show when={props.project.selected()}>` 同理。数据没到 = 控件不存在，不是占位。
- 2026-10-27 起两处都给了占位：模型按钮走 `ComposerModelControlPending`（28px 高、脉冲骨架，宽度 ~165px 对齐常见模型名长度），同时去掉了 `Composer` 传的 `modelControlsVisible={!loading}`（该 prop 仍被 `session/preparing-composer.tsx` 用 `false`，别删）。工作区行的分支状态改成三层：未同步 → 占位胶囊（`data-slot="new-session-git-pending"`）→ 有 git 走 `PromptWorkspaceSelector` → 没 git 才 `PromptGitStatus noGit`。
- 原来那个「无 Git」是假的：`bar.visible()` 为 false 时行尾直接 `noGit={!workspace.project.git()}`，而 `visible()` 在 VCS 同步回来之前恒为 false（它读 `data.location.info()?.project.vcs` 与 `vcs.info()?.branch.current`）。所以冷启动会先显示仓库「没有 Git」，数据到了再跳成「本地 / main-sicode」。
- 判断「vcs 到底同步没有」用 `data.location.vcs.info({ directory })` 是否为 undefined（`packages/client/src/solid/data.ts` 的 `LocationData.vcs?`），别用 `visible()`——它就是被同步驱动的那个值。
- 冷启动耗时实测（本机 3084，带 basic auth 打接口）：同一 location 热态 `/api/{project,model,provider,agent}` 全在 5–9ms；**没打开过的目录**首次 `/api/model` 约 2021ms（实例 boot 本身）。日志里那两次 12.9s / 14.2s + 503 是另一回事，见下条。
- 12.9s/14.2s 的元凶之一：`.opencode/opencode.jsonc` 的 `references.effect` 是 git 源，`Reference.refresh()` 在 boot 时 fork 出 `RepositoryCache.ensure(refresh:"daily")`，缓存过期就 `git clone`（首次）或 `git fetch + checkoutRemoteBranch + resetHard`（每天一次，`packages/core/src/repository-cache.ts:157-209`）。日志里 clone 结束时刻与 `/api/model` 503 响应时刻完全重合。修法：`.sicode/opencode.jsonc`（后加载，按 alias 覆盖）把 `effect` 改成 `type: local` 指向缓存目录；`Reference.refresh()` 对非 git 源直接 return，网络工作整段消失。代价是 reference 不自动更新，注释里给了手动刷新命令。
- 另一类 stall（07:38 那次 12.9s，无子进程、11.6s 日志空白）尚未定位，猜测主线程被同步 IO 顶住；要查得在 dev 版打点。
- 旁证：`/api/reference` 冷实例首次返回 `[]`、第二次才返回两条——同一类「插件没 settle 就先答」的竞态，不是空列表。

## MCP 工具

- 名字来源：MCP 工具在注册表里的名字是 `<namespace>_<tool>`——`packages/core/src/tool/mcp.ts:23` 的 `namespace()` 把 server 名里非 `[a-zA-Z0-9_-]` 换成 `_`（`.` 会被换掉，`-` 保留），再由 `packages/core/src/tool/runtime.ts:276` 的 `effectiveName` 拼成 `命名空间_工具名`。消息分片 `SessionMessage.AssistantTool`（`packages/schema/src/session-message.ts:164`）只有 `name`，**不带 server**，所以想按 server 展示只能反推。
- 反推规则在 `packages/session-ui/src/tools/mcp-tool.ts` 的 `mcpToolIdentity(name, servers)`：拿 Location 的 MCP server 名单逐个算命名空间前缀，取最长匹配。必须最长——`acme` 与 `acme_ops` 并存时，短的那个会把 `acme_ops_run` 吞成 `acme / ops_run`。名单为空（storybook / 还没同步）就返回 undefined，行维持原名，不要瞎猜。
- 名单来源是 `data.location.mcp.server.list({ directory })`（`packages/client/src/solid/data.ts`），由 `packages/app/src/shell/routes/session-ui-provider.tsx` 传进 `DataProvider` 的 `mcpServers`（`packages/session-ui/src/context/data.tsx`）。storybook 走 `CurrentSessionProviders` 的 `mcpServers` 入参，不传就不启用。
- 展示分两处：过程壳头部 `toolTitle()`（`packages/session-ui/src/tools/tool-renderer.tsx:349`）对 MCP 只返回 server 名，靠 `Set` 去重，同一 server 的多次调用不再算多种工具；行内 `GenericTool`（`packages/session-ui/src/components/basic-tool.tsx:415`）把 `ui.basicTool.called` 的 tool 参数换成 `server / tool`。失败卡片 `ToolDisplay` 的 `title` 也传同一个字符串，否则错误卡会退回扁平名。
- i18n 没加新键：`ui.basicTool.called` 本身就是「调用了 `{{tool}}`」，把 `server / tool` 塞进 `{{tool}}` 即可，避免改 40 多个语言文件。
- 验证：`bun test src/tools/mcp-tool.test.ts`（6 条，覆盖后缀含下划线、最长匹配、内置工具不被吞、名单缺失）；storybook 故事 `current-tool-group--mcp-calls`，收起态头部渲染成 `agent-mail, figma, Shell · 4 tools`，展开态行读作 `Called \`agent-mail / SendMessage\``。

## 自定义提供商

- **自定义提供商的「获取模型」链路（2026-10-27，a93d3241d4）**：探测逻辑在 `packages/core/src/provider-probe.ts`（导出 `probeModels`，Effect 版），`POST /api/provider/models`（`packages/protocol/src/groups/provider.ts` 的 `provider.models`）和插件 SDK 的 provider domain（`core/src/plugin/host.ts`）都调它；客户端类型是生成的，改 protocol 后要在 `packages/client` 跑 `bun run generate`。
- 探测的兼容面：响应接受 OpenAI `{data:[{id}]}`、Ollama `{models:[{name}]}`、裸数组三种；baseURL 不以 `/v1` 结尾时 404 会回退 `{base}/v1/models`；`Authorization` 只在用户没自定义同名 header 时才注入 Bearer；15s 超时；错误信息优先读响应体里的 `error.message`。
- **给 protocol 加 endpoint 的固定成本清单**（这次踩全了）：protocol group、server handler、两处插件 SDK domain 实现（`core/src/plugin/host.ts` + `plugin/src/promise/adapter.ts`）、client 生成物（generate）、以及 core 测试夹具里的 provider stub（`core/test/fixture/policy.ts`、`core/test/plugin/host.ts` 的 providerHost/noProviders/默认 overrides）——缺一处 typecheck 就挂。
- 表单：`packages/app/src/providers/credentials/dialog.tsx` 分三区（连接/模型/可折叠请求头），保存按钮固定在弹窗底部（form 内部滚动，外层 `max-h-[min(56vh,520px)]`）；「获取模型」按钮 → 内联面板（搜索+多选，已存在 id 显示「已添加」并禁用）。模型显示名改为可选（`form.ts` 的 `validateCustomProvider` 里空名兜底用 id），历史行为不变。
- i18n 只加了 en/zh/zht：`language.tsx` 里每个语言字典都是 `{...base(en), ...该语言}` 合并，缺 key 自动回退英文，不用改 40 个文件。
- **服务端改动必须重启桌面端才生效（2026-10-28，bbd5a3ac0a 验证）**：`serve --service` 是常驻进程、从源码启动，提交后不重启就还是旧代码。用户报「获取模型有问题」实测就是运行中的 3084 对 `/api/provider/models` 回 404——服务端代码本身没问题，双击 dev.bat 重启即可。排查时可用 `com.sicode.desktop.dev/opencode/service-local.json` 里的密码做 Basic auth（用户名 `opencode`）直接 curl 运行实例。
- 测试整条 HTTP 链路别用 `Effect.runPromise(Layer.build(...))`：Scope 会被提前关闭、服务拆光，所有请求都回空体 503。要用 `core/test/lib/effect.ts` 的 `it.live`（整个用例包在 scope 里，像 `provider.test.ts`），并且要先 `SdkPlugins.register` 一个能完成的插件——路由中间件等插件激活，不等就 503。
- 自定义提供商「获取模型」修了三处（2026-10-28）：①core/src/provider-probe.ts 现在解析表单的 {env:NAME} 语法（服务端 process.env 取值；缺失时明确报「Environment variable X is not set on the server」），原来把字面量 {env:X} 当 Bearer 发出去必 401；②探测顺序改为 /v1/models 先于 /models（OpenAI 兼容网关的规范路径；base 已含 /v1 时只试 /models）；③失败信息改为逐次列出「/v1/models → 403 Forbidden — Insufficient account balance; /models → …」，不再只留最后一次错误。app/src/providers/credentials/dialog.tsx 的模型搜索框拦了 Enter（原来会触发表单提交=保存并关闭弹窗），Esc 收起列表。实测三种输入（字面量/缺 env/有 env）行为正确；core+app typecheck 干净。注：用户的 403 Insufficient account balance 是网关账号余额问题，不是代码问题（假 key 探两条路径都是 401 而非 404，说明路径对）。
- 自定义提供商第二轮优化（2026-10-28，参考 WorkBuddy 添加模型弹窗）：①模型行加折叠「能力与窗口」——工具调用/图片输入/思考模式三个勾选 + 上下文窗口与最大输出两栏（预设 32K/64K/128K/256K 与 8K/16K/32K/64K），只把偏离默认值的字段写进 config（capabilities/limit），编辑时 formFromConfig 回读并自动展开；②「测试连接」按钮（API Key 右边）→ 新端点 provider.test：有模型 id 时发一次 max_tokens=1 的 chat/completions，没有则退回 /models，返回 {mode}；③拉取列表加「全选/清除」（作用于当前搜索结果）与数量提示，空态区分「端点没返回模型」和「搜索无匹配」；④删除提供商加确认弹窗；⑤填名称自动生成 providerID（用户改过 id 后不再覆盖）。core 侧 provider-probe 抽出 prepare/candidates 复用，probeChat 与 models 同样逐条报错；plugin 的 ProviderDomain 与 promise adapter 补了 test 方法，core 测试桩同步。验证：app/core/plugin typecheck 干净，server 仅既有 client-mcp 测试错；form 6 个测试过（含能力/limit 写入与非法窗口校验）；probeChat 实测两条路径都报出来。
- **保存自定义提供商必报「Integration not found: <providerID>」（2026-10-29 修复）**：保存流程（`packages/app/src/providers/credentials/dialog.tsx` saveMutation）在有明文 API Key 时无条件走 `integration.connect.key`，但该端点（`packages/server/src/handlers/integration.ts:68`）先校验 integration 注册表——自定义 providerID（如从名称生成的 `m-c-api`）不在表里 → 整个保存 404，且 config.update 已先行落库（保存半成功）。报错 toast 标题是 `common.requestFailed`（保存按钮的），不是测试连接的「连接失败」。
- 正确的落库路径早就在：自定义提供商的 config 本就不含 apiKey（`form.ts` validateCustomProvider 只写 `{env:NAME}` 引用），明文 key 设计上存 credential 库；运行时 `packages/core/src/model-resolver.ts:381` 对无 integration 的 provider 用 `providerID ?? integrationID` 兜底查 `connection.active`，`credentials.list`/`create`（`core/src/credential.ts`）不校验 integrationID、`activate` 默认激活。所以修法：先 `integration.get` 探测（404 即非注册），已知 integration 才走 `connect.key`，否则直接 `credential.create({integrationID: providerID, value:{type:"key",key}, activate:true})`。registered-integration 路径行为不变。
- **自定义提供商全链路体检（2026-10-29）**：①运行时链路闭合——package `aisdk:@ai-sdk/openai-compatible` 经 `provider.ts` 的 `packageName()` 剥前缀 → `core/src/plugin/provider/dynamic.ts`（DynamicProviderPlugin 兜底任意包）npm 装 `@ai-sdk/openai-compatible@ai-v6`（`sdk-factory.ts` 的 installSpec 钉 v6 tag）→ 取 `create*` 导出；`aisdk.ts` 的 `prepareOptions` 把 settings（baseURL）+ `nativeCredentialSettings`（credential type:"key" → `{apiKey}`）+ config headers 全部传入工厂。②credential 两条路都能到：明文 key 存 credential 库 → `model-resolver.ts:381` 按 providerID 查 `connection.active`；`{env:NAME}` 走合成 integration 的 env method → `connection.resolve` 读 `process.env[name]`。③config provider 插件（`config/plugin/provider.ts:29`）会给每个配置化 provider 注册**合成 integration**（key 或 env method）——用户撞的 404 本质是保存弹窗在 config.update 返回后立刻 connect.key、注册表 reload 未完成的**时序竞态**；直接 credential.create 的修法对该竞态免疫，两种状态都正确。④schema（`schema/src/config/provider.ts`）完整接受表单形状：settings 走 StructWithRest、capabilities（tools/input/reasoning）与 limit（context/output）字段全对上。
- 体检中另修两处：②`CustomProviderActions.remove` 原样调 `integration.get` 无 catch——删除自定义提供商必报「Integration not found」（与保存同根因），已加 404 回退到 `credential.list()` 按 integrationID 过滤；③zht 缺 5 个 key（deleted.title/description、edit.title、field.apiKey.editDescription）已补繁体。
- 已知瑕疵（未修，低危）：`listCustomProviders` 只回读 settings.baseURL，手工调过 timeout 等其它 settings 的 config 在编辑保存后会被丢；`{env:...}` 提供商改为明文 key 保存时，若合成 integration 只有 env method，`connect.key` 会 `Effect.die`（Key method not found → 500），刷新后重存可绕过；config.update 先于 key 存储执行，key 存储失败会留下「无 key 的提供商」（修复后概率极低）。

## shell 发现 / 别名兜底

- 现象：SiCode 在 Windows 上选中 5.1（`System32\WindowsPowerShell\v1.0\powershell.EXE`），pwsh 7 没进候选。
- 根因：用户机器的 pwsh 7 是 **App Execution Alias**（`%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe` 重解析点，无实体文件），而 core 跑在 Bun 上——Bun 的 `fs.stat` 对 APPEXECLINK 抛 **EACCES**（`throwIfNoEntry:false` 只压 ENOENT 压不住），`lstat` 报 `isFile:false` → `which` 包判定不存在 → 回退 5.1。已用无沙箱复跑排除沙箱干扰。
- 修复（`core/src/shell/select.ts`，全部带 `// SiCode:`）：①`stat()` 帮手吞 EACCES；②新增 `appAlias()`/`isAppAlias()`——lstat 存在、非常规文件、size∈(0,4096) 即认定为 alias stub；③`win()` 候选 `findExecutable("pwsh") ?? appAlias("pwsh")`；④`executable()` 对 stat 失败的绝对路径走 isAppAlias 兜底。
- 验证：alias 路径 resolve+spawn 实测 7.6.9（Bun spawn 对 alias 可用）；装实体版后 `which` 直接命中。
- per-user 实体安装（免管理员）：GitHub releases ZIP（105MB）解压到 `%LOCALAPPDATA%\Programs\PowerShell\7`，追加进 HKCU Path。winget 不行——MSIX 已占 `Microsoft.PowerShell` manifest 名额拒绝装 MSI，`--scope machine` 要管理员。
- 注意：已运行进程不会自动看到新 PATH，重启 SiCode（dev.bat）后 server 进程生效；alias 修复不依赖 PATH，同样重启后即用。

## 项目地图

- 注入端：`packages/core/src/config/plugin/project-map.ts` 把 `.sicode/structure.md` 全文和 `.sicode/notes.md` 的 `## ` 标题清单拼进每个请求。notes 只给标题是刻意的——全文约 28KB，每请求重放比模型自己按需读那一节更贵；地图全文注入则是划算的，它省掉「先读一遍再动手」的往返（约 1.3k tokens）。
- 生成端：cli/src/commands/handlers/init.ts（已随该命令一起撤销），命令曾是 `opencode init`（bin 名仍是 `opencode`，见 `packages/cli/package.json` 的 bin）。它从 cwd 往上找 `.git`/`package.json`/`Cargo.toml`/`go.mod`/`pyproject.toml` 定项目根，扫一级目录（跳过 node_modules、dist、隐藏目录等）、`package.json` 里 dev/build/test/check/lint 开头的脚本、README 第一段散文，产出带 TODO 的骨架；文件已存在就提示并退出，不覆盖。
- 有意不给「目录职责」「改动该去哪」下结论：静态扫描猜错比留 TODO 更糟，模型会当真。这两节留给 agent 或人填。
- `.sicode/` 只读不建是长期状态：`ConfigDiscovery` 的 `projectDirectories = [".sicode", ".opencode"]` 只用于发现，全仓没有任何地方 mkdir 它，所以新项目里那套注入不会生效，除非跑一次 init 或手工写文件。
- 生成入口只有一个：core 的内置斜杠命令 `/init`（`packages/core/src/config/plugin/command.ts`，注册在配置命令之前，用户自建 `init` 可覆盖）。它把「读代码写 `.sicode/structure.md`」整件事交给模型，prompt 里约束篇幅（一页）、排除易过期内容（文件清单/行数/TODO/版本号）、要求已存在时就地改进。桌面端在 composer 打 `/init` 即触发，命令经 `GET /api/command` 暴露，app 侧无需改动。
- 曾经写过一个 CLI 版 `opencode init`（静态扫描目录 + package.json 脚本 + README 首段，1 秒出骨架），已撤销（`a7aa342ec3`）。撤销理由：桌面端用户不该被要求开终端；两个同名不同行为的入口会让人猜用哪个。静态扫描的价值不足以维护第二份模板。
- **别家三派做法对照（2026-10-29 调研）**：① **agentic search**（Claude Code，Cursor 部分场景）——不做索引，直接 rg/glob/read，理由是早期 RAG 实验显示按需搜更好，代价是多走几轮；② **repo map**（Aider）——tree-sitter 抽定义/引用（名字+行号），按引用关系建文件图，PageRank 配个性化权重（在聊文件 50x、对话提到的标识符 10x），按 token 预算（默认 1024）挑最高分符号+签名；③ **语义索引**（Cursor）——Merkle 树增量 + 语法级分块 + 自训 embedding + 向量库。
- 关键数据：Aider 的 repo map 在 SWE-bench Lite 上 26.3% resolve rate、**70.3% 正确文件识别**（官方博客给的是全栈成绩，未单独消融）；Cursor 官方博客：语义搜索带来**平均 12.5% 准确率提升**（6.5–23.5%，视模型）、1000+ 文件的大库上代码留存 +2.6%、少了需求迭代 —— **是准确率不是速度**。Cursor 文档同时明确：引用具体符号时 Agent 自动走 grep（他们自建 Instant Grep，比 ripgrep 快），语义搜索是补充，两者组合最好。
- **SiCode 的位置**：已经在 agentic search 这一派（grep 0.4 秒、436 次零空结果），并且**已有 repo map 注入通道** —— `config/plugin/project-map.ts` 每请求注入 `.sicode/structure.md` 全文 + notes 标题清单（约 1.3k token）。区别只是：Aider 的地图自动生成，我们的靠手写维护。
- **所以「捡起来」的正确方向是自动 repo map，不是 LSP、也不是向量索引。** 依据：① LSP 三个 op 都要行号，实测模型不用（见「代码检索 / LSP」区）；② 向量索引是准确率收益且成本最高（需 embedding 路径 + 自训模型，见「语义索引」区决策）；③ repo map 恰好补「模型不知道仓库里有什么 → 反复 grep 摸索」这个真缺口，且**预注入、不需要模型主动调用**（绕开「模型不会用新工具」这个已被证伪两次的假设）。
- 落地形态（复用既有注入点，符合「新增文件+单点注册」纪律）：新增 core 下的 repo-map 目录（提取器 + 生成器 + 缓存，尚未创建），由 `project-map.ts` 在 `.sicode/structure.md` 缺失或过旧时改用自动生成的地图；注入通道一行不改。
- 前置依赖：`web-tree-sitter 0.25.10` 已在 `packages/core/package.json`，但**只带 bash 与 windows shell 语法**，TS/TSX 需另加 tree-sitter-typescript 的 wasm。这是唯一的硬前置。
- 成本与风险：约 2 天工作量（语法包接入+提取器半天、生成与预算半天、mtime 增量缓存半天、测试半天）；本仓 5146 个 ts/tsx 文件首次全量解析预计十几秒到几十秒，需缓存；地图体积要从 1.3k 控制在 2–3k token 内，否则每请求成本反超收益（Aider 的做法是按预算裁剪，不是全量输出）。
- 先做简单版的理由：PageRank 可以先用「被引用次数」近似，Aider 的 50x/10x 个性化权重属于调优项，不影响第一版验证「预注入符号地图是否减少探索步数」这个核心假设。
- **自动 repo map 已落地**（2026-10-29）。目录 `packages/core/src/repo-map/`：`languages.ts`（扩展名→语法注册表）、`extract.ts`（tree-sitter 树→符号+依赖，纯函数）、`render.ts`（排序+预算渲染，纯函数）、`parse.ts`（懒加载 wasm、按语言复用 Parser）、`cache.ts`（磁盘缓存）、`index.ts`（扫描+增量+内存缓存）。接入点只有一处：`config/plugin/project-map.ts` 在 `structure.md` 缺失时改用它。wasm 走 `#repo-map-wasm` 条件导出（bun/node/workerd 三份），写法照抄 `#shell-parser-wasm`。
- 语言覆盖：内置 10 种 —— typescript / tsx / javascript / python / go / rust / java / c / ruby / php，合计约 11MB wasm。`tree-sitter-wasms@0.1.13` 本身有 36 种，其他没打包是因为每个语法都进二进制（c_sharp/kotlin 各 4MB）。**加一种语言 = 注册表加一行 + `wasm.bun.ts` 加一个 import**，其余代码不动。
- 提取规则是结构化的，不是按语言写死：**顶层节点只要有 `name` 字段就当定义**（python/go/rust/java/js/ts 实测成立），外加三处修正 —— ① `export_statement` / `decorated_definition` 是包装层，递归进去取内层；② go 的名字在 `type_declaration` 下面的 `type_spec`；③ c 的函数定义没有 name 字段，名字在 `declarator` 链末端。另外只有 `export const` 这类绑定才下钻取 `variable_declarator`，未导出的模块级 const 不入图（否则全是常量噪声）。
- 排序：可解析的相对依赖入度 ×8，`src|lib|app` 目录 +2；ts 里 import 常写成 .js 扩展名、磁盘上却是同名 .ts 文件，所以带源码扩展名的 spec 会去掉扩展名再试一次；python 的点号路径（`.mod` / `..pkg` / `.`）单独处理。**绝对不要给裸包名建边**（`react`、go 的 import path 都在仓库外）。没有 import 边的语言（go/rust/java）全部 0 分，退化成路径序 —— 这是已知弱项，不是 bug。
- 渲染格式：单行 `path: name(line) name(line) …`，预算 4000 字符（≈1240 token，与原来手写的 structure.md 同量级）、每文件 5 个符号、单行上限 180 字符。超预算的文件是**跳过继续**而不是 break（避免一个长行把后面的全清空），跳过的数量合并成一行 `… and N more files`，且这行**从同一预算里扣**，否则总长会超。
- 本仓实测（2800+ 文件）：冷启动 5.8s，二次（走磁盘缓存，只 stat + 重解变更文件）0.39s。预算 4000/每文件 8 → 29 个文件，每文件 4 → 42 个，每文件 5 → 约 35 个。排序头部是 `schema.ts`（81 个文件引用）、`bus.ts`（65）、`protocols/shared.ts`（60），与实际依赖中心一致。
- 缓存：`<global cache>/repo-map/<sha1(绝对目录)>.json`，失效信号是 `mtimeMs + size`（与 trigram 同一套），原子写（临时文件 + rename）。内存层 TTL 5 分钟，key 是 `目录|budget|symbolsPerFile`（预算不同渲染结果不同，不能共用）。
- 冷启动不阻塞：没有磁盘缓存时**先返回空、后台构建**，下一轮请求才有图 —— 宁可第一轮没图，也不要让首轮卡 6 秒。有缓存时直接 await 增量刷新（亚秒级）。`wait: true` 是给测试和一次性命令用的。
- `.sicode/structure.md` 仍然优先（它承载解析器推不出来的架构知识），生成的图只做兜底。要在本仓对比两者，设 `OPENCODE_REPO_MAP=generated`。
- 验证：`test/repo-map.test.ts` 16 项（六种语言的提取、路径解析、排序、预算与尾部裁剪、磁盘缓存与新增文件）+ `test/project-map.test.ts` 5 项，共 21 pass；core typecheck 1738 文件 0 错误。**尚未验证的是效果本身** —— 预注入符号地图能否让每回合步数下降，要跑真实会话才有数据。
- 未验证风险：node 变体用 `require.resolve("tree-sitter-wasms/out/…")`（该包无 exports 字段，按路径解析可行）；打包成单个可执行文件时若 wasm 不在旁边，需要 `OPENCODE_REPO_MAP_WASM_DIR` 指向目录，否则该功能静默降级（图不注入，不影响其它功能）。

## 并行编辑与 DeepSeek 兼容

- **结论：SiCode 侧对 DeepSeek 并行的支持已经齐了，不用改内核代码；缺的只是「模型愿不愿意」+「配置里要不要显式开」。**
- 用户本机跑的根本不是官方 DeepSeek provider，而是三个中转站 openai-compatible（`~/.config/opencode/opencode.jsonc`）：`lianyi`（`@opencode/ai/providers/openai-compatible`）、`deepseek1` 与 `zy50009`（`aisdk:@ai-sdk/openai-compatible`）。两条路最后都落到同一个协议/解析器。
- 解析层实测通过（临时测试，已删）：新写 3 条用例喂真实分片格式——① 首帧一次宣告 3 个 tool_call（带 index/id/name），后续按 index 流式拼参数；② 后续 delta 省略 index（兼容差的网关）；③ 默认不发 `parallel_tool_calls`。全过。`packages/ai/src/protocols/openai-chat.ts:1103-1154` 的多调用累积用 `tool.index ?? matched ?? (id 不一致 ? nextToolIndex : fallback)` 定位，注释明说为「省略 index 的兼容 provider」和并行 delta 设计。
- 请求层：`resolveParallelToolCalls`（`open-responses.ts:783`）= `options.parallelToolCalls ?? (disableParallelToolUse === undefined ? undefined : !disabled)`，全仓无一处设 `disableParallelToolUse`，所以**默认不发送该字段**，由 provider 自己取默认（DeepSeek 官方默认 true）。`openai-chat.ts:785` 只在非 undefined 时写入 body；`hasActiveTools` 为假时也不发（OpenAI 会 400）。
- 可配置路径实测通过（临时测试，已删）：无论原生路（`DeepSeek.configure`/`OpenAICompatible.configure` 的 `providerOptions`）还是 aisdk 路，`providerOptions: { parallelToolCalls: true }` 都能落到请求体 `parallel_tool_calls: true`。所以「要不要显式声明」是配置问题、不是代码缺口。
- 提示词侧：`optimize.ts:65` 的 `DeepSeekPlugin` 是 **append** 模式，走 `deepseek.txt`（含 `## Tool batching` + `# Batch independent edits`）。`deepseek.txt` 措辞只是「batch aggressively / 一轮读完」，**没有 Cursor 那种「默认并行、要串行得自证」**；对比 `gpt.txt`/`gpt-astra.txt` 有 `- Prefer parallelizing independent tool calls.`，`kimi.txt:13` 更是 HIGHLY RECOMMENDED。deepseek.txt 是唯一连基础并行句都没有的主提示词文件。
- 上游默认提示词 `packages/core/src/session/runner/prompt/system.txt:6` 本身就有 `- Prefer parallelizing independent tool calls.`——append 模式不覆盖它，所以 DeepSeek 至少继承了这一句。
- 真瓶颈：并行工具调用（一条消息多发、无隔离）早已端到端具备（请求层不禁用 + `step.ts:121-133` 每个 tool-call `forkScoped` + `edit.ts:320` per-path 锁），缺的是模型在同一条消息里多发几个 edit 的「意愿」。改提示词强度是唯一剩下能推动的杠杆。
- batch 规范已提进 `session/runner/prompt/system.txt`（新增 `# Batching tool calls` 段），内容是「deepseek 独有的 Tool batching 5 条」+「Batch independent edits 核心句」的合并超集：一次读齐文件 / 一次宽搜代替多次窄搜 / 合并独立 shell / 用 offset-limit 读区间 / 编辑点确定后一次发完再统一校验 / 改完再验证不做 edit-verify-edit，末尾兜一句「只有真正依赖前一步结果时才逐个来」。
- 同步清理：`anthropic.txt` 与 `deepseek.txt` 是 append 模式（`packages/core/src/plugin/optimize.ts` 的 `mode="append"`，拼法是 `${system.text}\n\n${rendered}`），若不删会读两遍 → 删掉两者的 `# Batch independent edits` 段，并删掉 `deepseek.txt` 开头的 `## Tool batching` 段（信息已完整进 system.txt）。`deepseek.txt` 的 `## Say what you found` 是沟通规范，保留不变。
- 5 个 override 的 txt（gpt / kimi / trinity / meta / gpt-astra）**一个字没动**：override 是完全替换 system.txt，它们读不到新段，删掉自己的那段反而会丢规范。判據 结论：每种命中模式最终恰好读到一份 batch 规范（无命中 0→1，append 2→1，override 仍 1）。
- 改动前后字节数（含此前未提交的 stay in scope / verify once 两条，它们占 system.txt 增量的约 430 字节）：无命中模型 3877→5008（+1131）；append deepseek 7787→7978（**仅 +191**）；append anthropic 6829→7486（+657）；override gpt 5272→5272（0）。
- 体感判断（重要）：deepseek 用户（用户自用模型）净变化只有 +191 字节 ≈ 2.4，因为删掉的重复段与新段落基本抵消、内容等价 —— **对自己日常使用体感接近 0**。这批改动的真实价值是覆盖面：自定义 provider / GLM / Qwen / 本地模型过去一份 batch 规范都没有，现在有 1 份；按同模型对照（无此段并行率 7-20%、有此段 32-55%）预期它们从 ~10% 提到 40%+，但这仍是预期不是实测。
- `system.txt:6` 的 "Prefer parallelizing independent tool calls." 这句空洞口号早就存在，实测只换来 7-9% 并行率；同样意图写成 5 行具体规范才有 32-55%。这条修正了此前「静态守则是负债」的结论 —— 失效的不是守则，是不具体的守则。那句口号保留未删（避免多余 diff）。
- 验证：core `bun run typecheck` 1727 文件 0 错误；`test/plugin/optimize.test.ts` 12 pass 0 fail（该文件 import 了 anthropic.txt，但断言用同一份文件现算，删段落不影响）。

## DeepInfer 对 SiCode 的可迁移思路

- 来源：https://github.com/deepseek-ai/DeepInfer（2026-10 开源，Apache-2.0）+ doc/inference_deployment_qa.md。**层次错位，代码不可迁移**：它是 vLLM 系的大规模推理服务框架（FlashMLA/DeepGEMM/DeepEP 内核、EP+EPLB、prefill/decode 分离、KV cache 存储、结构化输出），跑在 SM100/Ascend 950 上。SiCode 是客户端 agent harness，两者不在同一层。
- **可迁移的是设计思路，最值钱的一条**：「验证是一个调度问题，不只是算法问题」（verification is a scheduling problem, not just an algorithm problem）。他们放弃了固定长度验证，改成按数据（代码 vs 对话）与当前负载动态决定验多长、并**在进入 batch 前先剪掉低置信度的 token**，因为「盲目验证整块草稿会浪费算力」。
- 对应到 SiCode：一次消息里发多个 edit 就是**投机执行**（草稿=多个 edit，验证=批后的检查）。DSpark 的三件事各自有对应物——① 置信度剪枝 ↔ 没读过的改点不进批、先读；② 有界验证 ↔ 批后只验一次且深度按风险，不必全量；③ 后缀衰减（越靠后越不可靠）↔ 批越长尾部越可能过时，长批后要重新落地。这比现有 `# Batch independent edits` 的「一句格言」更有解释力，因为它给了**判据**（是否已定位）和**边界**（批多长、批后干什么）。
- 另一条：他们把 KV cache 保留拉到 **>72 小时**，因为「缓存命中时省掉的重复 prefill」是最大的单点杠杆。SiCode 对应物是 prompt prefix cache（`promptCacheKey`/`cache_control`/`x-session-affinity`，`llm.ts:328` 已有「把工具定义留在最后一个 Step 以保住 provider 缓存前缀」的注释）。可做的审计：中途变更工具集/系统提示词前缀会不会打掉整段缓存；steer 注入替换请求尾部是安全的（尾部），但每回合动态追加的前缀内容会毁缓存。
- 他们自报的生产数字：单集群 155T tokens/天、$38/GPU-hour（低谷价）；DSpark 让单用户生成速度 +60~85%（Flash）。这些对 SiCode 没什么用，但「用吞吐/延迟两个维度分别度量」的纪律对应我先前建议的**耗时统计**（工具耗时 vs 模型耗时、每任务 round trip 数）——瓶颈定位就该这么做，而不是只看总时长。
- 注意别被搜索结果带偏：网上把 DSpark（投机解码框架，MIT，配套 DeepSpec 训练仓库，PKU 合作）当独立项目讲，它在这里是 DeepInfer 的一个 feature；`DEEPINFER_ENABLE_MTP_VARLEN` / `DEEPINFER_USE_NEXTN_DECODE`（默认草稿长度 5）是它的开关。

## shell 超时与阻塞成本

- **结论反转：shell 超时不是真问题。** 实测 1506 次 shell 调用（活的 `opencode-local.db`）：只有 **9 次**真的打到超时，总耗时 296.5 分钟，p50 3.1s / p90 31.6s / p99 122s。原先「437 次 >5s 共 241 分钟、多为探测跑满 300s」的说法来自 >5s 这个过低门槛，不是超时问题。
- 时间真正花在哪：173 次 ≥30s 的调用占了 190.9 分钟（64%），其中 158 次正常完成、30 次返回 <200 字符（约 30 分钟基本白等）。173 次里 1463 前台 / 43 后台 —— 模型几乎不用 `background: true`。另有 26 次是 `Start-Sleep` 显式轮询，15.4 分钟纯等待（工具说明里已明令禁止仍然发生）。
- **真 bug（已修）**：`packages/core/src/tool/plugin/shell.ts` 里前台命令被转后台时 `shell.timeout(info.id, 0)` 把超时**清零**，和同文件 24 小时后台上限的注释自相矛盾——被转后台的进程此后永不超时（实测有 302s 的调用）。改为 `backgroundedTimeout(input)`：保留调用者显式给的 timeout，否则套用 24h。
- **新增成本反馈**：前后台阻塞 ≥30s 时，在工具结果 content 末尾追加一行「This command blocked the session for Ns and returned M characters…」。原因是模型看不到阻塞代价——它会把一次 78s 只吐 2 个字符的探测再跑一遍。阈值放在可变对象 `slowTimings` 里，测试可以调小。计时从 `jobs.block` 开始（`waitedFrom`），不含权限确认的等待。
- **坑（浪费了一小时，务必记住）**：`test/tool-shell.test.ts` 的 pwsh 多行用例（`Write-Output \`` 续行、`@'...'@` here-string，共 4 个）**会整组偶发失败**，表现是 exit 1 + 无输出。把 `execute` 从箭头表达式改成等价的块体（零语义变化）也能复现；反过来 pristine 连续跑 5 次全绿。结论：是环境抖动（负载/pwsh 启动），与代码无关。**不要为它改设计**，隔一会儿重跑即可（全量 52~53 pass / 63 skip / 0 fail）。
- 对照实验的教训：这个仓库 HEAD 与工作区不一致（测试文件 HEAD 有 50 个用例、工作区 115 个），`git stash` 拿到的「基线」并不是我的改动去掉后的状态，前几轮 A/B 全是错的。以后做前后对比只用 `git diff` 确认「只含我的 hunk」再谈基线。
- **现已确认那 5 个 pwsh 用例是既有的并行负载抖动**：把改动全部 `git checkout` 回 pristine，用同一条命令跑同样的 5 个文件，结果一样是 `84 pass / 63 skip / 5 fail`（我只多出 3 个新用例通过）。单跑 `test/tool-shell.test.ts` 则 53 pass / 63 skip / 0 fail。所以别为这 5 个红去改设计，也别把它们当成自己的回归。
- 排查时踩的第二个坑：`bun test test/syntax-check*.test.ts ...` 在 Bash 里由 shell 展开、在 PowerShell 里**不展开**（bun 拿到的字面 glob 只匹配到部分文件），两次「对照」跑的根本不是同一组文件。跨 shell 做 A/B 时先确认展开结果一致。
- shell 轮询拦截已落地：`tool/plugin/shell.ts` 新增 `detectPollingWait()` + `pollTimings.minSeconds = 20`，在 `execute` 里 `input.command` 校验通过之后、`resolveTimeout` 之前调用，命中就 `Effect.fail`。
- 规则（三条件同时成立才拦）：① 没传 `background: true`（后台调用不阻塞，不管）；② 命令里最长的 sleep ≥ 20 秒（`Start-Sleep [-Seconds|-s] N` 与 bash `sleep N` 两种写法）；③ 命令里有读文件动作（Get-Content / Get-ChildItem / Test-Path / Get-Item / cat|tail|head|less|more + 非空格）。缺任一条放行。
- 为什么必须运行时拦：`BACKGROUND_INSTRUCTION`（同文件 62 行）早已写明「反复 sleep 再读输出文件就是轮询，不是有效工作」，措辞比 `background` 参数的 "DO NOT poll" 更详细，模型照样轮询 —— 提示词这条路已被证伪两次。
- 真实数据回放（本机 1687 条 shell 调用 / 288 分钟）：拦下 17 条、省 14.6 分钟、平均每次 52 秒，占 shell 总时长 5.1%。被拦的全部是 `Start-Sleep -Seconds N; Get-Content <opencode/shell/<hash>/sh_*>`，即模型在轮询自己后台任务的输出文件。
- 零误伤验证：真实数据里最长的 8 条调用（300 秒级的 `node tools/diag-*.js` 等重活）**全部放行**；5 条合理等待也全部放行 —— 等端口 240s（Get-NetTCPConnection）、等 90s 再 curl、等 20s 再跑 `node tools/mailbox.js`、短 sleep 2s 后读文件、`npm run build`。
- **修正此前数字（重要）**：早先说的「182 次吃掉 3380 秒 / 56 分钟 / 占总时长 3.6%」归因错了 —— 那把「所有含 sleep 的调用」的总耗时都算成了 sleep 的开销，但那些调用里大部分时间其实是别的命令在跑（`node tools/*.js` 之类）。按「可拦截」的精确口径是 17 条 14.6 分钟，占总时长约 0.9% 而不是 3.6%。以后引用用后者。
- 验证：新增 `test/shell-poll-detection.test.ts` 11 pass 0 fail（含边界 20s/19s、多次 sleep 取最长、`Start-Sleep` 不带 -Seconds、`asleep` 这类词内匹配不误判、background 豁免）；core typecheck 1728 文件 0 错误；`test/tool-shell.test.ts` 48 pass / 5 fail，失败项全是 approvals 相关，属本机会话 shell 环境抖动（历史基线 8-16 fail），与本次改动无关。

## 语法回灌

- `.cpp` 已接入：本机其实一直装着 LLVM（`C:\Program Files\LLVM\bin\clang++.exe`，clang 22.1.6），只是不在 PATH——所以早前 `which clang` 探测全空、误判为「无编译器」。runner 现在先 `which("clang++")`，失败后按固定安装位置探测（Windows LLVM 目录、Homebrew、/usr/local、/usr）。
- 命令是 `clang++ -fsyntax-only -ferror-limit=5`：不编译不链接，只查语法；上限 5 条防止模板爆炸刷屏。标准库 include 可用（机器上有 Windows Kits SDK），带 `#include <vector>` 的文件实测 exit 0。
- 解析器 `parseClangOutput` 只取 `error:` / `fatal error:` 行，丢 note（那是给已报错误作解释的）和 warning（会让模型去「修」能编译的代码）。
- `.h` 故意不接：纯 C 头按 C++ 查会误报合法 C。宁缺勿错。
- clang e2e 测试按 clangAvailable 条件注册（自定义 it 没有 skipIf，直接 if 包住 it.effect）。
- UI 修复：主页项目下拉弹层（`home/projects/view.tsx` 的 Popover.Content）原来用 `bg-v2-background-bg-base`，深色主题下是 grey-1100 近纯黑，和其它已统一为 layer-01 + 细描边的弹层（context-menu、dock-toolbar）不一致——用户截图点名。已对齐，并在 `view.css` 加 dropdown 作用域：行默认/hover 各提一级 layer，NavButton 的 Tailwind hover 类用同文件非 layered 规则覆盖（非 layered 规则优先于 utilities）。

## webfetch 网络/代理

- packages/core/src/tool/plugin/webfetch.ts: webfetch 用 Effect FetchHttpClient -> 全局 fetch（Bun 运行时），直连目标 URL，默认 30s 超时（Effect.timeoutOrElse）；"transport error" 是 fetch 在 TCP/TLS 层失败（连接被重置或挂起超时），不是工具代码 bug。
- packages/core/src/effect/app-node-platform.ts + packages/util/src/effect/app-node-platform.ts: HttpClient 层没有代理包装；Bun fetch 会尊重 HTTP_PROXY/HTTPS_PROXY env，但前提是服务进程里有这些变量。WebSocket 走 packages/core/src/effect/websocket-constructor.ts（自己解析代理 env），HTTP 没有。
- packages/desktop/src/main/lifecycle/environment.ts:24: preferApplicationEnvironment 在 win32 明确跳过 shell env 探测（shellEnv=null），所以 Windows 桌面端 sidecar 继承的是 Electron 的系统 env，不会拿到 ~/.bashrc 里的代理 export。
- 结论：bash 工具 curl 200 而 webfetch transport error 的差异来自网络路径不同（curl 有 happy-eyeballs/独立 env；sidecar fetch 直连缺代理 env 或走坏 IPv6），排查时先在 bash 工具里 echo $HTTPS_PROXY 看 sidecar env。
- 修复（packages/desktop/src/main/service/system-proxy.ts 新增 + lifecycle/desktop-initialization.ts 单点注册）：app.whenReady 后用 session.resolveProxy() 把 OS 系统代理（注册表/PAC，Chromium 已知）解析出来，以 ??= 注入 HTTP_PROXY/HTTPS_PROXY（含小写变体）到 process.env，再让 sidecar 继承；Bun fetch 认这些 env。已设 env 的不覆盖。解析器 parseChromiumProxy 有单测（system-proxy.test.ts），tsc 干净。
- 本机实证：裸连 github.com 目前是通的（200），系统代理 127.0.0.1:7897 开着；失败当时应为瞬时 TLS 重置或直连不通。curl -6 无 IPv6。

## shell scanner

- shell 报错 "Portable shell scanner cannot analyze command: invalid-redirect" 根因：Windows 会话 shell 是 pwsh（select.ts win() 默认），模型发的是 bash heredoc（<< 在 pwsh 里不存在）；桌面端 channel=local/dev 强制便携扫描器（shell.ts:172）。用 demo.json 原文复现：pwsh 扫描器报 invalid-redirect（与报错一致）、bash 扫描器也拒（invalid-structure）。改进：parse.ts 报错信息追加 (session shell: <name>)，帮模型自我纠正；parity 测试已同步。

## 左侧栏

- 头部结构终态（`packages/app/src/shell/left-sidebar.tsx:388` 起）：左侧带文字的主操作「＋ 新建会话」(`command.session.new`)，右侧仅剩搜索 + 收起两个纯图标；新建图标从右侧删掉，避免同一动作出现两次。
- 头部与搜索框之间保留 1px `bg-v2-border-border-base` 分隔线（`left-sidebar.tsx:422`）。项目名标签、主页入口、版本号都被用户否掉，理由是下方分组标题已经在命名每个项目。
- 头部主操作是**长条按钮**：`left-sidebar.tsx` 里 `h-7 min-w-0 flex-1 rounded-[7px] bg-v2-background-bg-layer-02`，图标+文字左对齐、hover 升到 layer-03；右侧搜索/收起各 28px 图标与其同行。首版做成 shrink-0 的小文字按钮被否（用户要「长条」），关键区别是 flex-1 + 有底色才读得出是按钮。
- 视觉收口：新建会话长条改 `justify-center`（左对齐被用户否）；项目分组头用 `ProjectIcon`（16px，来自 `@opencode/ui/project-avatar`，服务端 `Project.Info` 的 id/name/icon 与 `LocalProject` 结构性兼容，tsc 通过）。
- 树形缩进：会话行 `ps-[27px]` → `ps-[42px]`，与项目名左边缘对齐（4 ps-1 + 10 chevron + 6 gap + 16 avatar + 6 gap = 42）；active 竖条 `start-3.5` → `start-[30px]` 跟着进缩进槽。
- 布局收口：项目分组头/会话行统一 28px（h-[26px] → h-7），分组内 mb-3.5，行内 gap 保持 6px；同一列里两套行高会让左边缘看起来锯齿状。
- 搜索框改为**按需展开**：头部搜索图标变成开关（`data-active` 用 overlay-pressed 高亮，`aria-expanded`），点开才渲染 input（Escape 关闭并清空），默认收起后项目列表紧贴分隔线，首屏多出约两行。`searchInput` 焦点用 `queueMicrotask` 延后，因为 input 在 Show 里按需挂载。
- 列表空态原来什么都不显示，读起来像坏了；现在 `visibleGroups().length === 0` 时按 query 有无显示 `dock.projects.empty` / 新增的 `dock.search.empty`（en-only key）。
- 选中态不再用硬编码 `bg-[rgba(255,255,255,0.08)]`（浅色主题下几乎不可见），改用 token `bg-v2-overlay-simple-overlay-pressed`，浅色/深色都成立。
- 分组名 `font-[500]` → `text-12-medium`（同一 12px 阶梯，且走 token 而非字面量）。
- 新建会话入口的终态（packages/app/src/shell/left-sidebar.tsx:405-414）：头部只有一条全宽入口，用 <Button variant="neutral" class="h-7 min-w-0 flex-1">。换掉原来的裸 button + bg-layer-02，因为满宽圆角浅底空心在形状上就是一个输入框，而整列唯一的输入框是搜索——它一直在冒充搜索框。
- 项目分组头悬停的 "+" 已删除（原来 absolute end-0.5 ... opacity-0 group-hover/head:opacity-100），用户明确要求「只保留全宽的，其他去掉」。删后分组头不再需要 group/head，按钮 pe-6 收成 pe-2，否则标题为不存在的图标留了 24px 空白。newSessionIn() 仍被右键菜单 projectMenu 使用，没有变成死代码。
- 侧栏的层级原则：**只回答「我要继续哪个会话」**。项目是容器，不该比内容更响。项目名 `text-v2-text-text-muted`，会话名 `text-v2-text-text-base`，时间戳 `text-v2-text-text-faint`，悬停/选中时项目名才升到 base。此前项目名是 base，六个空分组全是亮白，列表读起来像六张标题，真正的会话沉在下面。
- 字重不能承担分层：`text-12-medium` 是 500，`text-12-regular` 是 460，微软雅黑下笔画粗细几乎一样（`packages/ui/AGENTS.md` 也写了 460 对 400 看不出来）。所以分组名与会话名的区分必须靠颜色，不能靠字重。
- 头部收成**一行一块**（`packages/app/src/shell/left-sidebar.tsx` 的头部 div）：新建会话 `Button variant="neutral"` 独占填充，搜索和收起是裸图标（`size-7` + `rounded-[6px]` + hover overlay），只有一个填充块，层级才读得出「这是动作，那些是工具」。早先是搜索框一行 + 新建按钮一行，三个同色填充块挤在 60px 里互相抵消。
- 搜索**按需展开**用 `searchOpen` 信号：点放大镜才挂载 input（`ref` 里 `queueMicrotask` 聚焦，因为 input 在 `Show` 里后挂载），Escape 清空并关闭，关闭时也清空 query —— 否则收起的搜索会继续过滤列表，用户看不出为什么少了一半。
- 没有会话的项目**不画折叠箭头**，用 `<Show when={group.sessions.length > 0} fallback={<span class="size-2.5 shrink-0" />}>` 留空槽保持头像对齐。空分组点不开，箭头是死控件。头像仍是 16px `ProjectIcon`，缩进链 ps-1 + 2.5 + gap 1.5 + 16 + gap 1.5 仍对齐会话行的 ps-[42px]。
- 项目名升到 base 后，项目行按钮上的 `data-[active=true]:text-v2-text-text-base` 和 `text-muted hover:text-base` 都失去视觉作用，一并删掉，否则后人会以为还有一层状态。
- 对比 demo：`.sicode/demos/sidebar-hierarchy.html`，左现态右改态，可切深/浅色，带「标记改动」「悬停第一行」两个开关。token 值是从 `packages/ui/src/styles/tokens/theme.css` + `colors.css` 抄的实值，不是近似色。
- 会话行和已归档行都改成 `div.group/session` 包一个行按钮 + 一个绝对定位的三点按钮（`end-1`、`size-5`、`arrow` 图标 `outline-dots`、无障碍名 `common.moreOptions`）。原因：HTML 不允许 button 嵌套 button，内层点击会被吞。
- 悬停底色挪到外层 div（`hover:bg-v2-overlay-simple-overlay-hover` + `data-active` 在 div 上），不再挂在按钮上：三点的位置在行按钮之外，底色若只跟随按钮 hover，鼠标移到三点上会闪断。
- 空闲行右侧不再显示相对时间，只保留运行中的转圈（`SessionProgressIndicatorV2`），这是状态而不是装饰；两者共用一个 28px 的右侧留白（`pe-7`），三点按钮落在这块留白里，所以长标题不会钻到三点下面。
- 三点用 `hover-reveal`（`opacity-0` + `transition-opacity`，`hover: none` 下恒为 1）加 `group-hover/session:opacity-100` / `group-focus-within/session:opacity-100` 出现，点击 `stopPropagation` 后按 `getBoundingClientRect()` 的 `right` / `bottom + 4` 定位，复用同一个 `menu` 信号与 `sessionMenu` / `archivedMenu`，所以和右键是同一份菜单。
- 原有的 `relative()` 相对时间格式化函数在去掉时间戳后已无调用点，随之删除。
- 批量选择（删除 / 归档）状态放 `createStore({ active, ids })`，`ids` 是复合串 `${serverKey}\u001f${session.id}`。不能用 `SessionInfo` 对象身份：每次 sync 都会重建对象，选择会在中途悄悄清空。
- 可选范围 `selectable()` 只覆盖 `visibleGroups()` 的主列表，所以已归档架子在批量模式下整体隐藏（`Show when={!selection.active && ...}`），而不是留着点不动的行。
- 入口三个：会话右键「选择会话」（`select-element` 图标）、项目右键（整组进入，仅 `sessions.length > 0` 时出现）、以及项目头本身——批量模式下项目头那个 chevron 槽换成复选框，折叠分组也能整组选；空分组保留空槽并回落到原来的折叠行为。
- 选中后头部两行整体换成批量条：关闭 + 「已选择 N 个」(复用 `home.sessions.select.count`) + 全选/取消全选，下面归档/删除两个按钮。`Escape` 退出（aside 的 onKeyDown，跳过 input/textarea），进入时清空 `query()`，因为搜索框在批量模式下已不在屏幕上，残留的过滤会静默藏起行。
- 批量模式下会话行的三点菜单隐藏（`Show when={!selection.active}`）：那时行是复选框，单会话菜单是另一条更窄的路径。
- 批量执行按 **server + directory** 分组（`byLocation`），不是只按 server：`notifySessionTabsRemoved` 一次只接受一个目录，而同一台服务器可以挂多个项目。归档走 `session.update({ archived: true })`、删除走 `data.session.remove(id)` + `sessionTreeIDs` 带子会话，每个都用 `Promise.allSettled`；失败只报第一个，成功的部分照常生效，选择集由剪枝 effect 收缩。
- 文案复用 `session.delete.many.*`，归档新增 `dock.session.archive.many.*`，另有 `dock.session.select`、`dock.select.exit`；zh/zht 已同步（归档/封存）。
- `projectMenu` 的入参类型放宽成 `ProjectGroup & { sessions: readonly SessionInfo[] }`：菜单需要整组进入批量，而 `ProjectGroup` 本身只描述连接与项目。
- 会话行三点按钮（`left-sidebar.tsx`，`end-1 top-1/2 size-5`）悬浮不是手指指针，真因不是按钮自身缺 `cursor-pointer`：`ui-inspect` 的评论阶段整屏覆盖层（`[data-component="ui-inspect"][data-phase="comment"]`）设了 `cursor: default` 且默认接收指针事件，页面上所有元素在「选中元素评论」时都只能报覆盖层的光标。现改成该阶段 `pointer-events: none`，仅 `[data-slot="ui-inspect-editor"]` 收回 `pointer-events: auto`；点空白关闭改由 `overlay.tsx` 的 document 捕获监听处理（`pointerdown` + `click` 双拦，避免关闭评论的那一下把下面的按钮按了）。
- 第二层原因：`ScrollView` 的隐形滚动条 thumb（`scroll-view.css` `.scroll-view__thumb`，`opacity: 0` 但 `pointer-events: auto`，纵向占 `inset-inline-end: 0`、宽 12px）压在列表右边缘，会抢走 `end-1` 那 20px 按钮的右侧命中。三点按钮加 `z-10` 提到它之上。
- 会话行右槽现在是「时间 ↔ 三点」共用一个位置：时间用行内 `shrink-0`（不是 absolute，否则会和标题重叠），`group-hover/session:opacity-0` 淡出让位给三点。时间复用 `@/shell/time` 的 `getRelativeTime` 和 `common.time.*` 四键；上一轮新加的 `dock.time.*` 五键因此无人使用，已从 en/zh/zht 删除。
- 批量条从侧栏头部移到 `DockToolbar`（本地工作区）正上方，跟着它一起消失在批量模式之外；头部恢复成常驻的「搜索 + 收起」和「新建会话」两行。
- 折叠联动是双向的（`left-sidebar.tsx:338`）：右侧面板打开时自动收起并记 `autoCollapsed`；面板关闭时若该标记还在就自动展开。用户手动点收起会清掉标记——手动收起优先于自动展开。展开按钮不清标记（此时栏已展开，标记残留只会变成 no-op）。
- 项目置顶落在 `packages/app/src/runtime/server/persistence.ts` 的 `ProjectList`（`pinned: Persistence.fallback(Schema.Boolean, () => false)`），写入方法是 `registry.tsx` 的 `createServerProjects().setPinned(directory, pinned)`，读取经由 `runtime.tsx` 的 `enrich` 展开 `...project` 透传，所以 `LocalProject`（`shell/state/layout.tsx`）要补 `pinned?: boolean`。
- 排序只在 `shell/left-sidebar.tsx` 的 `groups()` 末尾做一次稳定 `sort`（pinned 优先），不动 `projects.list()`，否则首页项目视图的顺序也会跟着变；`sort` 稳定才能保证取消置顶后回到用户原本排的位置。
- `Persistence.fallback` 让字段在 store 类型里变成**必填**，因此所有直接构造项目对象的投影（`registry.tsx` 的 `open()`、`persistence.test.ts`、`registry.test.ts`）都必须显式给 `pinned: false`，否则 `typecheck` 报 TS2741/TS2769。
- 置顶是纯展示顺序，行内要配一个 `pin` 图标（`packages/ui/src/icons/catalog.ts` 新增），否则置顶与未置顶的行外观完全相同，用户看不出状态。
- 批量或单条删除后，侧栏那行仍在显示（服务端其实已删）：`shell/left-sidebar.tsx` 的会话来自两处合并，`fetched` resource 是 `session.list` 快照，`ctx.data.session.list()` 是本地实时缓存；合并用 `byId.set` 按 id 覆盖，**只能覆盖，不能删除**。删除只让实时缓存里那条消失，快照里那份还留着，于是旧行复活。
- 归档不会复现这个问题，因为它改的是字段（`time.archived`），实时缓存里那条还在，覆盖得回去；这也是为什么这个 bug 只在删除上暴露。
- 修复：`createResource` 取出 `refetch`，`deleteBatch` 成功路径与单条 `remove` 的 `.then` 各调一次 `refetchSessions()`。批量路径在 `dialog.close()` 之前 await，避免关框的瞬间看到行回闪。
- 首页列表没有同样问题：`home/sessions/controller.tsx` 的 `remove` / `removeMany` 在 `.finally` 里 `queryClient.invalidateQueries({ queryKey: ["home-sessions", conn] })`，侧栏只是缺这一步等价动作。
- 判断标准：往这个 `groups()` 的合并里加新数据源时，先问删除能不能表达。只能按 id 覆盖的合并，任何「消失」型变更都必须配合失效/重取。
- 修 bug：右面板开着时点展开按钮「没反应」——联动 effect 见 !collapsed 立即压回。改归因模型：`foldCause: "user"|"auto"|undefined` + `foldManually()`；effect 只在 cause≠"user" 时自动收，cause==="auto" 且面板关时才自动开。手动展开（cause="user"）面板开着也保持展开。上版 `autoCollapsed` 布尔被替换。
- 搜索框拟态（2026-10-29）试过一版又整体撤回，用户结论是「不要拟态，恢复」。撤回范围：`left-sidebar.tsx` 的 `<label>` 回到 `flex h-7 min-w-0 flex-1 items-center rounded-[6px] bg-v2-background-bg-layer-02 px-2 text-12-regular`（无 shadow、无 transition、去掉 `focus-within`），`tokens/theme.css` 三个生效区块里的 `--v2-elevation-input-inset` / `--v2-elevation-input-inset-focus` 一并删除，当时那版拟态 demo 也删了。现在仓库里 grep `input-inset` 零命中。
- 那版的写法备查（要再试只改一处即可）：底色换成 `bg-v2-background-bg-deep`（与侧栏同色），凹感全部由成对内阴影给出——`inset 1px 1px 2px alpha-dark-14` 暗面 + `inset -1px -1px 2px alpha-light-100` 亮面 + `inset 0 0 0 0.5px` 内描边；聚焦加深到 1.5px/3px 并把内描边换 `--v2-border-border-focus`。深色主题必须反向配：暗面用 `alpha-dark-100`（纯黑），高光降到 `alpha-light-10/16`，因为深色栏底上暗面几乎不成立，靠的是那圈微亮边缘。
- 拟态成立的前提只有一条：**面和它的背景必须同色**，凹感全靠内阴影。原来 `layer-02` 比侧栏亮一档，浅色下近乎白对白（#f2f2f2 vs #fafafa）、深色下又比栏底亮（#2e2e2e vs #080808），无论哪种都读成「凸起的小卡片」，这正是它不好看的原因，不是阴影参数的问题。
- 它还偏离 `packages/ui/DESIGN.md` 的 Elevation 规则（默认扁平，只有菜单/popover/hover card/dialog/toast 这类真浮层才用 elevation token）。如果以后要在别处引入凹面输入控件，先把这条规则补成「凹面输入可用 `input-inset` 系列」再推广，别只加 token 不写规则。
- rail 对齐（2026-10-29）：折叠态和展开态是同一颗折叠控件，位置和尺寸都必须一致。展开态在 `left-sidebar.tsx` 顶部的 `px-1.5` 容器里再套 `px-0.5 pt-0.5`，所以按钮实际落在 x=8、y=10；rail 里子元素是 `items-center`（垂直居中）＋整栏居中，52px 下按钮落在 x=12，看着一收一放就"跳"。修法：折叠态也套一层 `flex w-full flex-col items-start gap-1 px-2 pt-0.5`，并把折叠宽度从 `w-[52px]` 改成 `w-[45px]`——45 = 8 + 28 + 8 + 1（末尾 1px 是 `border-e`，border-box 会从内容宽里扣掉）。拆开写 44px 会差 1px 放不下两颗 28px 按钮。
- 尺寸只有一档：折叠态两颗按钮和展开态「收起左栏」都是 `size-7`（28px），等于 `[data-component="button-v2"][data-size="normal"]` 的高度，也是这一列所有行（`h-7`）的高度。原来折叠态是 `size-8`（32px），比它所在的行还高。
- 底部 dock 触发件（`dock-toolbar.tsx`）也统一到 28px：`rail` 变体从 `flex h-9 w-9`（36px、`layer-02` 自绘底）改成 `<Button variant="neutral" class="size-7 p-0">`，和上面两颗同一原语同一尺寸；`pill` 变体改成 `<Button variant="ghost" class="flex h-auto w-full justify-start p-[5px]">`。开合态用 `data-state={open() ? "pressed" : undefined}`（Button 的 pressed 态就是 `neutral` 的 `background-image` 叠加），不再依赖 `data-[expanded]`——Kobalte 的 `Popover.Trigger` 本身会给 `data-expanded`，但原语没有针对它的样式。
- logo 铺满：`Mark` 是 256×256 的方形 app 图标，四周本来就带自己的圆角边缘，所以 rail 里给 `size-6`（24px）落在 28px 按钮里留 2px，图像撑满控件视觉——原来 `size-[18px]` 在 36px 方块里像一枚小徽章。
- `dock-toolbar` 的 `Popover.Trigger` 现在 `as={Button}`，所以 `aria-label`、`data-action`、`type` 都由 Kobalte 透传到 button；`rail` 下按钮只有图标没有文字子节点，`aria-label` 是唯一可访问名，不能删。
- 确认弹窗（2026-10-29）：侧栏里凡是让一行「消失」的动作，都必须先问一次。此前只有「删除会话」有确认，理由是归档可逆、关闭项目不删数据——但用户看到的是同一件事：点了，行没了。现在三条都走 `dialog.show` + `Dialog/DialogHeader/DialogTitleGroup/DialogFooter`（形状照 `remove`）：单条归档（`dock.session.archive.title` / `.confirm`）、单条恢复（`dock.session.restore.title` / `.confirm`）、关闭项目（`dock.project.close.title` / `.description`）。归档/恢复合并成一个 `setArchived(key, session, archived)`，用布尔值选标题、说明和按钮，避免两份几乎相同的弹窗。关闭项目用 `contrast` 而不是 `danger`：它不删任何东西，红色会谎报严重性；说明句里写明「会话会从侧栏移除，但不会被删除——重新打开该目录即可恢复」，这是弹窗存在的全部价值。原来 `closeProject` 和 `projectMenu` 上「Nothing is deleted, so no confirmation dialog」的注释已相应改写，否则下次读代码的人会以为确认是被误加的。
- 底部 dock 上下间距（2026-10-29）：`<aside>` 自己带 `pb-[var(--shell-bottom-inset,8px)]`，底部分区又写了 `py-2`，于是 divider 到触发件 8px、触发件到窗口边 16px，视觉上「本地工作区」往下坠。改成 `px-2 pt-2`，下边距交给 aside 的 `pb` 承担，两边各 8px。判断这类间距时先看父级的 shell inset 变量，别在子容器里补第二份——补的是叠加，不是对齐。
- `dock-toolbar.tsx` 的 rail 触发件用 `variant="ghost"` + `rounded-[7px]`，静止透明、只显示 `Mark`，hover 与菜单打开（`data-state="pressed"` / Kobalte `data-expanded`）才出现淡底。原先的 `neutral` 让底部那颗和上面的方块排成一列，看起来像多出一个按钮。
- `Mark` 取 `size-6`（24px）：没有底板时图标要吃掉 28px 控件里除 2px 边距外的全部空间，否则读起来是角落里的小徽标。
- 侧栏展开态只有一个横向内缩：每个块各自 `px-2`（外层不再带横向内缩），搜索行、新建会话按钮、项目头、会话行、归档行都落在同一条 8px 边线上。列表容器原先用 `pe-2.5` 给滚动条让位，导致项目头比上面的按钮窄 8px，整列看起来像两套网格；滚动条是 12px 覆盖层、只在滚动时出现，行可以从它下面通过。`ScrollView` 必须全宽，thumb 用 `inset-inline-end: 0` 贴的是它自己的盒子，外层一旦有横向内缩，滚动条就离开侧栏右缘。
- 折叠联动终版是**转移触发**而非状态监听（`left-sidebar.tsx:347`）：effect 只在右面板 open→closed / closed→open 的瞬间执行，内部用 `untrack` 读 collapsed/foldCause，避免面板开着时 effect 跟着 collapsed() 变化重跑（那会把用户点展开立即压回去——两轮 bug 的共同根因）。规则：面板打开瞬间，展开态→折叠并记 cause=auto（已折叠则不动，不覆盖手动意图）；面板关闭瞬间，仅 cause==="auto" 才展开。`foldCause()!=="user"` 的持续门槛版本会让「曾手动展开」的栏此后永远不被面板折叠，已废弃。
- 顶部标签与左栏联动：`viewed()` 让**路由压过 `home.selection()`**——`route.type === "session"` 时用 `groupOf(server, sessionID)` 找归属项目，`route.type === "draft"` 时读草稿标签自带的 `directory`，其余情况才回落到 home 选择。改前 `current` / `isActiveProject` 只读 `home.selection()`，而切换标签只改路由，于是侧栏一直指着上一个项目：正在看的会话被折叠在一个没展开的分组里。
- `groupOf` 先按 id 在 `groups()` 里找（分组已把 sandbox 目录并进来），找不到再退回 `data.session.get(id).location.directory` 比对 worktree / sandboxes：搜索词会过滤掉行，但路由仍可能指向被滤掉的会话。
- 自动展开用 `createEffect(on(() => 当前项目 id, ..., { defer: true }))`，只做「展开」。效果只在项目变化时触发，所以手动折叠当前项目不会被回弹；从别的项目切回来时它自己展开。
- 会话标题悬浮滚动（`packages/app/src/shell/marquee-text.tsx` + `marquee-text.css`）：多行 `/` 的会话标题（侧栏 224px，标题常见 200px+）改成静止省略号、悬停滑出尾巴。三层结构 `[data-slot=marquee] > marquee-track > marquee-label`；`data-marquee="run"` 时把 `overflow:hidden/text-overflow:ellipsis` 从 label 摘掉、只留外层裁剪，否则 label 自身的 clip 框随 translate 一起移动，尾巴永远出不来（这是这类实现最容易踩的坑）。
- 距离必须在**截断态**量：`label.scrollWidth - root.clientWidth`。切成 visible 之后 `scrollWidth` 只报盒宽，距离会塌成 0。
- 时序：悬停 160ms 后启动（防止鼠标划过多行时满屏都在动），时长 `distance*14ms` 钳在 450~3200ms，`cubic-bezier(0.33,1,0.68,1)`；离开 180ms ease-out 滑回并复位。`prefers-reduced-motion` 直接跳到尾巴不滑。标题变更（自动生成标题）走 `createEffect` 复位，避免沿用旧位移。
- 只挂在 `flex-1` 的文字区，所以缩进槽（ps-42px）和右侧时间/「···」上悬停不触发。
- 接入两处：主列表与「已归档」列表的标题；项目名（`left-sidebar.tsx` 的 group 行）暂未接，要的话同一行替换即可。
- 预览：`artifacts/marquee-states.html`（四态：静止/滚动中/到位/短标题），`artifacts/marquee-preview.html`（真悬停 + 逐帧测量，Playwright 验证位移 67px、时长 0.94s、离开后 `overflow:hidden` + ellipsis 复原）。
- 顺带记录：`packages/app` 单测 779 pass / 3 fail，三条（settings search 两条 + visibleTimelineMessages 一条）在 `packages/app/src/settings/` 无改动的前提下也失败，属既有问题，与本次无关。
- 单条删除/归档必须自己发 `notifySessionTabsRemoved`：`packages/app/src/shell/left-sidebar.tsx` 的 `remove()` 与 `setArchived()` 原来只调 `ctx.data.session.remove()` / `.sync()`，而 `data.session.remove` 只在 `createSessionMutations` 里记一条 remove 变更，不碰标签，所以顶部会话标签会留在那儿指向已消失的会话。
- 参照写法在 `packages/app/src/home/sessions/controller.tsx`（单条删除带 `sessionTreeIDs`）与 `packages/app/src/home/sessions/archive.ts`（单条归档只发自己）。删除要带上整棵子树，否则删掉的父会话留下子 agent 的孤儿标签。
- 批量路径 `archiveBatch` / `deleteBatch` 早就发了，单条路径是漏的；清理标签的责任在发起方，不在 `data.session` 层，新加会话删除/归档入口时按这两处对齐。
- 激活会话的左侧竖条原来在 `start-[30px]`，正好落在项目头像列（20–36）中央，看着像从图标里长出来的一条线；改到 `start-[20px]`，与头像左边缘严格对齐，两级共用一条左边缘（`left-sidebar.tsx` 激活行 Show 内）。实测文字都在 42px 没动。对照 artifacts/active-mark-preview.html。
- 右侧对齐：项目行 button 是 `pe-2`、会话行是 `pe-1`，导致项目行的 pin/转圈比会话行右端的转圈/时间靠左 4px；项目行改 `pe-1`，两行右端落在同一列（实测 216→220 变 216/216 同列）。左边缘本来就齐：项目名与会话标题的文字起点都是 42px（ps-1 4 + chevron 10 + gap 6 + avatar 16 + gap 6）。对照 artifacts/sidebar-end-preview.html。

## harness 止损机制

- packages/core/src/session/runner/ 已有完整止损层：loop-detection.ts（fingerprint + 先 nudge 后 stop，LOOP_MIN_REPETITIONS=3，NEVER_NUDGE 白名单含 todowrite）、completion-gate.ts、failure-streak.ts、explore-budget.ts；prompt-prefix.ts 有 cache 指纹；project-memory.ts 有 dedupe。做新 nudge 前先看这些，别重复造。
- 缺口：loop-detection 只匹配「同参数 + 同结果」的完全重复（same_calls_and_results / same_calls_only），抓不到「同一文件换不同命令或参数反复查」——Flash 那次查 package.json 用 Select-String / python json 轮流来就漏网。真要补，是补这个缺口，不是另起一套。
- 长输出落盘已实现（shell.ts:78 描述：满结果写文件 + 截断预览），对应 Cursor dynamic-context-discovery §1，无需再做。
- 未确认两项：一轮内多工具调用是否并行（model-request.ts:386 把 executeTool 交给 AI SDK，runner 无 concurrency 原语）；MCP 是否全量 schema 进 catalog（Cursor 是 per-server 目录懒加载）。
- 本地逆向稿 D:\软件丨工具\cursor逆向专区\文档\Cursor-四层工程逻辑对照.md §3/§4.2 明确「不要抄大段 DO NOT 清单；每条规则必须是工具行为定义或结构校验」，且声明无任何本地二进制证据（app/code/tools 目录空，asar 未解）。
- 并行执行：已实现。session/runner/step.ts:122-134 对流里的每个 tool-call 事件 fork 一个 fiber（Effect.forkScoped），最后 Fiber.awaitAll 汇合；注释 step.ts:103 说明每源保序靠各自 fiber 串行发布，不靠共享写队列。所以一轮内多个工具调用是**真并发**，不是串行。缺的是模型愿不愿意一次发多个，不是执行层。
- 依赖栅栏：step.ts 没有 wait_for_previous 类字段，依赖顺序靠模型自觉。但因为并发是真的，同时改同一文件有 tool-write-lock（core/test/tool-write-lock.test.ts 覆盖）兜底。
- MCP 动态加载：已实现且比 Cursor 更进一步。core/src/codemode/instructions.ts:13-15 只渲染部分目录（catalog.shown < catalog.total），超出时用 search() 查；packages/codemode/src/tool-runtime.ts:175 「Search ranks paths and descriptions first; only returned matches need their schemas rendered」——正是 Cursor dynamic-context-discovery §4 的效果，且是运行时函数而非落盘目录。
- 结论：逆向稿 §4.2 建议的 2（并行栅栏）与 4（MCP 目录化），SiCode 都不缺。真缺口只剩 loop-detection 覆盖不到「同文件不同参数反复查」。
- 新增重复探查检测：packages/core/src/session/runner/loop-detection.ts 的 detectRepeatedProbe()。detectLoop 要求「同参数+同结果」，模型换着花样查同一文件（grep → Select-String → python json）就漏网；新检测按文件计数，写入即清零（读回校验不算），每步对同一文件只计一次。
- 路径提取 touchedPaths()：结构化字段 path/filePath/file/dir/directory + 对命令文本扫 PATH_TOKEN；必须含分隔符或命中 FILE_EXTENSIONS 白名单，否则 `json.load` 这类点号调用会被当文件（真实会话里误报过一次）。绝对路径与相对路径用 samePath 后缀比较视为同一文件。
- 介入方式：steer.ts 新增 probeNudged（字符串=路径），排在 loopNudged 之后、failureNudged 之前；**只 nudge，绝不 stop**（模糊检测，误停代价太大）。llm.ts 里 probeNudged 是 per-turn Set，每个文件只报一次；runStep 需要显式传参（它不是 drain 内的闭包，是独立 Effect.fn）。
- 真实会话回放（ses_e7c562f2，87 步）介入 4 次：step22 package.json（核心病理）、step40 solid-js 内部文件（发散）、step59 theme.css、step64 utilities.css；left-sidebar/dock-toolbar 的「改完再读」未被误伤。
- 本仓库既有失败（与本次改动无关）：session-runner.test.ts 的 compaction 用例、session-runner-recorded 的 5s 超时用例，基线同样失败。

## shell 扫描器

- 落地：packages/core/src/tool/plugin/shell.ts 的 description() 之前是**空参调用**（第 332 行），所以「Commands run on ${OS} using ${shell}」这行从来没渲染出来过，模型一直不知道自己在什么 shell 里。现在注册时解析 shellSelect.resolve({priority:"config"}) → ShellSelect.name() 得到方言名（pwsh/bash/cmd），传入 description()，并在 ps(shell) 为真时追加两句工具行为定义：here-string 与输入重定向非法、多行 stdin 先写文件再 Get-Content -Raw 管道。带 SiCode 注释。
- 验证：ShellSelect.name 对完整 Windows 路径 "C:\Program Files\...\pwsh.exe" 也返回 pwsh，ps() 返回 true；bash/cmd 不触发。tsc 干净。
- 注意：test/tool-shell.test.ts 在本机有环境相关抖动（基线两次跑分别 16 / 8 条 fail，带改动 10 / 5 条，都是 pwsh 相关用例），判定改动前后需多跑一次对照，别只看单次数值。

## 项目头像色板

- 头像色板在 `packages/ui/src/styles/tokens/theme.css` 的三处（root 浅色、`[data-color-scheme="light"]`、`[data-color-scheme="dark"]`），必须三处同步加；`packages/ui/src/data-display/project-avatar/project-avatar.css` 再加一条 `[data-variant="…"]` 映射。
- 新增色还要动 `PROJECT_AVATAR_VARIANTS` 和 `getProjectAvatarVariant` 的白名单（它是逐个 `===` 判断，不是查表），以及 `packages/app/src/runtime/i18n/en.ts` 的 `common.color.*`；漏加词典键时 typecheck 会卡住，是有效防线。
- `lime` 和 `mint` 已经是 `getProjectAvatarVariant` 里的历史别名（分别映射 green/cyan），新颜色不能叫这两个名字，否则用户选中的颜色会被解析成别的色。
- 已上线的 9 组色对可以反推出两条稳定规律：浅色边框 = 同 H/S、L 乘 0.87（9 组全部吻合，误差不超过 1.4pt）；暗色底 = 同 H、S 乘 0.8、L 乘 0.58，暗色边框 = 同 H/S、L 乘 1.14 并截到 72。加新色按此推导，不要取平均值，平均线在暗色上会偏 8 到 12pt。
- 选色先量化再决定：现有 9 色在 OKLab 下的最小间距是 7.0、白字最低对比度 1.98（yellow），新色必须同时越过这两个下限才算看得清区别且字还读得清。脚本在 `.sicode/scratch/palette-check.mjs` 和 `palette-derive.mjs`。
- 变体数量变化会让 `DERIVED_VARIANTS` 的长度变，所有项目派生出来的颜色会重新分配一次；这是纯展示层派生（不写库），只影响观感，不覆盖用户手动选过的颜色。

## 数据迁移 toast

- toast「数据迁移失败 / Transport: Failed to fetch」来自 desktop/src/renderer/migration-status.tsx（zh.ts:766 文案）：渲染进程每秒轮询 /api/experimental/migration/v1，任何异常都 toast。ClientError("Transport", cause)（client/promise/generated/client-error.ts:8）只表示 fetch 层连不上 sidecar；真正迁移失败是服务端返回 status:"error"（v1-migration.bun.ts:519 记录 error 文本）。
- 实证（本机）：opencode-local.db 里没有 V1 `session` 表、只有 session_v2，即无需迁移；sidecar 活着（GET /api/experimental/migration/v1 返回 UnauthorizedError 而非连接失败）。所以弹窗是启动瞬间连不上的误报，无数据风险。迁移本身可断点续传（cursor 写 kv 表 migration.v1-v2）。
- 修复：Transport 类错误放进 30s 宽限期静默重试（isTransportError 用 name==="ClientError" && message 以 "Transport:" 开头，因为 ClientError 未从 index 导出），只有 status:="error" 或超过宽限才 toast。tsc 干净。
- 排除代理嫌疑：desktop-initialization.ts 中 loadProxyEnvironment（内含 ensureLoopbackNoProxy，补 127.0.0.1/localhost/::1 到 NO_PROXY）在 29 行，syncSystemProxy 在 34 行且只 ??= 写 HTTP(S)_PROXY、不动 NO_PROXY，本地请求始终免代理。

## 会话加载态

- `packages/app/src/session/screen.tsx` 的会话分支（`<Match when={session.identity.params.id}>`）原来只在 `messagesReady()` 为真时渲染 `timelineView()`，为假时除页头外什么都不画，所以冷启动落到会话标签页时整块正文是空的。
- `messagesReady` 来自 `session/timeline/model.ts` 的 `ready` memo：`resource` 已解析到当前 id，或 `data.session.message.list(id)` 里已有非 inbox 消息时为真。因此 `!ready` 等价于"一条可显示的消息都没有"，加载态只会出现在真正空白的首屏，不会在切换已加载过的会话时闪一下。
- 加载 UI 抽在 `packages/app/src/session/session-loading.tsx`（`Spinner` + `session.messages.loading`，文案各语言都已有）。两处调用：`screen.tsx` 的消息区、`route.tsx` 的 `PendingSessionState`（`data.session.get(id)` 还没拿到 directory 时）。
- `screen.tsx` 里页头与时间线/加载态现在包在一个 `flex size-full min-h-0 flex-col` 容器里：父级 `relative flex-1 min-h-0 overflow-hidden` 是块级元素，子级 `flex-1` 不拉伸；加容器后加载态才能占满剩余高度而不压住页头。
- `packages/app/src/session/route.tsx` 的 `PendingSessionState` 直接复用同一组件：`SessionPanelFrame` 本身是 flex column，页头下方 `flex-1` 直接生效。
- 更正上一条的布局做法：最终没有加 flex 容器（时间线在父级里按自身 `h-full` 量高度，多一个兄弟节点会让它重算）。`screen.tsx` 里加载态是一个 `absolute inset-0 flex` 的覆盖层，只在 `!messagesReady()` 时挂载，时间线照旧。
- `packages/app/src/session/session-identity-header.tsx` 的页头是 `sticky top-0 z-30`，覆盖层的父级 `relative` 已存在，不需要调整层级；但覆盖层会盖住页头，所以只在页头也处于加载态（`isDesktop() && !messagesReady()`）时一起出现，两者同时消失。

## 协作定位 / 交付边界

- 2026-10-29 定调：**这里的协作关系是开发 SiCode 本身**。用户是 SiCode 的开发者，不是它的终端使用者（用哪个开发工具是个人选择，不写进文档）。默认交付物 = packages/* 下的代码改动，要能随仓库/安装包抵达下一个用户；只改本机环境（用户级配置、安装命令、「你重启试试」）不算交付，那只在一台机器上生效。
- 反面案例：LSP 符号跳转的收益被我做成了往 `~/.config/opencode/opencode.jsonc` 写 `lsp.typescript` 段 + 建议对方重启跑两天看数据 — 三处错：① 改的是用户本机、进不了产品；② 把开发者当测试员；③ 后续还顺着讨论「要不要再装 CSS/Astro language server」，继续在优化一台机器而不是产品。正确形态是把能力做进产品（例如检测到 `tsconfig.json` 自动接 language server），本机只作验证场地。
- 判据一句话：这个改动会不会随仓库/安装包抵达下一个用户？不会 → 它只是验证手段，交付时必须明说这层区别，不许包装成成果。
- 由此重排的优化待办形态（都是改代码，不是改本机）：batch 并行段落提进 `session/runner/prompt/system.txt`（覆盖无 provider 命中的模型，现在只有 7 个 provider txt 有）；shell 轮询（`Start-Sleep -Seconds N; Get-Content f`）在 `tool/plugin/shell.ts` 运行时拦截；LSP 做成自动检测接入。
- 本机 `~/.config/opencode/opencode.jsonc` 由上面那条已加的 lsp 段处于「待决」状态：它是验证用的临时配置，不是产品交付，含 provider 凭据故不能进仓库；原文件已备份 `opencode.jsonc.bak-1029-0514`。

## 正文渲染

- 引用块二次改版（用户嫌 accent 硬竖条+半圆角不好看）：`packages/session-ui/src/components/markdown.css` blockquote 改「圆角软卡片（radius 8 + accent 6% 淡底）+ `::before` 内嵌药丸条（3px、radius 999、inset-inline-start 5px、上下各留 10px、accent 65%）」，padding 10px 16px。对照 demo artifacts/markdown-polish-demo.html §② 的「现状」列设为旧硬竖条（.was-quote）、「提案」列为新样式，预览 artifacts/blockquote-preview.png。
- 注意 `bun test` 在 session-ui 会误跑 component-tests/*.spec.ts（Playwright 用例，报 "did not expect test() to be called here"），与单测无关；单测 39 pass。
- 列表美化（`markdown.css` Lists 段）：`li::marker` 降为 `--v2-text-text-faint`（原来符号=正文色，在塞满行内代码的列表里跟正文抢眼）；ul/ol 缩进 32→24px（ol 28px，给两位序号留位）；li 间距 8→6px；补 `li > ul, li > ol { margin: 6px 0 0 }`。demo 加 §⑦ 列表对照（`.was-list` 现状 / `.proposal` 提案，内容取自用户真实会话那段 ScrollView 列表）。
- 验证方式：Playwright + CentBrowser `executablePath` 读 `getComputedStyle(li, "::marker").color` 与 padding/margin——截图肉眼分不出 24/32px 和 faint 差异，必须读计算样式。
- 验证方式：Playwright + CentBrowser `executablePath` 读 `getComputedStyle(li, "::marker").color` 与 padding/margin——截图肉眼分不出 24/32px 与 faint 差异，必须读计算样式。
- 列表改成软容器（用户要求「美化成容器」）：`markdown.css` 的 ul/ol 加 `background: color-mix(in oklch, var(--v2-text-text-base) 5%, transparent)` + `border-radius: 8px` + `padding: 10px 16px 10px 36px`（36 = 16 呼吸 + 20 符号位），margin 统一 14px；删掉 ol 单独的 28px 覆盖。嵌套 `li > ul/ol` 保留 20px 缩进但 `background: none; border-radius: 0`（子行不是块）。淡符号（`li::marker` faint）保留。
- demo §⑦ 现状=淡符号+紧缩进（.was-list），提案=容器版（.proposal）；新增一段有序列表验证序号不被容器边缘裁掉。预览 artifacts/list-container-preview.png。
- 验证手法：Playwright 指定 CentBrowser executablePath；截图用 `locator("#sec-list").screenshot()` 而非 --screenshot + #anchor（后者在本机 headless 会截到空白）。
- 行内代码片二次改版（用户点名「包括 `<div class=...>` 这些背景」，即丑的是代码片不是列表骨架）：`markdown.css` 的 `--markdown-inline-code-bg-mix` 14% → 8%，`:not(pre) > code` 的 `color` 从 `--v2-text-text-base` 改为 `--markdown-inline-code-color`（= `--v2-text-text-code-accent` 蓝），并加 `box-shadow: inset 0 0 0 1px` 7% 内描边（用 box-shadow 不用 border：border 会改 metrics，而 path 属性是异步到达的，必须保持 paint-only）。
- 关键判断：原来「14% 灰底 + 正文同色文字」= 一块没有身份的补丁，一行五个就成了补丁墙；改成靠**颜色**而不是**深色块**表明「这是代码」。对比页 artifacts/inline-code-variants.html（A 现状 / B 只减淡 / C 已落地），截图 artifacts/inline-code-variants.png。
- 列表容器（5% 淡底+圆角）用户此前判为「也不好看」，但根因疑似是代码片太重；代码片减淡后需重新评估，四方案页 artifacts/list-variants.html 仍在。
- 第三版重设计（换模型后重做，块引用不动）：方向从「给列表/代码加表面」反转为「让它们更轻」。列表彻底去掉容器（此前 5% 淡底+圆角 8 被判难看），改 `margin: 16px 0` + `padding-inline-start: 22px` + `ul { list-style-type: none }` 配自定义 `ul > li::before` 5px 圆点（`inset-inline-start: -13px; top: 0.62em`，text-base 30%）+ `li + li { margin-top: 7px }`；任务行用 `:has(input[checkbox])` 排除圆点；嵌套列表 18px 缩进无容器。
- 行内代码同步收紧：`font-size: 0.92em`（mono 比正文宽，缩一档才不抢眼）、`--markdown-inline-code-bg-mix` 6%、文字 `color-mix(code-accent 78%, text-base)`、`padding: 0.1em 0.34em`、radius 5、内描边仍用 box-shadow（不改 metrics）。
- 新增终版 demo artifacts/markdown-redesign.html（完整一条回答：正文/无序/有序/嵌套/任务清单/行内代码/块引用），浅色 artifacts/markdown-redesign.png、深色 artifacts/markdown-redesign-dark.png；旧 demo 的 §⑤/§⑦ 提案列已同步成新实现，避免两份说法打架。
- 计算值核对（Playwright）：ul 背景透明、缩进 22px、圆点 5px、行距 7px、ol marker faint、code 13.8px(0.92em)/底 6%。
- 列表定案：方案 C「左侧 1px 细线」（用户在 artifacts/list-pick.html 四选一中选中）。`markdown.css`：ul/ol 加 `padding: 2px 0 2px 18px` + `border-inline-start: 1px solid color-mix(text-base 12%)`；`ul>li`/`ol>li` 加 `margin-inline-start: 10px`；圆点仍 5px/30%；`li + li { margin-top: 8px }`；嵌套 `li > ul/ol` 显式 `border-inline-start: 0` + `padding-left: 18px`（线套线会读成目录）。
- 线的颜色不能用 `--v2-border-border-muted`：那是 8% 白，在 #080808 画布上直接消失（计算值验证）。12% 文字色在深浅两套都可读。
- 四选一页 artifacts/list-pick.html（A 灰点 / B accent 点 / C 细线 / D 短横线），关键做法：**页面本身不加卡片外框**——上一轮四选一被误读成「整个消息是个容器」，就是因为方案页的 `.cell` 卡片底。
- 覆盖面核查：blockquote / 列表 / 行内代码全部只定义在 `packages/session-ui/src/components/markdown.css` 的 `[data-component="markdown"]` 作用域内，所以所有会话内渲染（回答正文、reasoning 思考块、工具输出、问答卡片、压缩摘要）自动同步。`message-part.css`（reasoning 用 `--font-size-small`+muted）与 `session-compaction.css` 只覆盖字号/颜色，不重复定义引用块。表格放大浮层是 `[data-component="markdown-table"]` 专用组件，不渲染 blockquote，无需处理。
- 真漏一处并已修：引用块**内部**的列表会多出一条竖线贴在 accent 药丸条旁（双重边框感）。加 `blockquote :is(ul, ol) { border-inline-start: 0; padding-inline-start: 6px }` + `> li { margin-inline-start: 8px }`。测试页 artifacts/quote-nested-test.html（含引用块内列表+代码）。
- 唯一未覆盖：公开分享页 `packages/web/src/components/share/content-markdown.module.css`（自用 `[data-slot="markdown"]` 一套独立样式），本机桌面端不涉及。
- 行内代码颜色改绿（用户：「代码不能搞蓝色，不然还以为可以点的，就跟代码高亮样就行了」）。根因：`--v2-text-text-code-accent` 在浅色主题是 blue-900，和 `--markdown-link` (#3b7dd8) 同一蓝族，读起来像可点链接。改用 `--markdown-code`（浅 #3d9a57 / 深 #7fd88f，主题里 markdown 代码专用绿），去掉原先 78% 混正文色的 color-mix（会把绿洗淡）。
- 文件路径类行内代码（`code[data-inline-code-kind="path"]`）**保持蓝**：它真的可点（`[data-local-links]` 下带 cursor:pointer + hover 下划线），蓝色此时是正确语义，不能统一改绿。
- 顺带确认：`--markdown-link` 深色是 #fab283（橙）、浅色 #3b7dd8（蓝）——所以「蓝=链接」只在浅色成立，但用户体感如此，按用户的场景改。
- 行内代码真·多色高亮：新增 `packages/ui/src/context/inline-code-highlight.ts`（约 60 行、零依赖、sticky 正则逐 token 扫描），配色直接引用 `--syntax-*`（与代码块同一套 palette）：标签 `syntax-type`、属性/声明属性/自定义属性 `syntax-property`、字符串 `syntax-string`、数字带单位/短横线开关 `syntax-constant`、函数调用 `syntax-primitive`、注释 `syntax-comment`、标点 `v2-text-text-faint`；标识符**不染色**继承正文色（避免彩虹）。挂载点在 `marked-base.tsx` 的 `codespan` 渲染器（不是 marked-parser 的 code 扩展），这样小/同步路径和 worker 路径产出完全一致（`parseSmallMarkdown` 与 worker 共用 base）。
- 判词陷阱：CSS 自定义属性规则必须写 `--(?:[a-z][a-z0-9-]*)+(?![\w-])`。最初写 `--[a-z][\w-]*` 会把 `--noEmit` 吃掉一半（`--no` 被染成属性色、`Emit` 掉回正文），加尾部边界整体失败后才落到 flag 规则。
- 标题层级修 bug：h3 原本用 `--font-size-small`(14px) 比正文 15px 还小，层级倒挂。改为阶梯 20/16/15/14（h4 单独 14），h3 靠 600 字重 + 间距承担层级；h5/h6 muted。依据 `packages/ui/DESIGN.md` 的 12/14/15/16/20 阶梯（文档明确 12.5/11.5 是手调残留要收敛）。
- demo 改为**真解析器生成**：`artifacts/build-markdown-demo.ts` 用 `createMarkdownParser()` 渲染样例，并把 `markdown.css` 原文内联进页面 —— 预览与实现不再可能脱节（之前手抄样式两次出现文档与代码不一致）。
- 测试：新增 `inline-code-highlight.test.ts` 6 条；`marked-parser.test.ts` 里 `<example>` 断言改为两个 span（tag + 括号）。ui 135 pass、session-ui 57 pass、两包 tsc 干净。
- 代码块「还原 + 行号」：① 去掉今天加的 `pre { max-height: 400px }` 限高（长代码被压成 400px 窥视孔），保留 `overflow-x: auto` 与细滚动条；② 新增行号槽：`markdown.tsx` 的代码块构建处（唯一构建点，全仓只有 `pre.className="highlights"` 这一处）在 `<pre>` 内先插 `<span data-slot="markdown-code-gutter" aria-hidden>` 再插 `<code>`，`syncLineNumbers()` 用 `code.textContent.split("\n").length` 计行；流式更新时若行数未变就跳过（`dataset.count` 比对）。
- 行号是**一个 span 内含换行文本**，不是每行一个元素：300 行也只多一个节点；`white-space: pre` + `tabular-nums` + `text-align: end` 让数字右对齐，靠行高与代码行同步（代码块不软换行，源码一行=视觉一行）。
- 布局：`[data-component="markdown-code"] > pre { display: flex }`，gutter `position: sticky; inset-inline-start: 0` 抗横向滚动，`background: inherit`（继承卡片底色）+ `border-inline-end` 1px 8%；`pointer-events: none` 免干扰选择。
- demo（`artifacts/build-markdown-demo.ts`）里把解析器产出的 `<pre class="highlights">` 包成运行时同款结构（wrapper + gutter + code），这样预览与运行时形状一致，行号可被看见。
- 校验：session-ui tsc 干净、markdown 相关 33 pass。
- 代码块行号在真机缺失，根因是**代码块有两个收尾点**（`packages/session-ui/src/components/markdown.tsx`）：流式的 `updateCodeBlock`（约 1040 行）本来会插行号槽；静态 HTML 分支的 `applyBlock`（约 953 行，包 `pre > code` 时只加了 `data-component` 和复制按钮）不插。已保存的回复走 `completedProjection()` → 单个 `mode:"full"` 块 → 静态分支，所以打开历史会话就看不到行号；流式生成时反而有。
- 修法：在 `applyBlock` 的包裹循环里补 `pre.prepend(createLineNumbers())` + `syncLineNumbers(pre, code.textContent)`，与流式分支调用同一对函数。改后不论 `full` / `code` / 流式三种来源都会带行号。
- 教训：这个组件里「HTML 来源」和「块来源」是两套 DOM 生产路径，任何对代码块的装饰（复制按钮、mermaid、行号）都要两边都挂；只测流式会漏掉历史渲染。
- 验证限制：`bun test` 下无法挂载 Solid 组件（bun 原生 JSX 不走 solid 编译器，`DialogProvider` 直接报 `jsxs_xxx is not defined`），组件级验证只能靠 storybook 的 Playwright 组件测试（本机未装 playwright 浏览器）；本次以读码 + `vite build` 通过 + 既有 demo 的干槽（同一对 helper、同样 parser 形状的 `<pre>`）为依据。

## 长会话与上下文压缩

- 同行做法（2026-10-29 调研）：**Claude Code** 压缩后自动重读「最近修改的 5 个文件」，超过 5k token 的文件只回填路径（`Referenced file`），并从磁盘重注入 CLAUDE.md / plan / auto memory / git status / skill 正文；**Codex** 摘要四块（进度与决策 / 约束与偏好 / 剩余 TODO / 继续所需关键数据），保留全部用户消息原话，新上下文 = 初始上下文 + 最近约 20k token + 摘要，单条工具输出在记录时就按 10k token 截断，自动压缩阈值硬夹 90%；**Cursor** 用「耐久块」而非摘要承载状态（plan 全文、最新 todo、transcript 文件位置、未关闭订阅），且「开始压」和「允许落盘」是两个阈值，后台摘要在途可跨回合收养；**Anthropic API** 层的 `clear_tool_uses` 是选择性清除旧工具结果而不是摘要，实测单用 +29%、配合 memory 工具 +39%。
- SiCode 原本已有：检查点模板（Objective / Requirements / Decisions / Work State / Next Move / Relevant Files≤15 / Important Context）、最近 15k token 原文尾、压缩前 transcript 指针、以及跨会话的 project-memory 事实。**短板不在摘要质量，在摘要之外什么都没留**。
- 新落地 1（`packages/core/src/session/compaction-durable.ts`）：压缩时把「最近改过的文件内容 + 最新 todo 清单」作为 `<working-files>` 块写进 checkpoint 的 metadata，由 `packages/core/src/session/runner/to-llm-message.ts` 渲染在 `<recent-context>` 之后、transcript 指针之前。文件内容用 `<file path="...">` 标签而不是 markdown 围栏 —— 代码里带反引号会把围栏打坏。
- 规则：编辑类工具（edit / write / patch）优先于只读过的文件；最多 4 个文件；被编辑的文件上限 12000 字符，只读过的 4000 字符；总量 24000 字符且不超过压缩预算的 5%；跳过大于 512KB、含 NUL 的二进制、以及已不存在的路径。内容为压缩时刻的快照，块内明说是快照 —— 拿旧内容编辑会因 `oldString` 不匹配而失败（大声失败，不会写坏文件）。
- 实测（把真实 12 小时会话的工具调用回放进 collect）：产出 2 个文件 / 24402 字符 / 约 7626 token，占 200k 窗口 3.8%，主要是 `packages/app/src/shell/left-sidebar.tsx` 和 `.sicode/notes.md`。
- 新落地 2（`packages/core/src/session/compaction.ts`）：`precompute` 默认值由 false 改为 true（85% 阈值、64k 以下不启动、失败 2 次停），压缩不再必然卡在关键路径上。`test/session-compaction.test.ts` 里原来那条「background summaries stay off unless enabled」改为显式关闭再断言，并新增一条钉住默认值。
- 为什么做这两条（真实会话 ses_e7c2b57ecffe0dBHGxXuqNhsgy 的数据）：44 回合 / 792 步 / 16 次压缩；read 218 次里 66% 是重复读，其中 68 次跨越压缩点；压缩后 6 步内 48 次 read 有 90% 是已读过的文件；read 输出中位 12411 字符，91% 超过 `packages/core/src/session/recent-text.ts` 里 1250 字符的截断线 —— 也就是说压缩后那些文件等于没读。
- 未做，留观察：`packages/core/src/session/recent-text.ts` 的 1250 字符截断仍对全部工具输出生效，耐久块只覆盖最近 2~4 个文件；要让其余文件也可编辑，得按工具类型区分截断（read 放宽、shell 维持）。另外自定义 compaction 插件提前返回的那条路径不会生成耐久块。
- 已知测试失败：`test/session-compaction.test.ts` 的「summary compaction past the ceiling keeps the conversation unchanged while the window fits」在本次改动前就失败（用 git stash 回到 HEAD 复验过，同样 3→2 消息数不符），与本次无关，未处理。

## 输入处理 / 澄清

- 四项输入侧改进的实测触发频率（2026-10-29，本机 302 条用户输入 / 500 次 read）：① read 的 file-not-found 只有 9 次（1.8%），现行双向子串建议已命中 5 次，改成 stem/编辑距离**新增命中 0 次** → 不值得做；② 把 kimi 那两条（混合输入照做、用用户语言回复）提进 `packages/core/src/session/runner/prompt/system.txt` 无收益 —— 不加任何语言指令时模型中文回复率已是 95%（131/138），乱输入的纠正率 2.7% 与规整输入 2.4% 无差；③ context-hints 有 59% 的可处理消息抠不到词，但其中 **84% 是纯中文口语**，文件路径是拉丁字母、文件名模糊查找也救不了，可救的只有 16%（约 19 条，且词是 api/vpn 这类噪声）；④ 澄清只在 10.9%（33/302）的消息上触发。
- 澄清已落地：`packages/core/src/session/clarify-hint.ts`（纯函数 `assess()` + `inject()`，无 Service/Layer，便于回放真实数据），接在 `packages/core/src/session/context.ts` 里紧跟 context-hints 的同一注入点。只在「回合起始」（最后一条用户消息之后还没有 assistant/shell）注入，请求级、不写会话，system 前缀不受影响，因此不吃缓存。开关 `OPENCODE_CLARIFY=0` 默认开。
- 规则：长度 ≤24 字 + 含动作词 + 无任何锚点（路径/文件后缀/≥5 字母标识符/数字/URL/引号）+ 非疑问句（吗呢啥什么怎么为什么哪如何多少是不是 ?？）+ 非续写（继续/好/嗯/ok）+ 不含许可词（随便/随意/都行/你定/看你/whatever）。缺什么就只说缺什么：目标（"which file, module, or symbol"）与交付形态（生成类）或完成标准（修改类）。
- 关键是**两档而不是强制提问**：先要求模型用一行写明它采取的读法，只有当两种读法都成立且会引出不同工作时才用 question 工具问一句。早期版本是「必须先提问」，实测会在中途短消息上变成打扰（"你帮我修复好" 指向刚讨论的 bug，问「哪个文件」是错的）。
- 反向证据（必须记住）：欠约束消息之后下一句是纠正的比例 **0/26 = 0%**，其他消息后是 7/254 = 2.8%。所以「欠约束导致返工」这个前提**没有数据支持**。26 个样本按 2.8% 基准期望只有 0.7 次纠正，观察 0 不能证明无收益，只能证明无证据 —— 因此这条按「成本极小（约 100 token、覆盖 11% 回合）+ 失败模式对称（最坏是没效果）」保留，靠后续 A/B 决定去留。
- 意外发现（下一项候选，比澄清更值钱）：**纯提问的回合里有 35%（41/117）模型仍然写了文件**。最典型的一次是会话 ses_e86496d5fffdDmGWD22vIMhqrG：用户连续问「网页版反代卡在哪」，模型连做 3 次 edit 改 nginx.conf 与文档，用户回「撤掉所有文件，我问你问题没让你改东西」。这条的改法是「提问回合先说明要改什么、等确认再动手」，但不能做成「提问就不准写」——"新建一个订阅可以吗"这类问句本身就是许可请求（该回合写到 53 次），必须 A/B。

## 设计值注入

- 动机（实测）：`AGENTS.md` 已经写了「改 packages/ui / session-ui / app 的 CSS 前先读 packages/ui/DESIGN.md」，但本机 510 次 read 里只有 **5 次**打开了它，同期 `packages/{ui,session-ui,app}` 下写了 **245 次**。指令不被执行 → 规范根本不在场，每个组件各有一套字号/圆角。
- 落地 `packages/core/src/session/design-hint.ts`（`condense` / `needed` / `inject`），接在 `packages/core/src/session/context.ts` 里与 context-hints、clarify-hint 同一注入点。仅在「UI 回合」注入，请求级、不写会话；开关 `OPENCODE_DESIGN=0`。
- 触发条件（都不看模型意图，只看可观测事实）：① 本轮用户消息含设计词（样式/字体/字号/字重/圆角/间距/阴影/深色/浅色/主题/界面/布局/对比度，或 css/scss/typography/theme/radius/elevation/contrast 等英文词）；② **上一轮**编辑过 UI 文件（`.css|scss|sass|less|styl`，或 `.tsx|jsx|vue|svelte|astro|html` 且路径不在 core/server/api/sdk/scripts/test/fixtures/cli/tui 下）。只回溯到上一条用户消息为止 —— 否则一次 CSS 改动会让这个会话之后每个请求都背上 ~1k token。
- 路径判据用**反向排除**而不是白名单：`packages/app/src/shell/left-sidebar.tsx` 这种组件既无 `ui` 也无 `components` 字样，按名词白名单会漏判。
- 压缩规则：按 `##`/`###` 切节 → 只留值类章节（font/weight/type/scale/space/radius/elevation/color/token…），丢掉 Known drift / Changing a surface 这类历史与流程；表只留有 `token` 或 `--` 表头的（逐 face 解释 400 怎么解析的那张表属于解释，丢弃）；散文只取句子，句界是「中文句号」或「英文句点+空格」——`0.25rem`、`e.g.` 不是句界（按标点硬切曾把 0.25rem 切成两句）。
- 每个散文行取**前 3 句**（上限 460 字符），不按关键词挑句：试过按「含 token / 含 only-must 类规定词」打分挑选，结果把「上游还有硬编码 440/530」这句挤掉了 —— 而它正是让权重改动做不干净的那条。文档顺序有效，别自作聪明。
- 章节按「决策频率」排序输出：Type scale → Radius → Space → Elevation → Weight → Font stack → Color；预算按**整节**丢弃（半张表比没有更糟），默认 3000 字符。
- 实测产物：本仓 `packages/ui/DESIGN.md` 6552 字符（≈2048 tok）→ 压缩 2933 字符（≈917 tok，45%），7 个章节全保留，关键规则全在（12/14/15/16/20 阶梯、10px 圆角上限、4·8·12·24 栅格、只有浮层用 elevation、440/530 硬编码、不许在组件里写裸 hex）。加上 `<design-values>` 包装共 ≈1012 tok。
- 为什么每步请求都重复注入而不是只做一次：synthetic 消息不落盘，回合内第 3 步编辑时如果不再注入，模型手里就没有这些值了；而注入位置固定在用户消息之后，前缀稳定，命中提示词缓存。一次性注入（像 context-hints 那样）适合「首步选文件」，不适合「第 N 步写组件」。
- 验证：`test/design-hint.test.ts` 13 项（表格/规则/caveat 保留，Known drift 与非 token 表丢弃，章节排序，按整节裁剪，空文档返回 undefined，三种触发与两种不触发，四类 inject 行为）；core typecheck 1744 文件 0 错误；相关 6 个测试文件 81 pass。
- 未验证：模型拿到这些值后是否真的少犯「自创字号 / 乱加圆角 / 到处加阴影」的错。要等真实 UI 会话对比。

## 浏览器只读模式（browser.read / browser.write）

- 操作在 `operation()` 上标 `access: read|write`；权限名拆成 `browser.read` / `browser.write`。
- 默认 deny 两条；attach 的 `access` 默认 `full`（兼容老面板），面板 UI 默认关=只读，就地 `rpc.access` 重算权限，不重建 attachment。
- evaluate=写；navigate/tabs.open/reload/scroll=读。只读下写工具被 whollyDisabled 从工具表移除。

## 界面字体

- **system-first 栈 = workbuddy 参考实现（2026-10-29 固化，提交 064ba80a4a）**：当前 `--font-family-sans` = `-apple-system, BlinkMacSystemFont, "PingFang SC", Helvetica, Arial, "Microsoft YaHei", "微软雅黑", "思源黑体", "Source Han Sans SC", "Noto Sans SC Variable", "Noto Sans SC", "Noto Sans CJK SC", ui-sans-serif, system-ui, sans-serif`（mono 栈不变，真 mono 脸在前、CJK 兜底在后）。设计意图：mac 落 PingFang、Windows 落 Microsoft YaHei，英文由 Helvetica/Arial 兜（不走 CJK 脸的拉丁字形），打包的 Noto variable 只是**最后兜底**（Linux/无系统 CJK 脸的机器）——UI 字号下 Noto 在 Windows Chromium 里明显比系统 CJK 脸细，所以它绝不能排前面。
- **三个坑**：① `"Microsoft YaHei UI"` 与 `"Microsoft YaHei"` 是**不同字体文件**，Windows 优先解析前者——曾因它导致 UI 跟参考实现漂移，已从栈里删除；② `packages/app/src/settings/model.tsx` 的 effect 在 settings 加载时把同一变量**内联写到 :root**，覆盖 theme.css 初值，两处必须 byte-identical（比对方法：正则提取两份栈、压缩空白后全等）；③ `stack(font, base)` 把用户设置存的值拼在 base **前面**——老用户在设置里存过 "思源黑体" 会让新栈完全架空，排查「改了没效果」先查这里。
- **参考实现的真实栈提取法**：WorkBuddy 装在 `D:/Program Files\WorkBuddy\resources\app.asar.unpacked\renderer/assets/dist-*.css`，`grep -oh "font-family:[^;}]*"` 排序即得（它家用 Source Code Pro 作 mono）。

## 内置浏览器代理

- **侧边浏览器打不开外网（2026-10-29 修，提交 1f1be1638f）**：每个浏览器 pane 用独立 partition（`opencode-browser-<UUID>`，见 `pane.ts:119`），**partition session 是独立网络栈，不继承系统代理** → 内置浏览器直连 → 需要代理的站点全打不开，而系统浏览器（读系统代理）能开。用户机器代理：注册表 `ProxyServer=127.0.0.1:7897`（Clash 混合端口）、无 PAC、`ProxyOverride` 已含本地。
- 修法（`gui-extensions/src/browser/chromium.ts`）：`createBrowserPage` 里拿到 `contents.session` 后 `applySystemProxy()`——用 `session.defaultSession.resolveProxy("https://example.com")` 拿到 PAC 结果串，取第一个 `PROXY host:port` 拼成 `http://host:port`，再 `session.setProxy({ proxyRules, proxyBypassRules: "<local>,localhost,127.0.0.1,[::1]" })`。解析结果模块级缓存（切了梯子需重启才生效，这是已知取舍）。
- **旁路规则必须显式写**：上游 `lifecycle/configure.ts` 有 `app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")`（来自上游 e1e2efe8ec），`<-loopback>` 的语义是**取消** Chromium 默认的本地绕过、让 loopback 也走代理——不显式设 bypass，SiCode 自己的 3084/5173 sidecar 请求也会被送进代理。
- **不要只改 env**：`desktop/src/main/service/system-proxy.ts` 的 `syncSystemProxy` 只把系统代理镜像进 `HTTP_PROXY/HTTPS_PROXY` 环境变量（给 sidecar 的 fetch/webfetch 用），它管不到任何浏览器 session。二者是两条独立路径。

## 工具批量编辑

- `packages/core/src/session/runner/step.ts:122-151` 每个 tool-call 到达就 `Effect.forkScoped` 一个 fiber，结束 `Fiber.awaitAll`，所以一条消息里的多个工具调用天然并发。
- `packages/core/src/file-mutation.ts:60` 锁表是模块级 `transactionLocks`，跨 Location 共享；`:71-74` 按解析后绝对路径排序逐个加锁，同路径串行、不同路径不阻塞。`edit.ts:320` 和 `patch.ts:304` 各自整段包在 `withLock` 内。
- `edit` 与 `patch` 的关键差异在失败语义：`edit.ts:268-297` 每次独立读→匹配→写，同一批多个 edit 前面写成功的不回退（部分成功）；`patch.ts:109-212` 先把全部 hunk 解析成 `Prepared` 并预校验，`:219` 才请权、`:233` 才逐文件写，任何 hunk 失败都不落盘。
- `packages/core/src/plugin/syntax-check.ts:31` 的 `WRITERS` 只有 edit/write，`:94-99` 的 `writtenPath` 只读 `input.path`；`patch.ts:21-25` 输入只有 `patchText`，所以 patch 完全不触发语法检查。这是「批量路径没有即时诊断」的根因。
- `packages/core/src/syntax-check/runner.ts:108-118` 每个文件 spawn 一个子进程（bun build --no-bundle / python -c / clang++ -fsyntax-only），单次 timeout 3s；`Effect.forEach` 默认顺序，要给 patch 加多文件检查必须显式 `{ concurrency: N }` 并设文件数上限。
- `FileDiff.Info` 在 `packages/schema/src/file-diff.ts:6-12`，`status` 取 `added|deleted|modified`；patch 的 `metadata.files` 就是这个形状，多文件诊断应过滤 `deleted`。
- 不要按模型家族切换编辑工具：`patch.ts:319-333` 的 SiCode 注释记录过上游 usePatch 的做法会让工具面漂移、破坏 prompt cache，三个工具同时注册是刻意的。

## 代码检索方案

- **第一手逆向材料在本机（2026-10-29 接入方案讨论）**：`D:/软件丨工具/cursor逆向专区/文档/`（38 篇，@verified 2026-10-24）——《Cursor-本地Trigram索引存储结构》《Cursor-本地检索与索引全链路》是方案级第一手材料（真实仓库 + crepectl 实测，非博客）。关键实测（SiCode 仓库 8654 文件）：稀有符号 indexed grep ~14ms vs 全库 rg 内容搜索 ~1000ms = 50~70×，Agent 每轮 5~10 次 grep → 每轮省秒级——**推翻「trigram 仅 1万+文件仓库才显著」的旧判断**（250ms 是 rg --files 的速度，内容搜索恒定 ~1s）。全量建索引 ~7s/8019 docs/87MB（源码 97MB）。机制：Crepe 倒排 `.git/cursor/crepe/<commit>/`（CRP2 格式，Rust 原生 file-service，非 SQLite）；更新=事件+防抖合并、commit 锚定、unsaved buffer 由工具层并搜；候选集无相关性排序（doc_id 序）；head_limit 无默认 + 2000 行/15k 字符硬帽；语义与正则分工具不混排，语义失败明确引导 grep/glob/read。抄能力最小清单：commit 级倒排（可选）+ ripgrep 并搜 unsaved（必须）+ path/line/text 返回（必须）+ 不为 grep 做 Merkle/向量合并。SiCode 检索实施方案在 `.sicode/plans/retrieval-implementation.html`（v6）。
