import { Show } from "solid-js"
import { sameDirectory } from "@opencode/util/path"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import type { ServerApi } from "@/runtime/server/api"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"

/**
 * Merging an isolated worktree back into its main checkout: resolve the directory to a project,
 * preview, then merge on confirm. A worktree row merges itself; the main row falls back to its
 * single managed worktree, and otherwise the user is asked to act on the specific row instead of
 * the menu guessing which of several trees they meant.
 */
export function mergeWorktree(input: {
  api: ServerApi
  directory: string
  language: ReturnType<typeof useLanguage>
  dialog: ReturnType<typeof useDialog>
}) {
  const { api, language, dialog } = input

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
    .get({ location: { directory: input.directory } })
    .then((info) => {
      if (!sameDirectory(input.directory, info.project.canonical))
        return mergePreview(info.project.id, input.directory)
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
}
