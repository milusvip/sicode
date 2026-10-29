import { describe, expect, test } from "bun:test"
import { mkdtemp } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import type { SessionMessage } from "../src/session/message.js"
import { condense, inject, needed } from "../src/session/design-hint.js"

const user = (text: string, id = "u1") =>
  ({ id, type: "user", text, time: { created: 0 }, files: [], agents: [], skills: [] }) as unknown as SessionMessage.Info

const edit = (path: string, id = "a1") =>
  ({
    id,
    type: "assistant",
    time: { created: 0 },
    content: [{ type: "tool", name: "edit", state: { status: "completed", input: { filePath: path } } }],
  }) as unknown as SessionMessage.Info

const assistant = (id = "a0") =>
  ({ id, type: "assistant", time: { created: 0 }, content: [] }) as unknown as SessionMessage.Info

const DOC = `# Web UI design system

Prose that explains the whole thing at length and carries no values at all.

## Font stack

- Sans: \`--font-family-sans\` — one face for both scripts. It is chosen so mixed text reads as one typeface.

## Weight

\`theme.css\` declares \`--font-weight-regular: 400\` and \`--font-weight-bold: 670\`.
\`--font-weight-regular\` only governs declarations that reference the token. The CSS also hardcodes \`440\` in a few hundred places; those were left alone.

| face | real weights | \`400\` resolves to |
| --- | --- | --- |
| a static install | 400, 500, 700 | 400 |

## Type scale

| token | value | role |
| --- | --- | --- |
| \`--font-size-small\` | 14px | secondary row |
| \`--font-size-base\` | 15px | body |

## Radius

| token | value |
| --- | --- |
| \`--radius-md\` | 6px |

10px is the ceiling.

## Known drift (2026-10-25)

- \`font-size\` still appears as a literal in roughly 75 places across 10 distinct values.
`

describe("condense", () => {
  test("keeps the token tables and the rules that carry a value", () => {
    const out = condense(DOC)!
    expect(out).toContain("| `--font-size-small` | 14px | secondary row |")
    expect(out).toContain("| `--radius-md` | 6px |")
    expect(out).toContain("10px is the ceiling.")
    expect(out).toContain("--font-weight-regular: 400")
  })

  test("keeps the caveat that follows a value", () => {
    // The sentence after the declaration is what stops a half-done weight change: 440 stays.
    expect(condense(DOC)).toContain("440")
  })

  test("drops history sections and tables that are not about tokens", () => {
    const out = condense(DOC)!
    expect(out).not.toContain("Known drift")
    expect(out).not.toContain("75 places")
    expect(out).not.toContain("real weights")
  })

  test("orders sections by what decides an edit, not by document order", () => {
    const out = condense(DOC)!
    expect(out.indexOf("## Type scale")).toBeLessThan(out.indexOf("## Radius"))
    expect(out.indexOf("## Radius")).toBeLessThan(out.indexOf("## Font stack"))
  })

  test("drops whole sections rather than half a table when the budget runs out", () => {
    const out = condense(DOC, 180)!
    expect(out).toContain("## Type scale")
    expect(out).not.toContain("## Radius")
  })

  test("returns nothing for a document with no values", () => {
    expect(condense("# Notes\n\nJust prose, no numbers and no variables.\n")).toBeUndefined()
  })
})

describe("needed", () => {
  test("fires when the request itself is about UI", () => {
    expect(needed([user("把圆角改小一点")])).toBe(true)
    expect(needed([user("the contrast is too low in dark mode")])).toBe(true)
  })

  test("fires when the turn before edited UI files", () => {
    expect(needed([user("继续", "u1"), edit("packages/ui/src/button/button.css"), user("再改一处", "u2")])).toBe(
      true,
    )
    expect(needed([user("继续", "u1"), edit("packages/app/src/shell/left-sidebar.tsx"), user("再改一处", "u2")])).toBe(
      true,
    )
  })

  test("stays silent for edits that are not UI, and for older turns", () => {
    expect(needed([user("继续", "u1"), edit("packages/core/src/bus.ts"), user("再看一下", "u2")])).toBe(false)
    // A CSS edit two turns back does not make every later request a UI request.
    expect(
      needed([
        user("改样式", "u1"),
        edit("packages/ui/src/a.css"),
        user("换个话题", "u2"),
        assistant("a2"),
        user("写个脚本", "u3"),
      ]),
    ).toBe(false)
  })
})

describe("inject", () => {
  test("adds the values right after the prompt on a UI turn", async () => {
    const directory = await mkdtemp(join(tmpdir(), "design-"))
    await Bun.write(join(directory, "DESIGN.md"), DOC)

    const messages = await inject({ messages: [user("把圆角改小一点")], directory })
    expect(messages).toHaveLength(2)
    const hint = messages[1] as SessionMessage.Synthetic
    expect(hint.type).toBe("synthetic")
    expect(hint.text).toContain("<design-values>")
    expect(hint.text).toContain("DESIGN.md")
    expect(hint.text).toContain("--radius-md")
    expect(hint.text).not.toContain("```")
  })

  test("leaves a non-UI request alone", async () => {
    const directory = await mkdtemp(join(tmpdir(), "design-"))
    await Bun.write(join(directory, "DESIGN.md"), DOC)
    const messages = [user("写个脚本统计工具调用")]
    expect(await inject({ messages, directory })).toBe(messages)
  })

  test("leaves the request alone when the project wrote no values down", async () => {
    const directory = await mkdtemp(join(tmpdir(), "design-"))
    const messages = [user("把圆角改小一点")]
    expect(await inject({ messages, directory })).toBe(messages)
  })

  test("can be switched off", async () => {
    const directory = await mkdtemp(join(tmpdir(), "design-"))
    await Bun.write(join(directory, "DESIGN.md"), DOC)
    const messages = [user("把圆角改小一点")]
    expect(await inject({ messages, directory, enabled: false })).toBe(messages)
  })
})
