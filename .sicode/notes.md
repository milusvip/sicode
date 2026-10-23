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

## 默认 UI 字体

- 设置默认：`packages/app/src/settings/model.tsx` 的 `sansDefault` / `sansFallback`（空值回落到这）
- CSS 初值：`packages/ui/src/styles/theme.css` 的 `--font-family-sans`
- 加载：`packages/app/src/index.css` 的 `@fontsource-variable/noto-sans-sc` + `font-family: "思源黑体"` 的 local()；Inter 仍保留给手动填写

## 全局右键菜单

- `packages/app/src/shell/context-menu/`，挂在 `app.tsx`；原生 `electron-context-menu` 留给 webview，别删
- 用 Kobalte DropdownMenu 程序化打开；开着再右键要先关再开，且不能有退场动画

## 对话区这几块的美化

- 会话错误行：`SessionError` 用 `<Card variant="error">`，但 `session-turn.css` 把 `--card-pad-*` 全设 0 且隐藏了 `::before`，所以只剩一行红图标 + 裸文字。改成 `--v2-state-bg-danger` 底 + `--v2-state-border-danger` 边 + 8/10 padding + 8px 圆角（和 `[data-component="diagnostics"]` 同一套危险态 token），文字仍用 `--v2-text-text-base` 保可读，图标用 danger 色并 `margin-top: 1px` 对齐首行
- 问答体：`question-answers` 原来 `padding: 8px 0`，正文和行标题不对齐。现在自己带 `padding-inline-start: calc(--ind-col + 8px)`，并用 `[data-slot="collapsible-content"][data-expanded]:has(> [data-component="question-answers"])` 把父级那 12px 通用缩进清零（`[data-expanded]` 是为了压过 basic-tool.css 的 4 级选择器）。问句 12.5/muted，答句 13/base 且挂 2px 左边线（`--v2-border-border-strong`，base 太淡）
- 时长文案：整分钟不再带 "0 秒"/"0s"。`ui.message.duration.minutes`（en/zh/zht 新增）+ `formatElapsed` 的 `rest === 0` 分支
- `question` 工具在 `toolGroupType` 里恒返回 undefined，所以它永远是独立行，不会进 process chain——上面的 `:has` 其实只需要独立行那种情况
- 沙盒坑：`.preview-shell` 里改完 CSS 再热构建会挂在 `packages/ui/src/styles/index.css` 的 `@import "katex/dist/katex.min.css"`（root 没有 katex，只有 `packages/ui/node_modules` 有）。所以沙盒只能吃到已生成的缓存 CSS；要重新构建得先在 root 装 katex 或换个入口

## 项目记忆

- 抽取：`core/src/session/project-memory.ts` 的 `parseSummary` —— 只取 `## Decisions` / `## Relevant Files` / `## Important Context`，丢掉 Work State / Next Move（进度不出会话）。纯函数，无模型调用。
- 存储：`project-memory-store.ts` 走现有 KV 表，key 是 `project-memory:<项目目录>`，不建表、不改 schema、不写仓库。
- 淘汰：`verify(facts, exists)` 对每个路径跑存在性检查，连续 2 次缺失才删；无路径的散文事实不参与校验（没证据就不猜）。
- 接线：`config/plugin/project-memory.ts` 订阅 `session.compaction.ended`（事件带 `text`），`internal.ts` 单点注册。**没改 `session/compaction.ts`**。
- 召回：`core/src/tool/plugin/recall.ts`，工具名 `recall`，输入 `query` + `limit`。打分在 `project-memory.ts` 的 `search`：路径命中 +3、正文命中 +1、失效 -1，同分看 `seen`。输出是行文本（事实 + 路径），agent 直接照路径去读。
- 已知边界：路径校验只能发现「文件没了」，发现不了「文件还在但结论错了」（`packages/theme` 就活下来了）。
- 演示：`bun packages/core/script/project-memory-demo.ts .preview-shell/summary-sample.md "工具栏 按钮"`，跑真实抽取 → 校验 → 召回。
