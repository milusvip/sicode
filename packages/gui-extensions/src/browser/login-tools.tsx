import { Popover } from "@kobalte/core/popover"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { showToast } from "@opencode/ui/toast"
import { Tooltip } from "@opencode/ui/tooltip"
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useExtension, type IpcClient } from "../sdk"
import { addressParts } from "./address"
import { ChromeBridge } from "./chrome-bridge"
import type { CookieLoginState } from "./connection"
import type { Model } from "./model"

// SiCode: one entry, beside the page tools, for bringing the browser the user already signed into in here.
// Two ways in, in the order they usually work: connect the system Chromium, whose extension pushes the real
// login state, or paste cookies when it cannot be installed. Configuration (port, token, blocked domains)
// stays in Settings → Browser; this popover only answers "is it connected?", offers the one-click install,
// and keeps the paste as the fallback.

type Client = IpcClient<typeof ChromeBridge.spec>

type Status = Awaited<ReturnType<Client["status"]>>

type Phase = "loading" | "off" | "waiting" | "connected" | "portBusy"

const DOT: Record<Phase, string> = {
  loading: "#8b8b8b",
  off: "#8b8b8b",
  waiting: "#e6a700",
  connected: "#2dba26",
  portBusy: "#e24b4a",
}

const LABEL: Record<Phase, string> = {
  loading: "login.status.loading",
  off: "login.status.off",
  waiting: "login.status.waiting",
  connected: "login.status.connected",
  portBusy: "login.status.portBusy",
}

// SiCode: one label per login-state read, shown as the paste toast's description.
const COOKIE_LOGIN_LABEL: Record<CookieLoginState["state"], string> = {
  likely: "cookies.login.likely",
  unclear: "cookies.login.unclear",
  unlikely: "cookies.login.unlikely",
}

