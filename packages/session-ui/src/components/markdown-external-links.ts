/**
 * SiCode: how long a click keeps its feedback when the link opens inside the app (the side browser
 * pane). That path never moves focus, so `blur` cannot tell us the browser took over.
 */
const OPENING_HOLD_MS = 700

/**
 * SiCode: external links get an explicit owner instead of leaning on the embedder's `target="_blank"`
 * handling.
 *
 * The desktop shell does wire that path (`setWindowOpenHandler` → `shell.openExternal`), but relying
 * on it leaves the click with no observable outcome inside the app: nothing to log, nothing to
 * report, and no place to hang an "open in the side browser instead" preference later. Going through
 * the host makes one owner responsible for the destination.
 *
 * When the host supplies no handler we do not `preventDefault`, so the embedder's own handling still
 * applies — that keeps the web build and any extension surface working unchanged.
 */
export function setupExternalLinks(root: HTMLElement, open: () => ((url: string) => void) | undefined) {
  const view = root.ownerDocument.defaultView
  let opening: { link: HTMLAnchorElement; timer: ReturnType<typeof setTimeout> } | undefined

  // SiCode: the host call is fire-and-forget and never reports back, so the click needs a visible
  // outcome of its own — a cold `shell.openExternal` takes a few hundred milliseconds, and the
  // transcript used to show nothing until the browser appeared.
  const settle = () => {
    if (!opening) return
    clearTimeout(opening.timer)
    opening.link.removeAttribute("data-opening")
    opening = undefined
  }

  const handleClick = (event: MouseEvent) => {
    // Ignore secondary buttons and modified clicks: those are the reader asking for a new window or
    // tab, which is the platform's call, not ours.
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey

    if (event.defaultPrevented || event.button !== 0 || modified) return

    if (!(event.target instanceof Element)) return

    const link = event.target.closest("a.external-link[href]")

    if (!(link instanceof HTMLAnchorElement)) return
    const url = link.getAttribute("href")

    if (!url) return
    const handler = open()

    if (!handler) return
    event.preventDefault()
    settle()
    link.setAttribute("data-opening", "")
    opening = { link, timer: setTimeout(settle, OPENING_HOLD_MS) }
    handler(url)
  }

  root.addEventListener("click", handleClick)
  // A system browser takes focus when it appears: the earliest real "it opened" signal we get, and
  // the one that ends the feedback at its true duration instead of the hold.
  view?.addEventListener("blur", settle)

  return () => {
    settle()
    root.removeEventListener("click", handleClick)
    view?.removeEventListener("blur", settle)
  }
}
