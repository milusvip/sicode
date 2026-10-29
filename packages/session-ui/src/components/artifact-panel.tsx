import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import type { SessionMessageAssistant } from "@opencode/client/promise"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { useDialog } from "@opencode/ui/context/dialog"
import { useI18n } from "@opencode/ui/context/i18n"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { latestHtmlChange, type HtmlArtifact } from "../timeline/artifact"
import "./artifact-panel.css"

/**
 * SiCode: HTML demos the assistant writes never render inside the conversation — the timeline
 * stays pure prose and tool chains. When a demo lands this watcher opens it in the host's side
 * browser (injected via `open`, the desktop's browser pane) and falls back to the built-in drawer
 * where that pane is unavailable (web, remote servers, the preview shell).
 *
 * A demo is usually built in steps, so the same page sees several writes and edits. Only a write
 * may open a page; anything after that just asks the pane to refresh the tab it already shows, and
 * bursts of them collapse into one refresh so the panel does not flash on every step.
 */
export function ArtifactPanel(props: {
  messages: () => SessionMessageAssistant[]
  /** Opens a workspace HTML file in the host's side browser; returns false to use the drawer. */
  open?: (path: string) => boolean
}) {
  const dialog = useDialog()
  // The change this view has already handled, by part. Undefined until the first pass, so
  // loading a session with history never auto-opens its last demo — only live work does.
  const [seen, setSeen] = createSignal<string | undefined>(undefined)
  // Pages this view opened in the host's browser: every later change to them is a refresh.
  const opened = new Set<string>()
  let pending: ReturnType<typeof setTimeout> | undefined
  let queued: HtmlArtifact | undefined

  onCleanup(() => pending !== undefined && clearTimeout(pending))

  const flush = () => {
    pending = undefined
    const change = queued
    queued = undefined

    if (!change) return
    // An edit has no snapshot: it may only refresh a page the pane already shows.
    if (change.content === undefined && !opened.has(change.path)) return

    if (props.open?.(change.path)) {
      opened.add(change.path)

      return
    }

    if (change.content === undefined) return
    // `show` replaces whatever is on the dialog stack, so a later step swaps into the open drawer.
    dialog.show(() => <ArtifactDrawer path={change.path} content={change.content!} />, undefined, "artifact")
  }

  createEffect(() => {
    const change = latestHtmlChange(props.messages())

    // A streaming call has no final arguments yet; the completed pass re-runs this effect.
    if (!change || change.streaming) return

    const key = `${change.ref.messageID}:${change.ref.partID}`
    const previous = seen()

    setSeen(key)

    if (previous === undefined || previous === key) return

    // Steps of one build arrive close together; the panel refreshes once they settle.
    queued = change
    if (pending !== undefined) clearTimeout(pending)
    pending = setTimeout(flush, 400)
  })

  return null
}

/** Bytes above which the iframe is skipped: a multi-megabyte srcdoc can stall the renderer. */
const MAX_PANEL_BYTES = 2 * 1024 * 1024

/**
 * SiCode: the session's scrollbar is a 4px overlay pill; a sandboxed iframe can't run that JS, so
 * the closest visual match is a thin native pill. A neutral semi-transparent gray reads on both
 * light and dark demo backgrounds, and `scrollbar-width: thin` covers Firefox.
 */
const scrollbarCss =
  "<style>html{scrollbar-width:thin;scrollbar-color:rgba(128,128,128,.45) transparent}"
  + "::-webkit-scrollbar{width:8px;height:8px}"
  + "::-webkit-scrollbar-track{background:transparent}"
  + "::-webkit-scrollbar-thumb{border-radius:9999px;background:rgba(128,128,128,.45);border:2px solid transparent;background-clip:padding-box}"
  + "::-webkit-scrollbar-thumb:hover{background:rgba(128,128,128,.65)}</style>"

/** Injected just before `</head>` so the demo's own styles still win the cascade. */
function decorateArtifactHtml(html: string): string {
  const head = html.search(/<\/head>/i)
  if (head >= 0) return html.slice(0, head) + scrollbarCss + html.slice(head)

  return scrollbarCss + html
}

export function ArtifactDrawer(props: { path: string; content: string }) {
  const i18n = useI18n()
  const tooLarge = () => props.content.length > MAX_PANEL_BYTES

  return (
    <div data-component="artifact-drawer">
      <Kobalte.Content data-slot="artifact-drawer-content">
        <div data-slot="artifact-drawer-header">
          <span data-slot="artifact-drawer-label">{i18n.t("ui.artifact.title")}</span>
          <span data-slot="artifact-drawer-path" title={props.path}>
            {props.path}
          </span>
          <Kobalte.CloseButton
            data-slot="artifact-drawer-close"
            as={IconButton}
            icon={<Icon name="close" />}
            variant="ghost"
            aria-label={i18n.t("ui.common.close")}
          />
        </div>
        <Show
          when={!tooLarge()}
          fallback={<div data-slot="artifact-drawer-too-large">{i18n.t("ui.artifact.tooLarge")}</div>}
        >
          <iframe
            data-slot="artifact-drawer-frame"
            // Scripts run, but the frame has no origin: no storage, no parent access, no network identity.
            sandbox="allow-scripts"
            title={props.path}
            srcdoc={decorateArtifactHtml(props.content)}
          />
        </Show>
      </Kobalte.Content>
    </div>
  )
}
