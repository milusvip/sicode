import { describe, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Environment } from "@opencode/core/environment/index"
import { FileSystem } from "@opencode/core/filesystem"
import { Location } from "@opencode/core/location"
import { FileAccess } from "@opencode/core/file-access"
import { Permission } from "@opencode/core/permission"
import { Ripgrep } from "@opencode/core/ripgrep"
import { Global } from "@opencode/util/global"
import { TrigramSearch } from "@opencode/core/filesystem/trigram-search"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { GlobTool } from "@opencode/core/tool/plugin/glob"
import { GrepTool } from "@opencode/core/tool/plugin/grep"
import { Tool } from "@opencode/core/tool"
import { ToolOutput } from "@opencode/core/tool-output"
import { location } from "./fixture/location"
import { tmpdir, tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const globToolNode = makeLocationNode({
  name: "test/glob-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(GlobTool.Plugin)),
  deps: [Tool.node, Environment.node, Ripgrep.node, Location.node, FileAccess.node, Permission.node],
})
const grepToolNode = makeLocationNode({
  name: "test/grep-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(GrepTool.Plugin)),
  deps: [
    Tool.node,
    Environment.node,
    Ripgrep.node,
    Location.node,
    FileAccess.node,
    Permission.node,
    TrigramSearch.node,
    ToolOutput.node,
  ],
})
const sessionID = Session.ID.make("ses_search_tool_test")

const withTools = <A, E, R>(
  directory: string,
  body: (registry: Tool.Interface) => Effect.Effect<A, E, R>,
  assertions?: Permission.AssertInput[],
) =>
  Effect.gen(function* () {
    const registry = yield* Tool.Service
    return yield* body(registry)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([Tool.node, globToolNode, grepToolNode]), [
        Location.node.replace(
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ),
        Permission.node.replace(
          permissionLayer({
            assert: (input) =>
              Effect.sync(() => {
                assertions?.push(input)
              }),
          }),
        ),
      ]),
    ),
  )

const call = (name: "glob" | "grep", input: unknown) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id: `call-${name}`, name, input },
})

