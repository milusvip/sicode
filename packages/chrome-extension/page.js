/* Injected via chrome.scripting.executeScript({ files: ["page.js"], world: "MAIN" }). */
;(() => {
  const key = "__sicodeBridge"
  const api = "__sicodeBridgeAPI"
  if (globalThis[api]) return

  const store = () => {
    if (!globalThis[key]) globalThis[key] = { refs: new Map(), seq: 0 }
    return globalThis[key]
  }

  const visible = (el) => {
    if (!(el instanceof HTMLElement)) return true
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return false
    const style = window.getComputedStyle(el)
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  const interesting = (el) => {
    if (!visible(el)) return false
    const tag = el.tagName.toLowerCase()
    if (["a", "button", "input", "textarea", "select", "summary", "dialog"].includes(tag)) return true
    if (/^h[1-6]$/.test(tag)) return true
    const role = el.getAttribute("role")
    if (role) {
      if (
        /^(dialog|alertdialog|heading|menuitem|tab|switch|option|listbox|combobox|textbox|searchbox|button|link|checkbox|radio)$/i.test(
          role,
        )
      )
        return true
      return true
    }
    if (el.isContentEditable) return true
    const tabIndex = el.getAttribute("tabindex")
    return tabIndex !== null && tabIndex !== "-1"
  }

  const roleOf = (el) => {
    const role = el.getAttribute("role")
    if (role) return role
    const tag = el.tagName.toLowerCase()
    if (tag === "a") return "link"
    if (tag === "button") return "button"
    if (tag === "select") return "combobox"
    if (tag === "textarea") return "textbox"
    if (tag === "dialog") return "dialog"
    if (/^h[1-6]$/.test(tag)) return "heading"
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase()
      if (type === "checkbox") return "checkbox"
      if (type === "radio") return "radio"
      if (type === "submit" || type === "button") return "button"
      if (type === "search") return "searchbox"
      return "textbox"
    }
    return tag
  }

  const flagsOf = (el) => {
    const flags = []
    const disabled =
      (el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLButtonElement) &&
      el.disabled
    if (disabled || el.getAttribute("aria-disabled") === "true") flags.push("disabled=true")
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      flags.push(`checked=${el.checked}`)
    } else if (el.getAttribute("aria-checked") != null) {
      flags.push(`checked=${el.getAttribute("aria-checked")}`)
    }
    const expanded = el.getAttribute("aria-expanded")
    if (expanded != null) flags.push(`expanded=${expanded}`)
    const selected = el.getAttribute("aria-selected")
    if (selected != null) flags.push(`selected=${selected}`)
    const pressed = el.getAttribute("aria-pressed")
    if (pressed != null) flags.push(`pressed=${pressed}`)
    if (el.getAttribute("aria-modal") === "true") flags.push("modal=true")
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.readOnly) flags.push("readonly=true")
      if (el.required) flags.push("required=true")
    }
    return flags
  }

  const staleRef = (ref) =>
    `Element ref ${ref} is unknown or stale. Call browser.snapshot({tabID}) and use a ref from that tab's newest snapshot. Do not reuse refs after navigation or a newer snapshot.`

  const labelOf = (el) => {
    const raw =
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      el.getAttribute("name") ||
      el.getAttribute("alt") ||
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
        ? el.value
        : "") ||
      (el.textContent || "")
    return String(raw).replace(/\s+/g, " ").trim().slice(0, 300)
  }

  /** Mirror of @opencode/util/destructive-web-ui — keep in sync (extension cannot import util). */
  const destructiveWebUiBlocked =
    "Blocked: this control or script looks like a destructive delete/remove on the page. " +
    "SiCode will not run it by default (protects cloud files / console data). " +
    "Ask the user to confirm and click it themselves, or set OPENCODE_ALLOW_DESTRUCTIVE_WEB_UI=1 only when intentional."

  const isDebugSafeWebUiLabel = (text) => {
    const raw = String(text || "")
      .replace(/\s+/g, " ")
      .trim()
    if (!raw) return false
    const lower = raw.toLowerCase()
    if (/清空(搜索|筛选|过滤|輸入|输入|条件|條件)|清除(搜索|筛选|过滤|輸入|输入|条件|條件)/.test(raw)) return true
    if (/\b(clear|remove)\b.{0,20}\b(search|filter|sort|column|chip|tag|highlight)\b/.test(lower)) return true
    if (/\b(remove\s+filter|clear\s+filters?|clear\s+search|reset\s+filters?)\b/.test(lower)) return true
    if (/\b(deleted_at|is_deleted|soft_deleted|deletion_scheduled)\b/.test(lower)) return true
    return false
  }

  const isDestructiveWebUiLabel = (text) => {
    const raw = String(text || "")
      .replace(/\s+/g, " ")
      .trim()
    if (!raw) return false
    if (isDebugSafeWebUiLabel(raw)) return false
    const lower = raw.toLowerCase()
    if (
      /删除|刪除|移入回收站|永久删除|永久刪除|彻底删除|徹底刪除|确认删除|確認刪除|确定删除|確定刪除|是否删除|是否刪除|注销账号|註銷帳號|注销账户|註銷賬戶|卸载|卸載|抹掉|销毁|銷毀|恢复出厂|恢復出廠|清空回收站|清空全部|清空数据|清空數據|清空所选|清空所選|取消订阅|取消訂閱|关闭账号|關閉帳號/.test(
        raw,
      )
    )
      return true
    if (/清空/.test(raw)) return true
    if (
      /\b(delete|destroy|uninstall|purge|wipe|erase)\b/.test(lower) ||
      /\b(remove|empty)\b.{0,24}\b(all|permanent|forever|trash|bin|account|item|file|files|row|selected)\b/.test(
        lower,
      ) ||
      /\b(permanently\s+delete|empty\s+trash|move\s+to\s+trash|confirm\s+delete|yes[,\s]+delete|are\s+you\s+sure.{0,40}delete)\b/.test(
        lower,
      ) ||
      /\b(cancel\s+subscription|close\s+account|factory\s+reset|revoke\s+(access|token|key|license)|terminate\s+account|deactivate\s+account)\b/.test(
        lower,
      )
    )
      return true
    if (/\b(btn-delete|icon-delete|fa-trash|mdi-delete|lucide-trash|data-testid=["']?delete)\b/i.test(raw)) return true
    if (/([?&/]delete(?:[/=]|$)|action=delete|data-action=["']?delete)/i.test(raw)) return true
    return false
  }

  const isDestructiveWebUiScript = (script) => {
    const text = String(script || "")
      .replace(/\s+/g, " ")
      .trim()
    if (!text) return false
    if (/\.remove\s*\(|removeChild\s*\(|replaceChildren\s*\(/.test(text)) return true
    if (/\b(deleteRow|deleteItem|softDelete|hardDelete)\b/i.test(text)) return true
    if (/\.destroy\s*\(|\.trash\s*\(/.test(text)) return true
    if (
      isDestructiveWebUiLabel(text) &&
      /\.click\s*\(|\.submit\s*\(|dispatchEvent\s*\(|form\.requestSubmit\s*\(/.test(text)
    )
      return true
    return false
  }

  const assertSafeClick = (el) => {
    const haystack = [
      labelOf(el),
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("name"),
      el.id,
      typeof el.className === "string" ? el.className : "",
      el.getAttribute("href"),
      el.getAttribute("data-action"),
      el.getAttribute("data-testid"),
    ]
      .filter(Boolean)
      .join(" ")
    if (isDestructiveWebUiLabel(haystack)) throw new Error(destructiveWebUiBlocked)
  }

  globalThis[api] = {
    snapshot(depth = 8) {
      const state = store()
      state.refs.clear()
      state.seq = 0
      const lines = []
      let truncated = false
      const maxLines = 500
      const maxDepth = Math.min(20, Math.max(1, Number(depth) || 8))

      /** Nearest heading label by depth — structural context only, not site-specific. */
      const headings = []

      const walk = (node, level) => {
        if (truncated || lines.length >= maxLines) {
          truncated = true
          return
        }
        if (!(node instanceof Element)) return
        if (level > maxDepth) {
          truncated = true
          return
        }

        const role = roleOf(node)
        if (role === "heading") {
          headings.length = level + 1
          headings[level] = labelOf(node)
        }

        if (interesting(node)) {
          state.seq += 1
          const ref = `e${state.seq}`
          state.refs.set(ref, node)
          const flags = flagsOf(node)
          const under = headings
            .slice(0, level)
            .filter(Boolean)
            .at(-1)
          lines.push(
            `${"  ".repeat(level)}@${ref} [${role}] ${JSON.stringify(labelOf(node))}${
              flags.length ? ` ${flags.join(" ")}` : ""
            }${under && role !== "heading" ? ` under=${JSON.stringify(under)}` : ""}`,
          )
        }

        for (const child of node.children) walk(child, level + (interesting(node) ? 1 : 0))
      }

      walk(document.body || document.documentElement, 0)
      return { content: lines.join("\n"), truncated }
    },

    click(ref, button = "left", count = 1, allowDestructive = false) {
      const el = store().refs.get(ref)
      if (!(el instanceof Element)) throw new Error(staleRef(ref))
      if (!allowDestructive) assertSafeClick(el)
      el.scrollIntoView({ block: "center", inline: "center" })
      // Left: HTMLElement.click only (MouseEvent + click() used to double-fire).
      if (button === "left") {
        if (!(el instanceof HTMLElement)) throw new Error(staleRef(ref))
        for (let i = 0; i < count; i++) el.click()
        return true
      }
      const type = button === "right" ? "contextmenu" : "auxclick"
      for (let i = 0; i < count; i++) {
        el.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            button: button === "right" ? 2 : 1,
            detail: i + 1,
          }),
        )
      }
      return true
    },

    fill(ref, text) {
      const el = store().refs.get(ref)
      if (!(el instanceof Element)) throw new Error(staleRef(ref))
      el.scrollIntoView({ block: "center", inline: "center" })
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.focus()
        el.value = text
        el.dispatchEvent(new Event("input", { bubbles: true }))
        el.dispatchEvent(new Event("change", { bubbles: true }))
        return true
      }
      if (el instanceof HTMLElement && el.isContentEditable) {
        el.focus()
        el.textContent = text
        el.dispatchEvent(new Event("input", { bubbles: true }))
        return true
      }
      throw new Error("Target is not an editable field. Choose a textbox ref from the snapshot.")
    },

    evaluate(script, ref, allowDestructive = false) {
      if (!allowDestructive && isDestructiveWebUiScript(script)) throw new Error(destructiveWebUiBlocked)
      if (ref) {
        const el = store().refs.get(ref)
        if (!(el instanceof Element)) throw new Error(staleRef(ref))
        const fn = new Function(`return (${script})`)()
        if (typeof fn !== "function") {
          throw new Error("With ref, script must be a function, e.g. (el) => el.textContent")
        }
        return fn(el)
      }
      return (0, eval)(script)
    },

    press(key) {
      const target = document.activeElement instanceof Element ? document.activeElement : document.body
      const parts = String(key).split("+")
      const code = parts[parts.length - 1]
      const event = {
        key: code,
        code: code.length === 1 ? `Key${code.toUpperCase()}` : code,
        bubbles: true,
        cancelable: true,
        ctrlKey: parts.includes("Control"),
        metaKey: parts.includes("Meta"),
        altKey: parts.includes("Alt"),
        shiftKey: parts.includes("Shift"),
      }
      target.dispatchEvent(new KeyboardEvent("keydown", event))
      target.dispatchEvent(new KeyboardEvent("keyup", event))
      return true
    },

    scroll(deltaX = 0, deltaY = 0) {
      window.scrollBy(deltaX, deltaY)
      return true
    },
  }
})()
