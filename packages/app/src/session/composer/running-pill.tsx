import { Popover } from "@kobalte/core/popover"
import type { BackgroundTask } from "@opencode/gui-extensions/sdk"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import { followShellOutput } from "@opencode/session-ui/tools/shell-output"
import { Badge } from "@opencode/ui/badge"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { type JSX, createEffect, createMemo, createSignal, createUniqueId, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useServer } from "@/runtime/server/current"
import { useOpenSessionRoute } from "@/session/session-identity-header"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import { useWorkspaceLocation } from "@/workspaces/location"
import "./todo-pill.css"

const neutral = "light-dark(var(--v2-text-text-base), #ffffff)"

type RunningItem = {
  key: string
  type: "subagent" | "shell"
  label?: string
  agent?: string
  sessionID?: string
  target: string
}

type BlockingTask = { type: "shell" | "subagent"; partID: string; id?: string; label?: string }

/** Same compact clock as the work-shell head — hide sub-second noise. */
function formatElapsed(ms: number): string | undefined {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 1) return undefined
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    const rest = seconds % 60
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rest = minutes % 60
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
  }
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`
}

/**
 * SiCode: background shells share one capsule; click opens a compact popup (list + output).
 * Subagents stay as separate capsules. Trailing lane content (todo) sits in the same pill row.
 */
export function SessionRunningPill(props: {
  sessionID?: string
  owner?: string
  blocking: readonly BlockingTask[]
  tasks: readonly BackgroundTask[]
  onReveal?: (target: string) => void
  trailing?: JSX.Element
}) {
  const language = useLanguage()
  const openRoute = useOpenSessionRoute()
  const server = useServer()
  const sdk = useServerSDK()
  const [now, setNow] = createSignal(Date.now())
  const [tray, setTray] = createStore({ open: false, selected: undefined as string | undefined })

  const sessionAgent = (sessionID: string | undefined) =>
    sessionID ? server.ctx.data.session.get(sessionID)?.agent : undefined

  const items = createMemo<RunningItem[]>(() => [
    ...props.blocking.flatMap((task) =>
      task.type === "subagent"
        ? [
            {
              ...task,
              key: task.id ?? task.partID,
              agent: sessionAgent(task.id),
              sessionID: task.id,
              target: task.partID,
            },
          ]
        : [],
    ),
    ...props.tasks.flatMap((task) =>
      task.type === "subagent"
        ? [{ ...task, key: task.id, agent: task.agent ?? sessionAgent(task.id), sessionID: task.id, target: task.id }]
        : [],
    ),
    ...props.tasks.flatMap((task) => (task.type === "shell" ? [{ ...task, key: task.id, target: task.id }] : [])),
  ])

  const visible = createMemo(() => {
    const list = items()
    if (list.length === 1 && list[0].sessionID && list[0].sessionID === props.sessionID) return []
    return list
  })

  const shells = createMemo(() => visible().filter((item) => item.type === "shell"))
  const subagents = createMemo(() => visible().filter((item) => item.type === "subagent"))

  const selected = createMemo(() => {
    const list = shells()
    if (list.length === 0) return
    const id = tray.selected
    return list.find((item) => item.key === id) ?? list[0]
  })

  createEffect(() => {
    if (visible().length === 0) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => window.clearInterval(timer))
  })

  createEffect(() => {
    const list = shells()
    if (list.length === 0) {
      setTray({ open: false, selected: undefined })
      return
    }
    if (tray.selected && list.some((item) => item.key === tray.selected)) return
    setTray("selected", list[0].key)
  })

  const startedAt = (item: RunningItem) => {
    if (item.type === "shell") {
      const byId = server.ctx.data.shell.get(item.target)?.time.started
      if (byId !== undefined) return byId
      const match = server.ctx.data.shell
        .list()
        .find((shell) => shell.status === "running" && shell.command === item.label)
      return match?.time.started
    }
    if (!item.sessionID) return
    return server.ctx.data.session.get(item.sessionID)?.time.created
  }

  const elapsedFor = (item: RunningItem) => {
    const start = startedAt(item)
    if (start === undefined) return
    return formatElapsed(now() - start)
  }

  const viewing = (item: RunningItem) => !!item.sessionID && item.sessionID === props.sessionID

  const openSubagent = (item: RunningItem) => {
    const current = props.sessionID

    if (!current || viewing(item)) return

    if (item.sessionID) return openRoute(current, item.sessionID)

    if (props.owner && props.owner !== current) return openRoute(current, props.owner, item.target)

    if (props.onReveal) return props.onReveal(item.target)

    openRoute(current, current, item.target)
  }

  const stop = (item: RunningItem) => {
    const request = item.sessionID
      ? sdk.api.session.interrupt({ sessionID: item.sessionID })
      : sdk.api.shell.remove({
          id: item.target,
          location: { directory: server.ctx.data.shell.get(item.target)?.location.directory },
        })

    void request.catch((error) =>
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(error, language.t("common.requestFailed")),
      }),
    )
  }

  const titleFor = (item: RunningItem) => {
    if (item.type === "shell") return language.t("ui.tool.shell")
    if (item.agent) return `${item.agent[0].toUpperCase()}${item.agent.slice(1)}`
    return language.t("ui.tool.agent.default")
  }

  const shellSummary = createMemo(() => {
    const list = shells()
    const head = list[0]
    if (!head) return
    return {
      count: list.length,
      label: head.label,
      clock: elapsedFor(head),
    }
  })

  return (
    <div data-slot="composer-lane-pills" class="pointer-events-auto flex min-w-0 flex-wrap justify-end gap-2">
      <Show when={shellSummary()}>
        {(summary) => (
          <Popover
            open={tray.open}
            onOpenChange={(open) => setTray("open", open)}
            placement="top-end"
            gutter={8}
          >
            <Popover.Trigger
              as="button"
              type="button"
              data-slot="session-running-pill"
              data-composer-pill
              data-kind="shell"
              data-expanded={tray.open ? "" : undefined}
              aria-expanded={tray.open}
              aria-label={language.plural("session.running.shell.jobs", summary().count)}
            >
              <Icon name="console" class="size-3.5 shrink-0 text-v2-icon-icon-muted" />
              <span class="flex min-w-0 items-center gap-1.5">
                <TextShimmer text={language.t("ui.tool.shell")} active={!tray.open} />
                <Show when={summary().count === 1} fallback={<Badge class="shrink-0">{summary().count}</Badge>}>
                  <Show when={summary().label}>
                    {(label) => (
                      <span dir="auto" class="min-w-0 max-w-[160px] truncate text-v2-text-text-muted">
                        {label()}
                      </span>
                    )}
                  </Show>
                </Show>
                <Show when={summary().clock}>
                  {(clock) => (
                    <span data-slot="session-running-elapsed" class="shrink-0 tabular-nums text-v2-text-text-muted">
                      {clock()}
                    </span>
                  )}
                </Show>
              </span>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                data-slot="session-shell-popup"
                data-composer-pill-panel
                aria-label={language.plural("session.running.shell.jobs", shells().length)}
              >
                <ShellJobsPopup
                  shells={shells()}
                  selected={selected()}
                  elapsedFor={elapsedFor}
                  onSelect={(key) => setTray("selected", key)}
                  onStop={stop}
                  onStopAll={() => {
                    for (const item of shells()) stop(item)
                    setTray("open", false)
                  }}
                />
              </Popover.Content>
            </Popover.Portal>
          </Popover>
        )}
      </Show>
      <For each={subagents()}>
        {(item) => (
          <SubagentRunningPill
            item={item}
            title={titleFor(item)}
            clock={elapsedFor(item)}
            viewing={viewing(item)}
            onOpen={() => openSubagent(item)}
            onStop={() => stop(item)}
          />
        )}
      </For>
      {props.trailing}
    </div>
  )
}

function ShellJobsPopup(props: {
  shells: RunningItem[]
  selected: RunningItem | undefined
  elapsedFor: (item: RunningItem) => string | undefined
  onSelect: (key: string) => void
  onStop: (item: RunningItem) => void
  onStopAll: () => void
}) {
  const language = useLanguage()
  const multi = () => props.shells.length > 1
  const title = () =>
    multi()
      ? language.plural("session.running.shell.jobs", props.shells.length)
      : (props.selected?.label ?? language.plural("session.running.shell.jobs", props.shells.length))

  return (
    <div data-slot="session-shell-popup-body" class="flex min-w-0 flex-col">
      <div data-slot="session-shell-popup-head" class="flex min-w-0 items-center gap-2 px-2.5 py-2">
        <span
          dir={multi() ? undefined : "ltr"}
          class="min-w-0 flex-1 truncate text-[13px] font-medium leading-[var(--line-height-compact)] text-v2-text-text-base"
          classList={{ "font-mono text-[12px] font-normal": !multi() }}
        >
          {title()}
        </span>
        <Show when={!multi() && props.selected}>
          {(item) => (
            <Show when={props.elapsedFor(item())}>
              {(clock) => (
                <span
                  data-slot="session-running-elapsed"
                  class="shrink-0 tabular-nums text-[12px] text-v2-text-text-faint"
                >
                  {clock()}
                </span>
              )}
            </Show>
          )}
        </Show>
        <Show
          when={multi()}
          fallback={
            <IconButton
              type="button"
              size="small"
              variant="ghost-muted"
              data-slot="session-shell-stop"
              class="shrink-0"
              icon={<Icon name="outline-xmark" />}
              aria-label={language.t("session.running.stop.shell")}
              onClick={() => props.selected && props.onStop(props.selected)}
            />
          }
        >
          <button
            type="button"
            data-slot="session-shell-stop-all"
            aria-label={language.t("session.running.stop.shell.all")}
            onClick={() => props.onStopAll()}
          >
            <span>{language.t("session.running.stop.shell.all")}</span>
            <Icon name="outline-xmark" size="small" />
          </button>
        </Show>
      </div>
      <Show when={multi()}>
        <div
          data-slot="session-shell-popup-list"
          data-scrollable
          class="flex max-h-[120px] flex-col gap-0.5 overflow-y-auto p-1"
        >
          <For each={props.shells}>
            {(item) => {
              const active = () => props.selected?.key === item.key
              return (
                <div
                  data-slot="session-shell-popup-row"
                  data-active={active() ? "" : undefined}
                  class="group/shell-row flex min-w-0 items-center gap-1"
                >
                  <button
                    type="button"
                    data-slot="session-shell-popup-select"
                    class="flex min-w-0 flex-1 items-center gap-2 text-start"
                    aria-current={active() ? "true" : undefined}
                    onClick={() => props.onSelect(item.key)}
                  >
                    <span
                      dir="ltr"
                      data-slot="session-shell-popup-command"
                      class="min-w-0 flex-1 truncate font-mono text-[12px] leading-[var(--line-height-compact)]"
                    >
                      {item.label}
                    </span>
                    <Show when={props.elapsedFor(item)}>
                      {(clock) => (
                        <span
                          data-slot="session-running-elapsed"
                          class="shrink-0 tabular-nums text-[12px] text-v2-text-text-faint"
                        >
                          {clock()}
                        </span>
                      )}
                    </Show>
                  </button>
                  <IconButton
                    type="button"
                    size="small"
                    variant="ghost-muted"
                    data-slot="session-shell-stop"
                    class="shrink-0"
                    icon={<Icon name="outline-xmark" />}
                    aria-label={language.t("session.running.stop.shell")}
                    onClick={() => props.onStop(item)}
                  />
                </div>
              )
            }}
          </For>
        </div>
      </Show>
      <Show when={props.selected}>{(item) => <ShellOutputStrip item={item()} />}</Show>
    </div>
  )
}

function ShellOutputStrip(props: { item: RunningItem }) {
  const language = useLanguage()
  const server = useServer()
  const sdk = useServerSDK()
  const location = useWorkspaceLocation()
  const [output, setOutput] = createSignal("")
  let scroller: HTMLPreElement | undefined

  const directory = () =>
    server.ctx.data.shell.get(props.item.target)?.location.directory ?? location().directory

  createEffect(() => {
    const id = props.item.target
    const dir = directory()
    if (!dir) return

    const running = server.ctx.data.shell.get(id)?.status === "running"
    onCleanup(
      followShellOutput({
        id,
        directory: dir,
        running: running !== false,
        load: (input) => sdk.api.shell.output(input),
        onOutput: setOutput,
      }),
    )
  })

  createEffect(() => {
    output()
    const el = scroller
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  })

  return (
    <pre
      ref={scroller}
      data-slot="session-shell-popup-output"
      data-scrollable
      dir="ltr"
      aria-label={language.t("session.running.shell.panel")}
      class="m-0 overflow-auto whitespace-pre-wrap break-all font-mono text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-muted"
    >
      <Show when={output()} fallback={language.t("session.running.shell.empty")}>
        {output()}
      </Show>
    </pre>
  )
}

function SubagentRunningPill(props: {
  item: RunningItem
  title: string
  clock?: string
  viewing: boolean
  onOpen: () => void
  onStop: () => void
}) {
  const language = useLanguage()
  const id = createUniqueId()
  const [menu, setMenu] = createStore({ open: false })
  const aria = () => [props.title, props.item.label, props.clock].filter(Boolean).join(" · ")

  return (
    <Menu gutter={8} placement="top-end" open={menu.open} onOpenChange={(open) => setMenu("open", open)}>
      <Menu.Trigger
        as="button"
        type="button"
        id={id}
        data-slot="session-running-pill"
        data-composer-pill
        data-kind="subagent"
        aria-label={aria()}
        aria-current={props.viewing ? "page" : undefined}
      >
        <SessionProgressIndicatorV2
          class="size-3.5 shrink-0"
          style={{
            color: props.item.agent
              ? `var(--v2-agent-${props.item.agent.toLowerCase()}-solid, ${neutral})`
              : neutral,
          }}
        />
        <span class="flex min-w-0 items-center gap-1.5">
          <TextShimmer text={props.title} active={!props.viewing} />
          <Show when={props.item.label}>
            {(label) => (
              <span dir="auto" class="min-w-0 max-w-[160px] truncate text-v2-text-text-muted">
                {label()}
              </span>
            )}
          </Show>
          <Show when={props.clock}>
            {(clock) => (
              <span data-slot="session-running-elapsed" class="shrink-0 tabular-nums text-v2-text-text-muted">
                {clock()}
              </span>
            )}
          </Show>
        </span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content class="w-60" aria-label={aria()}>
          <Menu.Item
            class="group/running-item"
            classList={{ "!bg-v2-overlay-simple-overlay-hover": props.viewing }}
            aria-current={props.viewing ? "page" : undefined}
            onSelect={() => {
              setMenu("open", false)
              props.onOpen()
            }}
            onKeyDown={(event) => {
              if (event.key !== "Delete" && event.key !== "Backspace") return

              event.preventDefault()
              props.onStop()
            }}
          >
            <SessionProgressIndicatorV2
              class="shrink-0"
              style={{
                color: props.item.agent
                  ? `var(--v2-agent-${props.item.agent.toLowerCase()}-solid, ${neutral})`
                  : neutral,
              }}
            />
            <span class="shrink-0 font-[530]">{props.title}</span>
            <span
              dir="auto"
              class="me-1.5 min-w-0 flex-1 truncate text-v2-text-text-muted group-hover/running-item:me-0 group-data-[highlighted]/running-item:me-0 [@media(hover:none)]:me-0"
            >
              {props.item.label}
            </span>
            <Show when={props.clock}>
              {(clock) => (
                <span
                  data-slot="session-running-elapsed"
                  class="shrink-0 pe-1 tabular-nums text-v2-text-text-faint group-hover/running-item:hidden group-data-[highlighted]/running-item:hidden [@media(hover:none)]:hidden"
                >
                  {clock()}
                </span>
              )}
            </Show>
            <span class="hidden shrink-0 group-hover/running-item:flex group-data-[highlighted]/running-item:flex [@media(hover:none)]:flex">
              <IconButton
                type="button"
                size="small"
                variant="ghost-muted"
                tabIndex={-1}
                icon={<Icon name="outline-xmark" />}
                aria-label={language.t("session.running.stop.subagent")}
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onPointerUp={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  props.onStop()
                }}
              />
            </span>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}
