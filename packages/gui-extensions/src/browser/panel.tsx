import { Popover } from "@kobalte/core/popover"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import type { IconName } from "@opencode/ui/icons/catalog"
import { IconButton } from "@opencode/ui/icon-button"
import { LineCommentEditor } from "@opencode/ui/line-comment"
import { Loader } from "@opencode/ui/loader"
import { Keybind } from "@opencode/ui/keybind"
import { Menu } from "@opencode/ui/menu"
import { Switch } from "@opencode/ui/switch"
import { showToast } from "@opencode/ui/toast"
import { Tooltip } from "@opencode/ui/tooltip"
import { ScrollView } from "@opencode/ui/scroll-view"
import { createEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createMemo, For, on, onCleanup, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import type { Browser } from "@opencode/plugin-browser/rpc"
import { createKeyed, useExtension, usePanel, type PanelTab, type MountedSession, type SessionScreen } from "../sdk"
import { addressParts, connection, loopback, resolveAddress, SEARCH_ENGINES, searchQuery, searches } from "./address"
import { commentNote, pageNote } from "./comment"
import type { CookieLoginState } from "./connection"
import { bare, completes, highlight, suggest, type Visit } from "./history"
import type { Model } from "./model"
import type { PaneElement } from "./ipc"
import { PageIcon } from "./page-icon"

// SiCode: one label per login-state read, shown as the paste toast's description.
const COOKIE_LOGIN_LABEL: Record<CookieLoginState["state"], string> = {
  likely: "cookies.login.likely",
  unclear: "cookies.login.unclear",
  unlikely: "cookies.login.unlikely",
}

type PaneState = {
  /** The address field's text while the user edits it, and the submitted address it keeps afterwards. */
  address: string
  editing: boolean
  /**
   * The report counts when an address was submitted; the next URL change, finished load or rejection shows the
   * page's URL.
   */
  kept: { followed: number; rejected: number } | undefined
  /** The movement count at a submit; the next reported movement ends the submitted navigation. */
  navigating: number | undefined
  /** The user typed since focusing the address field; suggestions follow typing, not a focused URL. */
  typed: boolean
  /** The suggestion Enter opens; -1 opens the typed text. */
  active: number
  /** Escape closed the suggestions; typing opens them again. */
  dismissed: boolean
  /** The tab whose element picker is on. */
  picking: { sessionKey: string; tabID: Browser.TabID } | undefined
  /** A picked element awaiting its comment. The page stays frozen as a still until it closes. */
  comment:
    | {
        sessionKey: string
        tabID: Browser.TabID
        url: string
        /** The tab's navigation count at the pick; the element's ref dies when it changes. */
        generation: number
        element: PaneElement
        draft: string
      }
    | undefined
  /** A comment on the whole page awaiting its text, frozen like an element comment. */
  note: { sessionKey: string; tabID: Browser.TabID; url: string; title: string; draft: string } | undefined
  /** The login-state paste is open. */
  paste: boolean
  size: { width: number; height: number }
  editorHeight: number
}

/** Suggestions the address field lists, and pages the new tab page lists. */
const SUGGESTIONS = 5

const RECENT = 5

export default function SessionBrowserPane(props: {
  tab: Accessor<PanelTab>
  session: MountedSession
  screen: SessionScreen
  model: Model
}) {
  const extension = useExtension()
  const keybinds = extension.keybinds
  const desktop = extension.desktop
  const embeds = extension.embeds
  const system = extension.system
  const panel = usePanel()
  const visible = () => panel.visible()
  const state = () => props.model.tab(props.session, props.tab().id)
  const address = () => (state()?.url === "about:blank" ? "" : (state()?.url ?? ""))
  const failed = () => !!state()?.loadError
  const suspended = () => props.model.suspended(props.session)
  const command = (action: Browser.Action) => props.model.command(props.session, action)

  const page = () => {
    const tab = state()

    return tab ? props.model.page(props.session, tab.id) : undefined
  }

  const [store, setStore] = createStore<PaneState>({
    address: "",
    editing: false,
    kept: undefined,
    navigating: undefined,
    typed: false,
    active: -1,
    dismissed: false,
    picking: undefined,
    comment: undefined,
    note: undefined,
    paste: false,
    size: { width: 0, height: 0 },
    editorHeight: 0,
  })

  // Finished loads, counted. A submitted address that lands on the URL the page already had (say "example.com" on
  // https://example.com/) changes no URL, only this.
  const settled = createMemo(
    on(
      () => !!state()?.loading,
      (loading, previous, count: number = 0) => (previous && !loading ? count + 1 : count),
    ),
  )

  // Page reports, counted: a count moves on every report, even one that repeats a value. Tab switches, URL changes and
  // finished loads:
  const followed = createMemo(
    on([() => state()?.id, address, settled], (_input, _previous, count: number = 0) => count + 1),
  )

  // Rejections: a blocked or rejected request leaves the page where it was.
  const rejected = createMemo(
    on(
      () => props.model.error(props.session),
      (error, _previous, count: number = 0) => (error ? count + 1 : count),
    ),
  )

  // Any reported movement, including a rejected or blocked request. A command clearing the last error is not one.
  const moved = createMemo(
    on(
      [() => state()?.id, () => state()?.generation, () => state()?.loading, rejected],
      (_input, _previous, count: number = 0) => count + 1,
    ),
  )

  // A submitted navigation the browser has not reported yet; keeps the empty state hidden meanwhile.
  const navigating = () => store.navigating === moved()

  // The address field: the user's text while editing, and a submitted address until the page reports a URL change or a
  // rejection; otherwise the page's URL.
  const field = () => {
    if (store.editing) return store.address
    const kept = store.kept

    return kept?.followed === followed() && kept.rejected === rejected() ? store.address : address()
  }

  const empty = () => !address() && !state()?.loading && !navigating()
  // The desktop page hides blank and loading documents itself; only hide here
  // while the pane shows its own empty or failed state over the embed.
  const shown = () => visible() && !empty() && !failed()

  const embed = () => {
    const tab = state()

    return tab ? props.model.embed(props.session, tab.id) : undefined
  }

  let box: HTMLDivElement | undefined
  let input: HTMLInputElement | undefined
  let anchor: HTMLFormElement | undefined

  const error = () => {
    const value = props.model.error(props.session)

    if (value === "browser.pane.replaced") return extension.t("replaced")

    if (value === "browser.pane.unsupported") return extension.t("unsupported")

    return value
  }

  const inspectable = () => !!address() && !failed() && !suspended()

  const picking = () => store.picking?.sessionKey === props.session.key && store.picking?.tabID === state()?.id
  // A comment on a picked element freezes the page so its editor can float above it.
  const commenting = () => store.comment?.sessionKey === props.session.key && store.comment?.tabID === state()?.id
  const noting = () => store.note?.sessionKey === props.session.key && store.note?.tabID === state()?.id

  // A paste is written for one page's site: another tab, or another URL, closes it rather than carrying its cookies
  // over. The paste popup keys on this too, so it starts empty on the page it opens for.
  const pageKey = () => {
    const tab = state()

    return tab ? `${tab.id}\n${address()}` : undefined
  }

  createKeyed(pageKey, () => setStore("paste", false))

  // The address field always shows the whole URL; at rest it draws the host emphasized.
  const parts = () => addressParts(field())
  const site = () => !!field() && !store.editing

  // Suggestions follow what the user typed; a focused address is not a query.
  const suggestions = createMemo(() =>
    store.editing && store.typed ? suggest(props.model.visits(), store.address, SUGGESTIONS) : [],
  )

  const listed = () => suggestions().length > 0 && !store.dismissed
  const chosen = () => (listed() ? suggestions()[store.active] : undefined)
  const recent = () => props.model.visits().slice(0, RECENT)

  // A loopback address opens on the machine that runs the server; the system browser here reaches it only when the
  // server runs here too.
  const reachable = () => {
    const url = address()

    if (!URL.canParse(url)) return false
    const parsed = new URL(url)

    if (parsed.protocol === "file:") return props.session.server.local

    return /^https?:$/.test(parsed.protocol) && (props.session.server.local || !loopback(parsed.hostname))
  }

  const setPicking = (current: NonNullable<PaneState["picking"]>, enabled: boolean) => {
    props.model.inspect({ key: current.sessionKey }, current.tabID, enabled)
    setStore("picking", enabled ? current : undefined)
  }

  const closeComment = () => {
    const current = store.comment

    if (!current) return
    props.model.highlight({ key: current.sessionKey }, current.tabID)
    setStore("comment", undefined)
  }

  const closeNote = () => setStore("note", undefined)

  const toggleInspect = () => {
    const tab = state()

    if (!tab || !inspectable()) return

    if (store.comment) closeComment()
    closeNote()
    setPicking({ sessionKey: props.session.key, tabID: tab.id }, !picking())
  }

  const focusAddress = () => {
    input?.focus()
    input?.select()
  }

  // Navigates the tab and keeps the submitted address in the field until the page reports where it went; a blank page
  // keeps the field empty. Ends editing here rather than on blur: a click elsewhere, such as a recent page, may have
  // blurred the field already.
  const go = (url: string) => {
    const tab = state()

    if (!tab) return
    setStore({
      editing: false,
      typed: false,
      active: -1,
      address: url === "about:blank" ? "" : url,
      navigating: moved(),
      kept: { followed: followed(), rejected: rejected() },
    })
    command({ type: "navigate", tabID: tab.id, url })
    input?.blur()
  }

  const step = (by: number) => {
    const count = suggestions().length

    if (!count) return
    setStore({
      dismissed: false,
      active: store.active + by < -1 ? count - 1 : ((store.active + by + 1) % (count + 1)) - 1,
    })
  }

  const submitComment = (value: string) => {
    const current = store.comment

    if (!current) return
    const tab = state()

    // The draft outlives a reload or agent navigation, but the ref no longer names anything.
    const live =
      props.session.key === current.sessionKey && tab?.id === current.tabID && tab.generation === current.generation

    // The owning screen's composer serves the session the pane shows.
    props.screen.composer.attach(
      commentNote({
        origin: extension.id,
        tabID: current.tabID,
        url: current.url,
        element: {
          ref: live ? current.element.ref : undefined,
          selector: current.element.selector,
          label: current.element.label,
          role: current.element.role,
          name: current.element.name,
          text: current.element.text,
        },
        comment: value,
      }),
    )
    closeComment()
  }

  const openNote = () => {
    const tab = state()

    if (!tab || !address()) return

    // The editor is already open: the button keeps what the user wrote.
    if (noting()) return

    if (picking() && store.picking) setPicking(store.picking, false)
    closeComment()
    setStore("note", { sessionKey: props.session.key, tabID: tab.id, url: tab.url, title: tab.title, draft: "" })
  }

  const submitNote = (value: string) => {
    const current = store.note

    if (!current) return
    props.screen.composer.attach(
      pageNote({
        origin: extension.id,
        tabID: current.tabID,
        url: current.url,
        title: current.title,
        label: current.title || addressParts(current.url).host || current.url,
        comment: value,
      }),
    )
    closeNote()
  }

  const zoomed = () => !!address() && (page()?.zoom ?? 1) !== 1

  // A search that would not load is usually the engine's network rather than the query, so the failure offers the next
  // engine; picking it also makes it the default, which is what the next search needs.
  const searchFailure = () => {
    const engine = props.model.searchEngine()
    const query = searchQuery(engine, address())

    return query ? { engine, query } : undefined
  }

  const nextSearchEngine = () => {
    const failure = searchFailure()

    if (!failure) return
    const index = SEARCH_ENGINES.findIndex((engine) => engine.id === failure.engine.id)

    return SEARCH_ENGINES[(index + 1) % SEARCH_ENGINES.length]
  }

  const switchSearch = () => {
    const failure = searchFailure()
    const engine = nextSearchEngine()

    if (!failure || !engine) return
    props.model.setSearchEngine(engine.id)
    go(resolveAddress(failure.query, engine))
  }

  const zoomPage = (direction: "in" | "out" | "reset") => {
    const tab = state()

    if (tab) props.model.zoom(props.session, tab.id, direction)
  }

  const copyLink = () => {
    const url = address()

    if (!url) return
    void system.copy(url).then(
      () => showToast({ title: extension.t("common.copied") }),
      () => showToast({ title: extension.t("common.requestFailed") }),
    )
  }

  // The picked element in surface pixels, and the editor anchored below it, above it, or over it.
  const spotlight = () => {
    const rect = store.comment?.element.rect

    if (!rect) return
    const zoom = desktop?.zoom() ?? 1

    return { x: rect.x / zoom, y: rect.y / zoom, width: rect.width / zoom, height: rect.height / zoom }
  }

  const placement = () => {
    const rect = spotlight()

    if (!rect) return
    const gap = 8
    const width = Math.max(0, Math.min(400, store.size.width - gap * 2))
    // The editor scrolls rather than growing past the surface, so its actions stay reachable.
    const maxHeight = Math.max(0, store.size.height - gap * 2)
    // Until the editor has been measured once, assume its default three-row height.
    const height = Math.min(store.editorHeight || 176, maxHeight)
    const left = Math.min(Math.max(gap, rect.x), Math.max(gap, store.size.width - width - gap))
    const below = rect.y + rect.height + gap
    const above = rect.y - gap - height

    const top =
      below + height <= store.size.height - gap
        ? below
        : above >= gap
          ? above
          : Math.max(gap, store.size.height - height - gap)

    return { left, top, width, maxHeight }
  }

  onCleanup(
    props.model.mount({
      visible,
      address,
      reload: () => {
        const tab = state()

        if (tab) command({ type: "reload", tabID: tab.id })
      },
      close: () => {
        const tab = state()

        if (tab) props.model.closeTab(props.session, tab.id)
      },
      inspectable,
      inspect: toggleInspect,
      focusAddress,
    }),
  )

  // The pane stays mounted when another session is routed; it listens to the routed session's picker.
  createKeyed(
    () => props.session.key,
    (sessionKey) =>
      onCleanup(
        props.model.onInspect({ key: sessionKey }, (event) => {
          if (event.active) {
            setStore("picking", { sessionKey, tabID: event.tabID })

            return
          }

          if (store.picking?.sessionKey === sessionKey && store.picking.tabID === event.tabID)
            setStore("picking", undefined)

          if (!event.element) return
          const tab = state()

          if (tab?.id !== event.tabID || !visible()) {
            props.model.highlight({ key: sessionKey }, event.tabID)

            return
          }

          setStore("comment", {
            sessionKey,
            tabID: tab.id,
            url: tab.url,
            generation: tab.generation,
            element: event.element,
            draft: "",
          })
        }),
      ),
  )

  // The page's address shortcut moves focus to this field when the page is the one on screen.
  createKeyed(
    () => props.session.key,
    (sessionKey) =>
      onCleanup(
        props.model.onAddress({ key: sessionKey }, (tabID) => {
          if (tabID === state()?.id && visible()) focusAddress()
        }),
      ),
  )

  // A tab the user just opened starts in its address field, once its blank page is on screen. Syncs DOM focus.
  createKeyed(
    () => (visible() && empty() ? state()?.id : undefined),
    () => {
      if (props.model.opened(props.session)) focusAddress()
    },
  )

  // A picker or comment belongs to the page on screen: the page's picker stops when its tab is switched away or the
  // pane hides, and a comment closes with its tab.
  const endPicker = () => {
    const current = store.picking

    if (current && (current.sessionKey !== props.session.key || current.tabID !== state()?.id || !visible()))
      setPicking(current, false)
  }

  onCleanup(() => {
    if (store.picking) setPicking(store.picking, false)
    closeComment()
  })

  createKeyed(visible, endPicker, { otherwise: endPicker })
  createKeyed(
    () => {
      const tab = state()

      return tab ? { session: props.session.key, tabID: tab.id } : undefined
    },
    (current) => {
      endPicker()

      if (store.comment?.sessionKey !== current.session || store.comment.tabID !== current.tabID) closeComment()

      if (store.note?.sessionKey !== current.session || store.note.tabID !== current.tabID) closeNote()
    },
    {
      equals: (previous, next) => previous.session === next.session && previous.tabID === next.tabID,
      otherwise: () => {
        endPicker()
        closeComment()
        closeNote()
      },
    },
  )
  // The page does not have focus while the picker waits for a hover, so Escape reaches the app.
  createEventListener(
    window,
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !store.picking) return
      event.preventDefault()
      event.stopPropagation()
      setPicking(store.picking, false)
    },
    { capture: true },
  )
  createResizeObserver(
    () => box,
    (rect) => setStore("size", { width: rect.width, height: rect.height }),
  )

  // A restored tab has no page until the pane first shows it.
  createKeyed(
    () => {
      const tab = state()

      return tab && shown() && !embed() ? tab.id : undefined
    },
    (tabID) => props.model.load(props.session, tabID),
  )

  const tip = (label: string, keys?: readonly string[]): JSX.Element => (
    <div class="flex items-center gap-2">
      <span>{label}</span>
      <Show when={keys && keys.length > 0}>
        <Keybind keys={[...(keys ?? [])]} variant="neutral" />
      </Show>
    </div>
  )

  return (
    <aside id="browser-panel" class="relative size-full min-w-0 overflow-hidden bg-v2-background-bg-base flex flex-col">
      <div
        data-component="browser-bar"
        class="h-11 shrink-0 flex items-center gap-2 px-3 border-b-[0.5px] border-v2-border-border-muted"
      >
        <div class="flex shrink-0 items-center">
          <For each={["back", "forward"] as const}>
            {(direction) => (
              <Tooltip placement="top" value={extension.t(direction === "back" ? "common.goBack" : "common.goForward")}>
                <IconButton
                  variant="ghost-muted"
                  size="large"
                  disabled={!state()?.[direction === "back" ? "canGoBack" : "canGoForward"]}
                  aria-label={extension.t(direction === "back" ? "common.goBack" : "common.goForward")}
                  onClick={() => {
                    const tab = state()

                    if (tab) command({ type: direction, tabID: tab.id })
                  }}
                  icon={<Icon name={direction === "back" ? "outline-arrow-left" : "outline-arrow-right"} />}
                />
              </Tooltip>
            )}
          </For>
          <Tooltip
            placement="top"
            value={
              state()?.loading
                ? extension.t("action.stop")
                : tip(extension.t("action.reload"), keybinds.keybind("browser.reload"))
            }
          >
            <IconButton
              variant="ghost-muted"
              size="large"
              disabled={!state()?.loading && !address()}
              aria-label={extension.t(state()?.loading ? "action.stop" : "action.reload")}
              onClick={() => {
                const tab = state()

                if (tab) command({ type: tab.loading ? "stop" : "reload", tabID: tab.id })
              }}
              icon={
                <Show when={state()?.loading} fallback={<Icon name="outline-rotate-clockwise" />}>
                  <Loader />
                </Show>
              }
            />
          </Tooltip>
        </div>
        <Popover
          open={store.editing && listed()}
          anchorRef={() => anchor}
          placement="bottom-start"
          gutter={4}
          // The list overhangs the field by its 8px padding, so suggestion icons and text line up with the field's.
          shift={-8}
          modal={false}
        >
          <form
            ref={anchor}
            dir="ltr"
            data-component="browser-address"
            data-editing={store.editing ? "" : undefined}
            data-site={site() ? "" : undefined}
            data-address={store.editing && !store.typed && field() ? "" : undefined}
            onPointerDown={(event) => {
              // The whole field focuses the input, as the site button and page actions handle their own clicks.
              if (event.target === event.currentTarget) {
                event.preventDefault()
                input?.focus()
              }
            }}
            onSubmit={(event) => {
              event.preventDefault()
              const picked = chosen()
              const text = field().trim()

              if (picked) return go(picked.url)

              if (text || failed()) return go(resolveAddress(text, props.model.searchEngine()))
              input?.blur()
            }}
          >
            {/* Editing shows the icon of the page Enter would open: the page's own, or the chosen suggestion's. */}
            <Show
              when={site()}
              fallback={
                <PageIcon
                  icon={store.editing && field() ? (store.typed ? chosen()?.icon : page()?.icon) : undefined}
                  class="text-v2-icon-icon-muted"
                />
              }
            >
              {/* Site information describes one page: another tab or URL closes it, and opening it reads anew. */}
              <Show when={`${props.session.key}\n${state()?.id}\n${address()}`} keyed>
                <SiteInformation
                  url={address()}
                  certificateWarning={!!page()?.certificateWarning}
                  server={props.session.server.local ? undefined : props.session.server.name}
                  site={() => {
                    const tab = state()

                    return tab ? props.model.site(props.session, tab.id) : undefined
                  }}
                  clear={() => {
                    const tab = state()

                    return tab ? props.model.clearSite(props.session, tab.id) : undefined
                  }}
                  agentAccess={() => props.model.agentAccess(props.session)}
                  agentLocked={() => props.model.agentLocked(props.session)}
                  setAgentAccess={(access) => props.model.setAgentAccess(props.session, access)}
                  refreshAgentAccess={() => props.model.refreshAgentAccess(props.session)}
                />
              </Show>
            </Show>
            <div data-slot="browser-address-text">
              <input
                ref={input}
                data-slot="browser-address-input"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={store.editing && listed()}
                aria-controls={listed() ? "browser-suggestions" : undefined}
                aria-activedescendant={chosen() ? `browser-suggestion-${store.active}` : undefined}
                spellcheck={false}
                autocomplete="off"
                value={field()}
                disabled={!state()}
                placeholder={extension.t("address.search")}
                aria-label={extension.t("address.label")}
                onFocus={(event) => {
                  setStore({ editing: true, address: field(), typed: false, active: -1, dismissed: false })
                  event.currentTarget.select()
                }}
                // Leaving the field without submitting cancels the edit; a submit already ended it. Focus that leaves
                // for the page or another window keeps the field as the document's focus, so the window's return would
                // focus it again and start an edit under the returning click, such as one on the site button.
                onBlur={(event) => {
                  if (store.editing) setStore({ editing: false, typed: false, active: -1, kept: undefined })

                  if (!document.hasFocus()) event.currentTarget.blur()
                }}
                onInput={(event) => {
                  const value = event.currentTarget.value
                  const first = suggest(props.model.visits(), value, 1)[0]

                  // Typing completes the first suggestion, as a search would; deleting never does.
                  const complete =
                    !!first && !event.inputType.startsWith("delete") && (completes(first, value) || searches(value))

                  setStore({ address: value, typed: true, dismissed: false, active: complete ? 0 : -1 })
                }}
                onKeyDown={(event) => {
                  // Keys during IME composition pick and cancel candidates, not suggestions. Safari can report the
                  // composition-confirming keydown with isComposing false but keyCode 229.
                  if (event.isComposing || event.keyCode === 229) return

                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    if (!suggestions().length) return
                    event.preventDefault()
                    step(event.key === "ArrowDown" ? 1 : -1)

                    return
                  }

                  if (event.key !== "Escape") return
                  event.preventDefault()

                  if (listed()) return setStore({ dismissed: true, active: -1 })
                  event.currentTarget.blur()
                }}
              />
              {/* At rest, draw the whole URL over the input's hidden text with its host emphasized. While editing, the
                  input shows its own text so selection and the caret need no mirror. */}
              <Show when={!store.editing && field()}>
                <div aria-hidden="true" data-slot="browser-address-display">
                  <span data-slot="browser-address-url" data-host={parts().host ? "" : undefined}>
                    <span data-slot="browser-address-muted">{parts().scheme}</span>
                    <span data-slot="browser-address-host">{parts().host}</span>
                    {parts().rest}
                  </span>
                </div>
              </Show>
              {/* The suggestion Enter opens, after the typed text. Long text scrolls the input, which a mirror cannot
                  follow, so only a short query shows it. */}
              <Show when={store.editing && store.address.length <= 48 && chosen()}>
                {(visit) => (
                  <div aria-hidden="true" data-slot="browser-address-hint">
                    <span class="invisible shrink-0">{store.address}</span>
                    <span class="ms-1.5 min-w-0 truncate">{`- ${bare(visit().url)}`}</span>
                  </div>
                )}
              </Show>
            </div>
            {/* Any zoom but 100% stays in sight, as the system browser shows it; a click resets it. */}
            <Show when={zoomed()}>
              <Tooltip placement="top" value={extension.t("zoom.reset")}>
                <button
                  type="button"
                  data-slot="browser-address-zoom"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => zoomPage("reset")}
                >
                  {extension.t("zoom.percent", { percent: Math.round((page()?.zoom ?? 1) * 100) })}
                </button>
              </Tooltip>
            </Show>
            {/* Submit sits at the field's trailing edge so a pointer can open the address without the keyboard. */}
            <Tooltip placement="top" value={extension.t("address.go")}>
              <IconButton
                type="submit"
                variant="ghost-muted"
                size="small"
                data-slot="browser-address-go"
                disabled={!state()}
                aria-label={extension.t("address.go")}
                onPointerDown={(event) => event.preventDefault()}
                icon={<Icon name="enter" />}
              />
            </Tooltip>
          </form>
          <Popover.Portal>
            <Popover.Content
              data-component="browser-suggestions"
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <div id="browser-suggestions" role="listbox" aria-label={extension.t("address.suggestions")}>
                <For each={suggestions()}>
                  {(visit, index) => (
                    <PageRow
                      visit={visit}
                      query={store.address}
                      option={{ id: `browser-suggestion-${index()}`, selected: index() === store.active }}
                      onClick={() => go(visit.url)}
                    />
                  )}
                </For>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover>
        <div class="flex shrink-0 items-center gap-1">
          {/* Signing in by pasted cookies sits with the page's own tools rather than in the address field, and works
              on a blank tab too: a paste that names its own domains needs no page open. */}
          <Show when={pageKey()} keyed>
            <SiteCookies
              url={address()}
              disabled={suspended()}
              open={store.paste}
              onOpenChange={(open) => setStore("paste", open)}
              write={(text) => {
                const tab = state()

                return tab ? props.model.setCookies(props.session, tab.id, text) : undefined
              }}
            />
          </Show>
          <Tooltip
            placement="top"
            value={
              <div class="flex flex-col gap-1">
                {tip(extension.t("inspect"), keybinds.keybind("browser.inspect"))}
                {/* The page claims Chromium's picker chord itself; the app leaves it to the terminal. */}
                {tip(extension.t("inspect.pageShortcut"), keybinds.keys("mod+shift+c"))}
              </div>
            }
          >
            {/* The ghost variant sets the button color, so the active accent needs precedence over it. */}
            <IconButton
              variant="ghost-muted"
              size="large"
              data-action="browser-inspect"
              disabled={!inspectable()}
              state={picking() ? "pressed" : undefined}
              classList={{ "!text-v2-icon-icon-accent": picking() || commenting() }}
              aria-pressed={picking()}
              aria-label={extension.t("inspect")}
              onClick={toggleInspect}
              icon={<Icon name="outline-browser-annotate" />}
            />
          </Tooltip>
          <Menu gutter={4} modal={false} placement="bottom-end">
            <Tooltip placement="top" value={extension.t("options")}>
              <Menu.Trigger
                as={IconButton}
                variant="ghost-muted"
                size="large"
                disabled={!state()}
                icon={<Icon name="outline-dots" />}
                aria-label={extension.t("options")}
              />
            </Tooltip>
            <Menu.Portal>
              <Menu.Content class="min-w-56">
                {/* Zooming closes the menu: the page stays a still while the menu covers it, so a zoom would show
                    only once it closed. The address field shows any zoom but 100% afterwards. */}
                <Menu.Group>
                  <Menu.Item
                    disabled={!address()}
                    onSelect={() => zoomPage("in")}
                    shortcut={<Keybind keys={[...keybinds.keys("mod+plus")]} variant="neutral" />}
                  >
                    {extension.t("zoom.in")}
                  </Menu.Item>
                  <Menu.Item
                    disabled={!address()}
                    onSelect={() => zoomPage("out")}
                    shortcut={<Keybind keys={[...keybinds.keys("mod+-")]} variant="neutral" />}
                  >
                    {extension.t("zoom.out")}
                  </Menu.Item>
                  <Menu.Item
                    disabled={!zoomed()}
                    onSelect={() => zoomPage("reset")}
                    badge={extension.t("zoom.percent", { percent: Math.round((page()?.zoom ?? 1) * 100) })}
                  >
                    {extension.t("zoom.reset")}
                  </Menu.Item>
                </Menu.Group>
                <Menu.Separator />
                {/* Adding the page to the session is a page action, but a rare one: it lives here rather than in the
                    address field, which keeps only the field and the page's tools. */}
                <Menu.Item disabled={!address() || failed() || suspended()} onSelect={openNote}>
                  {extension.t("page.add")}
                </Menu.Item>
                <Menu.Item disabled={!address()} onSelect={copyLink}>
                  {extension.t("link.copy")}
                </Menu.Item>
                <Menu.Item disabled={!reachable()} onSelect={() => system.openExternal(address())}>
                  {extension.t("external.open")}
                </Menu.Item>
                <Menu.Separator />
                <Menu.Sub>
                  <Menu.SubTrigger>{extension.t("search.engine")}</Menu.SubTrigger>
                  <Menu.Portal>
                    <Menu.SubContent class="min-w-40">
                      <Menu.RadioGroup
                        value={props.model.searchEngine().id}
                        onChange={(engine) => props.model.setSearchEngine(engine)}
                      >
                        <For each={SEARCH_ENGINES}>
                          {(engine) => (
                            <Menu.RadioItem value={engine.id} closeOnSelect>
                              {extension.t(`search.engine.${engine.id}`)}
                            </Menu.RadioItem>
                          )}
                        </For>
                      </Menu.RadioGroup>
                    </Menu.SubContent>
                  </Menu.Portal>
                </Menu.Sub>
                <Menu.Separator />
                <Menu.Item disabled={props.model.visits().length === 0} onSelect={() => props.model.clearHistory()}>
                  {extension.t("history.clear")}
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        </div>
      </div>
      <Show when={error() && !failed()}>
        <div
          class="shrink-0 px-3 py-1.5 text-12-regular text-v2-state-fg-danger border-b border-v2-border-border-muted"
          role="alert"
          aria-live="assertive"
        >
          {error()}
        </div>
      </Show>
      <embeds.View
        id={embed()}
        visible={shown()}
        frozen={commenting() || noting()}
        radius={10}
        class="relative min-h-0 flex-1 bg-v2-background-bg-base flex items-center justify-center"
      >
        <div ref={box} aria-hidden="true" class="pointer-events-none absolute inset-0" />
        <Show when={empty() && !failed() && !suspended()}>
          {/* As designed: the heading 80px from the top, the recent list centered above a 160px bottom inset. The
              minimum height keeps a full list clear of the heading in a short pane, which then scrolls. */}
          <ScrollView dir="auto" class="size-full">
            <div class="relative flex min-h-[max(100%,732px)] items-center justify-center px-6 pb-40">
              <div class="absolute inset-x-6 top-20 mx-auto flex max-w-[360px] flex-col items-center gap-4 text-center">
                <Icon name="outline-globe" size="large" class="text-v2-icon-icon-muted" />
                <div class="flex flex-col gap-2">
                  <div class="text-[13px] font-[530] leading-[var(--line-height-compact)] text-v2-text-text-base">
                    {extension.t("home.title")}
                  </div>
                  <div class="text-[13px] font-[440] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                    {extension.t("home.description")}
                  </div>
                </div>
              </div>
              {/* One visit is enough to list; the list stops at a handful. */}
              <Show when={recent().length > 0}>
                <div class="flex w-full max-w-[685px] flex-col gap-4">
                  <div class="px-2 text-[13px] font-[440] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                    {extension.t("home.recent")}
                  </div>
                  <div class="flex flex-col gap-2">
                    <For each={recent()}>{(visit) => <PageRow visit={visit} onClick={() => go(visit.url)} />}</For>
                  </div>
                </div>
              </Show>
            </div>
          </ScrollView>
        </Show>
        <Show when={failed() && !suspended()}>
          {/* Add the 40px toolbar to the file empty state's 160px bottom padding to align their centers. */}
          <div
            dir="auto"
            class="flex size-full flex-col items-center justify-center gap-2 p-6 pb-[200px] text-center text-text-weak"
          >
            <Icon name="globe" size="large" class="mb-2 shrink-0" />
            <div class="text-[13px] font-medium leading-[var(--line-height-compact)] text-text-strong">
              {extension.t("failed.title")}
            </div>
            <div class="text-13-regular leading-[var(--line-height-base)]">{extension.t("failed.description")}</div>
            <Show when={nextSearchEngine()}>
              {(engine) => (
                <Button class="mt-2" size="small" variant="neutral" onClick={switchSearch}>
                  {extension.t("failed.search", { engine: extension.t(`search.engine.${engine().id}`) })}
                </Button>
              )}
            </Show>
          </div>
        </Show>
        <Show when={suspended()}>
          <p class="px-6 text-center text-13-regular text-v2-text-text-subtle" role="status">
            {extension.t("suspended")}
          </p>
        </Show>
        <Show when={commenting() && store.comment}>
          {(current) => (
            <div
              data-component="browser-comment"
              class="absolute inset-0 z-10"
              onPointerDown={(event) => {
                // A click beside the editor dismisses it unless it would discard a draft.
                if (event.target === event.currentTarget && !current().draft.trim()) closeComment()
              }}
            >
              <Show when={spotlight()}>
                {(rect) => (
                  <div
                    data-slot="browser-comment-spotlight"
                    class="pointer-events-none absolute rounded-[2px]"
                    style={{
                      left: `${rect().x}px`,
                      top: `${rect().y}px`,
                      width: `${rect().width}px`,
                      height: `${rect().height}px`,
                    }}
                  />
                )}
              </Show>
              <Show when={placement()}>
                {(position) => (
                  <div
                    ref={(element) =>
                      createResizeObserver(element, (rect) => setStore("editorHeight", Math.ceil(rect.height)))
                    }
                    data-slot="browser-comment-editor"
                    data-prevent-autofocus
                    class="absolute overflow-y-auto rounded-[6px] shadow-[var(--v2-elevation-raised)]"
                    style={{
                      left: `${position().left}px`,
                      top: `${position().top}px`,
                      width: `${position().width}px`,
                      "max-height": `${position().maxHeight}px`,
                    }}
                  >
                    <LineCommentEditor
                      value={current().draft}
                      onInput={(value) => setStore("comment", "draft", value)}
                      onCancel={closeComment}
                      onSubmit={submitComment}
                      mention={{
                        items: (query) => props.screen.file.search(query, { kind: "any" }),
                      }}
                      selection={
                        <span class="flex min-w-0 items-center gap-1" dir="ltr">
                          <Icon name="select-element" size="small" class="shrink-0" />
                          <span class="min-w-0 truncate leading-[var(--line-height-tight)]">
                            {current().element.label}
                          </span>
                        </span>
                      }
                    />
                  </div>
                )}
              </Show>
            </div>
          )}
        </Show>
        <Show when={noting() && store.note}>
          {(current) => (
            <div
              data-component="browser-comment"
              class="absolute inset-0 z-10"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget && !current().draft.trim()) closeNote()
              }}
            >
              {/* Under the page actions at the address field's end, which opened it. */}
              <div
                data-slot="browser-comment-editor"
                data-prevent-autofocus
                class="absolute end-2 top-2 overflow-y-auto rounded-[6px] shadow-[var(--v2-elevation-raised)]"
                style={{
                  width: `${Math.max(0, Math.min(400, store.size.width - 16))}px`,
                  "max-height": `${Math.max(0, store.size.height - 16)}px`,
                }}
              >
                <LineCommentEditor
                  value={current().draft}
                  onInput={(value) => setStore("note", "draft", value)}
                  onCancel={closeNote}
                  onSubmit={submitNote}
                  placeholder={extension.t("page.placeholder")}
                  mention={{
                    items: (query) => props.screen.file.search(query, { kind: "any" }),
                  }}
                  selection={
                    <span class="flex min-w-0 items-center gap-1" dir="ltr">
                      <Icon name="outline-globe" size="small" class="shrink-0" />
                      <span class="min-w-0 truncate leading-[var(--line-height-tight)]">
                        {current().title || addressParts(current().url).host || current().url}
                      </span>
                    </span>
                  }
                />
              </div>
            </div>
          )}
        </Show>
      </embeds.View>
      <p class="sr-only" role="status" aria-live="polite">
        {picking() ? extension.t("inspect.active") : ""}
      </p>
    </aside>
  )
}

