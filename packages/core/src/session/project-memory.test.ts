import { expect, test } from "bun:test"
import { Effect } from "effect"
import type { KV } from "../kv.js"
import { MISS_LIMIT, fileOf, merge, parseSummary, search, verify } from "./project-memory.js"
import { ProjectMemoryStore } from "./project-memory-store.js"
import { toModelContent } from "../tool/plugin/recall.js"

const summary = `## Objective
- Add a paste entry to the browser pane

## Requirements
- (none)

## Decisions
- Parse and scope cookies in main, not the renderer: the session owns the page URL
- No action buttons in the address field

## Work State
### Completed
- Moved the paste button to the toolbar

### Active
- Waiting on component tests

## Next Move
1. Run playwright

## Relevant Files
- \`packages/gui-extensions/src/browser/panel.tsx\`: toolbar and popover
- \`packages/gui-extensions/src/browser/cookies.ts\`: parse and scope
- \`packages/identity/logo-mark.png\`: brand mark (wrong, moved)
- (none)

## Important Context
- Cookies live in the pane's memory partition, so a restart signs the user out
- Theme tokens are in \`ui/src/styles/tokens/theme.css\`, not \`packages/theme\`
`

test("a summary leaves behind facts and drops progress", () => {
  const facts = parseSummary(summary, 1_000)

  expect(facts.map((fact) => fact.kind)).toEqual([
    "decision",
    "decision",
    "file",
    "file",
    "file",
    "context",
    "context",
  ])
  // Work State and Next Move never survive, and "(none)" is not a fact.
  expect(facts.some((fact) => fact.text.includes("Waiting on component tests"))).toBe(false)
  expect(facts.some((fact) => fact.text.includes("Run playwright"))).toBe(false)
  // A file bullet keeps its reason as the text and its path for checking.
  expect(facts[2]).toEqual({
    kind: "file",
    text: "toolbar and popover",
    paths: ["packages/gui-extensions/src/browser/panel.tsx"],
    misses: 0,
    seen: 1_000,
  })
  // Prose keeps every path it names, so one wrong path fails the whole fact.
  expect(facts[6]).toMatchObject({
    kind: "context",
    paths: ["ui/src/styles/tokens/theme.css", "packages/theme"],
  })
})

test("the same fact confirmed again replaces its earlier copy and resets its misses", () => {
  const earlier = [{ kind: "context" as const, text: "Cookies die on restart", paths: [], misses: 1, seen: 10 }]
  const later = [{ kind: "context" as const, text: "cookies die on restart", paths: [], misses: 0, seen: 20 }]
  const merged = merge(earlier, later, 30)

  expect(merged).toHaveLength(1)
  expect(merged[0]).toMatchObject({ text: "cookies die on restart", misses: 0, seen: 30 })
})

test("a fact is dropped only after the check keeps finding its path missing", () => {
  const facts = [
    { kind: "file" as const, text: "panel", paths: ["packages/gui-extensions/src/browser/panel.tsx"], misses: 0, seen: 1 },
    { kind: "file" as const, text: "mark", paths: ["packages/identity/logo-mark.png"], misses: 0, seen: 1 },
    { kind: "context" as const, text: "no paths to check", paths: [], misses: 0, seen: 1 },
  ]
  const exists = (path: string) => path.endsWith("panel.tsx")

  const first = verify(facts, exists)
  expect(first.dropped).toEqual([])
  expect(first.kept[1]).toMatchObject({ misses: 1 })

  const second = verify(first.kept, exists)
  expect(second.dropped.map((fact) => fact.text)).toEqual(["mark"])
  // A fact with no paths is prose: nothing to prove wrong, so it stays.
  expect(second.kept.map((fact) => fact.text)).toEqual(["panel", "no paths to check"])
  expect(MISS_LIMIT).toBe(2)
})

