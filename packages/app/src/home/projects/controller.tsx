import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { useServerActionsController } from "@/servers/registry/controller"
import { useSettingsCommand } from "@/settings/command"
import { useSettingsSurface } from "@/settings/surface"
import { type LocalProject } from "@/shell/state/layout"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import { closeHomeProject, errorMessage, homeProjectDirectories } from "@/shell/layout/helpers"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { showToast } from "@/shell/notifications/toast"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Show, createResource } from "solid-js"
import { sameDirectory } from "@opencode/util/path"
import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import type { HomeController } from "../model"
import { useGlobal } from "@/runtime/server/runtime"
import { useRevealProject } from "./reveal"

export const HomeServersSchema = Schema.Struct({
  collapsed: Persistence.record(Persistence.fallback(Schema.Boolean, () => false)),
})

export function createHomeProjectsController(home: HomeController) {
  const platform = usePlatform()
  const pickDirectory = useDirectoryPicker()
  const dialog = useDialog()
  const language = useLanguage()
  const openSettings = useSettingsCommand()
  const settings = useSettingsSurface()
  const serverManagement = useServerActionsController()
  const global = useGlobal()
  const revealProject = useRevealProject()
  const [_state, setState, _, ready] = persisted(Persist.global("home.servers"), HomeServersSchema, { collapsed: {} })

  const [state] = createResource(
    () => ready.promise ?? Promise.resolve(),
    (promise) => promise.then(() => _state),
    { initialValue: _state },
  )

  function edit(conn: ServerConnection.Http, onSave?: (saved: ServerConnection.Http) => void) {
    void import("@/servers/connect/dialog").then(({ DialogServer }) => {
      void dialog.show(() => <DialogServer mode="edit" server={conn} onSave={(saved) => onSave?.(saved)} />)
    })
  }

  // An expired pairing session or a changed password signs the app out of an HTTP server; signing in again edits it,
  // and the action that asked for sign-in continues once the dialog saves, as it does for extension servers. It continues
  // with the saved connection: the one it started with still carries the rejected credentials.
  function authenticate(conn: ServerConnection.Any, onConnected?: (conn: ServerConnection.Any) => void) {
    if (conn.type !== "http" || !home.server.health(conn)?.unauthorized)
      return ServerConnection.authenticate(conn, () => onConnected?.(conn))
    edit(conn, onConnected)

    return true
  }

  function directories(project: LocalProject) {
    return [project.worktree, ...(project.sandboxes ?? [])]
  }

  function choose(conn: ServerConnection.Any) {
    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => home.project.add(conn, homeProjectDirectories(result)),
    })
  }

  return {
    copy: {
      language,
    },
    selection: {
      value: home.selection.value,
    },
    server: {
      list: home.server.list,
      health: home.server.health,
      projects: home.project.forServer,
      collapsed: (conn: ServerConnection.Any) => state().collapsed[ServerConnection.key(conn)] ?? false,
      toggleCollapsed: (conn: ServerConnection.Any) => {
        const key = ServerConnection.key(conn)
        setState("collapsed", key, !state().collapsed[key])
      },
      canRemove: (conn: ServerConnection.Any) => serverManagement.connection.canRemove(ServerConnection.key(conn)),
      remove: (conn: ServerConnection.Any) => serverManagement.connection.remove(ServerConnection.key(conn)),
      canHide: (conn: ServerConnection.Any) => serverManagement.connection.canHide(ServerConnection.key(conn)),
      hide: (conn: ServerConnection.Any) => serverManagement.connection.setHidden(ServerConnection.key(conn), true),
      edit: (conn: ServerConnection.Http) => edit(conn),
      authenticate: (conn: ServerConnection.Any) => authenticate(conn),
      focus: (conn: ServerConnection.Any) => {
        if (authenticate(conn, (next) => home.selection.focusServer(next))) return
        home.selection.focusServer(conn)
      },
    },
    project: {
      list: home.project.list,
      recentlyClosed: home.project.recentlyClosed,
      homedir: home.project.homedir,
      select: (conn: ServerConnection.Any, directory: string) => {
        if (authenticate(conn, (next) => home.project.select(next, directory))) return
        home.project.select(conn, directory)
      },
      add: home.project.add,
      openNewSession: (conn: ServerConnection.Any, directory: string) => {
        if (authenticate(conn, (next) => home.project.openProjectNewSession(next, directory))) return
        home.project.openProjectNewSession(conn, directory)
      },
      canImportSession: !!platform.openAttachmentPickerDialog,
      importSession: (conn: ServerConnection.Any, project: LocalProject) => {
        if (!platform.openAttachmentPickerDialog) return
        void platform
          .openAttachmentPickerDialog(
            {
              title: language.t("command.session.import"),
              accept: ["application/json"],
              extensions: ["json"],
            },
            async (file) => {
              const data = await Schema.decodeUnknownPromise(
                Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)),
              )(await file.text())

              const api = home.server.context(conn).sdk.api.session

              // SAFETY: the import endpoint validates the transcript, including exports written by earlier releases.
              const imported = await api.import({
                ...data,
                location: { directory: project.worktree },
              } as Parameters<typeof api.import>[0])

              home.project.openProjectSession(conn, project.worktree, imported)
            },
          )
          .catch((cause: unknown) => {
            showToast({
              title: language.t("common.requestFailed"),
              description: errorMessage(cause, language.t("common.requestFailed")),
            })
          })
      },
      edit: (conn: ServerConnection.Any, project: LocalProject) => {
        settings.openProject({
          server: ServerConnection.key(conn),
          project: project.worktree,
        })
      },
      hasUnread: (conn: ServerConnection.Any, project: LocalProject) => {
        const notification = global.ensureServerCtx(conn).notification

        return directories(project).some((directory) => notification.project.hasUnread(directory))
      },
      clearNotifications: (conn: ServerConnection.Any, project: LocalProject) => {
        const notification = global.ensureServerCtx(conn).notification
        directories(project).forEach((directory) => notification.project.markViewed(directory))
      },
      choose: (conn: ServerConnection.Any) => {
        if (authenticate(conn, (next) => choose(next))) return

        if (home.server.health(conn)?.healthy === false) return
        choose(conn)
      },
      close: (conn: ServerConnection.Any, directory: string) => {
        const next = closeHomeProject(
          home.selection.value(),
          ServerConnection.key(conn),
          home.server.context(conn).projects,
          directory,
        )

        if (next) home.selection.set(next)
      },
      move: (conn: ServerConnection.Any, worktree: string, index: number) => {
        home.server.context(conn).projects.move(worktree, index)
      },
      canReveal: revealProject.available,
      reveal: revealProject.reveal,
      merge: (conn: ServerConnection.Any, project: LocalProject) => {
        const api = home.server.context(conn).sdk.api
        const rowDirectory = project.worktree

        const mergePreview = (projectID: string, directory: string) =>
          api.worktree.mergePreview({ projectID, directory }).then((preview) => {
            void dialog.show(() => (
              <Dialog fit>
                <DialogHeader hideClose>
                  <DialogTitleGroup
                    title={language.t("dialog.worktree.merge.title")}
                    description={
                      <div class="flex flex-col gap-2">
                        <div>{language.t("dialog.worktree.merge.description", { branch: preview.branch })}</div>
                        <div class="text-v2-text-text-faint">
                          {language.plural("dialog.worktree.merge.ahead", preview.ahead)}
                          <Show when={preview.behind > 0}>
                            {" · "}
                            {language.plural("dialog.worktree.merge.behind", preview.behind)}
                          </Show>
                        </div>
                        <Show when={preview.dirty}>
                          <div>{language.t("dialog.worktree.merge.dirty")}</div>
                        </Show>
                        <Show when={preview.sourceDirty}>
                          <div>{language.t("dialog.worktree.merge.sourceDirty")}</div>
                        </Show>
                      </div>
                    }
                  />
                </DialogHeader>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => dialog.close()}>
                    {language.t("common.cancel")}
                  </Button>
                  <Button
                    variant="contrast"
                    disabled={preview.sourceDirty}
                    onClick={() => {
                      dialog.close()
                      void api.worktree
                        .merge({ projectID, directory })
                        .then((result) => {
                          showToast({
                            title:
                              result.ahead === 0
                                ? language.t("home.worktree.merge.nothing")
                                : language.t("home.worktree.merge.done", { count: result.ahead }),
                          })
                        })
                        .catch((cause: unknown) =>
                          showToast({
                            variant: "error",
                            title: language.t("dialog.worktree.merge.failed"),
                            description: errorMessage(cause, language.t("dialog.worktree.merge.failed")),
                          }),
                        )
                    }}
                  >
                    {language.t("dialog.worktree.merge.action")}
                  </Button>
                </DialogFooter>
              </Dialog>
            ))
          })

        void api.location
          .get({ location: { directory: rowDirectory } })
          .then((info) => {
            // A worktree row merges itself; the main row falls back to its single managed
            // worktree, and otherwise the user is asked to act on the specific row instead of
            // the menu guessing which of several trees they meant.
            if (!sameDirectory(rowDirectory, info.project.canonical))
              return mergePreview(info.project.id, rowDirectory)
            return api.worktree.list({ projectID: info.project.id }).then((entries) => {
              const managed = entries.filter(
                (entry) => entry.strategy !== undefined && !sameDirectory(entry.directory, info.project.canonical),
              )
              if (managed.length !== 1) {
                showToast({ title: language.t("home.worktree.merge.noneAvailable") })
                return
              }
              return mergePreview(info.project.id, managed[0].directory)
            })
          })
          .catch((cause: unknown) =>
            showToast({
              variant: "error",
              title: language.t("dialog.worktree.merge.failed"),
              description: errorMessage(cause, language.t("dialog.worktree.merge.failed")),
            }),
          )
      },
    },
    utility: {
      settings: openSettings,
      help: () => platform.openExternal("https://opencode.ai/desktop-feedback"),
    },
  }
}

export type HomeProjectsController = ReturnType<typeof createHomeProjectsController>
