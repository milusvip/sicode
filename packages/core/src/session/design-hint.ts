export * as SessionDesignHint from "./design-hint.js"

import { readFile } from "fs/promises"
import { join } from "path"
import { DateTime } from "effect"
import { SessionMessage } from "./message.js"

/**
 * SiCode: puts the design values of the repository in front of the model on the requests that are
 * about to touch UI, because the alternative does not happen.
 *
 * `AGENTS.md` already says to read `packages/ui/DESIGN.md` before changing CSS. Measured on this
 * machine: 510 reads, of which 5 opened that file, against 245 writes under `packages/ui`,
 * `packages/session-ui` and `packages/app`. The instruction is not followed, so the values are not
 * in play and each component gets its own idea of a type scale.
 *
 * So this injects the values themselves, the way the repo map injects structure: condensed to the
 * tables and the rules, only on UI turns, only for the request. Nothing is written to the session,
 * and the cached system prefix is untouched.
 *
 * What is deliberately left out: the reasoning behind each value and the colour roles. They are
 * long, they do not change a decision at edit time, and the pointer to the full file is in the
 * block so the model can read it when it does need them.
 */

/** Files whose names say "this project has written its values down". */
const CANDIDATES = ["DESIGN.md", "docs/DESIGN.md", "packages/ui/DESIGN.md", "ui/DESIGN.md", ".sicode/DESIGN.md"]

/** Sections worth carrying: the ones that hold values. */
const KEEP = /font|weight|type|scale|space|spacing|radius|elevation|shadow|color|colour|token|sizing|breakpoint/i
/** Sections that are history or procedure, not values. */
const DROP = /drift|history|changelog|known issue|changing a surface|migration/i

/** A line worth keeping carries a variable or a pixel value. */
const VALUE_LINE = /--[a-z-]+|\d+(\.\d+)?(px|rem|em)\b/i
/** A table is kept only when it tabulates variables; the rest explain how a value resolves. */
const VALUE_TABLE = /token|--/i

/** Longest lead kept from one prose line. */
const LEAD_LIMIT = 460
/** A value, the rule that governs it, and the exception. A fourth sentence only restates them. */
const LEAD_SENTENCES = 3

/**
 * Section order by how often it decides an edit. The budget drops whole sections from the bottom,
 * so the scale and the radius ladder survive even in a project whose document runs long.
 */
const PRIORITY = [
  /type|scale|typograph/i,
  /radius|corner/i,
  /space|spacing|grid/i,
  /elevation|shadow|depth/i,
  /weight/i,
  /font/i,
  /color|colour/i,
]

/**
 * Whole sentences in document order, up to the limit. Order is kept on purpose: the sentence that
 * follows a value is usually the caveat that governs it (`440` and `530` stay hardcoded upstream),
 * and picking by keyword instead dropped the very caveat that changes the edit.
 *
 * The boundary is a CJK stop, or a Latin stop followed by a space: `0.25rem` and `e.g.` are not
 * sentence ends, and splitting on them truncated the value itself.
 */
const lead = (text: string) => {
  const sentences = text.split(/(?<=[。！？])|(?<=[.!?])(?=\s)/).slice(0, LEAD_SENTENCES)
  let out = ""
  for (const sentence of sentences) {
    if (out.length + sentence.length > LEAD_LIMIT) break
    out += sentence
  }
  if (out === "") {
    // One sentence longer than the limit: cut at a word boundary rather than mid-word.
    const cut = text.slice(0, LEAD_LIMIT)
    const space = cut.lastIndexOf(" ")
    out = (space > 40 ? cut.slice(0, space) : cut).trimEnd() + " …"
  }
  return out.trim()
}

/**
 * Condenses a design document to its values: tables of tokens, and the sentences of each rule that
 * carry a value or the rule itself. The rest of each rule explains a number that is already kept,
 * so it costs tokens without changing a decision.
 *
 * Pure, so the extraction can be checked against real documents instead of trusted.
 */