export function LoginTools(props: {
  model: Model
  /** The page's URL, empty on a blank tab; it tells the paste which site it is written for. */
  url: string
  /** The page a paste is written for; undefined while no tab is open, which hides the paste. */
  page: string | undefined
  disabled: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Writes the paste for the page's site and reloads it; undefined while the pane cannot answer. */
  write: (text: string) => Promise<{ cookies: number; storage: number; login: CookieLoginState }> | undefined
}) {
  const extension = useExtension()
  const [status, setStatus] = createSignal<Status>()
  const [busy, setBusy] = createSignal(false)
  const [note, setNote] = createSignal<string>()

  let timer: ReturnType<typeof setInterval> | undefined

  // Undefined while the desktop has no bridge to answer, as on the web: the paste alone then signs the page in.
  const client = () => {
    const live = props.model.chromeBridge()

    return live.status === "active" ? live.value : undefined
  }

  const refresh = () => {
    void client()
      ?.status({})
      .then((value) => setStatus(value), () => undefined)
  }

  onMount(() => {
    refresh()
    timer = setInterval(refresh, 5_000)
  })
  onCleanup(() => {
    if (timer) clearInterval(timer)
  })

  const phase = createMemo((): Phase => {
    const value = status()

    if (!value) return "loading"

    if (value.connected) return "connected"

    if (value.listenError?.startsWith("port_in_use:")) return "portBusy"

    if (value.enabled) return "waiting"

    return "off"
  })

  const install = async () => {
    const current = client()

    if (!current || busy()) return
    setBusy(true)
    setNote(undefined)

    try {
      // Install works while the host is off: enabling first means the extension connects on hello.
      await current.setEnabled(true)
      const result = await current.openInstall({})
      setNote(result.message)
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      refresh()
    }
  }

  return (
    <Popover
      open={props.open}
      placement="bottom-end"
      gutter={8}
      modal={false}
      onOpenChange={(open) => {
        props.onOpenChange(open)

        if (open) refresh()
      }}
    >
      <Tooltip placement="top" value={extension.t("login.action")}>
        <Popover.Trigger
          as={IconButton}
          type="button"
          variant="ghost-muted"
          size="large"
          disabled={props.disabled}
          aria-label={extension.t("login.action")}
          onClick={() => refresh()}
          icon={
            <span class="relative inline-flex">
              <Icon name="outline-square-arrow" />
              {/* The dot follows the bridge, so its state shows without opening this. */}
              <Show when={client()}>
                <span class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full" style={{ background: DOT[phase()] }} />
              </Show>
            </span>
          }
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          data-component="browser-login"
          aria-label={extension.t("login.action")}
          // The panel takes focus itself: with a bridge the field below is not where the user starts, and the
          // pointer should not land a caret in a paste they have not begun.
          onOpenAutoFocus={(event: Event) => {
            event.preventDefault()

            if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus()
          }}
        >
          <Show when={client()}>
            <div data-slot="browser-login-status">
              <span data-slot="browser-login-dot" style={{ background: DOT[phase()] }} />
              {extension.t(LABEL[phase()])}
              <Show when={phase() === "connected" && status()?.packageVersion}>
                <span data-slot="browser-login-version">v{status()?.packageVersion}</span>
              </Show>
            </div>
            <Show when={note()}>{(value) => <div data-slot="browser-login-note">{value()}</div>}</Show>
            <Button size="small" variant="outline" disabled={busy()} onClick={() => void install()}>
              {extension.t(busy() ? "login.installing" : phase() === "connected" ? "login.update" : "login.install")}
            </Button>
          </Show>
          {/* A paste belongs to one page's site: another tab or URL closes it in the panel, and the key remounts
              the field, so it never carries one site's cookies over to another. */}
          <Show when={props.page} keyed>
            <div data-slot="browser-login-divider" />
            <PasteCookies
              url={props.url}
              // Connecting is the first way in; without a bridge the paste is the only one, so it takes focus.
              focus={!client()}
              write={props.write}
              onClose={() => props.onOpenChange(false)}
            />
          </Show>
          <Show when={!client() && !props.page}>
            <div data-slot="browser-login-note">{extension.t("login.unavailable")}</div>
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}

/**
 * Signs the pane into a site by pasting the cookies another browser holds: a `Cookie` header, one `name=value` per
 * line, a JSON map, or an exported cookie list. The pane writes them for this page's site and reloads it, so the page
 * comes back signed in. A paste is often the only way in when the site's login cannot complete in this browser (a
 * captcha, a second factor, or an SSO hop) and the extension cannot be installed.
 */
function PasteCookies(props: {
  url: string
  /** Whether the field takes focus when it opens. */
  focus: boolean
  write: (text: string) => Promise<{ cookies: number; storage: number; login: CookieLoginState }> | undefined
  onClose: () => void
}) {
  const extension = useExtension()
  const [state, setState] = createStore<{ text: string; writing: boolean; error?: string }>({ text: "", writing: false })

  let input: HTMLTextAreaElement | undefined

  // A blank tab has no site to name; the paste then has to carry its own domains.
  const host = () => addressParts(props.url).host

  onMount(() => {
    if (props.focus) input?.focus()
  })

  // A closed popup forgets its paste: the next opening starts empty rather than offering another site's cookies.
  const close = () => {
    setState({ text: "", error: undefined })
    props.onClose()
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
            title:
              value.cookies || !value.storage
                ? extension.plural("cookies.written", value.cookies)
                : extension.plural("cookies.stored", value.storage),
            description: extension.t(COOKIE_LOGIN_LABEL[value.login.state]),
          })
        },
        // The pane refused the paste: an unknown pair, a domain that is not this site, or a cookie Chromium rejected.
        (cause: unknown) => setState("error", cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setState("writing", false))
  }

  return (
    <>
      <div class="flex items-center justify-between gap-2">
        <div data-slot="browser-cookies-title">{extension.t("cookies.title")}</div>
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
        <Button size="small" variant="contrast" disabled={state.writing || !state.text.trim()} onClick={write}>
          {extension.t(state.writing ? "cookies.writing" : "cookies.write")}
        </Button>
      </div>
    </>
  )
}
