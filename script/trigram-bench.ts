// SiCode: measure the two-stage trigram search against a full-tree ripgrep sweep, on the
// repository this is run from. Exists because the number quoted in .sicode/context-plan.html
// was a hand-waved range ("40-80x") that could not be defended query by query, and because
// comparing it to Cursor's published ~70x mixes two different corpora.
//
// Both sides of the comparison produce the same answer — the list of files containing a
// literal — with no row limit applied, so neither gets credit for early exit. Stage one
// (candidates) and stage two (in-memory literal match) are timed separately so a slow
// total can be attributed.
//
// Usage: bun script/trigram-bench.ts [--reps N] [--json]
import { Database } from "bun:sqlite"
import fsp from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { TrigramIndex } from "../packages/core/src/filesystem/trigram.bun.ts"
import { chunkPaths, IN_MEMORY_MATCH_MAX_FILES, matchLiteralInMemory } from "../packages/core/src/filesystem/trigram-search.ts"

// effect is installed under packages/core, so a bare specifier here would not resolve.
const { Effect } = await import(Bun.resolveSync("effect", path.join(import.meta.dir, "../packages/core")))

const root = path.resolve(import.meta.dir, "..")
const args = process.argv.slice(2)
const reps = Number(args[args.indexOf("--reps") + 1]) || 5
const asJson = args.includes("--json")

/** Literals a model actually greps for, spanning narrow (few files) to broad (many). */
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined
const QUERIES = [
  "TrigramSearch",
  "compaction",
  "semantic",
  "precompute",
  "tool-output",
  "MAX_CANDIDATES",
  "export const",
  "useEffect",
  "sessionID",
  "ripgrep",
].filter((query) => !only || query === only)

const now = () => performance.now()

/**
 * The app resolves ripgrep from its own cache rather than $PATH (it downloads the binary on
 * first use), so a bench run from a plain shell has to do the same or it measures nothing.
 */
const RG = await (async () => {
  if (process.env.RG_PATH) return process.env.RG_PATH
  const cached = path.join(os.homedir(), ".cache", "opencode", "bin", "rg.exe")
  try {
    await fsp.access(cached)
    return cached
  } catch {
    return "rg"
  }
})()
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))
  return sorted[index]!
}

