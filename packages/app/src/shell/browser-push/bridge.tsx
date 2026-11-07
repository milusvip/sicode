import { createEffect, onCleanup } from "solid-js"
import type { Comments, Composer, Files, LineRange, SessionScreen } from "@opencode/gui-extensions/sdk"
import { useComments } from "@/composer/comments"
import { useComposerState } from "@/composer/persistence"
import { useFile } from "@/workspaces/files/model"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useExtensionAttachment } from "@/runtime/extension/host-apis"

/**
 * Publishes the draft (new-session) composer as a SessionScreen so browser-bridge push
 * can attach chips before the first message creates a real session. Mount inside
 * `ComposerPersistenceProvider`, `FileProvider`, and `CommentsProvider` on the draft route
 * only — session screens already publish their own via `createMountedSession`.
 */
export function DraftSessionScreenBridge() {
  const file = useFile()
  const comments = useComments()
  const composer = useComposerState()
  const location = useWorkspaceLocation()
  const attachment = useExtensionAttachment()

  const files: Files = {
    get root() {
      return location().directory
    },
    ready: file.ready,
    resolve: file.normalize,
    absolute: file.absolute,
    get: file.get,
    missing: file.notFound,
    sync: (path, options) => file.load(path, options),
    exists: file.exists,
    search: (query, options) =>
      options?.kind === "any" ? file.searchFilesAndDirectories(query, options) : file.searchFiles(query, options),
    selection: {
      // SAFETY: the file model returns the view cache's selection for the path, which its schema types as a line range.
      get: (path) => file.selectedLines(path) as LineRange | null | undefined,
      set: (path, range) => void file.setSelectedLines(path, range),
    },
    scroll: {
      get: (path) => ({
        // SAFETY: the file model returns the view cache's offsets for the path, which its schema types as numbers.
        top: file.scrollTop(path) as number | undefined,
        // SAFETY: as above.
        left: file.scrollLeft(path) as number | undefined,
      }),
      set(path, value) {
        if (value.top !== undefined) file.setScrollTop(path, value.top)

        if (value.left !== undefined) file.setScrollLeft(path, value.left)
      },
    },
    tree: {
      list: file.tree.children,
      state: file.tree.state,
      sync: (path, options) => (options?.force ? file.tree.refresh(path) : file.tree.list(path)),
      expand: (path, options) => void file.tree.expand(path, options),
      collapse: (path) => void file.tree.collapse(path),
    },
  }

  const commentFile = (id: string) => comments.all().find((item) => item.id === id)?.file

  const comment: Comments = {
    list: (path) => (path ? comments.list(path) : comments.all()),
    add: comments.add,
    update(id, text) {
      const path = commentFile(id)

      if (path) comments.update(path, id, text)
    },
    remove(id) {
      const path = commentFile(id)

      if (path) comments.remove(path, id)
    },
    focus: { current: comments.focus, set: (value) => void comments.setFocus(value) },
    active: { current: comments.active, set: (value) => void comments.setActive(value) },
  }

  const composerRef: Composer = {
    attach: (part) => composer.context.add(part),
    update: (id, patch) => composer.context.updateComment(id, patch),
    detach: (id) => composer.context.removeComment(id),
  }

  const screen: SessionScreen = Object.freeze({
    file: files,
    comment,
    composer: composerRef,
  })

  createEffect(() => onCleanup(attachment.screen(screen)))

  return null
}