test("a path check reads the file, not the line a fact points at", () => {
  expect(fileOf("packages/core/src/config/discovery.ts:17")).toBe("packages/core/src/config/discovery.ts")
  expect(fileOf("packages/core/src/config/discovery.ts:17-24")).toBe("packages/core/src/config/discovery.ts")
  expect(fileOf("packages/core/src/config/discovery.ts")).toBe("packages/core/src/config/discovery.ts")
})

test("project memory records, checks, and forgets through the key-value store", async () => {
  const values = new Map<string, KV.Value>()
  const kv: KV.Interface = {
    get: (key) => Effect.sync(() => values.get(key)),
    set: (key, value) => Effect.sync(() => void values.set(key, value)),
    remove: (key) => Effect.sync(() => void values.delete(key)),
    scan: () => Effect.succeed({ entries: [] }),
  }

  const recorded = await Effect.runPromise(ProjectMemoryStore.record(kv, "/repo", parseSummary(summary, 1_000)))
  expect(recorded).toHaveLength(7)

  // A second summary confirms what is still true and adds what is new.
  const again = await Effect.runPromise(
    ProjectMemoryStore.record(kv, "/repo", parseSummary("## Important Context\n- Deploy runs on Bun\n", 2_000)),
  )
  expect(again).toHaveLength(8)

  // A path that is gone is recorded, not dropped on the spot: one missing check may be a rename in progress.
  const checked = await Effect.runPromise(
    ProjectMemoryStore.check(kv, "/repo", (path) => !path.includes("identity")),
  )
  expect(checked.dropped).toEqual([])
  expect(checked.kept).toHaveLength(8)

  // The second check in a row is proof, and the fact that named the missing file goes.
  const second = await Effect.runPromise(
    ProjectMemoryStore.check(kv, "/repo", (path) => !path.includes("identity")),
  )
  expect(second.dropped.map((fact) => fact.text)).toEqual(["brand mark (wrong, moved)"])
  expect(await Effect.runPromise(ProjectMemoryStore.load(kv, "/repo"))).toHaveLength(7)

  // Nothing left to drop, and the stored memory is not rewritten for a third identical check.
  const third = await Effect.runPromise(
    ProjectMemoryStore.check(kv, "/repo", (path) => !path.includes("identity")),
  )
  expect(third.dropped).toEqual([])
  expect(third.kept).toHaveLength(7)

  // Another project keeps its own memory.
  expect(await Effect.runPromise(ProjectMemoryStore.load(kv, "/other"))).toEqual([])

  await Effect.runPromise(ProjectMemoryStore.clear(kv, "/repo"))
  expect(await Effect.runPromise(ProjectMemoryStore.load(kv, "/repo"))).toEqual([])
})


test("a stored value this build cannot read is treated as no memory at all", async () => {
  const values = new Map<string, KV.Value>([["project-memory:/repo", { old: "shape" }]])
  const kv: KV.Interface = {
    get: (key) => Effect.sync(() => values.get(key)),
    set: (key, value) => Effect.sync(() => void values.set(key, value)),
    remove: (key) => Effect.sync(() => void values.delete(key)),
    scan: () => Effect.succeed({ entries: [] }),
  }

  expect(await Effect.runPromise(ProjectMemoryStore.load(kv, "/repo"))).toEqual([])
})

test("recall ranks a path hit above a word in the text, and a stale fact below a fresh one", () => {
  const facts = [
    { kind: "context" as const, text: "the toolbar has three buttons", paths: [], misses: 0, seen: 3 },
    { kind: "file" as const, text: "toolbar and popover", paths: ["browser/panel.tsx"], misses: 0, seen: 1 },
    { kind: "file" as const, text: "toolbar in the old pane", paths: ["browser/old-panel.tsx"], misses: 1, seen: 9 },
    { kind: "decision" as const, text: "cookies are scoped in main", paths: [], misses: 0, seen: 2 },
  ]

  // Both files match on their path, and a path hit outranks a word in the text. The one that still checks out wins
  // over its stale twin despite being older.
  expect(search(facts, "panel").map((fact) => fact.text)).toEqual([
    "toolbar and popover",
    "toolbar in the old pane",
  ])
  // With nothing but text hits, the most recently confirmed fact leads and the stale one trails.
  expect(search(facts, "toolbar").map((fact) => fact.text)).toEqual([
    "the toolbar has three buttons",
    "toolbar and popover",
    "toolbar in the old pane",
  ])
  expect(search(facts, "scoped")).toHaveLength(1)
  expect(search(facts, "   ")).toEqual([])
  expect(search(facts, "toolbar", 1)).toHaveLength(1)
})

