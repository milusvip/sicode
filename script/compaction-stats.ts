#!/usr/bin/env bun
// Reports what compaction costs, and whether a background summary was ever used.
//
//   bun script/compaction-stats.ts                 # the most recent log
//   bun script/compaction-stats.ts path/to/a.log   # one or more explicit logs
//
// Why this exists: `experimental.precompute_compaction` was shipped default-off because nobody could say what it
// would save. This reads the two lines `compaction-metrics.ts` and `session/compaction.ts` write and answers that
// with numbers — how long a compaction actually blocks, and how many held summaries were thrown away — so the
// setting can be decided on evidence instead of a guess.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

type Timing = { reason: string; outcome: string; durationMs: number }
type Held = { state: string; reason?: string; savedMs?: number; leadMs?: number }

const LOG_DIR = path.join(os.homedir(), ".local", "share", "opencode", "log")

/** Every `key=value` on a logfmt line, unquoted. */
function fields(line: string) {
  const out = new Map<string, string>()
  for (const match of line.matchAll(/([A-Za-z_][\w.]*)=("(?:[^"\\]|\\.)*"|\S*)/g)) {
    const value = match[2]
    out.set(match[1], value.startsWith('"') ? value.slice(1, -1) : value)
  }
  return out
}

function latest() {
  if (!fs.existsSync(LOG_DIR)) return []
  return fs
    .readdirSync(LOG_DIR)
    .filter((name) => name.endsWith(".log"))
    .map((name) => path.join(LOG_DIR, name))
    .map((file) => ({ file, at: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.at - a.at)
    .slice(0, 1)
    .map((entry) => entry.file)
}

function percentile(values: number[], at: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  // Nearest-rank: with three samples, p90 has to be the largest, not the middle one.
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(at * sorted.length) - 1))]
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`

function tally(values: string[]) {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1]).map(([key, count]) => `${key} ${count}`).join(", ")
}

const files = process.argv.slice(2).length > 0 ? process.argv.slice(2) : latest()
if (files.length === 0) {
  console.log(`no log found under ${LOG_DIR}`)
  console.log("pass a log path, or run SiCode once so it writes one")
  process.exit(1)
}

const timings: Timing[] = []
const held: Held[] = []
let lines = 0
for (const file of files) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.includes("compaction.")) continue
    const parsed = fields(line)
    const message = parsed.get("message")
    if (message === "compaction.timing") {
      timings.push({
        reason: parsed.get("reason") ?? "unknown",
        outcome: parsed.get("outcome") ?? "unknown",
        durationMs: Number(parsed.get("durationMs") ?? 0),
      })
      lines++
      continue
    }
    if (message === "compaction.precompute") {
      held.push({
        state: parsed.get("state") ?? "unknown",
        reason: parsed.get("reason"),
        savedMs: parsed.has("savedMs") ? Number(parsed.get("savedMs")) : undefined,
        leadMs: parsed.has("leadMs") ? Number(parsed.get("leadMs")) : undefined,
      })
      lines++
    }
  }
}

if (lines === 0) {
  console.log(`read ${files.join(", ")}`)
  console.log("no compaction lines yet — run a session until it compacts, or turn on")
  console.log("`experimental.precompute_compaction` to also record background summaries")
  process.exit(0)
}

const completed = timings.filter((entry) => entry.outcome === "completed")
const durations = completed.map((entry) => entry.durationMs)
const totalWait = durations.reduce((sum, value) => sum + value, 0)

const started = held.filter((entry) => entry.state === "started").length
const used = held.filter((entry) => entry.state === "used")
const discarded = held.filter((entry) => entry.state === "discarded")
const pending = Math.max(0, started - used.length - discarded.length)
const written = used.length + discarded.length

console.log(`compaction-stats  ${files.map((file) => path.basename(file)).join(", ")}  (${lines} lines)\n`)

console.log("Compaction waits")
console.log(`  count      ${completed.length}${completed.length > 0 ? `  (${tally(completed.map((entry) => entry.reason))})` : ""}`)
if (completed.length > 0) {
  console.log(`  p50        ${seconds(percentile(durations, 0.5))}`)
  console.log(`  p90        ${seconds(percentile(durations, 0.9))}`)
  console.log(`  max        ${seconds(Math.max(...durations))}`)
  console.log(`  total      ${seconds(totalWait)}  — the most background summaries could ever save`)
}
const failed = timings.length - completed.length
if (failed > 0) console.log(`  failed     ${failed}`)

console.log("\nBackground summaries")
if (started === 0) {
  console.log("  none started — `experimental.precompute_compaction` is off or never reached 85% of the window")
} else {
  console.log(`  started    ${started}`)
  console.log(`  used       ${used.length}${used.length > 0 ? `  (saved ${seconds(used.reduce((sum, entry) => sum + (entry.savedMs ?? 0), 0))}, ready ${seconds(percentile(used.map((entry) => entry.leadMs ?? 0), 0.5))} before it was needed)` : ""}`)
  console.log(`  discarded  ${discarded.length}${discarded.length > 0 ? `  (${tally(discarded.map((entry) => entry.reason ?? "unknown"))})` : ""}`)
  console.log(`  unsettled  ${pending}  — session ended or is still running before compaction took it`)
  if (written > 0) console.log(`  waste      ${Math.round((discarded.length / written) * 100)}% of written summaries were never used`)
}

console.log("\nVerdict")
if (started === 0 && completed.length === 0) {
  console.log("  nothing measured yet")
} else if (started === 0) {
  const median = percentile(durations, 0.5)
  console.log(`  precomputation is off. A compaction blocks for ${seconds(median)} at the median;`)
  console.log(`  turning it on is worth it only if that wait is long enough to notice (rule of thumb: > 15s).`)
} else if (written === 0) {
  console.log("  a summary was started but never settled — let a session run until it compacts")
} else {
  const waste = discarded.length / written
  const saved = used.reduce((sum, entry) => sum + (entry.savedMs ?? 0), 0)
  if (waste > 0.5) {
    console.log(`  ${Math.round(waste * 100)}% of the written summaries were thrown away (${tally(discarded.map((entry) => entry.reason ?? "unknown"))}).`)
    console.log("  keep it off, or narrow the window between 85% and the threshold.")
  } else if (waste > 0.25) {
    console.log(`  ${used.length} of ${written} were used, saving ${seconds(saved)}, but ${Math.round(waste * 100)}% was thrown away.`)
    console.log("  marginal — worth keeping only if that saving repeats often.")
  } else if (saved < 30_000) {
    console.log(`  ${used.length} of ${written} were used, saving only ${seconds(saved)} in total.`)
    console.log("  too little to judge — collect more compactions before deciding.")
  } else {
    console.log(`  ${used.length} of ${written} held summaries were used, saving ${seconds(saved)} of waiting.`)
    console.log("  that is a real gain — leaving `precompute_compaction` on is justified.")
  }
}
