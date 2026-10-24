import { $ } from "bun"
import path from "path"
import { Layer } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppProcess } from "@opencode/util/process"
import { FSUtil } from "@opencode/util/fs-util"
import { Bus } from "@opencode/core/bus"
import { Git } from "@opencode/core/git"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { VcsGitPlugin } from "@opencode/core/plugin/vcs/git"
import { initGit } from "../fixture/git"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { host } from "../plugin/host"

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { InstructionBuiltIns } from "@opencode/core/instructions/builtins"
import { Vcs } from "@opencode/core/vcs"
import { readInitial, readUpdate } from "../lib/instructions"

const file = (value: string, status: Vcs.FileStatus["status"], additions = 0, deletions = 0): Vcs.FileStatus => ({
  file: value,
  status,
  additions,
  deletions,
})

const run = (files: readonly Vcs.FileStatus[] | null) =>
  Effect.runPromise(readInitial(InstructionBuiltIns.gitStatusSource(() => Effect.succeed(files))))

describe("git status instruction", () => {
  test("a clean tree renders nothing at all", async () => {
    expect((await run([])).text).toBe("")
  })

  test("a non-git directory renders nothing at all", async () => {
    expect((await run(null)).text).toBe("")
  })

  test("dirty files render as prefixed rows with line counts", async () => {
    const { text } = await run([file("packages/app/a.tsx", "modified", 12, 3), file("packages/core/b.ts", "added", 40, 0)])
    expect(text).toBe(
      [
        "The following is the git status at the start of the conversation. It is a snapshot and does not update as the conversation goes; run `git status` yourself if you need the current state.",
        "Do not revert or discard changes you did not make. Check `git diff` before undoing any edit you are unsure about.",
        "",
        "<git_status>",
        "  M packages/app/a.tsx (+12 -3)",
        "  A packages/core/b.ts (+40 -0)",
        "</git_status>",
      ].join("\n"),
    )
  })

  test("a file with no line changes omits the count suffix", async () => {
    const { text } = await run([file("docs/x.md", "deleted")])
    expect(text).toContain("  D docs/x.md\n")
    expect(text).not.toContain("(+0 -0)")
  })

  test("the list collapses past the cap and says how many were dropped", () => {
    const files = Array.from({ length: 205 }, (_, index) => file(`f${index}.ts`, "modified", 1, 0))
    const rendered = InstructionBuiltIns.renderGitStatus(files)
    expect(rendered).toContain("  M f199.ts")
    expect(rendered).not.toContain("  M f200.ts")
    expect(rendered).toContain("  ...and 5 more files")
  })

  test("a failing VCS read degrades to nothing instead of breaking the prompt", async () => {
    const instructions = InstructionBuiltIns.gitStatusSource(() => Effect.fail("boom") as never)
    const { text } = await Effect.runPromise(readInitial(instructions))
    expect(text).toBe("")
  })

  test("edits after the snapshot re-render the current state", async () => {
    const instructions = InstructionBuiltIns.gitStatusSource(() => Effect.succeed([file("a.ts", "modified", 1, 1)]))
    const initialized = await Effect.runPromise(readInitial(instructions))

    const later = InstructionBuiltIns.gitStatusSource(() =>
      Effect.succeed([file("a.ts", "modified", 2, 1), file("b.ts", "added", 5, 0)]),
    )
    const { text, changed } = await Effect.runPromise(readUpdate(later, initialized))

    expect(changed).toBe(true)
    expect(text).toContain("The working tree has changed since the status above. Current state:")
    expect(text).toContain("  A b.ts (+5 -0)")
  })

  test("an unchanged status re-sends nothing", async () => {
    const status = () => Effect.succeed([file("a.ts", "modified", 1, 1)])
    const instructions = InstructionBuiltIns.gitStatusSource(status)
    const initialized = await Effect.runPromise(readInitial(instructions))
    const { changed } = await Effect.runPromise(readUpdate(instructions, initialized))
    expect(changed).toBe(false)
  })
})

// --- End-to-end: a real git repo, the real Vcs service, the real instruction ---

const withGitRepo = <A, E>(body: (directory: string, status: () => Effect.Effect<readonly Vcs.FileStatus[]>) => Effect.Effect<A, E>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir("sicode-git-status-")),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap((tmp) =>
      Effect.promise(async () => {
        await initGit(tmp.path, "-b", "main")
        await Bun.write(path.join(tmp.path, "tracked.ts"), "export const a = 1\n")
        await $`git add -A`.cwd(tmp.path).quiet()
        await $`git commit -m init`.cwd(tmp.path).quiet()
      }).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            const vcs = yield* Vcs.Service
            const context = host()
            yield* VcsGitPlugin.Plugin.effect({
              ...context,
              vcs: { ...context.vcs, transform: vcs.transform, reload: vcs.reload },
            })
            return yield* body(tmp.path, () => vcs.status())
          }).pipe(
            Effect.provide(
              LayerNode.compile(
                LayerNode.group([Vcs.node, Bus.node, Location.node, AppProcess.node, FSUtil.node, Git.node]),
                {
                  replacements: [
                    Location.node.replace(
                      Layer.succeed(
                        Location.Service,
                        Location.Service.of(
                          location(
                            { directory: AbsolutePath.make(tmp.path) },
                            {
                              projectDirectory: AbsolutePath.make(tmp.path),
                              vcs: { type: "git", store: AbsolutePath.make(path.join(tmp.path, ".git")) },
                            },
                          ),
                        ),
                      ),
                    ),
                  ],
                },
              ),
            ),
          ),
        ),
      ),
    ),
  )

describe("git status instruction over a real repository", () => {
  test(
    "a clean repo injects nothing, and an edited file shows up as modified",
    async () => {
      const { clean, dirty } = await Effect.runPromise(
        withGitRepo((directory, status) =>
          Effect.gen(function* () {
            const clean = yield* readInitial(InstructionBuiltIns.gitStatusSource(status))
            yield* Effect.promise(() => Bun.write(path.join(directory, "tracked.ts"), "export const a = 2\n"))
            const dirty = yield* readInitial(InstructionBuiltIns.gitStatusSource(status))
            return { clean, dirty }
          }),
        ).pipe(Effect.scoped),
      )

      expect(clean.text).toBe("")
      expect(dirty.text).toContain("<git_status>")
      expect(dirty.text).toContain("  M tracked.ts")
    },
    30_000,
  )
})
