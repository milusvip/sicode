#!/usr/bin/env bun
// SiCode: one-off probe for the regex turn-intent classifier.
//
// Runs the REAL `classifyUserIntent` over every user message in the local session DBs,
// reports the intent distribution, and dumps each message that hits a forced path
// (broad -> forced subagent) so false positives can be judged by hand. Read-only;
// writes a JSON dump under .sicode/scratch/.
//
//   bun packages/core/script/intent-probe.ts

import { Database } from "bun:sqlite"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { classifyUserIntent, type LocateIntent } from "../src/session/runner/locate-intent.js"

const dbs = ["opencode-local.db", "opencode.db"].map((f) => path.join(os.homedir(), ".local", "share", "opencode", f))

type Row = { session_id: string; seq: number; text: string; intent: LocateIntent; created: number }

const rows: Row[] = []
for (const file of dbs) {
  if (!fs.existsSync(file)) continue
  const db = new Database(file, { readonly: true })
  const messages = db.query("select session_id, seq, data from session_message where type = 'user' order by session_id, seq").all() as {
    session_id: string
    seq: number
    data: string | null
  }[]
  for (const m of messages) {
    if (!m.data) continue
    let parsed: { content?: { text?: string }[]; text?: string; time?: { created?: number } }
    try {
      parsed = JSON.parse(m.data)
    } catch {
      continue
    }
    const text = (parsed.content?.map((p) => p.text ?? "").join("") ?? parsed.text ?? "").trim()
    if (!text) continue
    rows.push({
      session_id: m.session_id,
      seq: m.seq,
      text,
      intent: classifyUserIntent(text),
      created: parsed.time?.created ?? 0,
    })
  }
  db.close()
}

const order: LocateIntent[] = ["broad", "known", "other"]
const counts = new Map<LocateIntent, number>(order.map((i) => [i, 0]))
for (const r of rows) counts.set(r.intent, (counts.get(r.intent) ?? 0) + 1)

console.log(`\n真实用户消息 ${rows.length} 条（${dbs.filter(fs.existsSync).length} 个库）\n`)
for (const intent of order) {
  const n = counts.get(intent) ?? 0
  const pct = rows.length ? ((n / rows.length) * 100).toFixed(1) : "0"
  const forced = intent === "broad" ? "  ← 强制 subagent(explore)" : ""
  console.log(`  ${intent.padEnd(9)} ${String(n).padStart(5)}  ${pct.padStart(5)}%${forced}`)
}
const forcedTotal = counts.get("broad") ?? 0
console.log(`\n  会被硬派工具的(broad): ${forcedTotal}  (${((forcedTotal / rows.length) * 100).toFixed(1)}%)`)

const outDir = path.resolve(import.meta.dirname, "../../../.sicode/scratch")
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, "intent-probe.json"), JSON.stringify(rows, null, 2))

for (const intent of ["broad"] as const) {
  const sample = rows.filter((r) => r.intent === intent)
  console.log(`\n===== ${intent} 命中 ${sample.length} 条（前 40）=====\n`)
  for (const r of sample.slice(0, 40)) {
    console.log(`[${r.session_id.slice(0, 20)}#${r.seq}] ${r.text.replace(/\s+/g, " ").slice(0, 120)}`)
  }
}
