/** A DOM element described for a composer note, without process-local refs. */
export type UiElement = {
  label: string
  selector: string
  /** Nearest `data-slot` on the element or an ancestor — stable design-system hook. */
  slot?: string
  /** Nearest `data-component` on the element or an ancestor. */
  component?: string
  /** Nearest `data-action` on the element or an ancestor. */
  action?: string
  role?: string
  name?: string
  text?: string
  rect: { x: number; y: number; width: number; height: number }
}

function clip(value: string, max: number) {
  if (value.length <= max) return value

  return `${value.slice(0, max - 1)}\u2026`
}

function isScopedRoot(root: Node): root is Document | ShadowRoot {
  return "querySelectorAll" in root
}

/**
 * Builds a stable CSS path for the element, stepping into shadow roots with ` >>> `
 * the same way the browser pane's CDP picker does.
 */
export function elementSelector(element: Element) {
  const segments: string[] = []

  for (let start: Element | undefined = element; start; ) {
    const root = start.getRootNode()
    const path: string[] = []

    for (let node: Element | null = start; node; node = node.parentElement) {
      if (node.id && isScopedRoot(root) && root.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
        path.unshift(`#${CSS.escape(node.id)}`)
        break
      }

      if (node === node.ownerDocument?.body) {
        path.unshift("body")
        break
      }

      const same = Array.from(node.parentNode?.children ?? []).filter(
        (child) => child instanceof Element && child.localName === node!.localName,
      )
      path.unshift(
        CSS.escape(node.localName) + (same.length > 1 ? `:nth-of-type(${same.indexOf(node) + 1})` : ""),
      )
    }

    segments.unshift(path.join(" > "))
    start = "host" in root && root.host instanceof Element ? root.host : undefined
  }

  const selector = segments.join(" >>> ")

  // A cut selector is invalid syntax; leave it out rather than pass it off as usable.
  return selector.length > 2000 ? "" : selector
}

function attrValue(element: Element, name: string) {
  const value = element.getAttribute(name)?.trim()

  return value ? clip(value, 128) : undefined
}

/**
 * Design-system hooks the app already stamps on interactive chrome. Prefer these over
 * fragile nth-of-type CSS paths when identifying a picked node for the model.
 * Walks ancestors so a click on an inner svg/icon still names the owning control.
 */
export function elementIdentity(element: Element) {
  let slot: string | undefined
  let component: string | undefined
  let action: string | undefined

  for (let node: Element | null = element; node; node = node.parentElement) {
    slot ??= attrValue(node, "data-slot")
    component ??= attrValue(node, "data-component")
    action ??= attrValue(node, "data-action")

    if (slot && component && action) break
  }

  return {
    ...(slot ? { slot } : {}),
    ...(component ? { component } : {}),
    ...(action ? { action } : {}),
  }
}

function elementLabel(element: Element, identity: ReturnType<typeof elementIdentity>) {
  const classes =
    element instanceof HTMLElement ? Array.from(element.classList, (name) => `.${name}`).join("") : ""
  const base = `${element.localName}${element.id ? `#${element.id}` : ""}${classes}`
  const hook = identity.slot || identity.component || identity.action

  // Bare decorative nodes (svg/path/icon spans) are useless chip titles; name the owning hook.
  if (hook && !element.id && !classes) return clip(`${element.localName} · ${hook}`, 200)

  return clip(base, 200)
}

function elementText(element: Element) {
  const raw =
    element instanceof HTMLElement
      ? (element.innerText ?? element.textContent ?? "")
      : (element.textContent ?? "")

  return clip(raw.replace(/\s+/g, " ").trim(), 160) || undefined
}

function elementAccessibility(element: Element) {
  if (!(element instanceof HTMLElement)) return {}

  const role = (element.getAttribute("role") ?? "").trim()
  const labeled = role && !["generic", "none", "presentation"].includes(role) ? { role: role.slice(0, 128) } : {}

  const fromLabel =
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
      ? element.labels?.[0]?.innerText
      : undefined

  const fromControl =
    element instanceof HTMLButtonElement
      ? element.innerText
      : element instanceof HTMLImageElement
        ? element.alt
        : undefined

  const resolved = (element.getAttribute("aria-label") || fromLabel || fromControl || element.getAttribute("title") || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160)

  return resolved ? { ...labeled, name: resolved } : labeled
}

/** Describes the element under a viewport point for a composer note. */
export function describeElement(element: Element): UiElement {
  const bounds = element.getBoundingClientRect()
  const accessibility = elementAccessibility(element)
  const identity = elementIdentity(element)

  return {
    label: elementLabel(element, identity),
    selector: elementSelector(element),
    ...identity,
    ...accessibility,
    text: elementText(element),
    rect: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
  }
}

/**
 * The deepest element at a point that is not the inspect chrome itself.
 * Walks into open shadow roots the same way a page picker would.
 */
export function elementAtPoint(x: number, y: number, skip: (node: Element) => boolean) {
  const stack =
    typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(x, y)
      : [document.elementFromPoint(x, y)].filter((node): node is Element => !!node)

  for (const top of stack) {
    if (skip(top)) continue

    let node: Element = top

    for (;;) {
      const root = node.shadowRoot

      if (!root) return node

      const nested = root.elementFromPoint?.(x, y)

      if (!nested || nested === node || skip(nested)) return node
      node = nested
    }
  }
}
