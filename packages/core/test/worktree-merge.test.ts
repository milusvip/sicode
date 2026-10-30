import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Context, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AbsolutePath } from "@opencode/core/schema"
import { Git } from "@opencode/core/git"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { Worktree } from "@opencode/core/worktree"
import { WorktreeStrategies } from "@opencode/core/worktree/strategies"
import { WorktreeTable } from "@opencode/core/worktree/sql"
import { Location } from "@opencode/core/location"
import { Global } from "@opencode/util/global"
import { FSUtil } from "@opencode/util/fs-util"
import { Config } from "@opencode/core/config"
import { tmpdir } from "./fixture/tmpdir"
import { initRepo } from "./fixture/git"
import { testEffect } from "./lib/effect"

class Fixture extends Context.Service<Fixture, Effect.Success<ReturnType<typeof makeFixture>>>()(
  "WorktreeMergeFixture",
) {}

const infrastructure = AppNodeBuilder.build(LayerNode.group([Project.node, Database.node, Bus.node]))
const it = testEffect(
  Layer.unwrap(
    Effect.gen(function* () {
      const input = yield* makeFixture()
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      return Layer.mergeAll(
        Layer.succeed(Fixture, input),
        Config.testLayer(),
        worktreeLayer(input.sourceDirectory, input.projectID, database, bus, input.root.path),
      )
    }),
  ).pipe(Layer.provideMerge(infrastructure)),
)

function worktreeLayer(
  directory: AbsolutePath,
  projectID: Project.ID,
  database: Database.Interface,
  bus: Bus.Interface,
  data: string,
) {
  return AppNodeBuilder.build(
    LayerNode.group([Worktree.node, WorktreeStrategies.node, Git.node, FSUtil.node, Location.node, Global.node]),
    [
      Database.node.replace(Layer.succeed(Database.Service, database)),
      Bus.node.replace(Layer.succeed(Bus.Service, bus)),
      Global.node.replace(Global.layerWith({ data })),
      Location.node.replace(
        Layer.succeed(
          Location.Service,
          Location.Service.of({
            directory,
            workspaceID: undefined,
            project: { id: projectID, directory, canonical: directory },
          }),
        ),
      ),
    ],
  ).pipe(Layer.fresh)
}

function abs(input: string) {
  return AbsolutePath.make(input)
}

function makeFixture() {
  return Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    )
    yield* Effect.promise(() => initRepo(root.path))
    const sourceDirectory = abs(yield* Effect.promise(() => fs.realpath(root.path)))
    const projectID = Project.ID.make("worktree-merge-project")
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: projectID, worktree: sourceDirectory, sandboxes: [], time_created: 1, time_updated: 1 })
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(WorktreeTable)
      .values({ project_id: projectID, directory: sourceDirectory })
      .run()
      .pipe(Effect.orDie)
    return { root, sourceDirectory, projectID, db }
  })
}

const setup = Effect.fnUntraced(function* () {
  return yield* Fixture
})

// Worktrees land in their own temp parent: the fixture's global data doubles as the repo root,
// and a worktree inside the repo would show up as untracked noise in every status assertion.
const createWorktree = Effect.fnUntraced(function* (projectID: Project.ID, source: AbsolutePath) {
  const parent = yield* Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
  )
  yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(parent.path, { recursive: true, force: true })))
  const service = yield* Worktree.Service
  const strategies = yield* WorktreeStrategies.Service
  return yield* service.create({ projectID, from: source, directory: abs(parent.path) }, strategies)
})

const git = async (cwd: string, ...args: string[]) => {
  const result = await $`git ${args}`.cwd(cwd).quiet()
  return result.stdout.toString()
}

