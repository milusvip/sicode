import { DataProvider } from "@opencode/session-ui/context"
import { MarkdownProvider, type ReadMarkdownImage } from "@opencode/session-ui/context/markdown"
import { useNavigate, useParams } from "@solidjs/router"
import { createMediaQuery } from "@solid-primitives/media"
import { createMemo, type ParentProps } from "solid-js"
import { useProviders } from "@/providers/catalog/providers"
import { LocalProvider } from "@/providers/models/selection"
import { useExtensionAttachment } from "@/runtime/extension/attachment"
import { useExtensionHost } from "@/runtime/extension/host"
import type { ServerConnection } from "@/runtime/server/registry"
import { sessionHref } from "@/shell/routes/session"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useTabs, type Tab } from "@/shell/tabs/tabs"
import { readLocalImage } from "@/runtime/server/image"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import { createTurnDiffCache } from "@/session/timeline/turn-diffs"

export function SessionUIProvider(
  props: ParentProps<{
    directory: string
    server: ServerConnection.Key
  }>,
) {
  const navigate = useNavigate()
  const params = useParams()
  const data = useData()
  const serverSDK = useServerSDK()
  const tabs = useTabs()
  const language = useLanguage()
  const host = useExtensionHost()
  const extensions = useExtensionAttachment()
  const directory = () => props.directory
  // The side region is a desktop surface: on narrow screens its drawer belongs to the owning panel.
  const sideRegion = createMediaQuery("(min-width: 768px)")

  const readImage = createMemo<ReadMarkdownImage>(() => {
    const dir = directory()

    return (path, signal) => readLocalImage(serverSDK.api, dir, path, signal)
  })

  const href = (sessionID: string) => sessionHref(props.server, sessionID)

  const navigateToSession = async (sessionID: string) => {
    const tab = tabs.store.find(
      (item) =>
        item.type === "session" &&
        item.server === props.server &&
        (item.sessionId === params.id || item.routeSessionId === params.id),
    )

    if (tab?.type === "session") tabs.rememberSessionRoute(tab, sessionID, params.id)
    await data.session.sync(sessionID).catch(() => undefined)
    navigate(href(sessionID))
  }

  const openReferencedSession = async (sessionID: string) => {
    // The transcript may mention a session from another server (or one that was deleted).
    // Resolve it on this server before touching tabs or the current route.
    const session = await serverSDK.api.session.get({ sessionID }).catch(() => undefined)

    if (!session || session.time.archived) {
      showToast({ title: language.t("session.error.notFound") })

      return
    }

    data.session.remember(session)
    tabs.select(tabs.addSessionTab({ server: props.server, sessionId: session.id }))
  }

  const providers = useProviders(directory)

  // Turn diffs live in the tab's in-memory state, so they outlast timeline remounts and go when the tab closes.
  const turnDiffs = () => {
    const id = params.id

    if (!id) return

    const tab =
      tabs.store.find(
        (item) =>
          item.type === "session" &&
          item.server === props.server &&
          (item.sessionId === id || item.routeSessionId === id),
      ) ?? ({ type: "session", server: props.server, sessionId: id } satisfies Tab)

    return tabs.state(tab, "turnDiffs", createTurnDiffCache)
  }

  const sessionUIData = createMemo(() => ({
    provider: providers.ready()
      ? { all: providers.all(), default: providers.default(), connected: providers.connected().map((item) => item.id) }
      : undefined,
    session: data.session.list(),
    session_status: Object.fromEntries(
      data.session
        .list()
        .map((session) => [
          session.id,
          data.session.status(session.id) === "running" ? ({ type: "busy" } as const) : ({ type: "idle" } as const),
        ]),
    ),
    session_diff: {},
  }))

  return (
    <DataProvider
      data={sessionUIData()}
      directory={directory()}
      sessionID={params.id}
      shellRunning={(id) => !!data.shell.get(id)}
      shellOutput={(input) => serverSDK.api.shell.output(input)}
      // SiCode: per-shell stop for the transcript rows; the endpoint kills the process and the
      // shell.exited event removes it from the running inventory.
      shellKill={(input) => serverSDK.api.shell.remove(input).then(() => undefined)}
      // SiCode: rows for a running subagent stop it through the child session's interrupt.
      sessionInterrupt={(sessionID) => serverSDK.api.session.interrupt({ sessionID }).then(() => undefined)}
      turnDiff={{
        get: (input) => turnDiffs()?.get(input),
        load: (input) => turnDiffs()?.load(input, () => serverSDK.api.session.diff(input)),
      }}
      onNavigateToSession={navigateToSession}
      onSessionHref={href}
      // Routed through the file extension's link handler, so the host never names a panel key itself.
      onOpenFile={
        sideRegion()
          ? (path) => {
              const session = extensions.current()

              if (!session) return

              void host.links.open({ href: path, session, exact: true })
            }
          : undefined
      }
    >
      <MarkdownProvider readImage={readImage()} openSession={openReferencedSession}>
        <LocalProvider>{props.children}</LocalProvider>
      </MarkdownProvider>
    </DataProvider>
  )
}
