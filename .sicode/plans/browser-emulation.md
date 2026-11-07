# 侧边浏览器：补环境模拟（emulate）

## Goal

给 agent 侧的浏览器工具面补上 chrome-devtools-mcp 有、SiCode 没有的那一块「环境模拟」：
设备视口 / deviceScaleFactor / mobile、UA、时区、locale、网络限速。落地成一个 operation
`emulate`，应用内 pane 用 CDP 的 `Emulation.*` + `Network.emulateNetworkConditions` 实现。

这解决的是「移动端 / 弱网 / 特定时区下页面行为不对」这类问题——现在 agent 只能用
`browser.screenshot` 看静态画面，没法把页面放进目标环境里复现。

## Non-goals

- 不做 chrome-devtools-mcp 的平台域那批（Extensions 管理、PWA、WebAuthn、WebMCP）。SiCode 的
  定位是接管现成浏览器，不是造测试平台，目标用户不同。
- 不做 `screencast_start/stop`（实时画面流）。纯调试用不上，先放着。
- 不做 `set_logpoints` / `get_css_styles` / `click_at`。这些是并列的候选，本方案只解决 emulate。
- 系统 Chrome 桥（`chrome/attachment.ts`）本次不实现，走既有的 unsupported 降级。

## Approach

### 1. schema：`packages/plugin-browser/src/rpc.ts`

在 `Operations` 数组里加一条 `operation("emulate", ...)`，用现成的 `operation()` 帮助函数
（`rpc.ts:152`，签名 `(name, description, fields, output, access)`）。字段全部 optional，省略即
不改动：

- `...tab`（必有 `tabID`，沿用 `rpc.ts:32` 的 `tab` 片段）
- `viewport: optional(Schema.Struct({ width, height, deviceScaleFactor?, mobile? }))`
- `userAgent: optional(short)`
- `timezone: optional(short)`（IANA，如 `America/New_York`）
- `locale: optional(short)`（如 `zh-CN`）
- `network: optional(Schema.Struct({ offline?, latencyMs?, downloadKbps?, uploadKbps? }))`
- `reset: optional(Schema.Boolean)` —— true 时清空所有 override，其余字段忽略

输出：`Schema.Struct({ ...page, emulation: Emulation })`，`Emulation` 是一个新的小 schema，回读
当前生效的值（viewport / userAgent / timezone / locale / network），方便 agent 确认状态、也方便
断言。`page` 片段沿用 `rpc.ts:83`。

`access`：**read**。理由——它不碰 DOM、不输入，性质接近 `scroll` / `navigate`（`rpc.ts:144-151`
的注释把这两者定为 read：read-only 模式存在的意义就是「能打开、能看」）。把 emulate 定成 read，
read-only agent 也能复现移动端问题。**这是需要你拍板的点**（见 Open questions）。

### 2. 应用内实现：`packages/gui-extensions/src/browser/chromium.ts`

在 `execute()` 的 `switch (action.type)`（`chromium.ts:988`）里加 `case "emulate"`，用现有的
`cdp.send(method, params, sessionID)`（`cdp.ts:28`）：

- viewport → `Emulation.setDeviceMetricsOverride`（mobile 同时开
  `Emulation.setTouchEmulationEnabled`）
- userAgent → `Emulation.setUserAgentOverride`
- timezone → `Emulation.setTimezoneOverride`
- locale → `Emulation.setLocaleOverride`
- network → 先 `Network.enable`，再 `Network.emulateNetworkConditions`
- reset → 对应每个的 clear 调用（`Emulation.clearDeviceMetricsOverride`、空串 reset UA/timezone、
  `Network.emulateNetworkConditions` 全关）

override 是 page target 级、跨导航保留，所以不需要重放。返回值用现成的 `result()` 包一层。

需要核对的两处交互（读代码确认，不猜）：
- `screenshot` 走 `Page.captureScreenshot` + `Page.getLayoutMetrics`（`chromium.ts:1235/1269`）——
  确认 device metrics override 生效后 `maxWidth` / `fullPage` 的取值仍正确。
- `lighthouse.ts:66-68` 已经传 `screenEmulation: { disabled: true }` 和
  `throttlingMethod: "provided"` —— 确认在模拟设备下跑 lighthouse 不会相互打架，必要时在工具描述里
  写清「lighthouse 忽略 emulation 的视口」。

### 3. 系统 Chrome 桥：不改代码

`chrome/attachment.ts:229` 的 `unsupported()` 是兜底：不在它支持白名单里的 action 自动报
"not supported on the system Chrome bridge yet"。新 operation 天然落到这条，**无需改代码**。只在
需要时把 emulate 从「Supported: …」那句正向列表里排除（现在本来就没列）。文档里说明：想用 emulate
要切到应用内 pane。

### 4. 不动的部分

`main.ts` 的路由（`backends` 的 chrome/pane 二分）、`profiling.ts`、`network.ts`、`diagnostics.ts`
都不需要改。emulate 挂在 page 上，页面关掉即失效，不用清理。

## Risks / open questions

1. **read 还是 write**：我建议 read（同 navigate/scroll）。但 read-only agent 能改设备模拟、
   进而影响用户看到的画面。若你觉得这在权限语义上越界，就定 write。**需你定。**
2. **一个 operation 还是两个**：chrome-devtools-mcp 拆成 `emulate` + `resize_page`。我建议合成一个
   `emulate`（viewport 就是它的一个字段），少一条工具、和 SiCode 现有「少而厚」的风格一致。
   若你要「只改视口」的高频路径，也可以拆。
3. **`Network.enable` 与既有 diagnostics 的关系**：`diagnostics.ts`（browser.console /
   network.list / network.get 的数据源）我没读。如果它已经在用 CDP Network domain，重复 `enable`
   一般无害但要确认；限速会不会影响它的抓包也要确认。**实现前先读 diagnostics.ts。**
4. **emulation 与会话迁移**：新开的 tab 是新的 page target，不继承另一个 tab 的 override。这是一致
   的行为，但要在工具描述里讲清「emulate 只对当前 tabID 生效」。

## Next steps（批准后）

1. 读 `packages/gui-extensions/src/browser/diagnostics.ts`，回答 open question 3。
2. 改 `rpc.ts`：加 `Emulation` schema + `emulate` operation。
3. 改 `chromium.ts`：加 `case "emulate"`。
4. `bun run check`（gui-extensions 与 plugin-browser 各跑一次 typecheck），
   `bun run lint:changed` 必须过。
