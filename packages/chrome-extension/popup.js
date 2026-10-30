const STRINGS = {
  zh: {
    title: "SiCode 浏览器桥接",
    subtitle: "连接桌面端 Agent",
    hint: "推送后 Agent 用系统 Chrome，无需 @。也可右键推送 / 选元素。复制登录态可贴到内置浏览器「导入会话」。",
    status_connected: "已连接",
    status_connecting: "连接中…",
    status_pairing: "连接中…",
    status_disconnected: "未连接",
    detail_ok: "就绪",
    detail_ok_prod: "正式版",
    detail_ok_beta: "Beta",
    detail_ok_dev: "开发版",
    detail_ok_local: "本地开发",
    detail_wait: "设置 → 浏览器",
    detail_update: "需重装",
    push: "推送到对话",
    push_ok: "已推送",
    push_fail_offline: "未连接",
    push_fail_url: "无法推送此页",
    push_fail: "推送失败",
    push_working: "推送中…",
    pick: "选元素推送",
    pick_ok: "已推送元素",
    pick_working: "在页面上点击或拖动框选…",
    pick_fail_cancel: "已取消",
    pick_fail: "选元素失败",
    copy_login: "复制登录态",
    sync_login: "同步登录态到内置浏览器",
    sync_working: "同步中…",
    sync_ok: "已同步 · 内置浏览器正在打开",
    sync_fail_url: "当前页不是 http(s)，无法同步",
    sync_fail_conn: "桌面端未连接，先连接 SiCode",
    sync_fail_empty: "这个站点没有可同步的 Cookie",
    sync_fail: "同步失败",
    copy_ok: "已复制 · 去内置浏览器导入",
    copy_fail_url: "无法读取此页",
    copy_fail_empty: "没有 Cookie / localStorage",
    copy_fail: "复制失败",
    copy_working: "读取中…",
    update_title: "需要更新扩展",
    update_body: "桌面端已带新版本。请先移除本扩展，再在 SiCode「设置 → 浏览器」安装并添加。",
    update_open: "打开扩展管理页",
  },
  en: {
    title: "SiCode Browser Bridge",
    subtitle: "Connect desktop Agent",
    hint: "Push uses system Chrome (no @). Or right-click Send / Pick element. Copy login state pastes into in-app Import session.",
    status_connected: "Connected",
    status_connecting: "Connecting…",
    status_pairing: "Connecting…",
    status_disconnected: "Disconnected",
    detail_ok: "Ready",
    detail_ok_prod: "Production",
    detail_ok_beta: "Beta",
    detail_ok_dev: "Dev",
    detail_ok_local: "Local",
    detail_wait: "Settings → Browser",
    detail_update: "Reinstall",
    push: "Send to chat",
    push_ok: "Sent",
    push_fail_offline: "Not connected",
    push_fail_url: "Can't send this page",
    push_fail: "Failed",
    push_working: "Sending…",
    pick: "Pick element",
    pick_ok: "Element sent",
    pick_working: "Click or drag-box select on the page…",
    pick_fail_cancel: "Cancelled",
    pick_fail: "Pick failed",
    copy_login: "Copy login state",
    sync_login: "Sync login to the in-app browser",
    sync_working: "Syncing…",
    sync_ok: "Synced · opening in the in-app browser",
    sync_fail_url: "Not an http(s) page, nothing to sync",
    sync_fail_conn: "Desktop not connected — connect SiCode first",
    sync_fail_empty: "No cookies to sync for this site",
    sync_fail: "Sync failed",
    copy_ok: "Copied · paste in Import session",
    copy_fail_url: "Can't read this page",
    copy_fail_empty: "No cookies / localStorage",
    copy_fail: "Copy failed",
    copy_working: "Reading…",
    update_title: "Extension update required",
    update_body: "Desktop has a newer package. Remove this extension, then Install & Add in SiCode Settings → Browser.",
    update_open: "Open extensions page",
  },
}

const langZh = document.getElementById("lang-zh")
const langEn = document.getElementById("lang-en")
const statusEl = document.getElementById("status")
const statusText = document.getElementById("status-text")
const statusDetail = document.getElementById("status-detail")
const updateEl = document.getElementById("update")
const updateOpen = document.getElementById("update-open")
const pushBtn = document.getElementById("push-tab")
const pickBtn = document.getElementById("pick-element")
const copyLoginBtn = document.getElementById("copy-login")
const syncLoginBtn = document.getElementById("sync-login")
const pushFeedback = document.getElementById("push-feedback")

let locale = "zh"
/** @type {string} */
let lastStatus = "disconnected"
let updateRequired = false
/** @type {string} */
let desktopChannel = ""

const applyLocale = (next) => {
  locale = next === "en" ? "en" : "zh"
  const table = STRINGS[locale]
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en"
  for (const node of document.querySelectorAll("[data-i18n]")) {
    const key = node.getAttribute("data-i18n")
    if (key && key in table) node.textContent = table[key]
  }
  langZh.setAttribute("aria-pressed", locale === "zh" ? "true" : "false")
  langEn.setAttribute("aria-pressed", locale === "en" ? "true" : "false")
  renderStatus(lastStatus, updateRequired)
}