/** A page in the suggestions or the new tab page: its icon, title and address, with the query's matches drawn. */
function PageRow(props: {
  visit: Visit
  query?: string
  /** Set for a suggestion: an option of the address field's list, which keeps keyboard focus in the field. */
  option?: { id: string; selected: boolean }
  onClick: () => void
}) {
  const body = () => (
    <>
      <PageIcon icon={props.visit.icon} class="text-v2-icon-icon-muted" />
      <span data-slot="browser-page-row-text">
        <Show when={props.visit.title}>
          <span data-slot="browser-page-row-title">
            <Marked text={props.visit.title} query={props.query ?? ""} />
          </span>
          <span>-</span>
        </Show>
        <span data-slot="browser-page-row-url">
          <Marked text={bare(props.visit.url)} query={props.query ?? ""} />
        </span>
      </span>
    </>
  )

  return (
    <Show
      when={props.option}
      fallback={
        <button type="button" data-component="browser-page-row" dir="ltr" onClick={() => props.onClick()}>
          {body()}
        </button>
      }
    >
      {(option) => (
        <div
          id={option().id}
          role="option"
          aria-selected={option().selected}
          data-component="browser-page-row"
          dir="ltr"
          // The address field keeps focus, so a click does not end editing before it opens the page.
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => props.onClick()}
        >
          {body()}
        </div>
      )}
    </Show>
  )
}

