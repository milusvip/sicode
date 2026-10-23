# 调研笔记

给 agent 看的。只记**事实**：功能在哪个文件、谁渲染谁、为什么这么改。

不记项目简介、不记进度、不记"当前正在做什么"——那些会过期，而过期的笔记比没有更糟。

## 写法

每查清一件事，追加一段：

```markdown
## 会话审查面板（2026-10-23）
- 入口：`packages/app/src/session/header/session-header-actions.tsx`
- 链路：header-actions → `gui-extensions/src/review/renderer.tsx` → `app/src/runtime/extension/side-region.tsx`
- 结论：审查面板是 gui-extension 注册的 panel，不是 app 的路由页；改固定/浮动行为要动 side-region 的 region 配置
```

三条要求：

1. **只增不删**。旧结论错了就在下面补一条更正，不要覆盖——覆盖会丢掉"为什么当初那么判断"。
2. **带路径**。`文件:行号` 比文字描述有用得多，下次可以直接跳到那里。
3. **命中就跳过搜索**。开新任务先扫一眼这里，如果这一块已经记过，直接从结论开始，不要再 grep 一遍。

---

## 记录

<!-- 从这行下面开始追加 -->
