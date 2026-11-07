import { createMemo, Match, on, onCleanup, Show, Switch } from "solid-js"
import { Tabs } from "@opencode/ui/tabs"
import type { ChangeKind } from "../review/contract"
import { createKeyed, useExtension, type MountedSession, type SessionScreen } from "../sdk"
import { current, useShared } from "./context"
import { refreshFileTree } from "./refresh"
import FileTree from "./tree"

/** The file tree beside the side panel: the session's changed files, or every workspace file. */
export default function FileSidebar(props: { session: MountedSession; screen: SessionScreen }) {
  const ctx = useExtension()
  const shared = useShared()
  const file = props.screen.file
  const empty = new Map<string, ChangeKind>()
  const changes = () => current(shared.changes())

  // The host mounts this only while the tree is open, which is when its changes should stay loaded.
  createKeyed(shared.changes, (service) => onCleanup(service.watch(props.screen, "tree")))

  // Lists the root again when the directory, the tree tab or the connection changes, and whenever the root
  // listing is unloaded: the workspace's tree resets to a new root entry. Loading that listing is the same key.
  createKeyed(
    () => {
      const directory = file.root

      if (!props.session.server.connected) return

      return { directory, tab: shared.tree.tab(), root: file.tree.state("") }
    },
    (listing) => {
      const refresh = shared.tree.directory !== listing.directory

      shared.tree.directory = listing.directory
      void file.tree.sync("", refresh ? { force: true } : undefined)
    },
    {
      equals: (previous, next) =>
        previous.directory === next.directory && previous.tab === next.tab && previous.root === next.root,
    },
  )

  // Without the review extension only the workspace files can show.
  const tab = createMemo(() => (changes() ? shared.tree.tab() : "all"))
  const count = createMemo(() => changes()?.diffs(props.session).length ?? 0)
  const ready = createMemo(() => changes()?.ready(props.session) ?? false)
  const diffFiles = createMemo(() => (changes()?.diffs(props.session) ?? []).map((diff) => diff.file))
  const kinds = createMemo(() => changes()?.kinds(props.session) ?? empty)

  // SiCode: a directory keeps the rows it listed once, and the server watches only the git head, so a file the
  // session deleted stays in them. List the loaded directories again when the tree shows and after each turn: the
  // cached expansion and the scroll offset stay, so the rows only move where the workspace changed. Open file
  // tabs reload content too (FileMutation publishes realtime events; this is the idle/mount backstop).
  const openTabs = () => ctx.layout.stored(props.session)

  createKeyed(
    () => props.session.server.connected && tab() === "all",
    () => void refreshFileTree(file, openTabs()),
  )

  const finished = createMemo(
    on(
      () => props.session.server.data.session.status(props.session.id),
      (next, previous) => (next === "idle" && previous !== undefined && previous !== "idle" ? {} : undefined),
      { defer: true },
    ),
  )

  createKeyed(
    () => props.session.server.connected && tab() === "all" && finished(),
    () => void refreshFileTree(file, openTabs()),
  )

  const nofiles = createMemo(() => {
    const state = file.tree.state("")

    if (!state?.loaded) return false

    return file.tree.list("").length === 0
  })

  const emptyState = (message: string) => (
    <div class="h-full flex flex-col">
      <div class="h-6 shrink-0" aria-hidden />
      <div class="flex-1 pb-64 flex items-center justify-center text-center">
        <div class="text-12-regular text-text-weak">{message}</div>
      </div>
    </div>
  )

  return (
    <Tabs
      variant="surface"
      value={tab()}
      onChange={(value) => {
        if (value !== "changes" && value !== "all") return
        shared.tree.setTab(value)
      }}
      class="h-full"
      data-scope="filetree"
    >
      <Tabs.List>
        <Show when={changes()}>
          <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
            {ctx.plural("tree.changes", count())}
          </Tabs.Trigger>
        </Show>
        <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
          {ctx.t("tree.all")}
        </Tabs.Trigger>
      </Tabs.List>
      <Show when={tab() === "changes"}>
        <Tabs.Content value="changes" class="bg-background-stronger px-3 py-0">
          <Switch>
            <Match when={count() > 0 || !ready()}>
              <Show
                when={ready()}
                fallback={
                  <div class="px-2 py-2 text-12-regular text-text-weak">
                    {ctx.t("common.loading")}
                    {ctx.t("common.loading.ellipsis")}
                  </div>
                }
              >
                <FileTree
                  session={props.session}
                  screen={props.screen}
                  path=""
                  class="pt-3"
                  allowed={diffFiles()}
                  kinds={kinds()}
                  draggable={false}
                  active={changes()?.active(props.session)}
                  onFileClick={(node) => {
                    const live = shared.changes()

                    // Review shows the change; while it is pending or off, the file opens instead.
                    if (live.status === "active") return live.value.focus(props.session, node.path)

                    shared.open(props.session, node.path)
                  }}
                />
              </Show>
            </Match>
          </Switch>
        </Tabs.Content>
      </Show>
      <Show when={tab() === "all"}>
        <Tabs.Content value="all" class="bg-background-stronger px-3 py-0">
          <Switch>
            <Match when={nofiles()}>{emptyState(ctx.t("tree.empty"))}</Match>
            <Match when={true}>
              <FileTree
                session={props.session}
                screen={props.screen}
                path=""
                class="pt-3"
                modified={diffFiles()}
                kinds={kinds()}
                onFileClick={(node) => shared.open(props.session, node.path)}
              />
            </Match>
          </Switch>
        </Tabs.Content>
      </Show>
    </Tabs>
  )
}
