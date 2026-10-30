const { Database } = require("bun:sqlite")

const db = new Database(process.env.HOME + "/.local/share/opencode/opencode-local.db", { readonly: true })
const SID = "ses_e77146dd4ffdHsBdFfMR34Lc72"
const rows = db.query("select seq,type,data from session_message where session_id=? order by seq").all(SID)

const t0 = Number(rows[0].data ? JSON.parse(rows[0].data).time?.created ?? 0 : 0)
const rel = (ms) => (ms ? `+${((ms - t0) / 1000).toFixed(1)}s` : "?")

for (const row of rows) {
  const d = JSON.parse(row.data)
  if (row.type === "user") {
    const text = d.content?.map?.((p) => p.text ?? "").join("") ?? d.text ?? ""
    console.log(`\n[${row.seq}] USER ${rel(d.time?.created)}\n    ${String(text).replace(/\n/g, "\n    ")}`)
    continue
  }
  if (row.type === "idle") {
    console.log(`\n[${row.seq}] IDLE ${rel(d.time?.created ?? d.time)}`)
    continue
  }
  const t = d.time ?? {}
  const gen = t.firstOutput ? ((t.firstOutput - t.created) / 1000).toFixed(1) : "?"
  const out = t.firstOutput && t.completed ? ((t.completed - t.firstOutput) / 1000).toFixed(1) : "?"
  console.log(
    `\n[${row.seq}] ASSISTANT ${rel(t.created)}  queue=${gen}s gen=${out}s total=${((t.completed - t.created) / 1000).toFixed(1)}s` +
      ` tok(in=${d.tokens?.input ?? "?"} out=${d.tokens?.output ?? "?"} rea=${d.tokens?.reasoning ?? "?"})`,
  )
  for (const part of d.content ?? []) {
    if (part.type === "reasoning") {
      console.log(`    (think ${(part.text ?? "").length}ch) ${String(part.text ?? "").slice(0, 260).replace(/\n/g, " ")}`)
    } else if (part.type === "text") {
      console.log(`    SAY: ${String(part.text ?? "").slice(0, 400).replace(/\n/g, "\n         ")}`)
    } else if (part.type === "tool") {
      const st = part.state ?? {}
      const dur = st.time?.completed && st.time?.start ? ((st.time.completed - st.time.start) / 1000).toFixed(1) : "?"
      console.log(`    TOOL ${part.name} (${dur}s) input=${JSON.stringify(st.input).slice(0, 300)}`)
      const text = (st.content ?? []).map((c) => c.text ?? "").join("")
      console.log(`         -> ${text.length}ch | ${text.slice(0, 420).replace(/\n/g, " ")}`)
    }
  }
}
