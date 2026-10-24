/** A DOM element described for a composer note, without process-local refs. */
export type UiElement = {
  label: string
  selector: string
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

function elementLabel(element: Element) {
  const classes =
    element instanceof HTMLElement ? Array.from(element.classList, (name) => `.${name}`).join("") : ""

  return clip(`${element.localName}${element.id ? `#${element.id}` : ""}${classes}`, 200)
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

  return {
    label: elementLabel(element),
    selector: elementSelector(element),
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