const renderStatus = (status, needsUpdate = updateRequired) => {
  lastStatus = status === "paused" ? "disconnected" : status
  updateRequired = needsUpdate === true
  const table = STRINGS[locale]
  const key = `status_${lastStatus}`
  statusEl.dataset.state = lastStatus
  // Connected but stale package → yellow warn dot (not green “all good”).
  statusEl.dataset.update = updateRequired ? "true" : "false"
  statusText.textContent = key in table ? table[key] : table.status_disconnected
  const channelKey =
    desktopChannel === "prod"
      ? "detail_ok_prod"
      : desktopChannel === "beta"
        ? "detail_ok_beta"
        : desktopChannel === "dev"
          ? "detail_ok_dev"
          : desktopChannel === "local"
            ? "detail_ok_local"
            : "detail_ok"
  statusDetail.textContent = updateRequired
    ? table.detail_update
    : lastStatus === "connected"
      ? table[channelKey]
      : table.detail_wait
  updateEl.dataset.show = updateRequired ? "true" : "false"
  pushBtn.disabled = lastStatus !== "connected"
  pickBtn.disabled = lastStatus !== "connected"
}

const refresh = async () => {
  const stored = await chrome.storage.local.get(["locale", "updateRequired", "channel"])
  applyLocale(typeof stored.locale === "string" ? stored.locale : "zh")
  updateRequired = stored.updateRequired === true
  desktopChannel = typeof stored.channel === "string" ? stored.channel : ""
  try {
    const reply = await chrome.runtime.sendMessage({ type: "sicode.status" })
    if (reply && typeof reply.status === "string") {
      if (typeof reply.channel === "string") desktopChannel = reply.channel
      renderStatus(reply.status, reply.updateRequired === true)
      return
    }
  } catch {
    // SW waking
  }
  const fallback = await chrome.storage.local.get(["connectionStatus", "updateRequired", "channel"])
  const status = typeof fallback.connectionStatus === "string" ? fallback.connectionStatus : "disconnected"
  desktopChannel = typeof fallback.channel === "string" ? fallback.channel : desktopChannel
  renderStatus(status === "paused" ? "disconnected" : status, fallback.updateRequired === true)
}

const setFeedback = (text) => {
  pushFeedback.textContent = text
}

syncLoginBtn.addEventListener("click", () => {
  void (async () => {
    const table = STRINGS[locale]
    setFeedback(table.sync_working)
    syncLoginBtn.disabled = true
    try {
      const reply = await chrome.runtime.sendMessage({ type: "sicode.syncLoginState" })
      if (!reply?.ok) {
        if (reply?.message === "bad_url") setFeedback(table.sync_fail_url)
        else if (reply?.message === "not_connected") setFeedback(table.sync_fail_conn)
        else if (reply?.message === "empty") setFeedback(table.sync_fail_empty)
        else setFeedback(table.sync_fail)
        return
      }
      setFeedback(`${table.sync_ok} (Cookie ${reply.cookies})`)
    } catch {
      setFeedback(table.sync_fail)
    } finally {
      syncLoginBtn.disabled = false
    }
  })()
})

pushBtn.addEventListener("click", () => {
  void (async () => {
    const table = STRINGS[locale]
    setFeedback(table.push_working)
    pushBtn.disabled = true
    try {
      const reply = await chrome.runtime.sendMessage({ type: "sicode.offerTab" })
      if (reply?.ok) {
        setFeedback(table.push_ok)
        return
      }
      if (reply?.message === "not_connected") setFeedback(table.push_fail_offline)
      else if (reply?.message === "bad_url") setFeedback(table.push_fail_url)
      else setFeedback(table.push_fail)
    } catch {
      setFeedback(table.push_fail)
    } finally {
      pushBtn.disabled = lastStatus !== "connected"
    }
  })()
})

pickBtn.addEventListener("click", () => {
  const table = STRINGS[locale]
  setFeedback(table.pick_working)
  pickBtn.disabled = true
  // Fire-and-forget: SW owns the long-running picker. Closing the popup must not cancel it.
  void chrome.runtime.sendMessage({ type: "sicode.offerElement" }).catch(() => undefined)
  window.close()
})

copyLoginBtn.addEventListener("click", () => {
  void (async () => {
    const table = STRINGS[locale]
    setFeedback(table.copy_working)
    copyLoginBtn.disabled = true
    try {
      const reply = await chrome.runtime.sendMessage({ type: "sicode.copyLoginState" })
      if (!reply?.ok || typeof reply.text !== "string") {
        if (reply?.message === "bad_url" || reply?.message === "no_tab") setFeedback(table.copy_fail_url)
        else if (reply?.message === "empty") setFeedback(table.copy_fail_empty)
        else setFeedback(table.copy_fail)
        return
      }
      await navigator.clipboard.writeText(reply.text)
      const bits = []
      if (typeof reply.cookies === "number") bits.push(`Cookie ${reply.cookies}`)
      if (typeof reply.storage === "number") bits.push(`LS ${reply.storage}`)
      setFeedback(bits.length ? `${table.copy_ok} (${bits.join(" · ")})` : table.copy_ok)
    } catch {
      setFeedback(table.copy_fail)
    } finally {
      copyLoginBtn.disabled = false
    }
  })()
})

updateOpen.addEventListener("click", () => {
  void chrome.tabs.create({ url: "chrome://extensions" })
})

await refresh()

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return
  if (changes.connectionStatus || changes.locale || changes.updateRequired || changes.channel) void refresh()
})

langZh.addEventListener("click", () => {
  void chrome.storage.local.set({ locale: "zh" })
  applyLocale("zh")
})
langEn.addEventListener("click", () => {
  void chrome.storage.local.set({ locale: "en" })
  applyLocale("en")
})
