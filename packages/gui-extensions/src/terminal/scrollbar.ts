/**
 * SiCode: ghostty-web paints an 8px gray canvas scrollbar. Replace it with the same
 * overlay pill as `@opencode/ui/scroll-view` (4px rounded thumb, theme border tokens).
 * Hit-testing stays on ghostty's 8px edge zone so drag/click keep working.
 */

type ScrollbarRenderer = {
  renderScrollbar: (
    viewportY: number,
    scrollbackLength: number,
    visibleRows: number,
    opacity?: number,
  ) => void
  canvasWidth: number
  canvasHeight: number
  ctx: CanvasRenderingContext2D
  theme: { background: string }
}

const HIT_WIDTH = 8
const HIT_INSET = 4
const THUMB_WIDTH = 4
const TRACK_PADDING = 4
const MIN_THUMB = 20

const cssVar = (host: HTMLElement, name: string, fallback: string) => {
  const value = getComputedStyle(host).getPropertyValue(name).trim()

  return value || fallback
}

export const styleTerminalScrollbar = (term: { renderer?: unknown }, host: HTMLElement) => {
  const renderer = term.renderer

  if (!renderer || typeof renderer !== "object") return

  const target = renderer as Partial<ScrollbarRenderer>

  if (typeof target.renderScrollbar !== "function") return

  if (typeof target.ctx !== "object" || !target.ctx) return

  target.renderScrollbar = (viewportY, scrollbackLength, visibleRows, opacity = 1) => {
    const ctx = target.ctx
    const canvasWidth = target.canvasWidth ?? 0
    const canvasHeight = target.canvasHeight ?? 0
    const background = target.theme?.background ?? "transparent"

    if (!ctx || canvasWidth <= 0 || canvasHeight <= 0) return

    const hitX = canvasWidth - HIT_WIDTH - HIT_INSET
    const trackHeight = canvasHeight - TRACK_PADDING * 2

    ctx.clearRect(hitX - 2, 0, HIT_WIDTH + 6, canvasHeight)
    ctx.fillStyle = background
    ctx.fillRect(hitX - 2, 0, HIT_WIDTH + 6, canvasHeight)

    if (opacity <= 0 || scrollbackLength === 0 || trackHeight <= 0) return

    const totalLines = scrollbackLength + visibleRows
    const thumbHeight = Math.max(MIN_THUMB, (visibleRows / totalLines) * trackHeight)
    const scrollPosition = viewportY / scrollbackLength
    const thumbY = TRACK_PADDING + (trackHeight - thumbHeight) * (1 - scrollPosition)
    const thumbX = hitX + (HIT_WIDTH - THUMB_WIDTH) / 2
    const fill = cssVar(host, "--border-weak-base", "rgba(128, 128, 128, 0.45)")

    ctx.save()
    ctx.globalAlpha = opacity
    ctx.fillStyle = fill
    ctx.beginPath()

    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(thumbX, thumbY, THUMB_WIDTH, thumbHeight, 9999)
    } else {
      ctx.rect(thumbX, thumbY, THUMB_WIDTH, thumbHeight)
    }

    ctx.fill()
    ctx.restore()
  }
}
