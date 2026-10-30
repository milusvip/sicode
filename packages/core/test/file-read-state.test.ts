import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Environment } from "@opencode/core/environment/index"
import { FileReadState } from "@opencode/core/file-read-state"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { AbsolutePath } from "@opencode/core/schema"
import { type EnvironmentFilesTransform, transformEnvironmentFiles } from "./fixture/environment"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { permissionLayer } from "./lib/permission"

function provide(directory: string, transformFiles: EnvironmentFilesTransform = () => ({})) {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  return Effect.provide(
    AppNodeBuilder.build(LayerNode.group([Environment.node]), [
      Location.node.replace(activeLocation),
      Permission.node.replace(permissionLayer()),
      Environment.node.replace(transformEnvironmentFiles(transformFiles)),
    ]),
  )
}

// A mtime strictly in the future of the snapshot: two writes can land inside one clock tick, so
// the tests move time explicitly instead of relying on the wall clock to differ.
const bump = (file: string) => Effect.promise(() => fs.utimes(file, new Date(), new Date(Date.now() + 5_000)))

describe("FileReadState", () => {
  it.live("reports undefined for a file the session never recorded", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const files = (yield* Environment.Service).files
        const file = path.join(directory, "unknown.txt")
        yield* Effect.promise(() => fs.writeFile(file, "x"))
        expect(yield* FileReadState.changedSince("ses_a", file, files)).toBeUndefined()
      }).pipe(provide(directory)),
    ),
  )

  it.live("reports false while the file is untouched and true once it moves", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const files = (yield* Environment.Service).files
        const file = path.join(directory, "watched.txt")
        yield* Effect.promise(() => fs.writeFile(file, "before"))
        const info = yield* files.stat(file)
        FileReadState.record("ses_a", file, { mtimeMs: info.mtimeMs, hash: FileReadState.hashText("before") })
        expect(yield* FileReadState.changedSince("ses_a", file, files)).toBe(false)
        yield* Effect.promise(() => fs.writeFile(file, "after"))
        yield* bump(file)
        expect(yield* FileReadState.changedSince("ses_a", file, files)).toBe(true)
      }).pipe(provide(directory)),
    ),
  )

  it.live("keeps snapshots per session", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const files = (yield* Environment.Service).files
        const file = path.join(directory, "shared.txt")
        yield* Effect.promise(() => fs.writeFile(file, "x"))
        const info = yield* files.stat(file)
        FileReadState.record("ses_a", file, { mtimeMs: info.mtimeMs })
        expect(yield* FileReadState.changedSince("ses_b", file, files)).toBeUndefined()
      }).pipe(provide(directory)),
    ),
  )

  it.live("track refreshes the snapshot so the session's own change is not stale", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const files = (yield* Environment.Service).files
        const file = path.join(directory, "mine.txt")
        yield* Effect.promise(() => fs.writeFile(file, "old"))
        const info = yield* files.stat(file)
        FileReadState.record("ses_a", file, { mtimeMs: info.mtimeMs, hash: FileReadState.hashText("old") })
        yield* Effect.promise(() => fs.writeFile(file, "new"))
        yield* bump(file)
        expect(yield* FileReadState.changedSince("ses_a", file, files)).toBe(true)
        yield* FileReadState.track("ses_a", file, files, "new")
        expect(yield* FileReadState.changedSince("ses_a", file, files)).toBe(false)
      }).pipe(provide(directory)),
    ),
  )
})