export const condense = (markdown: string, budget = 3000): string | undefined => {
  const sections = new Map<string, string[]>()
  let current: string | undefined
  let keeping = false
  // Whether the current table tabulates variables, decided by its header row.
  let valueTable = false
  let expectHeader = false

  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd()
    const heading = line.match(/^#{2,3}\s+(.*)$/)
    if (heading) {
      const title = heading[1]!.trim()
      keeping = KEEP.test(title) && !DROP.test(title)
      current = keeping ? title : undefined
      if (current) sections.set(current, [])
      valueTable = false
      expectHeader = true
      continue
    }
    if (!keeping || !current) continue

    const trimmed = line.trim()
    if (trimmed === "") {
      expectHeader = true
      continue
    }

    const bucket = sections.get(current)!
    if (trimmed.startsWith("|")) {
      // Table separators carry no information.
      if (/^\|[\s:|-]+\|$/.test(trimmed)) continue
      if (expectHeader) {
        valueTable = VALUE_TABLE.test(trimmed)
        expectHeader = false
        if (!valueTable) continue
      }
      if (valueTable) bucket.push(trimmed)
      continue
    }

    expectHeader = true
    if (!VALUE_LINE.test(trimmed)) continue
    bucket.push(lead(trimmed))
  }

  const rank = (title: string) => {
    const index = PRIORITY.findIndex((pattern) => pattern.test(title))
    return index === -1 ? PRIORITY.length : index
  }
  // Stable: sections that match no priority keep their document order after the ranked ones.
  const ordered = [...sections.keys()]
    .map((title, index) => ({ title, index }))
    .sort((a, b) => rank(a.title) - rank(b.title) || a.index - b.index)
    .map((entry) => entry.title)
    .filter((title) => sections.get(title)!.length > 0)

  // Whole sections only: half a table is worse than none.
  const output: string[] = []
  let used = 0
  for (const title of ordered) {
    const block = [`## ${title}`, ...sections.get(title)!]
    const size = block.reduce((total, line) => total + line.length + 1, 0)
    if (used + size > budget) continue
    output.push(...block)
    used += size
  }
  return output.length === 0 ? undefined : output.join("\n")
}

const CSS = /\.(css|scss|sass|less|styl)$/i
const MARKUP = /\.(tsx|jsx|vue|svelte|astro|html?)$/i
/**
 * Directories where a component file is plumbing rather than a surface. Inverted on purpose: a
 * component does not have to live under a folder called `ui` — `app/src/shell/left-sidebar.tsx`
 * is a surface too, and matching on names would have missed it.
 */
const NOT_UI = /(^|[\\/])(core|server|api|sdk|scripts?|tests?|fixtures|migrations|cli|tui)([\\/]|$)/i

const DESIGN_WORDS =
  /样式|字体|字号|字重|颜色|配色|排版|圆角|间距|边距|投影|阴影|深色|浅色|主题|界面|布局|对比度|\b(css|scss|tailwind|typography|design|theme|radius|spacing|elevation|contrast|palette|font-weight)\b/i

const touched = (input: { filePath?: unknown; path?: unknown }) =>
  String(input.filePath ?? input.path ?? "").replace(/\\/g, "/")

/** Whether an edit to this path is UI work. */
const isUI = (path: string) => CSS.test(path) || (MARKUP.test(path) && !NOT_UI.test(path))

/**
 * Whether this request is UI work: either it says so, or the turn before it edited UI files.
 * Only that one turn is inspected — one CSS edit does not make every later request a UI request —
 * and the answer depends on messages before this request's prompt, so it stays the same for every
 * step of the turn and the block keeps its position in the cached prefix.
 */
export const needed = (messages: ReadonlyArray<SessionMessage.Info>): boolean => {
  const index = messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return false
  const user = messages[index]
  if (user?.type === "user" && DESIGN_WORDS.test(user.text)) return true

  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const message = messages[cursor]!
    if (message.type === "user") break
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type !== "tool" || !["edit", "write", "patch"].includes(part.name)) continue
      if (isUI(touched(part.state.input as { filePath?: unknown; path?: unknown }))) return true
    }
  }
  return false
}

const hintMessage = (source: string, values: string): SessionMessage.Synthetic => ({
  id: SessionMessage.ID.create(),
  time: { created: DateTime.makeUnsafe(Date.now()) },
  type: "synthetic",
  metadata: { notice: "design-values" },
  description: `Design values from ${source}`,
  text: [
    "<design-values>",
    `Values for this repository, condensed from \`${source}\`. Emit these token names and numbers; do not invent a nearby value.`,
    "",
    values,
    "",
    `Read \`${source}\` when you need the reasoning behind a value, the colour roles, or the rules for changing a shared surface.`,
    "</design-values>",
  ].join("\n"),
})

/** The first candidate that exists and yields values. */
const find = async (directory: string, budget: number) => {
  for (const relative of CANDIDATES) {
    let markdown: string
    try {
      markdown = await readFile(join(directory, relative), "utf8")
    } catch {
      continue
    }
    const values = condense(markdown, budget)
    if (values) return { source: relative, values }
  }
  return undefined
}

/**
 * Prepends the condensed values when the request is UI work, or returns the messages unchanged.
 * Never throws: a missing or unreadable document is a reason to stay silent, not to fail a turn.
 */
export const inject = async (input: {
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly directory: string
  readonly enabled?: boolean
  readonly budget?: number
}): Promise<ReadonlyArray<SessionMessage.Info>> => {
  if (input.enabled === false) return input.messages
  if (!needed(input.messages)) return input.messages

  const found = await find(input.directory, input.budget ?? 3000).catch(() => undefined)
  if (!found) return input.messages

  const index = input.messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return input.messages

  const messages = [...input.messages]
  messages.splice(index + 1, 0, hintMessage(found.source, found.values))
  return messages
}
