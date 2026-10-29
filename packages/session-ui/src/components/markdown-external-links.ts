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
    handler(url)
  }

  root.addEventListener("click", handleClick)

  return () => root.removeEventListener("click", handleClick)
}
