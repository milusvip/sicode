import type { Files } from "../sdk"
import { fileTabPath, isFileTab } from "./path"

/**
 * Lists again every directory the tree has already loaded, so its rows match the workspace again. Resolves once
 * every listing has answered, which is what lets a caller show that the refresh is running.
 *
 * Nothing else does it: the tree keeps a directory's rows from the one time it listed them, and the server watches
 * only the git head, so no event arrives for a file that appears or disappears in the workspace. The walk follows the
 * loaded rows only, so it costs one listing per directory the user has already opened.
 *
 * SiCode: also force-reloads open file tabs (content), so an idle refresh after agent edits is not tree-only.
 * Realtime edits still arrive via filesystem.changed from FileMutation; this is the idle/mount backstop.
 */
export async function refreshFileTree(
  file: Pick<Files, "tree" | "sync" | "resolve">,
  openTabIds: readonly string[] = [],
) {
  const listings: Promise<void>[] = []

  const visit = (dir: string) => {
    if (!file.tree.state(dir)?.loaded) return

    listings.push(file.tree.sync(dir, { force: true }).catch(() => undefined))

    for (const node of file.tree.list(dir)) if (node.type === "directory") visit(node.path)
  }

  visit("")

  for (const id of openTabIds) {
    if (!isFileTab(id)) continue
    listings.push(file.sync(fileTabPath(file, id), { force: true, silent: true }).catch(() => undefined))
  }

  await Promise.all(listings)
}
