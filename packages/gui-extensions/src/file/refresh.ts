import type { Files } from "../sdk"

/**
 * Lists again every directory the tree has already loaded, so its rows match the workspace again. Resolves once
 * every listing has answered, which is what lets a caller show that the refresh is running.
 *
 * Nothing else does it: the tree keeps a directory's rows from the one time it listed them, and the server watches
 * only the git head, so no event arrives for a file that appears or disappears in the workspace. The walk follows the
 * loaded rows only, so it costs one listing per directory the user has already opened.
 */
export async function refreshFileTree(file: Pick<Files, "tree">) {
  const listings: Promise<void>[] = []

  const visit = (dir: string) => {
    if (!file.tree.state(dir)?.loaded) return

    listings.push(file.tree.sync(dir, { force: true }).catch(() => undefined))

    for (const node of file.tree.list(dir)) if (node.type === "directory") visit(node.path)
  }

  visit("")

  await Promise.all(listings)
}
