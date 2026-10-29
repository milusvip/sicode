#!/usr/bin/env bun
// Writes `.sicode/notes.md` without losing anyone else's writing.
//
//   bun script/notes.ts add --area "侧边栏浏览器" <<'EOF'
//   - 新查到的事实：`path/to/file.ts:42` 做什么
//   EOF
//
//   bun script/notes.ts list
//   bun script/notes.ts verify      # paths that no longer exist
//   bun script/notes.ts merge       # collapse "区（2026-10-23）" into "区"
//
// Why this exists: several agents work in this repo at once, and each of them "just writes the file". A whole-file
// write is a read-modify-write with no lock, so whoever saves last silently drops everyone else's paragraphs — which
// is exactly what happened here twice. Writing through one command makes every writer serial, and merging per area
// makes two agents editing different areas unable to touch each other at all.
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")
// Overridable so a test can point the command at a scratch file instead of the real notes.
const NOTES = process.env.SICODE_NOTES ? path.resolve(process.env.SICODE_NOTES) : path.join(ROOT, ".sicode", "notes.md")
const LOCK = `${NOTES}.lock`

/** The name an area is filed under: dates and decoration are dropped so "区（2026-10-23）" joins "区". */
export function areaOf(title: string) {
  return title
    .replace(/[（(][^）)]*[）)]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
}

type Section = { title: string; area: string; lines: string[] }

