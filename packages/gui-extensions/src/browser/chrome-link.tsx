import { Popover } from "@kobalte/core/popover"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import type { IpcClient, Live } from "../sdk"
import { ChromeBridge } from "./chrome-bridge"
import type { Model } from "./model"

// SiCode: discoverability entry for the system-Chrome bridge, in the pane's toolbar. The full
// configuration (port, token, blocked domains) stays in Settings → Browser; this popover only
// answers "is it connected?" and offers the one-click install: materialize the packed .crx,
// launch the detected Chromium, and let it show the native「添加扩展程序？」dialog.
// Demo note: labels are hardcoded zh-CN; i18n keys land with the settings-page commit.

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
  loading: "正在获取状态…",
  off: "未连接",
  waiting: "等待扩展连接…（装好后自动连上）",
  connected: "已连接你的浏览器",
  portBusy: "端口被占用（可能开着另一个 SiCode）",
}

export function ChromeLink(props: { model: Model; disabled?: boolean }) {
  const [open, setOpen] = createSignal(false)
  const [status, setStatus] = createSignal<Status>()
  const [busy, setBusy] = createSignal(false)
  const [note, setNote] = createSignal<string>()

  let timer: ReturnType<typeof setInterval> | undefined

  const client = () => {
    const live = props.model.chromeBridge() as Live<Client> | undefined
    return live?.status === "active" ? live.value : undefined
  }

  const refresh = () => {
    const current = client()
    if (!current) return
    void current.status({}).then((value) => setStatus(value), () => undefined)
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
      open={open()}
      placement="bottom-end"
      gutter={8}
      modal={false}
      onOpenChange={(value) => {
        setOpen(value)
        if (value) refresh()
      }}
    >
      <Tooltip placement="top" value="你的浏览器">
        <Popover.Trigger
          as={IconButton}
          type="button"
          variant="ghost-muted"
          size="large"
          disabled={props.disabled}
          aria-label="你的浏览器"
          onClick={() => refresh()}
          icon={
            <span class="relative inline-flex">
              <Icon name="outline-square-arrow" />
              <span
                class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full"
                style={{ background: DOT[phase()] }}
              />
            </span>
          }
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Content data-component="browser-chrome-link">
          <div data-slot="chrome-link-status">
            <span data-slot="chrome-link-dot" style={{ background: DOT[phase()] }} />
            {LABEL[phase()]}
            <Show when={phase() === "connected" && status()?.packageVersion}>
              <span data-slot="chrome-link-version">v{status()?.packageVersion}</span>
            </Show>
          </div>
          <Show when={note()}>
            <div data-slot="chrome-link-note">{note()}</div>
          </Show>
          <Button size="small" variant="outline" disabled={busy()} onClick={() => void install()}>
            {busy() ? "正在打开浏览器…" : phase() === "connected" ? "更新扩展" : "连接我平时的浏览器"}
          </Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}
