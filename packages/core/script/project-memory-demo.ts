#!/usr/bin/env bun
// SiCode: a development view of project memory. It runs the real extraction, storage, and path check over a compaction
// summary file, with an in-memory store, so the pipeline can be inspected without waiting for a session to compact.
//
//   bun packages/core/script/project-memory-demo.ts <summary.md>
//
// The summary is what `session/compaction.ts` writes; the check runs against this repository.

import fs from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import type { KV } from "../src/kv.js"
import { parseSummary, search } from "../src/session/project-memory.js"
import { ProjectMemoryStore } from "../src/session/project-memory-store.js"
import { toModelContent } from "../src/tool/plugin/recall.js"

const root = path.resolve(import.meta.dirname, "../../..")
const file = process.argv[2]

if (!file) {
  console.error("usage: bun packages/core/script/project-memory-demo.ts <summary.md>")
  process.exit(1)
}

const values = new Map<string, KV.Value>()
const kv: KV.Interface = {
  get: (key) => Effect.sync(() => values.get(key)),
  set: (key, value) => Effect.sync(() => void values.set(key, value)),
  remove: (key) => Effect.sync(() => void values.delete(key)),
  scan: () => Effect.succeed({ entries: [] }),
}

const summary = fs.readFileSync(path.resolve(root, file), "utf8")
const facts = parseSummary(summary)
const project = "/demo"

await Effect.runPromise(ProjectMemoryStore.record(kv, project, facts))

// A summary bullet writes paths relative to the project root, so that is what the check resolves against.
const exists = (value: string) => fs.existsSync(path.resolve(root, value))
const first = await Effect.runPromise(ProjectMemoryStore.check(kv, project, exists))
const second = await Effect.runPromise(ProjectMemoryStore.check(kv, project, exists))

const count = (kind: string) => facts.filter((fact) => fact.kind === kind).length

console.log(`\n抽取：${facts.length} 条（decision ${count("decision")} / file ${count("file")} / context ${count("context")}）`)
console.log(`校验第一轮：待淘汰 ${first.kept.filter((fact) => fact.misses > 0).length} 条（记一次失效）`)
console.log(`校验第二轮：淘汰 ${second.dropped.length} 条，保留 ${second.kept.length} 条\n`)

for (const fact of second.kept) {
  const state = fact.misses > 0 ? "⚠ 一次失效" : fact.paths.length > 0 ? "✓" : "·"
  console.log(`${state.padEnd(3)} [${fact.kind}] ${fact.text}`)
  if (fact.paths.length > 0) console.log(`     ${fact.paths.join("  ")}`)
}

for (const fact of second.dropped) console.log(`✗   [${fact.kind}] ${fact.text}\n     ${fact.paths.join("  ")}`)

// What the recall tool hands the model for a question about this project.
const query = process.argv[3] ?? "浏览器 工具栏"
const found = search(second.kept, query).map((fact) => ({
  kind: fact.kind,
  text: fact.text,
  paths: [...fact.paths],
  stale: fact.misses > 0,
}))

console.log(`\n召回（query: "${query}"）—— agent 看到的内容：\n`)
console.log(toModelContent(found, second.kept.length))
