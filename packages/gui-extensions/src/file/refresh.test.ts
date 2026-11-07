import { describe, expect, test } from "bun:test"
import type { FileNode } from "../sdk"
import { refreshFileTree } from "./refresh"

type Dir = { expanded: boolean; loaded?: boolean }

function fakeFiles(
  dirs: Record<string, Dir>,
  nodes: Record<string, FileNode[]>,
  waits: Record<string, Promise<void>> = {},
) {
  const forced: string[] = []
  const files: string[] = []

  return {
    forced,
    files,
    resolve: (input: string) => {
      const stripped = input.startsWith("file://") ? input.slice("file://".length) : input
      return decodeURIComponent(stripped)
    },
    tree: {
      state: (path: string) => dirs[path],
      list: (path: string) => nodes[path] ?? [],
      sync: (path: string, options?: { force?: boolean }) => {
        if (options?.force) forced.push(path)

        return waits[path] ?? Promise.resolve()
      },
      expand: () => {},
      collapse: () => {},
    },
    sync: (path: string, options?: { force?: boolean }) => {
      if (options?.force) files.push(path)

      return Promise.resolve()
    },
  }
}

const dir = (path: string): FileNode => ({ name: path, path, absolute: `/repo/${path}`, type: "directory", ignored: false })

describe("refreshFileTree", () => {
  test("lists again each directory the tree has loaded", async () => {
    const file = fakeFiles(
      {
        "": { expanded: true, loaded: true },
        docs: { expanded: true, loaded: true },
        src: { expanded: false, loaded: true },
        "src/lib": { expanded: true, loaded: true },
        vendor: { expanded: true },
      },
      { "": [dir("docs"), dir("src"), dir("vendor")], docs: [], src: [dir("src/lib")], "src/lib": [] },
    )

    await refreshFileTree(file)

    // A collapsed directory keeps its rows for the moment it opens again, so it lists again too. `vendor` never
    // listed, so nothing there is stale and its listing belongs to the expand that asks for it.
    expect(file.forced).toEqual(["", "docs", "src", "src/lib"])
  })

  test("does nothing until the root has listed", async () => {
    const file = fakeFiles({ "": { expanded: true }, docs: { expanded: true, loaded: true } }, {})

    await refreshFileTree(file)

    expect(file.forced).toEqual([])
  })

  test("force-reloads open file tabs by tab id", async () => {
    const file = fakeFiles({ "": { expanded: true, loaded: true } }, { "": [] })

    await refreshFileTree(file, ["//src/a.ts", "open", "//docs/readme.md"])

    expect(file.forced).toEqual([""])
    expect(file.files).toEqual(["src/a.ts", "docs/readme.md"])
  })

  test("resolves only once every listing has answered", async () => {
    let answer = () => {}
    const pending = new Promise<void>((resolve) => {
      answer = resolve
    })
    const file = fakeFiles(
      { "": { expanded: true, loaded: true }, docs: { expanded: true, loaded: true } },
      { "": [dir("docs")], docs: [] },
      { docs: pending },
    )

    let settled = false
    const refreshing = refreshFileTree(file).then(() => {
      settled = true
    })

    await Promise.resolve()

    expect(file.forced).toEqual(["", "docs"])
    expect(settled).toBe(false)

    answer()
    await refreshing

    expect(settled).toBe(true)
  })
})