/** rg on Windows prints `.\path\to\file`; the index and the matcher both use forward slashes. */
const outputPaths = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim().replaceAll("\\", "/").replace(/^\.\//, ""))
    .filter(Boolean)

/** Every file in the tree that could be indexed — the same set the index build consumes. */
const enumerate = async () => {
  const proc = Bun.spawn([RG, "--files", "--hidden", "--glob=!**/.git/**", "--no-messages", "."], {
    cwd: root,
    stdout: "pipe",
    stderr: "ignore",
  })
  const text = await new Response(proc.stdout).text()
  await proc.exited
  return outputPaths(text)
}

/** Full-tree ripgrep sweep: the baseline the two-stage path is compared against. */
const sweep = async (query: string) => {
  const started = now()
  const proc = Bun.spawn([RG, "--hidden", "--glob=!**/.git/**", "--no-messages", "-l", "-F", query, "."], {
    cwd: root,
    stdout: "pipe",
    stderr: "ignore",
  })
  const text = await new Response(proc.stdout).text()
  await proc.exited
  return { ms: now() - started, files: outputPaths(text) }
}

/**
 * Stage two exactly as the grep tool runs it: in-process matching when the candidate set is
 * small, one chunked ripgrep invocation otherwise. Chunking is measured too, since on Windows
 * the process spawn (~150ms) dominates every path that needs rg.
 */
const stageTwo = async (query: string, candidates: readonly string[]) => {
  const started = now()
  let files: string[]
  if (candidates.length <= IN_MEMORY_MATCH_MAX_FILES) {
    const rows = await Effect.runPromise(
      matchLiteralInMemory(root, candidates, query, { mode: "files", limit: Number.MAX_SAFE_INTEGER }),
    )
    files = [...new Set(rows.map((row) => outputPaths(String(row.match.entry.path))[0] ?? ""))].filter(Boolean)
  } else {
    const chunks = chunkPaths(candidates)
    const found: string[] = []
    for (const chunk of chunks) {
      const proc = Bun.spawn([RG, "--hidden", "--glob=!**/.git/**", "--no-messages", "-l", "-F", query, "--", ...chunk], {
        cwd: root,
        stdout: "pipe",
        stderr: "ignore",
      })
      const text = await new Response(proc.stdout).text()
      await proc.exited
      found.push(...outputPaths(text))
    }
    files = [...new Set(found)]
  }
  return { ms: now() - started, files }
}

const main = async () => {
  const all = await enumerate()
  console.error(`[bench] rg ${RG} · enumerated ${all.length} files`)
  const indexed: Array<readonly [string, string, { mtimeMs: number; size: number }]> = []
  const buildStarted = now()
  for (const relative of all) {
    try {
      const absolute = path.join(root, relative)
      const stat = await fsp.stat(absolute)
      const content = await fsp.readFile(absolute, "utf8")
      if (content.includes("\0")) continue
      indexed.push([relative, content, { mtimeMs: Math.floor(stat.mtimeMs), size: stat.size }])
    } catch {
      continue
    }
  }
  const db = TrigramIndex.open({ file: ":memory:" })
  db.replaceAll(indexed)
  const buildMs = now() - buildStarted
  console.error(`[bench] indexed ${indexed.length} text files in ${(buildMs / 1000).toFixed(2)}s`)

  const rows: Array<Record<string, unknown>> = []
  for (const query of QUERIES) {
    console.error(`[bench] query ${query}`)
    const candidateRuns: number[] = []
    let candidates: readonly string[] = []
    for (let i = 0; i < reps; i++) {
      const started = now()
      candidates = db.candidates(query) ?? []
      candidateRuns.push(now() - started)
    }
    const stageTwoRuns: number[] = []
    let twoStage: readonly string[] = []
    for (let i = 0; i < reps; i++) {
      const result = await stageTwo(query, candidates)
      stageTwoRuns.push(result.ms)
      twoStage = result.files
    }
    const sweepRuns: number[] = []
    let baseline: readonly string[] = []
    for (let i = 0; i < Math.max(2, Math.ceil(reps / 2)); i++) {
      const result = await sweep(query)
      sweepRuns.push(result.ms)
      baseline = result.files
    }
    const stageOneMs = median(candidateRuns)
    const stageTwoMs = median(stageTwoRuns)
    const sicodeMs = stageOneMs + stageTwoMs
    const baselineMs = median(sweepRuns)
    const missing = baseline.filter((file) => !twoStage.includes(file))
    if (missing.length > 0 && args.includes("--debug")) {
      console.error(`[debug] ${query} baseline[0..2]=${JSON.stringify(baseline.slice(0, 3))}`)
      console.error(`[debug] ${query} twostage[0..2]=${JSON.stringify(twoStage.slice(0, 3))}`)
    }
    rows.push({
      query,
      candidates: candidates.length,
      matches: twoStage.length,
      stageOneMs: +stageOneMs.toFixed(2),
      stageTwoMs: +stageTwoMs.toFixed(2),
      sicodeMs: +sicodeMs.toFixed(2),
      baselineMs: +baselineMs.toFixed(2),
      speedup: +(baselineMs / sicodeMs).toFixed(1),
      missing: missing.length,
    })
  }
  db.close()

  if (asJson) {
    console.log(JSON.stringify({ files: all.length, indexed: indexed.length, buildMs, rows }, null, 2))
    return
  }

  const speedups = rows.map((row) => Number(row.speedup))
  console.log(`tree       ${all.length} files enumerated, ${indexed.length} indexed, build ${(buildMs / 1000).toFixed(2)}s`)
  console.log(`reps       stage1 ${reps}, stage2 ${reps}, sweep ${Math.max(2, Math.ceil(reps / 2))}`)
  console.log("")
  console.log("query             cand  hits   stage1  stage2  sicode     rg   speedup  missing")
  for (const row of rows) {
    console.log(
      [
        String(row.query).padEnd(16),
        String(row.candidates).padStart(5),
        String(row.matches).padStart(5),
        `${row.stageOneMs}ms`.padStart(8),
        `${row.stageTwoMs}ms`.padStart(7),
        `${row.sicodeMs}ms`.padStart(7),
        `${row.baselineMs}ms`.padStart(7),
        `${row.speedup}x`.padStart(8),
        String(row.missing).padStart(8),
      ].join(" "),
    )
  }
  console.log("")
  console.log(
    `speedup    median ${median(speedups)}x, p10 ${percentile(speedups, 10)}x, p90 ${percentile(speedups, 90)}x, ` +
      `min ${Math.min(...speedups)}x, max ${Math.max(...speedups)}x`,
  )
  const wrong = rows.filter((row) => Number(row.missing) > 0)
  console.log(
    wrong.length === 0
      ? "correct    every query returned the same file set as the full sweep"
      : `correct    MISMATCH on ${wrong.map((row) => row.query).join(", ")}`,
  )
}

await main()