describe("Worktree merge", () => {
  it.live("snapshots uncommitted worktree changes and merges them into the source", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const created = yield* createWorktree(input.projectID, input.sourceDirectory)
      // The default worktree is detached: the merge must survive that.
      yield* Effect.promise(() => fs.writeFile(path.join(created.directory, "feature.txt"), "from worktree"))
      const result = yield* Worktree.Service.use((service) =>
        service.merge({ projectID: input.projectID, directory: created.directory }),
      )
      expect(result.ahead).toBe(1)
      expect(result.committed).toBeDefined()
      const landed = yield* Effect.promise(() => fs.readFile(path.join(input.sourceDirectory, "feature.txt"), "utf8"))
      expect(landed).toBe("from worktree")
      const status = yield* Effect.promise(() => git(input.sourceDirectory, "status", "--porcelain"))
      expect(status.trim()).toBe("")
    }),
  )

  it.live("merges committed worktree work", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const created = yield* createWorktree(input.projectID, input.sourceDirectory)
      yield* Effect.promise(() => fs.writeFile(path.join(created.directory, "committed.txt"), "done"))
      yield* Effect.promise(() => git(created.directory, "add", "-A"))
      yield* Effect.promise(() => git(created.directory, "commit", "-m", "worktree work"))
      const result = yield* Worktree.Service.use((service) =>
        service.merge({ projectID: input.projectID, directory: created.directory }),
      )
      expect(result.committed).toBeUndefined()
      expect(result.ahead).toBe(1)
      const landed = yield* Effect.promise(() =>
        fs.readFile(path.join(input.sourceDirectory, "committed.txt"), "utf8"),
      )
      expect(landed).toBe("done")
    }),
  )

  it.live("refuses when the source checkout is dirty", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      // The blocker must be a tracked change: untracked files do not make a merge unsafe.
      yield* Effect.promise(() => fs.writeFile(path.join(input.sourceDirectory, "tracked.txt"), "base"))
      yield* Effect.promise(() => git(input.sourceDirectory, "add", "-A"))
      yield* Effect.promise(() => git(input.sourceDirectory, "commit", "-m", "tracked"))
      const created = yield* createWorktree(input.projectID, input.sourceDirectory)
      yield* Effect.promise(() => fs.writeFile(path.join(created.directory, "kept.txt"), "worktree"))
      yield* Effect.promise(() => fs.writeFile(path.join(input.sourceDirectory, "tracked.txt"), "uncommitted"))
      const error = yield* Worktree.Service.use((service) =>
        service.merge({ projectID: input.projectID, directory: created.directory }),
      ).pipe(Effect.flip)
      expect(error).toBeInstanceOf(Worktree.MergeDirtyError)
      // The refused merge must not have moved anything in the source.
      const status = yield* Effect.promise(() => git(input.sourceDirectory, "status", "--porcelain"))
      expect(status).toContain("tracked.txt")
      const exists = yield* Effect.promise(() =>
        fs.stat(path.join(input.sourceDirectory, "kept.txt")).then(
          () => true,
          () => false,
        ),
      )
      expect(exists).toBe(false)
    }),
  )

  it.live("aborts a conflicted merge and leaves both checkouts untouched", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      // A shared file must exist on both sides before the fork point, or nothing conflicts.
      yield* Effect.promise(() => fs.writeFile(path.join(input.sourceDirectory, "README.md"), "base"))
      yield* Effect.promise(() => git(input.sourceDirectory, "add", "-A"))
      yield* Effect.promise(() => git(input.sourceDirectory, "commit", "-m", "base"))
      const created = yield* createWorktree(input.projectID, input.sourceDirectory)
      yield* Effect.promise(() => fs.writeFile(path.join(created.directory, "README.md"), "worktree version"))
      yield* Effect.promise(() => git(created.directory, "add", "-A"))
      yield* Effect.promise(() => git(created.directory, "commit", "-m", "worktree side"))
      yield* Effect.promise(() => fs.writeFile(path.join(input.sourceDirectory, "README.md"), "source version"))
      yield* Effect.promise(() => git(input.sourceDirectory, "add", "-A"))
      yield* Effect.promise(() => git(input.sourceDirectory, "commit", "-m", "source side"))
      const head = (yield* Effect.promise(() => git(input.sourceDirectory, "rev-parse", "HEAD"))).trim()
      const error = yield* Worktree.Service.use((service) =>
        service.merge({ projectID: input.projectID, directory: created.directory }),
      ).pipe(Effect.flip)
      expect(error).toBeInstanceOf(Worktree.MergeConflictError)
      expect((error as Worktree.MergeConflictError).files).toContain("README.md")
      // Backed out: the source HEAD and its content are exactly what they were.
      const after = (yield* Effect.promise(() => git(input.sourceDirectory, "rev-parse", "HEAD"))).trim()
      expect(after).toBe(head)
      const content = yield* Effect.promise(() =>
        fs.readFile(path.join(input.sourceDirectory, "README.md"), "utf8"),
      )
      expect(content).toBe("source version")
      const status = yield* Effect.promise(() => git(input.sourceDirectory, "status", "--porcelain"))
      expect(status.trim()).toBe("")
    }),
  )

  it.live("is a no-op when the worktree has nothing to give", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const created = yield* createWorktree(input.projectID, input.sourceDirectory)
      const head = (yield* Effect.promise(() => git(input.sourceDirectory, "rev-parse", "HEAD"))).trim()
      const result = yield* Worktree.Service.use((service) =>
        service.merge({ projectID: input.projectID, directory: created.directory }),
      )
      expect(result.ahead).toBe(0)
      expect(result.committed).toBeUndefined()
      expect(result.mergeCommit).toBe(head)
    }),
  )

  it.live("preview reports counts and dirty flags without touching either tree", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const created = yield* createWorktree(input.projectID, input.sourceDirectory)
      yield* Effect.promise(() => fs.writeFile(path.join(created.directory, "pending.txt"), "not committed"))
      const preview = yield* Worktree.Service.use((service) =>
        service.mergePreview({ projectID: input.projectID, directory: created.directory }),
      )
      expect(preview.dirty).toBe(true)
      expect(preview.sourceDirty).toBe(false)
      expect(preview.ahead).toBe(0)
      expect(preview.behind).toBe(0)
      expect(preview.branch).toContain("detached")
      const exists = yield* Effect.promise(() =>
        fs.stat(path.join(input.sourceDirectory, "pending.txt")).then(
          () => true,
          () => false,
        ),
      )
      expect(exists).toBe(false)
    }),
  )
})