describe("search tools", () => {
  for (const hidden of [undefined, false, true]) {
    for (const limit of hidden ? [10] : [1, 10]) {
      it.live(`glob honors hidden=${hidden} before limit=${limit}`, () =>
        Effect.gen(function* () {
          const tmp = yield* tmpdirScoped()
          yield* Effect.promise(() =>
            Promise.all(
              ["src/visible.ts", ".hidden.ts", "src/.hidden.ts", ".hidden/nested.ts", ".git/config.ts"].map((file) =>
                Bun.write(path.join(tmp.path, file), "needle\n"),
              ),
            ),
          )
          yield* withTools(tmp.path, (registry) =>
            Effect.gen(function* () {
              const result = yield* executeTool(
                registry,
                call("glob", { pattern: "**/*.ts", limit, ...(hidden === undefined ? {} : { hidden }) }),
              )
              const expected = hidden
                ? [".hidden.ts", ".hidden/nested.ts", "src/.hidden.ts", "src/visible.ts"]
                : ["src/visible.ts"]

              expect(result.status).toBe("completed")
              expect(result.output).toHaveLength(expected.length)
              expect(result.output).toEqual(
                expect.arrayContaining(expected.map((file) => ({ path: path.normalize(file), type: "file" }))),
              )
              expect(result.metadata).toEqual({ count: expected.length, truncated: false, timedOut: false })
              expect(result.content).toHaveLength(1)
              expect(result.content?.[0]?.type === "text" ? result.content[0].text.split("\n").sort() : []).toEqual(
                expected.map((file) => path.join(tmp.path, file)).sort(),
              )
            }),
          )
        }),
      )
    }
  }

  it.live("bounds omitted glob and grep limits", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all(
              Array.from({ length: FileSystem.DEFAULT_SEARCH_LIMIT + 1 }, (_, index) =>
                fs.writeFile(path.join(tmp.path, `${index}.txt`), "needle\n"),
              ),
            ),
          )
          yield* withTools(tmp.path, (registry) =>
            Effect.gen(function* () {
              const glob = yield* executeTool(registry, call("glob", { pattern: "*" }))
              const grep = yield* executeTool(registry, call("grep", { pattern: "needle" }))

              expect(glob.metadata).toEqual({ count: FileSystem.DEFAULT_SEARCH_LIMIT, truncated: true, timedOut: false })
              expect(grep.metadata).toEqual({
                matches: FileSystem.DEFAULT_SEARCH_LIMIT,
                truncated: true,
                timedOut: false,
                mode: "content",
                prefiltered: false,
              })
              expect(glob.content).toHaveLength(1)
              expect(grep.content).toHaveLength(1)
              const globText = glob.content?.[0]?.type === "text" ? glob.content[0].text : ""
              const grepText = grep.content?.[0]?.type === "text" ? grep.content[0].text : ""
              expect(globText.split("\n")).toHaveLength(FileSystem.DEFAULT_SEARCH_LIMIT + 2)
              expect(globText).toEndWith(
                `(Results are truncated: showing first ${FileSystem.DEFAULT_SEARCH_LIMIT} results. Consider using a more specific path or pattern.)`,
              )
              expect(grepText).toStartWith(`Found at least ${FileSystem.DEFAULT_SEARCH_LIMIT} matches in `)
              expect(grepText).toContain(
                `showing 1-${FileSystem.DEFAULT_SEARCH_LIMIT} of at least ${FileSystem.DEFAULT_SEARCH_LIMIT + 1}`,
              )
            }),
          )
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("rejects an empty grep pattern", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        withTools(tmp.path, (registry) =>
          Effect.gen(function* () {
            expect(yield* executeTool(registry, call("grep", { pattern: "" }))).toEqual({
              status: "error",
              error: {
                type: "tool.execution",
                message:
                  'Invalid arguments for tool "grep":\n- pattern: Pattern must not be empty\n\nArguments provided:\n{\n  "pattern": ""\n}\n\nUpdate the arguments and call the tool again.',
              },
            })
          }),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("handles explicit grep file and directory paths", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.promise(() =>
          Promise.all([
            fs.writeFile(path.join(tmp.path, "target.txt"), "needle\n"),
            fs.writeFile(path.join(tmp.path, "other.txt"), "needle\n"),
          ]),
        ).pipe(
          Effect.andThen(
            withTools(tmp.path, (registry) =>
              Effect.gen(function* () {
                const file = yield* executeTool(registry, call("grep", { path: "target.txt", pattern: "needle" }))
                expect(file).toMatchObject({
                  status: "completed",
                  output: [{ entry: { path: "target.txt" }, line: 1, text: "needle\n" }],
                  metadata: { matches: 1, truncated: false, mode: "content" },
                })

                const directory = yield* executeTool(registry, call("grep", { path: ".", pattern: "needle" }))
                expect(directory).toMatchObject({
                  status: "completed",
                  metadata: { matches: 2, truncated: false, mode: "content" },
                })
                if (directory.status !== "completed") return
                expect(directory.output).toEqual(
                  expect.arrayContaining([
                    expect.objectContaining({ entry: expect.objectContaining({ path: "target.txt" }) }),
                    expect.objectContaining({ entry: expect.objectContaining({ path: "other.txt" }) }),
                  ]),
                )
              }),
            ),
          ),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("reports no grep matches", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.promise(() => fs.writeFile(path.join(tmp.path, "file.txt"), "haystack\n")).pipe(
          Effect.andThen(withTools(tmp.path, (registry) => executeTool(registry, call("grep", { pattern: "needle" })))),
          Effect.tap((result) =>
            Effect.sync(() => {
              expect(result).toMatchObject({
                status: "completed",
                content: [{ type: "text", text: "No matches found" }],
                metadata: { matches: 0, truncated: false, mode: "content" },
              })
            }),
          ),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("includes context lines around each match", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.promise(() =>
          fs.writeFile(path.join(tmp.path, "sample.ts"), "alpha\nbeta\nneedle\ndelta\nepsilon\n"),
        ).pipe(
          Effect.andThen(
            withTools(tmp.path, (registry) => executeTool(registry, call("grep", { pattern: "needle", context: 1 }))),
          ),
          Effect.tap((result) =>
            Effect.sync(() => {
              expect(result.status).toBe("completed")
              if (result.status !== "completed") return
              const text = result.content?.[0]?.type === "text" ? result.content[0].text : ""
              expect(text).toContain("Line 2 | beta")
              expect(text).toContain("Line 3: needle")
              expect(text).toContain("Line 4 | delta")
              expect(text).not.toContain("alpha")
              // Context is presentation only; machine output stays matches-only.
              expect(result.output).toHaveLength(1)
              expect(result.metadata).toEqual({ matches: 1, truncated: false, timedOut: false, mode: "content", prefiltered: false })
            }),
          ),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("ranks files by filename hit first, demotes tests", () =>
    Effect.sync(() => {
      // toModelContent is a pure function; assert its ordering directly so the relevance
      // signal is pinned without a filesystem. A filename that names the pattern must beat a
      // file that merely mentions it many times, and a test file must never bury an implementation.
      const mk = (p: string, line: number, text: string) => ({
        kind: "match" as const,
        match: { entry: { path: p, type: "file" as const }, line, offset: 0, text, submatches: [] },
      })
      const rows = [
        mk("src/config.ts", 3, "retryCount = 5"),
        mk("src/config.ts", 7, "retry the request"),
        mk("src/config.ts", 9, "retry limit"),
        mk("src/retry.test.ts", 1, "describe retry"),
        mk("src/retry.test.ts", 2, "retry works"),
        mk("src/retry.ts", 1, "export function retry"),
      ]
      const out = GrepTool.toModelContent(rows, { mode: "content", truncated: false, offset: 0, pattern: "retry" })
      // retry.ts (implementation + filename hit) first, config.ts (body-only) second,
      // retry.test.ts (test file) demoted to last despite matching the stem.
      expect(out.indexOf("src/retry.ts:")).toBeLessThan(out.indexOf("src/config.ts:"))
      expect(out.indexOf("src/config.ts:")).toBeLessThan(out.indexOf("src/retry.test.ts:"))
    }),
  )

  it.live("counts matches per file", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.promise(() =>
          Promise.all([
            fs.writeFile(path.join(tmp.path, "many.txt"), "needle\nneedle\nneedle\n"),
            fs.writeFile(path.join(tmp.path, "one.txt"), "needle\n"),
          ]),
        ).pipe(
          Effect.andThen(
            withTools(tmp.path, (registry) =>
              executeTool(registry, call("grep", { pattern: "needle", mode: "count" })),
            ),
          ),
          Effect.tap((result) =>
            Effect.sync(() => {
              expect(result.status).toBe("completed")
              if (result.status !== "completed") return
              const text = result.content?.[0]?.type === "text" ? result.content[0].text : ""
              expect(text).toStartWith("Found 4 matches in 2 files")
              // 计数降序：这一档的价值就是分布本身
              expect(text.indexOf("many.txt: 3")).toBeLessThan(text.indexOf("one.txt: 1"))
              expect(result.output).toHaveLength(2)
              // 一页代表 4 条命中，而不是 2 行
              expect(result.metadata).toEqual({ matches: 4, truncated: false, timedOut: false, mode: "count", prefiltered: false })
            }),
          ),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("lists one row per matching file", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.promise(() =>
          Promise.all([
            fs.writeFile(path.join(tmp.path, "a.txt"), "needle here\n"),
            fs.writeFile(path.join(tmp.path, "b.txt"), "filler\nneedle there\n"),
          ]),
        ).pipe(
          Effect.andThen(
            withTools(tmp.path, (registry) =>
              executeTool(registry, call("grep", { pattern: "needle", mode: "files_with_matches" })),
            ),
          ),
          Effect.tap((result) =>
            Effect.sync(() => {
              expect(result.status).toBe("completed")
              if (result.status !== "completed") return
              const text = result.content?.[0]?.type === "text" ? result.content[0].text : ""
              expect(text).toStartWith("Found 2 files with matches")
              expect(text).toContain("a.txt:1: needle here")
              expect(text).toContain("b.txt:2: needle there")
              expect(result.output).toHaveLength(2)
              expect(result.metadata).toEqual({ matches: 2, truncated: false, timedOut: false, mode: "files_with_matches", prefiltered: false })
            }),
          ),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("pages through matches with offset", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.promise(() => fs.writeFile(path.join(tmp.path, "lines.txt"), "needle1\nneedle2\nneedle3\n")).pipe(
          Effect.andThen(
            withTools(tmp.path, (registry) =>
              executeTool(registry, call("grep", { pattern: "needle", limit: 1, offset: 1 })),
            ),
          ),
          Effect.tap((result) =>
            Effect.sync(() => {
              expect(result.status).toBe("completed")
              if (result.status !== "completed") return
              const text = result.content?.[0]?.type === "text" ? result.content[0].text : ""
              expect(result.output).toMatchObject([{ line: 2, text: "needle2\n" }])
              expect(text).toContain("showing 2-2 of at least 3")
              expect(result.metadata).toEqual({ matches: 1, truncated: true, timedOut: false, mode: "content", prefiltered: false })
            }),
          ),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("caps output by characters", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.promise(() =>
          fs.writeFile(
            path.join(tmp.path, "wide.txt"),
            Array.from({ length: 300 }, (_, index) => `needle ${index} ${"x".repeat(180)}\n`).join(""),
          ),
        ).pipe(
          Effect.andThen(withTools(tmp.path, (registry) => executeTool(registry, call("grep", { pattern: "needle" })))),
          Effect.tap((result) =>
            Effect.sync(() => {
              expect(result.status).toBe("completed")
              if (result.status !== "completed") return
              const text = result.content?.[0]?.type === "text" ? result.content[0].text : ""
              expect(text).toContain(`Output capped at ${GrepTool.CHAR_BUDGET} characters`)
              expect(text.length).toBeLessThan(GrepTool.CHAR_BUDGET + 300)
            }),
          ),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("spills the full result to a file when the character cap hides lines", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.promise(() =>
          fs.writeFile(
            path.join(tmp.path, "wide.txt"),
            Array.from({ length: 300 }, (_, index) => `needle ${index} ${"x".repeat(180)}\n`).join(""),
          ),
        ).pipe(
          Effect.andThen(withTools(tmp.path, (registry) => executeTool(registry, call("grep", { pattern: "needle" })))),
          Effect.tap((result) =>
            Effect.gen(function* () {
              expect(result.status).toBe("completed")
              if (result.status !== "completed") return
              const text = result.content?.[0]?.type === "text" ? result.content[0].text : ""
              // The cap notice is followed by a pointer to the spilled file, not just a "narrow it".
              expect(text).toContain("Full results saved to ")
              const match = text.match(/Full results saved to (.+);/)
              expect(match).not.toBeNull()
              if (!match) return
              const spilled = match[1]!
              // The spilled file holds the lines the cap dropped from the visible page. The last
              // selected match (needle 99) is beyond the character budget, so the model cannot see
              // it inline — but it must be recoverable from the spilled file without re-running.
              const full = yield* Effect.promise(() => fs.readFile(spilled, "utf8"))
              expect(full).toContain("needle 0 ")
              expect(full).toContain(`needle 99 `)
              expect(full.split("\n").length).toBeGreaterThan(100)
              // The visible text, by contrast, is capped and must not itself contain the late rows.
              expect(text.length).toBeLessThan(GrepTool.CHAR_BUDGET + 300)
            }),
          ),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("reports invalid grep regex details", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        withTools(tmp.path, (registry) =>
          Effect.gen(function* () {
            const result = yield* executeTool(registry, call("grep", { pattern: "[" }))
            expect(result).toMatchObject({
              status: "error",
              error: { type: "tool.execution" },
            })
            if (result.status !== "error" || !result.error) return
            expect(result.error.message).toStartWith("Invalid regex pattern:")
            expect(result.error.message).toContain("unclosed character class")
          }),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("requires external_directory approval for external grep files and directories", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        const assertions: Permission.AssertInput[] = []
        return Effect.promise(() => fs.writeFile(path.join(outside.path, "outside.txt"), "needle\n")).pipe(
          Effect.andThen(
            withTools(
              active.path,
              (registry) =>
                Effect.gen(function* () {
                  const directory = yield* executeTool(
                    registry,
                    call("grep", { path: outside.path, pattern: "needle" }),
                  )
                  const file = yield* executeTool(
                    registry,
                    call("grep", { path: path.join(outside.path, "outside.txt"), pattern: "needle" }),
                  )
                  expect(directory.status).toBe("completed")
                  expect(file.status).toBe("completed")
                }),
              assertions,
            ),
          ),
          Effect.tap(() =>
            Effect.sync(() => {
              expect(assertions.map((input) => input.action)).toEqual([
                "external_directory",
                "grep",
                "external_directory",
                "grep",
              ])
              expect(assertions[0]?.resources).toEqual([path.join(outside.path, "*").replaceAll("\\", "/")])
              expect(assertions[2]?.resources).toEqual([path.join(outside.path, "*").replaceAll("\\", "/")])
            }),
          ),
        )
      },
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  for (const name of ["glob", "grep"] as const) {
    it.live(`${name} reports a missing search path`, () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) =>
          withTools(tmp.path, (registry) =>
            Effect.gen(function* () {
              const result = yield* executeTool(
                registry,
                call(name, { path: "missing", pattern: name === "glob" ? "*" : "needle" }),
              )
              expect(result).toEqual({
                status: "error",
                error: { type: "tool.execution", message: "Search path does not exist: missing" },
              })
            }),
          ),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      ),
    )
  }

  it.live("reports a file used as the glob search path", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.promise(() => fs.writeFile(path.join(tmp.path, "file.txt"), "content\n")).pipe(
          Effect.andThen(
            withTools(tmp.path, (registry) => executeTool(registry, call("glob", { path: "file.txt", pattern: "*" }))),
          ),
          Effect.tap((result) =>
            Effect.sync(() => {
              expect(result).toEqual({
                status: "error",
                error: { type: "tool.execution", message: "Search path is not a directory: file.txt" },
              })
            }),
          ),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("requires external_directory approval for an explicit external glob path", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        const assertions: Permission.AssertInput[] = []
        return Effect.promise(() => fs.writeFile(path.join(outside.path, "outside.txt"), "outside\n")).pipe(
          Effect.andThen(
            withTools(
              active.path,
              (registry) => executeTool(registry, call("glob", { path: outside.path, pattern: "*.txt" })),
              assertions,
            ),
          ),
          Effect.tap((result) =>
            Effect.sync(() => {
              expect(result.status).toBe("completed")
              expect(assertions.map((input) => input.action)).toEqual(["external_directory", "glob"])
              expect(assertions[0]?.resources).toEqual([path.join(outside.path, "*").replaceAll("\\", "/")])
            }),
          ),
        )
      },
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("globs through an in-location external symlink without external approval", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        if (process.platform === "win32") return Effect.void
        const assertions: Permission.AssertInput[] = []
        return Effect.promise(async () => {
          await fs.writeFile(path.join(outside.path, "outside.txt"), "outside\n")
          await fs.symlink(outside.path, path.join(active.path, "linked"))
        }).pipe(
          Effect.andThen(
            withTools(
              active.path,
              (registry) => executeTool(registry, call("glob", { path: "linked", pattern: "*.txt" })),
              assertions,
            ),
          ),
          Effect.tap((result) =>
            Effect.sync(() => {
              expect(result.status).toBe("completed")
              expect(assertions.map((input) => input.action)).toEqual(["glob"])
              expect(result).toMatchObject({
                output: [{ path: path.join("linked", "outside.txt"), type: "file" }],
                content: [{ type: "text", text: path.join(active.path, "linked", "outside.txt") }],
              })
            }),
          ),
        )
      },
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )
})

describe("two-stage grep prefilter", () => {
  const localGlobToolNode = makeLocationNode({
    name: "test/local-glob-tool-plugin",
    layer: Layer.effectDiscard(registerToolPlugin(GlobTool.Plugin)),
    deps: [Tool.node, Environment.node, Ripgrep.node, Location.node, FileAccess.node, Permission.node],
  })
  const localGrepToolNode = makeLocationNode({
    name: "test/local-grep-tool-plugin",
    layer: Layer.effectDiscard(registerToolPlugin(GrepTool.Plugin)),
    deps: [
      Tool.node,
      Environment.node,
      Ripgrep.node,
      Location.node,
      FileAccess.node,
      Permission.node,
      TrigramSearch.node,
      ToolOutput.node,
    ],
  })
  const withPrefilter = <A, E, R>(
    directory: string,
    cache: string,
    body: (registry: Tool.Interface, trigram: TrigramSearch.Interface) => Effect.Effect<A, E, R>,
  ) =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const trigram = yield* TrigramSearch.Service
      return yield* body(registry, trigram)
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(LayerNode.group([Tool.node, localGlobToolNode, localGrepToolNode, TrigramSearch.node]), [
          Location.node.replace(
            Layer.succeed(
              Location.Service,
              Location.Service.of(
                location(
                  { directory: AbsolutePath.make(directory) },
                  { vcs: { type: "git", store: AbsolutePath.make(path.join(directory, ".git")) } },
                ),
              ),
            ),
          ),
          Global.node.replace(Layer.succeed(Global.Service, Global.Service.of(Global.make({ cache })))),
          Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
        ]),
      ),
    )

  it.live(
    "prefilters literal searches through the trigram index and falls back for regex",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped("sicode-trigram-")
        const cache = yield* tmpdirScoped("sicode-trigram-cache-")
        yield* Effect.promise(() =>
          Promise.all([
            Bun.write(path.join(tmp.path, "alpha.ts"), "export const waitForScan = 1\n"),
            Bun.write(path.join(tmp.path, "beta.ts"), "export const unrelated = 2\n"),
            Bun.write(path.join(tmp.path, "nested/gamma.ts"), "// uses waitForScan here\n"),
          ]),
        )
        yield* withPrefilter(tmp.path, cache.path, (registry, trigram) =>
          Effect.gen(function* () {
            yield* trigram.buildNow
            const literal = yield* executeTool(registry, call("grep", { pattern: "waitForScan" }))
            expect(literal.metadata).toEqual({
              matches: 2,
              truncated: false,
              timedOut: false,
              mode: "content",
              prefiltered: true,
            })
            const text = literal.content?.[0]?.type === "text" ? literal.content[0].text : ""
            expect(text).toContain("alpha.ts")
            expect(text).toContain("gamma.ts")
            expect(text).not.toContain("beta.ts")

            // Regex patterns are not sound to prefilter; they must take the full sweep.
            const regex = yield* executeTool(registry, call("grep", { pattern: "waitForS.*n" }))
            expect(regex.metadata).toMatchObject({ matches: 2, prefiltered: false })

            // The watcher keeps the index fresh: a file written after the build shows up.
            yield* Effect.promise(() => Bun.write(path.join(tmp.path, "delta.ts"), "// waitForScan later\n"))
            yield* Effect.sleep("2 seconds")
            const incremental = yield* executeTool(registry, call("grep", { pattern: "waitForScan" }))
            expect(incremental.metadata).toMatchObject({ matches: 3, prefiltered: true })
          }),
        )
      }),
    { timeout: 30_000 },
  )

  it.live(
    "keeps the index correct under a burst of saves and deletes to one large file",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped("sicode-trigram-stress-")
        const cache = yield* tmpdirScoped("sicode-trigram-stress-cache-")
        const big = path.join(tmp.path, "big.ts")
        // A large file so re-reading it is not free; a unique token per generation to prove
        // the index tracks the *latest* content, not a stale snapshot.
        const gen = (token: string) => `// ${token}\n${Array.from({ length: 20_000 }, (_, i) => `const v${i} = ${i}`).join("\n")}\n`
        yield* Effect.promise(() => Bun.write(big, gen("tokenAAA")))
        yield* Effect.promise(() => Bun.write(path.join(tmp.path, "other.ts"), "export const untouched = 1\n"))

        yield* withPrefilter(tmp.path, cache.path, (registry, trigram) =>
          Effect.gen(function* () {
            yield* trigram.buildNow

            // A rapid burst of saves: the debounce coalesces them into one upsert round, and
            // the index must settle on the LAST content, not an intermediate one.
            yield* Effect.promise(() => Bun.write(big, gen("tokenBBB")))
            yield* Effect.promise(() => Bun.write(big, gen("tokenCCC")))
            yield* Effect.promise(() => Bun.write(big, gen("tokenDDD")))
            yield* Effect.sleep("2 seconds")

            const latest = yield* executeTool(registry, call("grep", { pattern: "tokenDDD" }))
            expect(latest.metadata).toMatchObject({ prefiltered: true, matches: 1 })
            const stale = yield* executeTool(registry, call("grep", { pattern: "tokenBBB" }))
            expect(stale.metadata).toMatchObject({ matches: 0 })

            // A delete (the file vanishes) must drop it from the index.
            yield* Effect.promise(() => fs.unlink(big))
            yield* Effect.sleep("2 seconds")
            const gone = yield* executeTool(registry, call("grep", { pattern: "tokenDDD" }))
            expect(gone.metadata).toMatchObject({ matches: 0 })

            // The untouched file survives the churn untouched.
            const other = yield* executeTool(registry, call("grep", { pattern: "untouched" }))
            expect(other.metadata).toMatchObject({ prefiltered: true, matches: 1 })
          }),
        )
      }),
    { timeout: 30_000 },
  )

  it.live(
    "reindexes when the file set drifted since the last run (crash before watcher flush)",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped("sicode-trigram-drift-")
        const cache = yield* tmpdirScoped("sicode-trigram-drift-cache-")
        yield* Effect.promise(() => Bun.write(path.join(tmp.path, "a.ts"), "export const tokenAAA = 1\n"))

        // First run: build the index, then let the scope close (simulating process exit).
        yield* withPrefilter(tmp.path, cache.path, (registry, trigram) =>
          Effect.gen(function* () {
            yield* trigram.buildNow
            const first = yield* executeTool(registry, call("grep", { pattern: "tokenAAA" }))
            expect(first.metadata).toMatchObject({ prefiltered: true, matches: 1 })
          }),
        )

        // Drift the file set while no watcher is alive — the exact gap the reuse check guards.
        yield* Effect.promise(() => Bun.write(path.join(tmp.path, "b.ts"), "export const tokenBBB = 2\n"))

        // Second run on the same cache: the reuse check must notice b.ts is new and reindex,
        // so tokenBBB is searchable even though no watcher ever saw the write.
        yield* withPrefilter(tmp.path, cache.path, (registry, trigram) =>
          Effect.gen(function* () {
            yield* trigram.buildNow
            const added = yield* executeTool(registry, call("grep", { pattern: "tokenBBB" }))
            expect(added.metadata).toMatchObject({ prefiltered: true, matches: 1 })
            const kept = yield* executeTool(registry, call("grep", { pattern: "tokenAAA" }))
            expect(kept.metadata).toMatchObject({ prefiltered: true, matches: 1 })
          }),
        )
      }),
    { timeout: 30_000 },
  )

  it.live(
    "reindexes when a file's content changed since the last run (no watcher saw the edit)",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped("sicode-trigram-content-")
        const cache = yield* tmpdirScoped("sicode-trigram-content-cache-")
        const target = path.join(tmp.path, "a.ts")
        yield* Effect.promise(() => Bun.write(target, "export const tokenAAA = 1\n"))

        yield* withPrefilter(tmp.path, cache.path, (registry, trigram) =>
          Effect.gen(function* () {
            yield* trigram.buildNow
            const first = yield* executeTool(registry, call("grep", { pattern: "tokenAAA" }))
            expect(first.metadata).toMatchObject({ prefiltered: true, matches: 1 })
          }),
        )

        // Same path, different content, edited while no watcher was alive. The pause keeps the
        // mtime distinct even on coarse timestamps — the fingerprint has no finer signal.
        yield* Effect.sleep("20 millis")
        yield* Effect.promise(() => Bun.write(target, "export const tokenZZZ = 1\n"))

        // Second run: the path set is identical, so only the fingerprint can reveal the edit.
        // Without it the index answers "no matches" from trigrams for content that is gone.
        yield* withPrefilter(tmp.path, cache.path, (registry, trigram) =>
          Effect.gen(function* () {
            yield* trigram.buildNow
            const added = yield* executeTool(registry, call("grep", { pattern: "tokenZZZ" }))
            expect(added.metadata).toMatchObject({ prefiltered: true, matches: 1 })
            const removed = yield* executeTool(registry, call("grep", { pattern: "tokenAAA" }))
            expect(removed.metadata).toMatchObject({ prefiltered: true, matches: 0 })
          }),
        )
      }),
    { timeout: 30_000 },
  )

  it.live(
    "reuses the index when nothing changed, even with a binary file present",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped("sicode-trigram-reuse-")
        const cache = yield* tmpdirScoped("sicode-trigram-reuse-cache-")
        yield* Effect.promise(() => Bun.write(path.join(tmp.path, "a.ts"), "export const tokenAAA = 1\n"))
        // ripgrep enumerates this, the index cannot store it. If the reuse check compared only
        // "files in the index" against "files on disk", the two could never match and every
        // start would pay a full rebuild — silently, in the background.
        yield* Effect.promise(() =>
          Bun.write(path.join(tmp.path, "blob.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x00, 0x01])),
        )

        // built_at is written only by a rebuild, so an unchanged stamp proves the index was reused.
        const builtAt = () => {
          const key = createHash("sha1").update(tmp.path).digest("hex")
          const db = new Database(path.join(cache.path, "trigram", `${key}.db`), { readonly: true })
          const row = db.query("SELECT v FROM meta WHERE k = 'built_at'").get() as { v: string } | null
          db.close()
          return row?.v
        }

        yield* withPrefilter(tmp.path, cache.path, (registry, trigram) =>
          Effect.gen(function* () {
            yield* trigram.buildNow
            expect((yield* executeTool(registry, call("grep", { pattern: "tokenAAA" }))).metadata).toMatchObject({
              prefiltered: true,
              matches: 1,
            })
          }),
        )
        const first = builtAt()
        expect(first).toBeDefined()

        yield* withPrefilter(tmp.path, cache.path, (registry, trigram) =>
          Effect.gen(function* () {
            yield* trigram.buildNow
            // Still serving correct results from the reused index.
            expect((yield* executeTool(registry, call("grep", { pattern: "tokenAAA" }))).metadata).toMatchObject({
              prefiltered: true,
              matches: 1,
            })
          }),
        )
        expect(builtAt()).toBe(first)
      }),
    { timeout: 30_000 },
  )
})