/** Split the file into the preamble and its `## ` sections, keeping every line that is not a heading. */
export function parse(text: string) {
  const lines = text.split("\n")
  const head: string[] = []
  const sections: Section[] = []
  let current: Section | undefined
  let fenced = false

  for (const line of lines) {
    if (/^\s*```/.test(line)) fenced = !fenced
    if (!fenced && /^## /.test(line)) {
      current = { title: line.slice(3).trim(), area: areaOf(line.slice(3)), lines: [] }
      sections.push(current)
      continue
    }
    if (current) current.lines.push(line)
    else head.push(line)
  }

  return { head, sections }
}

export function render(head: string[], sections: Section[]) {
  const out = [...head]
  if (sections.length > 0 && out.length > 0 && out[out.length - 1].trim()) out.push("")
  for (const section of sections) {
    // A blank line after the heading is part of the layout: without it a table or a list butts against the title.
    out.push(`## ${section.title}`, "")
    const body = section.lines
      .join("\n")
      .replace(/^\n+/, "")
      .replace(/\s+$/, "")
    if (body) out.push(body)
    out.push("")
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n*$/, "\n")
}

function lock() {
  const deadline = Date.now() + 10_000
  for (;;) {
    try {
      fs.mkdirSync(LOCK)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      // A lock older than a minute is a writer that died mid-save; taking it over beats hanging forever.
      const age = Date.now() - fs.statSync(LOCK).mtimeMs
      if (age > 60_000) {
        fs.rmSync(LOCK, { recursive: true, force: true })
        continue
      }
      if (Date.now() > deadline) throw new Error(`another writer holds ${LOCK}; try again in a moment`)
      Bun.sleepSync(50)
    }
  }
}

function unlock() {
  fs.rmSync(LOCK, { recursive: true, force: true })
}

/** Read, change and write the file while nobody else can be between the read and the write. */
function edit(change: (text: string) => string) {
  lock()
  try {
    const before = fs.existsSync(NOTES) ? fs.readFileSync(NOTES, "utf8") : ""
    const after = change(before)
    if (after === before) return false
    // Write beside the file and rename: a half-written notes file is worse than no update.
    const temp = `${NOTES}.${process.pid}.tmp`
    fs.writeFileSync(temp, after)
    fs.renameSync(temp, NOTES)
    return true
  } finally {
    unlock()
  }
}

/** The bullets an agent hands over, cleaned of fences, blank edges and bullets already on file. */
export function incoming(raw: string, existing: string[]) {
  const lines = raw
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim() && !/^\s*```/.test(line))
    .map((line) => (/^\s*[-*]\s/.test(line) ? line : `- ${line.trim()}`))

  const seen = new Set(existing.map((line) => line.trim()))
  return lines.filter((line) => {
    if (seen.has(line.trim())) return false
    seen.add(line.trim())
    return true
  })
}

export function add(area: string, raw: string) {
  const changed = edit((text) => {
    const { head, sections } = parse(text)
    const section = sections.find((item) => item.area === area)
    const lines = incoming(raw, section?.lines ?? [])

    if (lines.length === 0) return text

    if (section) {
      // Only the edges lose their blanks: a table and the list under it are separated by one, and stripping every
      // blank line would run them together.
      const body = [...section.lines]
      while (body.length > 0 && !body[0].trim()) body.shift()
      while (body.length > 0 && !body[body.length - 1].trim()) body.pop()
      // A `---` that closes the section stays below the new bullets, or the next agent reads it as a separator
      // between the area and its own facts.
      const tail: string[] = []
      while (body.length > 0 && /^-{3,}$/.test(body[body.length - 1].trim())) tail.unshift(body.pop()!)
      section.lines = [...body, ...lines, ...tail, ""]
      return render(head, sections)
    }

    // A new area goes last, so the preamble and the existing areas keep the order their writers left them in.
    return render(head, [...sections, { title: area, area, lines: [...lines, ""] }])
  })

  if (!changed) {
    console.log(`nothing new for "${area}"`)
    return
  }

  const { sections } = parse(fs.readFileSync(NOTES, "utf8"))
  const section = sections.find((item) => item.area === area)
  console.log(`wrote "${area}" (${section?.lines.filter((line) => line.trim()).length ?? 0} lines)`)
}

export function list() {
  const { sections } = parse(fs.readFileSync(NOTES, "utf8"))
  for (const section of sections) {
    const count = section.lines.filter((line) => /^\s*[-*]\s/.test(line)).length
    console.log(`${String(count).padStart(3)}  ${section.area}${section.title !== section.area ? "  (has a date)" : ""}`)
  }
}

/** Correct a note that names the wrong path, in the same lock every writer already takes. */
export function fix(pairs: ReadonlyArray<readonly [string, string]>) {
  if (pairs.length === 0) throw new Error('fix needs --from "old" --to "new"')
  const changed = edit((text) => pairs.reduce((next, [from, to]) => next.split(from).join(to), text))
  console.log(changed ? `fixed ${pairs.length} pattern(s)` : "nothing to fix")
}

const ROOTS = ["packages", "script", ".sicode", "docs"]

/**
 * The repo file a backticked value names, or nothing when it names something else. Notes quote short paths
 * (`gui-extensions/src/...`) as often as full ones, so a first segment that matches a package is resolved through
 * `packages/`. Everything that is a command, a glob, a placeholder, an npm specifier or a URL is skipped: a check that
 * cries wolf about `@opencode/ui/logo` teaches everyone to ignore it.
 */
export function fileOf(value: string) {
  const cleaned = value.replace(/:\d+(?:-\d+)?$/, "").trim().replace(/\/+$/, "")
  if (/[\s"'=<>|]/.test(cleaned)) return
  if (/[*?]/.test(cleaned)) return
  if (/^[@#]|^https?:/.test(cleaned)) return
  if (/[A-Z]{3,}/.test(cleaned)) return
  // Not paths: an HTTP route or absolute path (`/init`, `/assets/main.js`), a brace-expanded list
  // (`packages/{client,app}`), or an elision (`app/.../virtualizer.tsx`). Reading a leading slash as
  // a first segment turned every route into `packages//init` and reported it missing.
  if (/^\/|\/\/|[{}]|\.\.\./.test(cleaned)) return

  const [first, ...rest] = cleaned.split("/")
  if (!first || rest.length === 0) return
  if (ROOTS.includes(first)) return cleaned
  if (fs.existsSync(path.join(ROOT, "packages", first))) return `packages/${cleaned}`
  return
}

export function verify() {
  const { sections } = parse(fs.readFileSync(NOTES, "utf8"))
  let checked = 0
  const missing: string[] = []

  for (const section of sections) {
    for (const line of section.lines) {
      for (const match of line.matchAll(/`([^`]+)`/g)) {
        const file = fileOf(match[1])
        if (!file) continue
        checked++
        if (!fs.existsSync(path.join(ROOT, file))) missing.push(`[${section.area}] ${file}`)
      }
    }
  }

  if (missing.length === 0) {
    console.log(`${checked} paths, all present`)
    return
  }

  console.log(`${checked} paths, ${missing.length} missing:`)
  for (const line of missing) console.log(`  ${line}`)
  process.exitCode = 1
}

/** Fold every dated twin into one section per area, keeping the first position and dropping repeated bullets. */
/** Reads repeated `--alias "from=to"` pairs, so differently named sections of one subject can be joined. */
function aliases(rest: string[]) {
  const map = new Map<string, string>()
  for (let at = 0; at < rest.length; at++) {
    if (rest[at] !== "--alias") continue
    const pair = rest[at + 1]
    if (!pair) throw new Error('--alias needs "from=to"')
    const split = pair.indexOf("=")
    if (split <= 0) throw new Error(`--alias needs "from=to", got: ${pair}`)
    map.set(areaOf(pair.slice(0, split)), areaOf(pair.slice(split + 1)))
  }
  return map
}

export function merge(aliases: ReadonlyMap<string, string> = new Map()) {
  const changed = edit((text) => {
    const { head, sections } = parse(text)
    const merged: Section[] = []
    const index = new Map<string, Section>()

    for (const section of sections) {
      // One hop only: a chain would make the result depend on the order the sections happen to appear in.
      const area = aliases.get(section.area) ?? section.area
      const existing = index.get(area)
      if (!existing) {
        // Even a section with no twin loses its date: the file is read by area, and a date in the title makes the
        // same area look like two.
        const copy = { ...section, area, title: area, lines: [...section.lines] }
        index.set(area, copy)
        merged.push(copy)
        continue
      }
      for (const line of section.lines) {
        if (!line.trim()) continue
        if (existing.lines.some((kept) => kept.trim() === line.trim())) continue
        existing.lines.push(line)
      }
      // One separator, not one per absorbed section: the trailing blank line each section carried would stack up.
      while (existing.lines.length > 0 && !existing.lines[existing.lines.length - 1]!.trim()) existing.lines.pop()
      existing.lines.push("")
    }

    return render(head, merged)
  })

  console.log(changed ? "merged" : "nothing to merge")
}

// Top-level await, not `void dispatch()`: reading stdin is asynchronous, and a floating promise lets the process exit
// before the paste arrives — which made a piped `add` succeed with nothing written.
if (import.meta.main) {
  try {
    await dispatch()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

async function dispatch() {
const [command, ...rest] = process.argv.slice(2)
const option = (name: string) => {
  const at = rest.indexOf(`--${name}`)
  return at >= 0 ? rest[at + 1] : undefined
}

if (command === "add") {
  const area = option("area")
  if (!area) throw new Error('add needs --area "<区域名>"')
  const file = option("file")
  const raw = file ? fs.readFileSync(path.resolve(file), "utf8") : await Bun.stdin.text()
  if (!raw.trim()) throw new Error("add needs bullets on stdin or in --file")
  add(areaOf(area), raw)
} else if (command === "list") {
  list()
} else if (command === "verify") {
  verify()
} else if (command === "fix") {
  const from: string[] = []
  const to: string[] = []
  for (let at = 0; at < rest.length; at++) {
    if (rest[at] === "--from") from.push(rest[++at] ?? "")
    else if (rest[at] === "--to") to.push(rest[++at] ?? "")
  }
  if (from.length !== to.length) throw new Error("fix needs one --to per --from")
  fix(from.map((value, index) => [value, to[index]!] as const))
} else if (command === "merge") {
  merge(aliases(rest))
} else {
  console.log('usage: bun script/notes.ts <add --area NAME|list|verify|merge [--alias "from=to"]...>')
  process.exitCode = 1
}
}
