/**
 * Injected into the page (isolated world). Exposes __sicodePickElement() which
 * highlights under the cursor, returns one or more element payloads on click /
 * drag-box select, or null on Escape.
 *
 * Uses a full-screen pointer shield so page scripts never see the click/drag
 * (pages that navigate on mousedown otherwise trip beforeunload → "离开此网站？").
 */
;(() => {
  if (globalThis.__sicodePickElement) return

  const MAX_ELEMENTS = 40
  const DRAG_THRESHOLD = 4
  /** Keep the shield up briefly after finish so the trailing click cannot hit the page. */
  const SHIELD_HOLD_MS = 400

  const cssPath = (el) => {
    if (!(el instanceof Element)) return ""
    if (el.id && /^[A-Za-z][\w:-]*$/.test(el.id)) {
      const match = document.querySelectorAll(`#${CSS.escape(el.id)}`)
      if (match.length === 1) return `#${CSS.escape(el.id)}`
    }
    const parts = []
    let node = el
    while (node && node.nodeType === 1 && parts.length < 8) {
      const tag = node.tagName.toLowerCase()
      if (tag === "html" || tag === "body") {
        parts.unshift(tag)
        break
      }
      const parent = node.parentElement
      if (!parent) {
        parts.unshift(tag)
        break
      }
      const siblings = [...parent.children].filter((child) => child.tagName === node.tagName)
      const index = siblings.indexOf(node) + 1
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag)
      node = parent
    }
    return parts.join(" > ").slice(0, 2_048)
  }

  const roleOf = (el) => {
    const role = el.getAttribute("role")
    if (role) return role.slice(0, 128)
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
    return tag.slice(0, 128)
  }

  const nameOf = (el) => {
    const raw =
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      el.getAttribute("name") ||
      el.getAttribute("alt") ||
      ""
    return String(raw).replace(/\s+/g, " ").trim().slice(0, 512)
  }

  const textOf = (el) => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      return String(el.value || "").replace(/\s+/g, " ").trim().slice(0, 512)
    }
    return String(el.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 512)
  }

  const labelOf = (el) => {
    const named = nameOf(el) || textOf(el)
    if (named) return named.slice(0, 512)
    return el.tagName.toLowerCase()
  }

  const payloadOf = (el) => {
    const name = nameOf(el)
    const text = textOf(el)
    const role = roleOf(el)
    return {
      selector: cssPath(el),
      label: labelOf(el),
      ...(role ? { role } : {}),
      ...(name ? { name } : {}),
      ...(text && text !== name ? { text } : {}),
    }
  }

  const centerIn = (rect, box) => {
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    return cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom
  }

  /**
   * @returns {Promise<Array<{ selector: string; label: string; role?: string; name?: string; text?: string }> | null>}
   */
  globalThis.__sicodePickElement = () =>
    new Promise((resolve) => {
      const previous = document.getElementById("__sicode-pick-root")
      if (previous) previous.remove()

      const root = document.createElement("div")
      root.id = "__sicode-pick-root"
      // Opaque to hit-testing so the page never receives the pointer sequence.
      root.style.cssText =
        "all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:auto;cursor:crosshair;background:transparent;"

      const banner = document.createElement("div")
      banner.textContent = "SiCode · 点击或拖动框选 · Esc 取消"
      banner.style.cssText =
        "pointer-events:none;position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;padding:8px 14px;border-radius:999px;background:#111827;color:#f9fafb;font:600 12px/1.3 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);"

      const hover = document.createElement("div")
      hover.style.cssText =
        "pointer-events:none;position:fixed;z-index:1;border:2px solid #3b82f6;background:rgba(59,130,246,.12);border-radius:4px;display:none;"

      const marquee = document.createElement("div")
      marquee.style.cssText =
        "pointer-events:none;position:fixed;z-index:1;border:2px dashed #3b82f6;background:rgba(59,130,246,.08);border-radius:2px;display:none;"

      const marks = document.createElement("div")
      marks.style.cssText = "pointer-events:none;position:fixed;inset:0;z-index:1;"

      root.append(banner, hover, marquee, marks)
      document.documentElement.append(root)

      let last = /** @type {Element | null} */ (null)
      let dragging = false
      let moved = false
      let startX = 0
      let startY = 0
      let finished = false

      const hitTest = (x, y) => {
        root.style.pointerEvents = "none"
        const target = document.elementFromPoint(x, y)
        root.style.pointerEvents = "auto"
        if (!target || root.contains(target)) return null
        return target
      }

      const destroy = () => {
        root.remove()
        document.removeEventListener("keydown", onKey, true)
      }

      const cleanup = (value) => {
        if (finished) return
        finished = true
        dragging = false
        // Hide chrome but keep the shield so the trailing click cannot land on a link.
        banner.style.display = "none"
        hover.style.display = "none"
        marquee.style.display = "none"
        clearMarks()
        root.style.cursor = "default"
        resolve(value)
        setTimeout(destroy, SHIELD_HOLD_MS)
      }

      const paintHover = (target) => {
        if (!target) {
          hover.style.display = "none"
          last = null
          return
        }
        last = target
        const rect = target.getBoundingClientRect()
        hover.style.display = "block"
        hover.style.left = `${Math.max(0, rect.left)}px`
        hover.style.top = `${Math.max(0, rect.top)}px`
        hover.style.width = `${Math.max(0, rect.width)}px`
        hover.style.height = `${Math.max(0, rect.height)}px`
      }

      const clearMarks = () => {
        while (marks.firstChild) marks.firstChild.remove()
      }

      const paintMarks = (els) => {
        clearMarks()
        for (const el of els) {
          const rect = el.getBoundingClientRect()
          const mark = document.createElement("div")
          mark.style.cssText = `pointer-events:none;position:fixed;left:${Math.max(0, rect.left)}px;top:${Math.max(0, rect.top)}px;width:${Math.max(0, rect.width)}px;height:${Math.max(0, rect.height)}px;border:2px solid #60a5fa;background:rgba(96,165,250,.14);border-radius:3px;`
          marks.append(mark)
        }
      }

      const boxFromPoints = (x0, y0, x1, y1) => {
        const left = Math.min(x0, x1)
        const top = Math.min(y0, y1)
        const right = Math.max(x0, x1)
        const bottom = Math.max(y0, y1)
        return { left, top, right, bottom, width: right - left, height: bottom - top }
      }

      const paintMarquee = (box) => {
        marquee.style.display = "block"
        marquee.style.left = `${box.left}px`
        marquee.style.top = `${box.top}px`
        marquee.style.width = `${box.width}px`
        marquee.style.height = `${box.height}px`
      }

      const elementsInBox = (box) => {
        const scope = document.body || document.documentElement
        const nodes = scope.querySelectorAll("*")
        /** @type {Element[]} */
        const hits = []
        for (const el of nodes) {
          if (!(el instanceof Element) || root.contains(el)) continue
          const tag = el.tagName
          if (
            tag === "SCRIPT" ||
            tag === "STYLE" ||
            tag === "NOSCRIPT" ||
            tag === "META" ||
            tag === "LINK" ||
            tag === "HEAD" ||
            tag === "HTML" ||
            tag === "BODY" ||
            tag === "BR" ||
            tag === "WBR"
          ) {
            continue
          }
          const rect = el.getBoundingClientRect()
          if (rect.width < 2 || rect.height < 2) continue
          if (!centerIn(rect, box)) continue
          hits.push(el)
        }
        const leaves = hits.filter((el) => !hits.some((other) => other !== el && el.contains(other)))
        return leaves.slice(0, MAX_ELEMENTS)
      }

      const onMove = (event) => {
        if (finished) return
        event.preventDefault()
        if (dragging) {
          const dx = event.clientX - startX
          const dy = event.clientY - startY
          if (!moved && dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD) {
            moved = true
            hover.style.display = "none"
          }
          if (!moved) return
          const box = boxFromPoints(startX, startY, event.clientX, event.clientY)
          paintMarquee(box)
          const selected = elementsInBox(box)
          paintMarks(selected)
          banner.textContent =
            selected.length > 0
              ? `SiCode · 已框选 ${selected.length} 个 · 松手确认 · Esc 取消`
              : "SiCode · 拖动框选 · Esc 取消"
          return
        }
        paintHover(hitTest(event.clientX, event.clientY))
      }

      const onDown = (event) => {
        if (finished || event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        dragging = true
        moved = false
        startX = event.clientX
        startY = event.clientY
        clearMarks()
        marquee.style.display = "none"
        paintHover(hitTest(event.clientX, event.clientY))
      }

      const onUp = (event) => {
        if (finished || !dragging || event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        dragging = false

        if (!moved) {
          const target = last || hitTest(event.clientX, event.clientY)
          if (!target) {
            cleanup(null)
            return
          }
          cleanup([payloadOf(target)])
          return
        }

        const box = boxFromPoints(startX, startY, event.clientX, event.clientY)
        const selected = elementsInBox(box)
        if (!selected.length) {
          cleanup(null)
          return
        }
        cleanup(selected.map(payloadOf))
      }

      const swallow = (event) => {
        event.preventDefault()
        event.stopPropagation()
      }

      const onKey = (event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          cleanup(null)
        }
      }

      // Listen on the shield — page never is the event target.
      root.addEventListener("pointermove", onMove)
      root.addEventListener("pointerdown", onDown)
      root.addEventListener("pointerup", onUp)
      root.addEventListener("pointercancel", onUp)
      root.addEventListener("click", swallow)
      root.addEventListener("auxclick", swallow)
      root.addEventListener("contextmenu", swallow)
      root.addEventListener("dragstart", swallow)
      document.addEventListener("keydown", onKey, true)
    })
})()