test("the recall tool's output names each fact, its paths, and a stale warning", () => {
  const content = toModelContent(
    [
      { kind: "file", text: "toolbar and popover", paths: ["browser/panel.tsx"], stale: false },
      { kind: "context", text: "cookies die on restart", paths: [], stale: true },
    ],
    9,
  )

  expect(content.split("\n")).toEqual([
    "2 of 9 facts this project kept from earlier compactions:",
    "- [file] toolbar and popover",
    "  browser/panel.tsx",
    "- [context] cookies die on restart",
    "  (a recent check could not find one of these paths; confirm before relying on it)",
  ])
  expect(toModelContent([], 0)).toBe("This project has no memory yet. Search the code as usual.")
  expect(toModelContent([], 4)).toContain("4 facts are kept")
})

test("SiCode: a query typed without spaces reaches a fact written with them", () => {
  const facts = [
    { kind: "context" as const, text: "长 diff 底部需要收起栏，溢出测量要等折叠动画结束", paths: [], misses: 0, seen: 2 },
    { kind: "context" as const, text: "编辑卡在过程容器里应压成链条行，不要卡片形态", paths: [], misses: 0, seen: 1 },
    { kind: "decision" as const, text: "设置页内容列自己管宽度，不再整体居中", paths: [], misses: 0, seen: 3 },
  ]

  // Chinese has no word boundaries, so the query is one token. The exact pass asks whether the fact
  // holds that whole run and finds nothing, because the stored text spells the words apart.
  expect(search(facts, "长diff底部").map((fact) => fact.text)).toEqual([
    "长 diff 底部需要收起栏，溢出测量要等折叠动画结束",
  ])
  // Reordered wording lands on the same fact: matching pairs instead of the whole string is the
  // whole point of the fallback.
  expect(search(facts, "收起栏在底部")).toHaveLength(1)
  // A CJK query sharing nothing returns nothing, rather than whichever fact looked closest.
  expect(search(facts, "量子纠缠拓扑绝缘体")).toEqual([])
  // Latin-only queries never reach the fallback: `panl` would otherwise ride `pa`/`an` into
  // `panel` and rank a typo above a real hit.
  expect(search(facts, "panl")).toEqual([])
})

test("SiCode: a verbatim hit stops the fallback, and a checked fact outranks its stale twin", () => {
  // Both facts cover the query, but only one contains it exactly. The fallback must not run once
  // the exact pass has an answer, or the fuzzy neighbour would join a result that is already right.
  expect(
    search(
      [
        { kind: "context" as const, text: "长 diff 底部需要收起栏", paths: [], misses: 0, seen: 1 },
        { kind: "context" as const, text: "长diff底部", paths: [], misses: 0, seen: 2 },
      ],
      "长diff底部",
    ).map((fact) => fact.text),
  ).toEqual(["长diff底部"])

  // Paths are part of the haystack: the query names the area in Chinese and the file in Latin.
  const projection = [
    {
      kind: "file" as const,
      text: "时间线投影逻辑",
      paths: ["session-ui/src/timeline/projection.ts"],
      misses: 1,
      seen: 9,
    },
    {
      kind: "file" as const,
      text: "时间线投影逻辑",
      paths: ["session-ui/src/timeline/projection.ts"],
      misses: 0,
      seen: 1,
    },
  ]

  expect(search(projection, "投影projection")).toHaveLength(2)
  // Equal coverage, so the fact whose paths still resolve leads despite being older.
  expect(search(projection, "投影projection")[0]?.misses).toBe(0)
})
