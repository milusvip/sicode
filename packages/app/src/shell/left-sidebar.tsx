import { For, Show, createEffect, createMemo, createResource, createSignal, on, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import type { SessionInfo } from "@opencode/client/promise"
import { displayName } from "@opencode/ui/project-avatar"
import { getFilename } from "@opencode/util/path"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Button } from "@opencode/ui/button"
import { TextField } from "@opencode/ui/text-field"
import { DockToolbar } from "@/shell/dock-toolbar"
import { MarqueeText } from "@/shell/marquee-text"
import { ProjectIcon } from "@/shell/layout/project-icon"
import { closeHomeProject, errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import { useSettingsSurface } from "@/settings/surface"
import { useLayout, type HomeProjectSelection, type LocalProject } from "@/shell/state/layout"
import { useRevealProject } from "@/home/projects/reveal"
import { useTabs } from "@/shell/tabs/tabs"
import { findSessionTab } from "@/shell/tabs/tabs"
import { notifySessionTabsRemoved } from "@/shell/titlebar/session-events"
import { getRelativeTime } from "@/shell/time"
import { sessionTreeIDs } from "@/session/requests/session-request-tree"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { pathKey } from "@/workspaces/path-key"

type MenuItem =
  | { label: string; icon?: string; shortcut?: string; danger?: boolean; onSelect: () => void }
  | "separator"

/** Everything a project row needs, so the menu handlers keep the connection instead of re-finding it. */
type ProjectGroup = {
  key: ServerConnection.Key
  conn: ServerConnection.Any
  directory: string
  project: LocalProject
}

/**
 * SiCode: the left column from the approved demo — projects, each with its sessions, the toolbar
 * dock at the bottom, and right-click menus per row. Sessions come from the server's synced list
 * and are grouped by the project whose directory they live in; archiving is real (session.update
 * carries `archived`) and archived rows are kept under a collapsible section so they can come back.
 */
export function LeftSidebar() {
  const global = useGlobal()
  const layout = useLayout()
  const language = useLanguage()
  const tabs = useTabs()
  const dialog = useDialog()
  const platform = usePlatform()
  const projectReveal = useRevealProject()
  const settingsSurface = useSettingsSurface()

  const [openState, setOpenState] = createSignal<Record<string, boolean>>({})
  const [archivedOpen, setArchivedOpen] = createSignal(false)
  const [menu, setMenu] = createSignal<{ x: number; y: number; items: MenuItem[] } | undefined>()
  /** Where the menu actually lands once its own size is known; undefined means "not measured yet". */
  const [menuPlacement, setMenuPlacement] = createSignal<{ x: number; y: number } | undefined>()
  const [hovered, setHovered] = createSignal(-1)
  const [collapsed, setCollapsed] = createSignal(false)
  const [query, setQuery] = createSignal("")
  /**
   * Batch mode. Keyed by a composite string, not by the `SessionInfo` object: every sync rebuilds
   * those objects, so identity would silently drop rows from the selection mid-task.
   */
  const [selection, setSelection] = createStore({ active: false, ids: [] as string[] })

  const matches = (session: SessionInfo) => {
    const needle = query().trim().toLowerCase()

    return !needle || (session.title ?? "").toLowerCase().includes(needle)
  }

  /** One entry per project, before sessions are attached. */
  const targets = createMemo(() =>
    global.servers.list().flatMap((conn) => {
      const key = ServerConnection.key(conn)
      const ctx = global.serverCtx(key)

      if (!ctx) return []

      return (ctx.projects.list() ?? []).map((project) => ({ conn, key, project }))
    }),
  )

  // Sessions come from the server per directory: the live cache only holds what this client has
  // opened, so a project nobody visited in this window would otherwise look empty.
  // The snapshot is merged per id below, which can override an entry but cannot remove one, so a
  // deletion has to invalidate it: the live cache loses the row while this map keeps the copy the
  // server returned, and the deleted session comes back from here. Refetching after a delete is
  // what makes the row leave; archiving and renaming only need the per-id override.
  const [fetched, { refetch: refetchSessions }] = createResource(
    () =>
      targets()
        .map((item) => `${item.key}:${item.project.worktree}`)
        .join("|"),
    async () => {
      const entries = await Promise.all(
        targets().map(async ({ key, project }) => {
          const ctx = global.serverCtx(key)
          const result = await ctx?.sdk.api.session
            .list({ directory: project.worktree, limit: 50 })
            .catch(() => ({ data: [] as SessionInfo[] }))

          return [project.worktree, result?.data ?? []] as const
        }),
      )

      return new Map(entries)
    },
    { initialValue: new Map<string, SessionInfo[]>() },
  )

  const groups = createMemo(() =>
    targets()
      .map(({ conn, key, project }) => {
        const ctx = global.serverCtx(key)
        const directories = new Set([project.worktree, ...(project.sandboxes ?? [])].map(pathKey))
        // The live cache wins per id: it already carries renames, archives, and deletions.
        const byId = new Map((fetched().get(project.worktree) ?? []).map((session) => [session.id, session]))
        for (const session of ctx?.data.session.list() ?? []) {
          if (directories.has(pathKey(session.location.directory))) byId.set(session.id, session)
        }
        const mine = [...byId.values()]
          .filter((session) => !session.parentID)
          .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))

        return {
          conn,
          key,
          directory: project.worktree,
          project,
          sessions: mine.filter((session) => !session.time?.archived && matches(session)),
          archived: mine.filter((session) => !!session.time?.archived),
        }
      })
      // Pinned rows lead the whole column, across servers. `sort` is stable, so everything else
      // keeps the order the user arranged in the home list, and unpinning puts a project back
      // where it was instead of appending it to the end.
      .sort((a, b) => Number(!!b.project.pinned) - Number(!!a.project.pinned)),
  )

  const visibleGroups = createMemo(() =>
    query().trim() ? groups().filter((group) => group.sessions.length > 0) : groups(),
  )

  /**
   * The group a session belongs to: by id first, since grouping already folded the project's
   * sandboxes into it. A search query filters the rows this column carries, so the route can name a
   * session the visible list does not hold — the session itself still records its directory.
   */
  const groupOf = (server: ServerConnection.Key, sessionID: string) => {
    const all = groups()
    const known = all.find((group) =>
      [...group.sessions, ...group.archived].some((session) => session.id === sessionID),
    )

    if (known) return known
    const directory = global.serverCtx(server)?.data.session.get(sessionID)?.location.directory

    if (!directory) return undefined
    const key = pathKey(directory)

    return all.find((group) =>
      [group.project.worktree, ...(group.project.sandboxes ?? [])].some((item) => pathKey(item) === key),
    )
  }

  /**
   * The project in view. The route outranks `home.selection`: picking a top tab is a move to
   * whatever project that session lives in, and the column has to follow it. Reading only the home
   * selection left the header naming the project the user had left, with the session they were
   * looking at folded away inside a group that was not open.
   */
  const viewed = createMemo((): HomeProjectSelection | undefined => {
    const route = layout.route()

    if (route.type === "session") {
      const owner = groupOf(route.server, route.sessionId)

      if (owner) return { server: owner.key, directory: owner.directory }
    }

    if (route.type === "draft") {
      const draft = tabs.store.find((tab) => tab.type === "draft" && tab.draftID === route.draftID)

      if (draft?.type === "draft") return { server: draft.server, directory: draft.directory }
    }

    return layout.home.selection()
  })

  /** The project the header names: the one in view, else the first with sessions. */
  const current = createMemo(() => {
    const selection = viewed()
    const all = groups()

    return (
      all.find((group) => group.key === selection?.server && group.directory === selection?.directory) ??
      all.find((group) => group.key === selection?.server) ??
      all[0]
    )
  })

  /**
   * Switching tabs into a folded group would highlight a row nobody can see, so the group the route
   * lands in opens itself. Keyed on the project, and only an expand: the effect fires when the
   * project changes, so folding the group the user is already looking at sticks instead of being
   * undone by the next render, while coming back to a project from another one reveals its rows.
   */
  createEffect(
    on(
      () => {
        const selection = viewed()
        return selection?.server && selection.directory ? `${selection.server}:${selection.directory}` : undefined
      },
      (id) => {
        if (!id) return
        setOpenState((state) => (state[id] === true ? state : { ...state, [id]: true }))
      },
      { defer: true },
    ),
  )

  const newSession = () => {
    const group = current()

    if (group) newSessionIn(group.key, group.directory)
  }

  const newSessionIn = (key: ServerConnection.Key, directory: string) => {
    global.serverCtx(key)?.projects.touch(directory)
    void tabs.newDraft({ server: key, directory })
  }

  const archived = createMemo(() => groups().flatMap((group) => group.archived.map((session) => ({ group, session }))))

  const isActiveProject = (key: ServerConnection.Key, directory: string) => {
    const selection = viewed()

    return selection?.server === key && selection?.directory === directory
  }

  const isActiveSession = (session: SessionInfo) => {
    const route = layout.route()

    return route.type === "session" && route.sessionId === session.id
  }

  /**
   * SiCode: a session row shows a spinner while its turn is running, the same signal the tab
   * strip uses. Reading it here keeps the sidebar honest about work happening in a project you
   * are not currently looking at.
   */
  const isRunning = (key: ServerConnection.Key, session: SessionInfo) => {
    const status = global.serverCtx(key)?.data.session.status(session.id)

    return status === "running"
  }

  type SelectedRow = { key: ServerConnection.Key; session: SessionInfo }

  const rowID = (key: ServerConnection.Key, session: SessionInfo) => `${key}\u001f${session.id}`

  const isSelected = (key: ServerConnection.Key, session: SessionInfo) => selection.ids.includes(rowID(key, session))

  const toggleSelected = (key: ServerConnection.Key, session: SessionInfo) =>
    setSelection("ids", (ids) => {
      const id = rowID(key, session)

      return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
    })

  /** A project header picks its whole group; pressing it again with everything picked clears it. */
  const toggleSelectedGroup = (group: { key: ServerConnection.Key; sessions: readonly SessionInfo[] }) => {
    const ids = group.sessions.map((session) => rowID(group.key, session))
    const picked = ids.every((id) => selection.ids.includes(id))

    setSelection("ids", (current) =>
      picked ? current.filter((id) => !ids.includes(id)) : [...current, ...ids.filter((id) => !current.includes(id))],
    )
  }

  /** Every live row the column currently shows, so "select all" means what is on screen. */
  const selectable = createMemo<SelectedRow[]>(() =>
    visibleGroups().flatMap((group) => group.sessions.map((session) => ({ key: group.key, session }))),
  )

  const allSelected = () => {
    const rows = selectable()

    return rows.length > 0 && rows.every((row) => isSelected(row.key, row.session))
  }

  const toggleAllSelected = () =>
    setSelection("ids", allSelected() ? [] : selectable().map((row) => rowID(row.key, row.session)))

  /** Resolves the stored ids back to rows: deletion and archiving may have removed some of them. */
  const selectedRows = () => {
    const wanted = new Set(selection.ids)

    return selectable().filter((row) => wanted.has(rowID(row.key, row.session)))
  }

  const enterSelection = (rows: readonly SelectedRow[] = []) => {
    setMenu(undefined)
    // The search field is not on screen in batch mode, so a leftover query would silently hide
    // rows from "select all" while the box that explains why is gone.
    setQuery("")
    setSelection({ active: true, ids: rows.map((row) => rowID(row.key, row.session)) })
  }

  const exitSelection = () => setSelection({ active: false, ids: [] })

  // Rows leave the list under an active selection when they are archived or deleted. Drop the ids
  // that no longer point at anything, and leave batch mode once there is nothing left to pick.
  createEffect(() => {
    if (!selection.active) return
    const available = new Set(selectable().map((row) => rowID(row.key, row.session)))

    if (available.size === 0) return exitSelection()
    const kept = selection.ids.filter((id) => available.has(id))

    if (kept.length !== selection.ids.length) setSelection("ids", kept)
  })

  type BatchGroup = { key: ServerConnection.Key; directory: string; sessions: SessionInfo[] }

  /**
   * Grouped by server *and* directory, not by server alone: tab cleanup takes one directory per
   * notice, and a server can host several projects at once.
   */
  const byLocation = (rows: readonly SelectedRow[]) =>
    rows.reduce((map, row) => {
      const id = `${row.key}\u001f${row.session.location.directory}`
      const group = map.get(id)

      if (group) group.sessions.push(row.session)
      else
        map.set(id, {
          key: row.key,
          directory: row.session.location.directory,
          sessions: [row.session],
        })

      return map
    }, new Map<string, BatchGroup>())

  /**
   * One update call per session: the endpoint carries a single `archived` flag, so there is no
   * bulk form to use instead. Settled rather than all-or-nothing — one failure must not strand the
   * rest of the batch, and the caller reports whatever did fail.
   */
  const archiveBatch = async ({ key, directory, sessions }: BatchGroup) => {
    const ctx = global.serverCtx(key)

    if (!ctx || sessions.length === 0) return
    const results = await Promise.allSettled(
      sessions.map((session) => ctx.sdk.api.session.update({ sessionID: session.id, archived: true })),
    )
    const changed = sessions.filter((_, index) => results[index]?.status === "fulfilled")

    if (changed.length > 0) {
      await Promise.allSettled(changed.map((session) => ctx.data.session.sync(session.id)))

      // Archiving takes the row out of the column, so a tab still pointing at it would outlive its
      // own sidebar entry.
      notifySessionTabsRemoved({ server: key, directory, sessionIDs: changed.map((session) => session.id) })
    }

    const failure = results.find((result) => result.status === "rejected")

    if (failure?.status === "rejected") throw failure.reason
  }

  /**
   * Deleting a session takes its child tree with it, the same contract the home list keeps, so a
   * batch cannot leave orphaned subagent sessions behind.
   */
  const deleteBatch = async ({ key, directory, sessions }: BatchGroup) => {
    const ctx = global.serverCtx(key)

    if (!ctx || sessions.length === 0) return
    const list = ctx.data.session.list()
    const targets = sessions.map((session) => ({ session, ids: sessionTreeIDs(list, session.id) }))
    const results = await Promise.allSettled(targets.map((target) => ctx.data.session.remove(target.session.id)))
    const removed = targets.filter((_, index) => results[index]?.status === "fulfilled")

    if (removed.length > 0)
      notifySessionTabsRemoved({
        server: key,
        directory,
        sessionIDs: [...new Set(removed.flatMap((target) => target.ids))],
      })

    const failure = results.find((result) => result.status === "rejected")

    if (failure?.status === "rejected") throw failure.reason
  }

  /** The tab behind the route, so the side panel state can be read from the shell. */
  const currentTab = createMemo(() => {
    const route = layout.route()

    return route.type === "session" ? findSessionTab(tabs.store, route.server, route.sessionId) : undefined
  })

  // Opening the side panel steals the horizontal room the session needs; fold the project list
  // instead of squeezing both. SiCode: the panel only acts at the moment it opens or closes, and
  // every fold remembers who caused it.
  // - Panel opens: an expanded sidebar folds (however it got expanded); an already folded one is
  //   left alone — a user collapse is never overridden here.
  // - Panel closes: only a fold the panel itself made is undone. A collapse the user clicked, or
  //   an expand they clicked while the panel was open, survives.
  // Reading collapsed()/foldCause() through untrack matters: the effect must fire on the
  // panel's open/close transitions only, or it would keep reverting the user's expand button
  // while the panel stays open (the expand button once looked dead for exactly that reason).
  const [foldCause, setFoldCause] = createSignal<"user" | "auto" | undefined>(undefined)
  const foldManually = (next: boolean) => {
    setFoldCause("user")
    setCollapsed(next)
  }
  let sideWasOpen = false
  createEffect(() => {
    const sideOpen = tabs.region(currentTab(), "side")
    const wasOpen = sideWasOpen
    sideWasOpen = sideOpen

    if (sideOpen && !wasOpen) {
      if (!untrack(() => collapsed())) {
        setFoldCause("auto")
        setCollapsed(true)
      }

      return
    }
    if (!sideOpen && wasOpen && untrack(() => foldCause()) === "auto") {
      setFoldCause(undefined)
      setCollapsed(false)
    }
  })

  const openSession = (key: ServerConnection.Key, session: SessionInfo) => {
    const existing = findSessionTab(tabs.store, key, session.id)

    if (existing) return tabs.select(existing)
    tabs.select(tabs.addSessionTab({ server: key, sessionId: session.id }))
  }

  /** Explicit user choice wins; otherwise only the project in view starts open. */
  const toggle = (id: string, active: boolean) =>
    setOpenState((current) => ({ ...current, [id]: !(current[id] ?? active) }))

  const showMenu = (event: MouseEvent, items: MenuItem[]) => {
    event.preventDefault()
    event.stopPropagation()
    setHovered(-1)
    setMenuPlacement(undefined)
    setMenu({ x: event.clientX, y: event.clientY, items })
  }

  /**
   * Both archive moves are reversible, but both also take the row out of the list the user is
   * looking at, and a context-menu item is one click with no undo gesture behind it. The dialog
   * names the session and says where it goes, which is what makes the move feel like a move rather
   * than a disappearance — the batch path already asks, so a single row asking too is consistent.
   */
  const setArchived = (key: ServerConnection.Key, session: SessionInfo, archived: boolean) =>
    void dialog.show(() => (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t(archived ? "dock.session.archive.title" : "dock.session.restore.title")}
            description={language.t(archived ? "dock.session.archive.confirm" : "dock.session.restore.confirm", {
              title: session.title || language.t("session.new"),
            })}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="contrast"
            onClick={() => {
              dialog.close()
              const ctx = global.serverCtx(key)

              void ctx?.sdk.api.session
                .update({ sessionID: session.id, archived })
                .then(() => {
                  if (archived)
                    notifySessionTabsRemoved({
                      server: key,
                      directory: session.location.directory,
                      sessionIDs: [session.id],
                    })

                  return ctx.data.session.sync(session.id)
                })
                .catch(() => undefined)
            }}
          >
            {language.t(archived ? "dock.session.archive" : "dock.session.restore")}
          </Button>
        </DialogFooter>
      </Dialog>
    ))

  const rename = (key: ServerConnection.Key, session: SessionInfo) => {
    void dialog.show(() => {
      const [value, setValue] = createSignal(session.title ?? "")
      const save = () => {
        const next = value().trim()

        if (!next) return
        const ctx = global.serverCtx(key)
        dialog.close()
        // Rename moves the row in the list (time.updated changes), so re-sync the canonical record.
        void ctx?.sdk.api.session
          .update({ sessionID: session.id, title: next })
          .then(() => ctx.data.session.sync(session.id))
          .catch(() => undefined)
      }

      return (
        <Dialog fit>
          <DialogHeader hideClose>
            <DialogTitleGroup title={language.t("dock.session.rename.title")} />
          </DialogHeader>
          <div class="px-3 pb-1">
            <TextField
              autofocus
              label={language.t("dock.session.rename.label")}
              hideLabel
              value={value()}
              onChange={setValue}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="contrast" onClick={save}>
              {language.t("common.save")}
            </Button>
          </DialogFooter>
        </Dialog>
      )
    })
  }

  const remove = (key: ServerConnection.Key, session: SessionInfo) => {
    void dialog.show(() => (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("dock.session.delete.title")}
            description={language.t("dock.session.delete.description", { title: session.title ?? "" })}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              dialog.close()
              const ctx = global.serverCtx(key)

              if (!ctx) return
              // The whole child tree goes with the root, so the tabs to close are the same set the
              // batch path collects — otherwise a subagent whose parent was deleted keeps its tab.
              const ids = sessionTreeIDs(ctx.data.session.list(), session.id)

              void ctx.data.session
                .remove(session.id)
                // Same reason as the batch path: the row is gone from the live cache, not from the
                // snapshot the column renders, so the snapshot is what has to be replaced.
                .then(() => {
                  notifySessionTabsRemoved({
                    server: key,
                    directory: session.location.directory,
                    sessionIDs: ids,
                  })

                  return refetchSessions()
                })
                .catch(() => undefined)
            }}
          >
            {language.t("common.delete")}
          </Button>
        </DialogFooter>
      </Dialog>
    ))
  }

  const sessionMenu = (key: ServerConnection.Key, session: SessionInfo): MenuItem[] => [
    { icon: "pencil-line", label: language.t("dock.session.rename"), onSelect: () => rename(key, session) },
    {
      icon: "archive",
      label: language.t("dock.session.archive"),
      onSelect: () => setArchived(key, session, true),
    },
    "separator",
    {
      icon: "select-element",
      label: language.t("dock.session.select"),
      onSelect: () => enterSelection([{ key, session }]),
    },
    "separator",
    {
      icon: "trash",
      label: language.t("dock.session.delete.action"),
      danger: true,
      onSelect: () => remove(key, session),
    },
  ]

  const archivedMenu = (key: ServerConnection.Key, session: SessionInfo): MenuItem[] => [
    { icon: "refresh", label: language.t("dock.session.restore"), onSelect: () => setArchived(key, session, false) },
    "separator",
    {
      icon: "trash",
      label: language.t("dock.session.delete.action"),
      danger: true,
      onSelect: () => remove(key, session),
    },
  ]

  const runBatch = (rows: readonly SelectedRow[], action: "archive" | "delete") => {
    const grouped = [...byLocation(rows).values()]

    void dialog.show(() => {
      const [busy, setBusy] = createSignal(false)
      const count = rows.length
      const confirm = async () => {
        setBusy(true)
        const failures: unknown[] = []

        for (const group of grouped) {
          try {
            await (action === "archive" ? archiveBatch(group) : deleteBatch(group))
          } catch (cause: unknown) {
            failures.push(cause)
          }
        }

        // Deleting is the one action the per-id merge cannot express, so the snapshot has to be
        // replaced before the dialog closes — otherwise the rows it still lists reappear behind it.
        if (action === "delete") await refetchSessions()
        setBusy(false)
        dialog.close()
        if (failures.length === 0) return exitSelection()
        showToast({
          title:
            action === "archive"
              ? language.t("common.requestFailed")
              : language.t("session.delete.failed.title"),
          description: errorMessage(failures[0], language.t("common.requestFailed")),
        })
        // Whatever did go through still left the selection, so the survivor set is recomputed by
        // the pruning effect; keep the mode open only while something is actually still selectable.
      }

      return (
        <Dialog fit>
          <DialogHeader hideClose>
            <DialogTitleGroup
              title={
                action === "archive"
                  ? language.t("dock.session.archive.many.title")
                  : language.t("session.delete.many.title")
              }
              description={
                action === "archive"
                  ? language.plural("dock.session.archive.many.confirm", count)
                  : (
                    <div class="flex flex-col gap-2">
                      <div>{language.plural("session.delete.many.confirm", count)}</div>
                      <div>{language.t("session.delete.many.warning")}</div>
                    </div>
                  )
              }
            />
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant={action === "archive" ? "contrast" : "danger"} disabled={busy()} onClick={() => void confirm()}>
              {action === "archive"
                ? language.t("dock.session.archive.many.button")
                : language.t("session.delete.many.button")}
            </Button>
          </DialogFooter>
        </Dialog>
      )
    })
  }

  /**
   * Closing is local: the project leaves the sidebar and the home list, its history stays on disk,
   * and reopening it brings the sessions back. Nothing is deleted — but the row disappearing from
   * the column is indistinguishable from losing the project, so it asks first and says in the same
   * sentence where the project went and how to get it back.
   */
  const closeProject = (group: ProjectGroup) => {
    if (!global.serverCtx(group.key)) return

    void dialog.show(() => (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("dock.project.close.title")}
            description={language.t("dock.project.close.description", { name: displayName(group.project) })}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="contrast"
            onClick={() => {
              dialog.close()
              const ctx = global.serverCtx(group.key)

              if (!ctx) return
              const next = closeHomeProject(layout.home.selection(), group.key, ctx.projects, group.directory)
              // Closing a project that was not the selection leaves the selection alone, and
              // "alone" can still be empty — a server-only selection is the neutral state either way.
              layout.home.setSelection(next ?? { server: group.key })
            }}
          >
            {language.t("dock.project.close")}
          </Button>
        </DialogFooter>
      </Dialog>
    ))
  }

  /** A remote server has no folder on this machine, so only the local connection can open one. */
  const canOpenFolder = (group: ProjectGroup) =>
    ServerConnection.local(group.conn) && !!(platform.openPath || platform.revealPath)

  /**
   * Opens the project directory itself. `openPath` launches the folder in the file manager, which is
   * what the label promises; `revealPath` only highlights it inside the parent window, so it is the
   * fallback for a platform without `openPath`.
   */
  const openProjectFolder = (group: ProjectGroup) => {
    if (!canOpenFolder(group)) return
    if (!platform.openPath) return projectReveal.reveal(group.conn, group.project)
    void platform.openPath(group.directory).catch((cause: unknown) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: errorMessage(cause, language.t("common.requestFailed")),
      }),
    )
  }

  /** The project's own settings page: icon, color, and the rest that renaming here cannot reach. */
  const openProjectSettings = (group: ProjectGroup) =>
    settingsSurface.openProject({ server: group.key, project: group.directory })

  /**
   * Pinning changes nothing about the project — only where its row sits — so it stays local to this
   * client's server state and needs no confirmation dialog.
   */
  const togglePinned = (group: ProjectGroup) =>
    global.serverCtx(group.key)?.projects.setPinned(group.directory, !group.project.pinned)

  const renameProject = (group: ProjectGroup) => {
    void dialog.show(() => {
      const [value, setValue] = createSignal(displayName(group.project))
      const save = () => {
        const next = value().trim()

        if (!next) return
        const ctx = global.serverCtx(group.key)
        // Empty clears the override, so the folder name shows through again — the same rule the
        // settings row follows.
        const name = next === getFilename(group.directory) ? "" : next
        dialog.close()

        if (!ctx) return
        if (group.project.id && group.project.id !== "global") {
          void ctx.sdk.api.project
            .update({ projectID: group.project.id, name })
            .then((project) => ctx.sync.project.update(project))
            .catch(() => undefined)

          return
        }

        ctx.sync.project.meta(group.directory, { name })
      }

      return (
        <Dialog fit>
          <DialogHeader hideClose>
            <DialogTitleGroup title={language.t("dock.project.rename.title")} />
          </DialogHeader>
          <div class="px-3 pb-1">
            <TextField
              autofocus
              label={language.t("dock.project.rename.label")}
              hideLabel
              value={value()}
              onChange={setValue}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="contrast" onClick={save}>
              {language.t("common.save")}
            </Button>
          </DialogFooter>
        </Dialog>
      )
    })
  }

  /**
   * Ordered by what a project row is for: act on it, then the places it lives, then closing. Closing
   * is last and separated — it removes the row, and a misplaced click there is the one action here
   * the user would want to undo.
   */
  const projectMenu = (group: ProjectGroup & { sessions: readonly SessionInfo[] }): MenuItem[] => [
    { icon: "plus-small", label: language.t("command.session.new"), onSelect: () => newSessionIn(group.key, group.directory) },
    "separator",
    // A toggle, so the label names what the click does rather than the state it is in now.
    {
      icon: "pin",
      label: language.t(group.project.pinned ? "dock.project.unpin" : "dock.project.pin"),
      onSelect: () => togglePinned(group),
    },
    { icon: "pencil-line", label: language.t("dock.project.rename"), onSelect: () => renameProject(group) },
    { icon: "settings-gear", label: language.t("project.settings.title"), onSelect: () => openProjectSettings(group) },
    ...(canOpenFolder(group)
      ? [
          {
            icon: "folder",
            label: language.t("dock.project.openFolder"),
            onSelect: () => openProjectFolder(group),
          },
        ]
      : []),
    {
      icon: "outline-copy",
      label: language.t("dock.project.copyPath"),
      onSelect: () => void platform.writeClipboardText?.(group.directory),
    },
    "separator",
    // Batch selection starts from here too: a project row is the handle for a folded group, and
    // right-clicking a session to find it is a detour when the whole project is what you meant.
    ...(group.sessions.length > 0
      ? [
          {
            icon: "select-element" as const,
            label: language.t("dock.session.select"),
            onSelect: () => enterSelection(group.sessions.map((session) => ({ key: group.key, session }))),
          },
        ]
      : []),
    // Red on hover, and confirmed afterwards: closing removes the row from the sidebar. It is the
    // only destructive-looking action in this menu, so it reads as one.
    { icon: "close", label: language.t("dock.project.close"), danger: true, onSelect: () => closeProject(group) },
  ]

  // The menu is a plain layer, not a Kobalte popper: close it from anywhere in the window, since a
  // click on the chat area would otherwise leave it floating.
  createEffect(() => {
    if (!menu()) return
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null

      if (target?.closest('[data-slot="left-sidebar-menu"]')) return
      setMenu(undefined)
    }
    document.addEventListener("pointerdown", close, true)
    onCleanup(() => document.removeEventListener("pointerdown", close, true))
  })

  return (
    <aside
      data-slot="left-sidebar"
      data-collapsed={collapsed() ? "true" : undefined}
      class={`relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-e border-v2-border-border-muted bg-v2-background-bg-deep pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)] transition-[width] duration-150 ease-out motion-reduce:transition-none ${
        // SiCode: 45px is 8 + 28 + 8 + 1 — one 28px control with the expanded header's own 8px
        // inset on both sides, plus the 1px end border that a border-box width would otherwise
        // take out of the padding. The rail is exactly one button wide on purpose: at 52px the
        // same control sat 4px inward and 4px short of the row it becomes when the column opens.
        collapsed() ? "w-[45px] items-center gap-1" : "w-[224px]"
      }`}
      onClick={() => setMenu(undefined)}
      onKeyDown={(event) => {
        // Escape leaves batch selection the same way it clears a search field: one key, one
        // obvious way back out of the mode the user just entered.
        if (event.key !== "Escape" || !selection.active) return
        if (event.target instanceof HTMLElement && event.target.closest("input, textarea")) return
        event.preventDefault()
        exitSelection()
      }}
    >
      {/* A component body runs once in Solid, so the earlier `if (collapsed()) return <rail/>` was
          evaluated a single time: the toggle changed the signal and nothing re-rendered. Show keeps
          both shapes reactive while the aside itself stays mounted, so the width animates in place
          instead of the whole column being torn down and rebuilt. */}
      <Show
        when={!collapsed()}
        fallback={
          <>
            {/* Both rail controls are the only way out of — or into work from — the collapsed
                column, so they keep their surface whether or not the pointer is over them. They
                take the same `neutral` variant as the expanded header, which is the variant that
                carries a resting fill; the bare buttons here showed one only on hover.

                They also take its size and its corner. The fold control is one button that keeps
                one place whether the column is open or shut: rail children are centred, which put
                the same 28px square 4px right and 2px above where the expanded header draws it, so
                the control appeared to jump every time the column opened or closed. `px-2 pt-0.5`
                is exactly the expanded header's own inset (`px-1.5` on the body plus `px-0.5
                pt-0.5` on the block), which is the only way the two land on the same pixel.

                SiCode: the vertical gap matches the rail's own 8px side inset (`px-2`), so the two
                controls sit on the same spacing in both directions instead of 8px apart sideways
                and 4px apart vertically. */}
            <div class="flex w-full flex-col items-start gap-2 px-2 pt-0.5">
              <Button
                variant="neutral"
                class="size-7 shrink-0 p-0"
                aria-label={language.t("dock.expand")}
                onClick={() => foldManually(false)}
              >
                <Icon name="chevron-right" class="size-3.5" />
              </Button>
              <Button
                variant="neutral"
                class="size-7 shrink-0 p-0"
                aria-label={language.t("command.session.new")}
                onClick={newSession}
              >
                <Icon name="plus" class="size-3.5" />
              </Button>
            </div>
            <div class="flex-1" aria-hidden="true" />
            <DockToolbar variant="rail" />
          </>
        }
      >
        {/* The column carries no horizontal inset of its own: the scroll view has to span the full
            width of the aside so its thumb lands on the window edge, and each block brings the same
            8px in return. */}
        <div class="flex min-h-0 flex-1 flex-col gap-0.5">
          {/* SiCode: search is a real field on its own line, with the collapse control beside it;
              the single full-width new-session button is the row under it. The divider that used
              to separate these blocks is gone — both blocks bring an edge of their own, and a
              third hairline in the same 40px made the top of the column look ruled rather than
              spaced. No section label above the button for the same reason: the label named a
              category of one. */}
          <div class="flex flex-col gap-1 px-2 pb-1 pt-0.5">
            <div class="flex items-center gap-1">
              {/* The fold control leads the row, in the same corner the collapsed column puts its
                  expand button: one place to learn, and the same click toggles the column both ways
                  instead of the control jumping sides with the state it produces. */}
              <Button
                variant="neutral"
                class="size-7 shrink-0 p-0"
                aria-label={language.t("dock.collapse")}
                onClick={() => foldManually(true)}
              >
                <Icon name="chevron-left" class="size-3.5" />
              </Button>
              <label class="flex h-7 min-w-0 flex-1 items-center rounded-[6px] bg-v2-background-bg-layer-02 px-2 text-12-regular">
                <input
                  type="text"
                  class="min-w-0 flex-1 bg-transparent text-12-regular text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                  aria-label={language.t("dock.search")}
                  placeholder={language.t("dock.search")}
                  value={query()}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setQuery("")
                  }}
                />
                <Icon name="magnifying-glass" class="size-3.5 shrink-0 text-v2-text-text-faint" />
              </label>
            </div>
            <Button variant="neutral" class="h-7 w-full" onClick={newSession}>
              <Icon name="plus" class="size-3.5 shrink-0" />
              <span class="truncate">{language.t("command.session.new")}</span>
            </Button>
          </div>

          <ScrollView class="min-h-0 flex-1">
            {/* The same 8px the search and new-session block above takes: every row in the column
                starts and ends on the edge the buttons use, and the scroll view itself stays
                full-bleed so its thumb sits on the aside's own edge rather than 6px inboard. */}
            <div class="flex flex-col px-2 pb-2.5">
              {/* An empty column with nothing in it reads as broken; name the reason instead. */}
              <Show when={visibleGroups().length === 0}>
                <p class="px-1 py-2 text-12-regular text-v2-text-text-faint">
                  {query().trim() ? language.t("dock.search.empty") : language.t("dock.projects.empty")}
                </p>
              </Show>
              <For each={visibleGroups()}>
                {(group) => {
                  const id = `${group.key}:${group.directory}`
                  const active = () => isActiveProject(group.key, group.directory)
                  // Collapsed by default: only the project in view opens itself, so a dozen groups
                  // do not turn the sidebar into a wall of titles.
                  const isCollapsed = () => !(openState()[id] ?? active())

                  return (
                    <div class="mb-2 flex flex-col">
                      <div class="relative flex h-7 items-center rounded-[5px] text-12-regular transition-colors hover:bg-v2-overlay-simple-overlay-hover">
                        {/* The whole row toggles: hitting a 16px chevron to fold a group was the wrong
                          target, and clicking the name used to jump to home instead of folding. */}
                        <button
                          type="button"
                          class={`flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-[5px] pe-1 ps-1 text-start hover:text-v2-text-text-base ${
                            // A folded group shows nothing but this name, so it carries the weight its
                            // hidden sessions cannot. Expanded, the sessions are the content and the
                            // header steps back — one emphasis per group, never both at once.
                            isCollapsed() ? "text-v2-text-text-base" : "text-v2-text-text-muted"
                          }`}
                          data-active={active()}
                          // In batch mode the same click picks the group instead of folding it, so the
                          // row must stop claiming it controls the disclosure. A group with nothing
                          // to pick falls back to folding: otherwise the row goes dead in this mode.
                          aria-expanded={selection.active ? undefined : !isCollapsed()}
                          onClick={() =>
                            selection.active && group.sessions.length > 0
                              ? toggleSelectedGroup(group)
                              : toggle(id, active())
                          }
                          onContextMenu={(event) => showMenu(event, projectMenu(group))}
                        >
                          {/* In batch mode the chevron's slot carries a checkbox: a folded group
                              shows no rows to click, so its header is the only handle left. A group
                              with nothing in it keeps the empty slot — a box that can never tick is
                              a promise the column cannot keep. */}
                          <Show when={selection.active && group.sessions.length > 0}>
                            <span
                              class={`flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border-[0.5px] ${
                                group.sessions.every((session) => isSelected(group.key, session))
                                  ? "border-v2-border-border-strong bg-v2-background-bg-contrast text-v2-icon-icon-contrast"
                                  : "border-v2-border-border-strong text-transparent"
                              }`}
                              aria-hidden="true"
                            >
                              <Icon name="check" class="size-2.5" />
                            </span>
                          </Show>
                          {/* A group with no sessions cannot open, so an arrow there is a dead
                              control promising rows that do not exist. The empty 10px slot keeps
                              every avatar in the column on the same x. */}
                          <Show
                            when={!selection.active && group.sessions.length > 0}
                            fallback={<span class="size-2.5 shrink-0" aria-hidden="true" />}
                          >
                            <Icon
                              name="chevron-down"
                              class={`size-2.5 shrink-0 text-v2-icon-icon-faint transition-transform${isCollapsed() ? " -rotate-90" : ""}`}
                            />
                          </Show>
                          {/* SiCode: the project's real avatar (custom icon or colored initial) — the
                              same mark the settings pages and the old switcher use, so a project is
                              recognizable at a glance even when names are similar. */}
                          <ProjectIcon project={group.project} class="shrink-0" aria-hidden="true" />
                          <span
                            class={`min-w-0 flex-1 truncate text-12-medium ${
                              // A pinned row keeps the emphasis a folded group has even while it is
                              // open: the mark alone was too quiet to explain why these rows sit on
                              // top, so the name carries the weight instead of a colour or a badge.
                              group.project.pinned ? "text-v2-text-text-base" : ""
                            }`}
                          >
                            {group.project.name ?? group.directory.split(/[\\/]/).filter(Boolean).pop()}
                          </span>
                          {/* Pinning only changes the row's position, so without a mark here the
                              state is invisible: two identical rows, one of which behaves as pinned. */}
                          <Show when={group.project.pinned}>
                            <Icon name="pin" class="size-3.5 shrink-0 text-v2-icon-icon-base" aria-hidden="true" />
                          </Show>
                          {/* The group folds, so its running sessions can be hidden entirely — the same
                              spinner the session rows carry says the work is still going while the
                              rows are out of sight, and keeps saying it when they are not. */}
                          <Show when={group.sessions.some((session) => isRunning(group.key, session))}>
                            <span
                              role="status"
                              aria-label={language.t("session.timeline.working")}
                              class="flex size-3 shrink-0 items-center justify-center"
                            >
                              <SessionProgressIndicatorV2 class="size-3" />
                            </span>
                          </Show>
                        </button>
                      </div>

                      <Show when={!isCollapsed()}>
                        <For each={group.sessions}>
                          {(session) => (
                              // The row is a button, so the "…" trigger sits beside it rather than
                              // inside: nesting one button in another is invalid and swallows the
                              // inner click. Hovering swaps the trailing slot for it, the way the
                              // app's home session list already does.
                              <div
                                class="group/session relative flex h-7 items-center rounded-[6px] transition-colors hover:bg-v2-overlay-simple-overlay-hover data-[active=true]:bg-v2-overlay-simple-overlay-pressed data-[selected=true]:bg-v2-overlay-simple-overlay-pressed"
                                data-active={isActiveSession(session)}
                                data-selected={selection.active && isSelected(group.key, session)}
                              >
                                <button
                                  type="button"
                                  class={`relative flex h-full w-full cursor-pointer items-center gap-2 rounded-[6px] pe-1 text-start text-12-regular text-v2-text-text-base ${
                                    // Batch mode indents the checkbox instead of aligning it with the
                                    // project's own box: a session is a child of that project, and a
                                    // shared left edge made the two levels read as siblings. The box
                                    // takes the avatar's column (24px), so titles still land under
                                    // project names. Both are flow children — an absolutely placed
                                    // box would sit on top of the title instead of pushing it aside.
                                    selection.active ? "ps-6" : "ps-[42px]"
                                  }`}
                                  role={selection.active ? "checkbox" : undefined}
                                  aria-checked={selection.active ? isSelected(group.key, session) : undefined}
                                  onClick={() =>
                                    selection.active
                                      ? toggleSelected(group.key, session)
                                      : openSession(group.key, session)
                                  }
                                  onContextMenu={(event) => showMenu(event, sessionMenu(group.key, session))}
                                >
                                  <Show
                                    when={selection.active}
                                    fallback={
                                      <Show when={isActiveSession(session)}>
                                        {/* SiCode: the mark sits on the project avatar's left edge
                                            (20px), not in the middle of that column where it used to
                                            look like a line growing out of the icon. Now the two
                                            levels share one edge, so the mark reads as "this row
                                            belongs to the project above". */}
                                        <span class="absolute start-[20px] top-[7px] bottom-[7px] w-[2px] rounded-[2px] bg-v2-text-text-base" />
                                      </Show>
                                    }
                                  >
                                    <span
                                      class={`flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border-[0.5px] ${
                                        isSelected(group.key, session)
                                          ? "border-v2-border-border-strong bg-v2-background-bg-contrast text-v2-icon-icon-contrast"
                                          : "border-v2-border-border-strong text-transparent"
                                      }`}
                                      aria-hidden="true"
                                    >
                                      <Icon name="check" class="size-2.5" />
                                    </span>
                                  </Show>
                                  <MarqueeText class="min-w-0 flex-1" text={session.title || language.t("session.new")} />
                                  {/* One trailing slot, two states: how long ago the session moved at
                                      rest, the "…" trigger on hover. The time keeps its place while
                                      invisible so the title never reflows under the pointer, and the
                                      trigger lands on top of it. A running session shows its mark
                                      there instead — "still working" outranks "last touched". */}
                                  <span class="flex shrink-0 items-center justify-end text-[10.5px] text-v2-text-text-faint tabular-nums transition-opacity group-hover/session:opacity-0">
                                    <Show
                                      when={isRunning(group.key, session)}
                                      fallback={getRelativeTime(
                                        new Date(session.time.updated ?? session.time.created).toISOString(),
                                        language.t,
                                      )}
                                    >
                                      <span
                                        role="status"
                                        aria-label={language.t("session.timeline.working")}
                                        class="flex size-3 items-center justify-center"
                                      >
                                        <SessionProgressIndicatorV2 class="size-3" />
                                      </span>
                                    </Show>
                                  </span>
                                </button>
                                {/* The "…" menu acts on one session, which is not what a row means in
                                    batch mode: there the row is a checkbox, so the trigger steps
                                    aside rather than offering a second, narrower path. */}
                                <Show when={!selection.active}>
                                  {/* z-10 is load-bearing: the scroll view's thumb overlays the last
                                      12px of the list with pointer-events on, so without a stacking
                                      step of its own the trigger loses its right edge to an invisible
                                      strip and the cursor turns into a default arrow over it. */}
                                  <button
                                    type="button"
                                    class="hover-reveal absolute end-1 top-1/2 z-10 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[4px] text-v2-icon-icon-muted group-hover/session:opacity-100 group-focus-within/session:opacity-100 hover:text-v2-text-text-base"
                                    aria-label={language.t("common.moreOptions")}
                                    onClick={(event) => {
                                      // The aside closes menus on any click that reaches it.
                                      event.stopPropagation()
                                      const rect = event.currentTarget.getBoundingClientRect()
                                      setHovered(-1)
                                      setMenuPlacement(undefined)
                                      setMenu({
                                        x: rect.right,
                                        y: rect.bottom + 4,
                                        items: sessionMenu(group.key, session),
                                      })
                                    }}
                                  >
                                    <Icon name="outline-dots" class="size-3.5" />
                                  </button>
                                </Show>
                              </div>
                          )}
                        </For>
                      </Show>
                    </div>
                  )
                }}
              </For>

              {/* Archived rows cannot be picked, so the shelf steps out of the way while picking
                  rather than sitting there as rows that ignore a click. */}
              <Show when={!selection.active && archived().length > 0}>
                {/* A different shelf, not the next group: the extra distance says "this is the end
                    of the project list", and a count chip reads as a total rather than another
                    row's time stamp. */}
                <button
                  type="button"
                  class="mt-3 flex h-7 w-full cursor-pointer items-center gap-1 rounded-[5px] px-1 text-start text-12-regular text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                  aria-expanded={archivedOpen()}
                  onClick={() => setArchivedOpen((open) => !open)}
                >
                  <Icon
                    name="chevron-down"
                    class={`size-2.5 shrink-0 text-v2-icon-icon-faint transition-transform${archivedOpen() ? "" : " -rotate-90"}`}
                  />
                  <span class="min-w-0 flex-1 truncate">{language.t("dock.archived")}</span>
                  {/* A count chip, not a pill: at this height 999px turned the numeral into a lozenge
                      that read wider than it was. 2px is the smallest step on the ladder — enough to
                      soften the corner, not enough to read as a rounded card. */}
                  <span class="shrink-0 rounded-[2px] bg-v2-overlay-simple-overlay-pressed px-1.5 text-[10.5px] text-v2-text-text-muted tabular-nums">
                    {archived().length}
                  </span>
                </button>
                <Show when={archivedOpen()}>
                  <For each={archived()}>
                    {({ group, session }) => (
                        // Archived rows stay out of batch selection: the selection model tracks the
                        // live list, so a tick here would be pruned away on the next sync. Deleting
                        // one is still a right-click away.
                        <div class="group/session relative flex h-7 items-center rounded-[6px] transition-colors hover:bg-v2-overlay-simple-overlay-hover">
                          <button
                            type="button"
                            class="flex h-full w-full cursor-pointer items-center rounded-[6px] pe-7 ps-[19px] text-start text-12-regular text-v2-text-text-muted hover:text-v2-text-text-base"
                            onClick={() => openSession(group.key, session)}
                            onContextMenu={(event) => showMenu(event, archivedMenu(group.key, session))}
                          >
                            <MarqueeText class="min-w-0 flex-1" text={session.title || language.t("session.new")} />
                            {/* Archived spans every project, so the row has to name its own origin —
                                it does not sit under a project heading that could say it for it. The
                                right gutter is reserved for the "…", so the name stops short of it. */}
                            <span class="max-w-[45%] shrink-0 truncate ps-2 text-[10.5px] text-v2-text-text-faint">
                              {group.project.name ?? group.directory.split(/[\\/]/).filter(Boolean).pop()}
                            </span>
                          </button>
                          <button
                            type="button"
                            class="hover-reveal absolute end-1 top-1/2 z-10 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[4px] text-v2-icon-icon-muted group-hover/session:opacity-100 group-focus-within/session:opacity-100 hover:text-v2-text-text-base"
                            aria-label={language.t("common.moreOptions")}
                            onClick={(event) => {
                              event.stopPropagation()
                              const rect = event.currentTarget.getBoundingClientRect()
                              setHovered(-1)
                              setMenuPlacement(undefined)
                              setMenu({ x: rect.right, y: rect.bottom + 4, items: archivedMenu(group.key, session) })
                            }}
                          >
                            <Icon name="outline-dots" class="size-3.5" />
                          </button>
                        </div>
                    )}
                  </For>
                </Show>
              </Show>
            </div>
          </ScrollView>
        </div>

        {/* The dock's own gap to the divider is the container's 8px; its gap to the window edge is
            the aside's `pb-[var(--shell-bottom-inset)]`, which is already the same 8px. Carrying a
            second `pb-2` here stacked two bottom gaps against one top gap, so the trigger sat 8px
            lower in its band than it did above it — the row read as hanging rather than centred. */}
        <div class="border-t border-v2-border-border-muted px-2 pt-2">
          {/* Batch actions belong next to the rows they act on, directly above the workspace dock.
              The top of the column stays search plus "new session": a mode bar there pushed the
              list down and hid the two controls the user reaches for most. */}
          <Show when={selection.active}>
            <div class="flex flex-col gap-1 pb-2">
              <div class="flex h-7 items-center gap-1">
                <Button
                  variant="ghost"
                  size="small"
                  class="size-7 shrink-0 p-0"
                  aria-label={language.t("dock.select.exit")}
                  onClick={exitSelection}
                >
                  <Icon name="close" class="size-3.5" />
                </Button>
                <span class="min-w-0 flex-1 truncate text-12-regular text-v2-text-text-base tabular-nums">
                  {language.plural("home.sessions.select.count", selection.ids.length)}
                </span>
                <Button variant="ghost" size="small" class="h-7 shrink-0 px-1.5" onClick={toggleAllSelected}>
                  {allSelected() ? language.t("home.sessions.select.none") : language.t("home.sessions.select.all")}
                </Button>
              </div>
              <div class="flex items-center gap-1">
                <Button
                  variant="neutral"
                  class="h-7 min-w-0 flex-1"
                  disabled={selection.ids.length === 0}
                  onClick={() => runBatch(selectedRows(), "archive")}
                >
                  <Icon name="archive" class="size-3.5 shrink-0" />
                  <span class="truncate">{language.t("common.archive")}</span>
                </Button>
                <Button
                  variant="danger"
                  class="h-7 min-w-0 flex-1"
                  disabled={selection.ids.length === 0}
                  onClick={() => runBatch(selectedRows(), "delete")}
                >
                  <Icon name="trash" class="size-3.5 shrink-0" />
                  <span class="truncate">{language.t("common.delete")}</span>
                </Button>
              </div>
            </div>
          </Show>
          <DockToolbar variant="pill" />
        </div>
      </Show>

      <Show when={menu()}>
        {(current) => (
          // Same component vocabulary as the renderer-wide menu (context-menu.css keyed off
          // data-slot), so a right-click here looks identical to a right-click anywhere else.
          <div
            data-component="sicode-context-menu"
            data-slot="left-sidebar-menu"
            tabindex="-1"
            ref={(element) => {
              queueMicrotask(() => element.focus())
              // Measure the real box rather than estimating from the item count: the menu now hugs
              // its content, so a label-heavy menu and a two-item one need different clamps, and
              // the estimate used to cut the right edge off the wider list or leave a gap beside
              // the narrow one. Measuring during the insert means the corrected position lands
              // before the first paint, so the menu never shows up in the wrong place first.
              const rect = element.getBoundingClientRect()
              setMenuPlacement({
                x: Math.max(8, Math.min(current().x, window.innerWidth - rect.width - 8)),
                y: Math.max(8, Math.min(current().y, window.innerHeight - rect.height - 8)),
              })
            }}
            onKeyDown={(event) => {
              const items = current().items
              const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0

              if (step !== 0) {
                event.preventDefault()
                let next = hovered()
                for (let attempt = 0; attempt < items.length; attempt++) {
                  next = (next + step + items.length) % items.length
                  if (items[next] !== "separator") break
                }
                setHovered(next)

                return
              }

              if (event.key === "Escape") {
                event.preventDefault()
                setMenu(undefined)

                return
              }

              if (event.key !== "Enter" && event.key !== " ") return
              const item = items[hovered()]
              if (!item || item === "separator") return
              event.preventDefault()
              setMenu(undefined)
              item.onSelect()
            }}
            style={{
              position: "fixed",
              // No width here on purpose: size comes from the shared context-menu rule
              // (width: max-content in context-menu.css), the same one the app-wide menu uses, so
              // the two can never drift apart the way they did when each carried its own number.
              left: `${menuPlacement()?.x ?? current().x}px`,
              top: `${menuPlacement()?.y ?? current().y}px`,
              "z-index": 70,
              outline: "none",
            }}
          >
            <For each={current().items}>
              {(item, index) =>
                item === "separator" ? (
                  <hr data-slot="sicode-context-menu-separator" />
                ) : (
                  <button
                    type="button"
                    class="text-start"
                    data-slot="sicode-context-menu-item"
                    data-variant={item.danger ? "danger" : undefined}
                    data-highlighted={hovered() === index() ? "" : undefined}
                    onMouseEnter={() => setHovered(index())}
                    onClick={() => {
                      setMenu(undefined)
                      item.onSelect()
                    }}
                  >
                    <span data-slot="sicode-context-menu-icon">
                      <Show when={item.icon}>{(icon) => <Icon name={icon()} class="size-4" />}</Show>
                    </span>
                    <span data-slot="sicode-context-menu-label">{item.label}</span>
                    <Show when={item.shortcut}>
                      {(shortcut) => <span data-slot="sicode-context-menu-shortcut">{shortcut()}</span>}
                    </Show>
                  </button>
                )
              }
            </For>
          </div>
        )}
      </Show>
    </aside>
  )
}