function Marked(props: { text: string; query: string }) {
  return (
    <For each={highlight(props.text, props.query)}>
      {(part) => (
        <Show when={part.match} fallback={part.text}>
          <mark>{part.text}</mark>
        </Show>
      )}
    </For>
  )
}

/**
 * Signs the pane into a site by pasting the cookies another browser holds: a `Cookie` header, one `name=value` per
 * line, a JSON map, or an exported cookie list. The pane writes them for this page's site and reloads it, so the page
 * comes back signed in. A paste is often the only way in when the site's login cannot complete in this browser (a
 * captcha, a second factor, or an SSO hop). It also works with no page open, where the paste names its own domains and
 * nothing reloads.
 */
function SiteCookies(props: {
  url: string
  disabled: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Writes the paste for the page's site and reloads it; undefined while the pane cannot answer. */
  write: (text: string) => Promise<{ cookies: number; login: CookieLoginState }> | undefined
}) {
  const extension = useExtension()
  const [state, setState] = createStore<{ text: string; writing: boolean; error?: string }>({ text: "", writing: false })
  let input: HTMLTextAreaElement | undefined

  // A blank tab has no site to name; the paste then has to carry its own domains.
  const host = () => addressParts(props.url).host

  // A closed popup forgets its paste: the next opening starts empty rather than offering another site's cookies.
  const close = () => {
    setState({ text: "", error: undefined })
    props.onOpenChange(false)
  }

  const write = () => {
    const text = state.text.trim()

    if (state.writing || !text) return

    setState({ writing: true, error: undefined })
    void (props.write(text) ?? Promise.reject(new Error("browser.pane.unavailable")))
      .then(
        (value) => {
          close()
          // SiCode: the paste toast doubles as the login-state read — the site kept the pasted
          // cookies, a login form is still up, or the page could not say in time.
          showToast({
            title: extension.plural("cookies.written", value.cookies),
            description: extension.t(COOKIE_LOGIN_LABEL[value.login.state]),
          })
        },
        // The pane refused the paste: an unknown pair, a domain that is not this site, or a cookie Chromium rejected.
        (cause: unknown) => setState("error", cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setState("writing", false))
  }

  return (
    <Popover
      open={props.open}
      placement="bottom-end"
      gutter={8}
      modal={false}
      onOpenChange={(open) => (open ? props.onOpenChange(true) : close())}
    >
      <Tooltip placement="top" value={extension.t("cookies.action")}>
        <Popover.Trigger
          as={IconButton}
          type="button"
          variant="ghost-muted"
          size="large"
          disabled={props.disabled}
          aria-label={extension.t("cookies.action")}
          icon={<Icon name="outline-key" />}
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          data-component="browser-cookies"
          onOpenAutoFocus={(event: Event) => {
            // The field takes focus itself, ready for the paste.
            event.preventDefault()
            input?.focus()
          }}
        >
          <div class="flex items-center justify-between gap-2">
            <Popover.Title data-slot="browser-cookies-title">{extension.t("cookies.title")}</Popover.Title>
            <IconButton
              variant="ghost-muted"
              size="small"
              aria-label={extension.t("common.close")}
              icon={<Icon name="outline-xmark" />}
              onClick={close}
            />
          </div>
          <div data-slot="browser-cookies-host" dir="ltr">
            {host() || extension.t("cookies.noPage")}
          </div>
          <textarea
            ref={input}
            dir="ltr"
            rows={5}
            spellcheck={false}
            autocomplete="off"
            data-slot="browser-cookies-input"
            aria-label={extension.t("cookies.title")}
            aria-invalid={state.error ? true : undefined}
            placeholder={extension.t("cookies.placeholder")}
            value={state.text}
            onInput={(event) => setState({ text: event.currentTarget.value, error: undefined })}
            onKeyDown={(event) => {
              // Enter in the field pastes a line; the platform's chord writes the whole paste without reaching for the
              // button, and Escape closes as it does in every other popup here.
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()

                return write()
              }

              if (event.key !== "Escape") return
              event.preventDefault()
              close()
            }}
          ></textarea>
          <Show when={state.error}>{(error) => <p data-slot="browser-cookies-error">{error()}</p>}</Show>
          <p data-slot="browser-cookies-hint">{extension.t(host() ? "cookies.hint" : "cookies.hint.domain")}</p>
          <div class="flex justify-end gap-2">
            <Button size="small" variant="neutral" onClick={close}>
              {extension.t("common.cancel")}
            </Button>
            <Button
              size="small"
              variant="contrast"
              disabled={state.writing || !state.text.trim()}
              onClick={write}
            >
              {extension.t(state.writing ? "cookies.writing" : "cookies.write")}
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}

const connections = {
  secure: { icon: "lock", title: "site.secure", description: undefined },
  insecure: { icon: "outline-hexagonal-warning", title: "site.insecure", description: "site.insecure.description" },
  local: { icon: "monitor", title: "site.local", description: "site.local.description" },
  file: { icon: "folder", title: "site.file", description: "site.file.description" },
} as const

/**
 * What the page can do and what can reach it, under the site button at the address field's start: its connection,
 * its stored data, the permissions it never gets, the agent's access, and the network it loads through.
 */
function SiteInformation(props: {
  url: string
  /** HTTPS whose certificate Chromium rejected and the pane accepted. */
  certificateWarning?: boolean
  server: string | undefined
  /** The page's cookie count; undefined while the pane cannot answer. */
  site: () => Promise<{ cookies: number }> | undefined
  clear: () => Promise<void> | undefined
  /** Agent write access for this attachment; default read (switch off). */
  agentAccess: () => "full" | "read"
  agentLocked: () => { read: boolean; write: boolean }
  setAgentAccess: (access: "full" | "read") => Promise<{ access: "full" | "read"; locked: { read: boolean; write: boolean } }> | undefined
  refreshAgentAccess: () => Promise<{ access: "full" | "read"; locked: { read: boolean; write: boolean } }> | undefined
}) {
  const extension = useExtension()

  // `load` counts openings and clears, so a count for an earlier one never replaces a later one.
  const [state, setState] = createStore<{
    open: boolean
    cookies?: number
    clearing: boolean
    load: number
    write: boolean
    lockedWrite: boolean
    lockedRead: boolean
  }>({
    open: false,
    clearing: false,
    load: 0,
    // Default off = read-only: worst case on first open is the agent can only look.
    write: props.agentAccess() === "full" && !props.agentLocked().read && !props.agentLocked().write,
    lockedWrite: props.agentLocked().write,
    lockedRead: props.agentLocked().read,
  })

  // A config deny outranks this switch: a locked read grants nothing, so the whole browser is
  // unavailable and the switch must read as off rather than claim a grant that is not in effect.
  const syncAccess = () => {
    const locked = props.agentLocked()
    setState({
      write: props.agentAccess() === "full" && !locked.read && !locked.write,
      lockedWrite: locked.write,
      lockedRead: locked.read,
    })
  }

  const kind = () => {
    const value = connection(props.url, { certificateWarning: props.certificateWarning })

    return value ? connections[value] : undefined
  }

  // Only web pages have cookies and ask for permissions; a workspace file has neither.
  const web = () => {
    const value = connection(props.url, { certificateWarning: props.certificateWarning })

    return !!value && value !== "file"
  }

  const load = () => {
    const run = state.load + 1
    setState({ load: run, cookies: undefined })
    void props.site()?.then(
      (value) => {
        if (state.load === run) setState("cookies", value.cookies)
      },
      () => undefined,
    )
  }

  const clear = () => {
    setState("clearing", true)
    void (props.clear() ?? Promise.reject(new Error("browser.pane.unavailable")))
      .catch(() => showToast({ title: extension.t("common.requestFailed") }))
      .finally(() => {
        setState("clearing", false)
        load()
      })
  }

  return (
    <Popover
      open={state.open}
      placement="bottom-start"
      gutter={8}
      modal={false}
      onOpenChange={(open) => {
        setState("open", open)

        if (open) {
          syncAccess()
          void (props.refreshAgentAccess() ?? Promise.resolve()).then(syncAccess, () => undefined)
          load()
        }
      }}
    >
      <Tooltip placement="top" value={extension.t("site.info")}>
        <Popover.Trigger
          as={IconButton}
          type="button"
          variant="ghost-muted"
          size="small"
          aria-label={extension.t("site.info")}
          icon={<Icon name="outline-sliders" />}
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          data-component="browser-site"
          // The panel takes focus itself rather than its close button, so a pointer opening shows no focus ring there.
          onOpenAutoFocus={(event: Event) => {
            event.preventDefault()

            if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus()
          }}
        >
          <div class="flex items-center justify-between gap-2">
            <Popover.Title data-slot="browser-site-host" dir="ltr">
              {addressParts(props.url).host || props.url}
            </Popover.Title>
            {/* A plain button: Kobalte's close button carries the open popover's data-expanded, which icon buttons
                draw as pressed. */}
            <IconButton
              variant="ghost-muted"
              size="small"
              aria-label={extension.t("common.close")}
              icon={<Icon name="outline-xmark" />}
              onClick={() => setState("open", false)}
            />
          </div>
          <Show when={kind()}>
            {(value) => (
              <SiteRow
                icon={value().icon}
                title={extension.t(value().title)}
                detail={value().description ? extension.t(value().description ?? "") : undefined}
              />
            )}
          </Show>
          <Show when={web()}>
            <SiteRow
              icon="outline-cookie"
              title={extension.t("site.cookies")}
              detail={state.cookies === undefined ? undefined : extension.plural("site.cookies.count", state.cookies)}
            >
              <Button
                size="small"
                variant="neutral"
                disabled={state.clearing || state.cookies === undefined}
                onClick={clear}
              >
                {extension.t("site.cookies.clear")}
              </Button>
            </SiteRow>
            <SiteRow
              icon="outline-eye-slash"
              title={extension.t("site.permissions")}
              detail={extension.t("site.permissions.description")}
            />
          </Show>
          <SiteRow
            icon="select-element"
            title={extension.t("site.agent")}
            detail={extension.t(
              state.lockedRead
                ? "site.agent.locked.read"
                : state.lockedWrite
                  ? "site.agent.locked"
                  : "site.agent.description",
            )}
          >
            <Switch
              appearance="compact"
              hideLabel
              aria-label={extension.t("site.agent.write")}
              checked={state.write}
              disabled={state.lockedWrite || state.lockedRead}
              onChange={(checked) => {
                if (state.lockedWrite || state.lockedRead) return
                const access = checked ? "full" : "read"
                setState("write", checked)
                void (props.setAgentAccess(access) ?? Promise.resolve())
                  .then(syncAccess, () => {
                    setState("write", !checked)
                    showToast({ title: extension.t("common.requestFailed") })
                  })
              }}
            >
              {extension.t("site.agent.write")}
            </Switch>
          </SiteRow>
          <Show when={props.server}>
            {(server) => <SiteRow icon="server" title={extension.t("site.network", { server: server() })} />}
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}

function SiteRow(props: { icon: IconName; title: string; detail?: string; children?: JSX.Element }) {
  return (
    <div data-slot="browser-site-row">
      <Icon name={props.icon} class="shrink-0" />
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-v2-text-text-base">{props.title}</span>
        <Show when={props.detail}>{(detail) => <span data-slot="browser-site-detail">{detail()}</span>}</Show>
      </div>
      {props.children}
    </div>
  )
}
