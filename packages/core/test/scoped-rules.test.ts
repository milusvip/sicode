import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import type { SessionMessage } from "../src/session/message.js"
import { applies, inject, loadRules, parse } from "../src/session/scoped-rules.js"

const user = (text: string, id = "u1") =>
  ({ id, type: "user", text, time: { created: 0 }, files: [], agents: [], skills: [] }) as unknown as SessionMessage.Info

const rule = (frontmatter: string, body = "- do the thing\n") => `---\n${frontmatter}\n---\n${body}`

const project = async (files: Record<string, string>) => {
  const root = await mkdtemp(join(tmpdir(), "sicode-scoped-rules-"))
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true })
    await writeFile(join(root, path), content)
  }
  return root
}

describe("parse", () => {
  test("reads globs, always and description from frontmatter", () => {
    const parsed = parse(
      ".sicode/rules/ui.md",
      rule("description: UI values\nglobs: packages/ui/**/*.css\nalways: false", "- read DESIGN.md\n"),
    )
    expect(parsed).toMatchObject({
      source: ".sicode/rules/ui.md",
      text: "- read DESIGN.md",
      globs: ["packages/ui/**/*.css"],
      always: false,
      description: "UI values",
    })
  })

  test("accepts a comma-separated glob list and a YAML list", () => {
    expect(parse("a.md", rule("globs: a/**, b/**"))?.globs).toEqual(["a/**", "b/**"])
    expect(parse("a.md", rule("globs:\n  - a/**\n  - b/**"))?.globs).toEqual(["a/**", "b/**"])
  })

  test("keeps a brace glob intact when splitting the comma list", () => {
    const parsed = parse("a.md", rule("globs: packages/{ui,app}/**/*.{css,tsx}"))!
    expect(parsed.globs).toEqual(["packages/{ui,app}/**/*.{css,tsx}"])
    expect(applies(parsed, ["packages/ui/src/index.css"])).toBe(true)
    expect(applies(parsed, ["packages/app/src/a.tsx"])).toBe(true)
    expect(applies(parsed, ["packages/core/src/a.ts"])).toBe(false)
  })

  test("splits a comma list that also contains a brace glob", () => {
    expect(parse("a.md", rule("globs: packages/{ui,app}/**, docs/**"))?.globs).toEqual([
      "packages/{ui,app}/**",
      "docs/**",
    ])
  })

  test("drops a rule with no body, and a rule with no globs never applies", () => {
    expect(parse("a.md", rule("globs: a/**", "   \n"))).toBeUndefined()
    const bare = parse("a.md", "just text, no frontmatter")!
    expect(bare.globs).toEqual([])
    expect(applies(bare, ["a/b.ts"])).toBe(false)
  })
})

describe("applies", () => {
  const parsed = (glob: string, always = false) => parse("a.md", rule(`globs: ${glob}\nalways: ${always}`))!

  test("matches a glob against a project-relative path", () => {
    expect(applies(parsed("packages/ui/**/*.css"), ["packages/ui/src/styles/tokens/theme.css"])).toBe(true)
    expect(applies(parsed("packages/ui/**/*.css"), ["packages/app/src/index.css"])).toBe(false)
  })

  test("always rules ignore the path list", () => {
    expect(applies(parsed("nothing/**", true), [])).toBe(true)
    expect(applies(parsed("nothing/**"), [])).toBe(false)
  })
})

describe("loadRules / inject", () => {
  test("loads only the rules whose globs match this turn's paths", async () => {
    const root = await project({
      ".sicode/rules/ui.md": rule("globs: packages/ui/**/*.css", "- use theme tokens\n"),
      ".sicode/rules/core.md": rule("globs: packages/core/**/*.ts", "- keep it functional\n"),
    })

    const rules = await loadRules({ directory: root, paths: ["packages/ui/src/index.css"] })
    expect(rules.map((item) => item.source)).toEqual([".sicode/rules/ui.md"])
    expect(rules[0]!.text).toContain("use theme tokens")
  })

  test("matches an absolute tool path against the project root", async () => {
    const root = await project({
      ".sicode/rules/core.md": rule("globs: packages/core/**/*.ts", "- functional\n"),
    })
    const absolute = join(root, "packages", "core", "src", "tool", "grep.ts").replace(/\\/g, "/")
    const rules = await loadRules({ directory: root, paths: [absolute] })
    expect(rules.map((item) => item.source)).toEqual([".sicode/rules/core.md"])
  })

  test("ignores paths outside the project and rules without globs", async () => {
    const root = await project({
      ".sicode/rules/core.md": rule("globs: packages/core/**/*.ts", "- functional\n"),
      ".sicode/rules/docs.md": rule("description: reference only", "- never injected\n"),
    })
    expect(await loadRules({ directory: root, paths: ["D:/other/packages/core/a.ts"] })).toEqual([])
    expect(await loadRules({ directory: root, paths: [] })).toEqual([])
  })

  test("always rules load even when the turn names no path", async () => {
    const root = await project({
      ".sicode/rules/all.md": rule("always: true", "- answer in Chinese\n"),
    })
    const rules = await loadRules({ directory: root, paths: [] })
    expect(rules.map((item) => item.source)).toEqual([".sicode/rules/all.md"])
  })

  test("injects a synthetic block after the current user message", async () => {
    const root = await project({
      ".sicode/rules/ui.md": rule("description: UI values\nglobs: packages/ui/**/*.css", "- read DESIGN.md\n"),
    })
    const messages = await inject({
      directory: root,
      messages: [user("改 packages/ui/src/index.css 的圆角")],
    })
    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({ type: "synthetic", metadata: { notice: "scoped-rules" } })
    const text = (messages[1] as { text: string }).text
    expect(text).toContain("read DESIGN.md")
    expect(text).toContain(".sicode/rules/ui.md")
    expect(text).toContain("UI values")
  })

  test("stays silent when disabled, when no glob matches, or when the directory is missing", async () => {
    const root = await project({
      ".sicode/rules/ui.md": rule("globs: packages/ui/**/*.css", "- tokens\n"),
    })
    expect(await inject({ directory: root, messages: [user("随便聊聊")] })).toHaveLength(1)
    expect(
      await inject({ directory: root, messages: [user("改 packages/ui/src/index.css")], enabled: false }),
    ).toHaveLength(1)
    expect(await inject({ directory: join(root, "missing"), messages: [user("改 a.css")] })).toHaveLength(1)
  })

  test("honours the budget in file-name order", async () => {
    const root = await project({
      ".sicode/rules/a.md": rule("always: true", `- ${"a".repeat(400)}\n`),
      ".sicode/rules/b.md": rule("always: true", `- ${"b".repeat(400)}\n`),
    })
    const rules = await loadRules({ directory: root, paths: [], budget: 600 })
    expect(rules.map((item) => item.source)).toEqual([".sicode/rules/a.md"])
  })
})
