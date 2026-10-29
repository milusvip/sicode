import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { areaOf, fileOf, incoming, parse, render } from "./notes"

test("an area loses its date, so one area cannot split into two sections", () => {
  expect(areaOf("侧边栏浏览器（2026-10-23 晚）")).toBe("侧边栏浏览器")
  expect(areaOf("About (2026-10-23)")).toBe("About")
  expect(areaOf("项目记忆（SiCode 新增）")).toBe("项目记忆")
  // A name with no decoration survives untouched.
  expect(areaOf("过程壳 / 时间线")).toBe("过程壳 / 时间线")
})

test("a heading inside a fenced block is an example, not a section", () => {
  const { head, sections } = parse(
    ["# 笔记", "", "## 写法", "", "```markdown", "## 示例区域", "- 举例", "```", "", "## 真实区域", "- 事实", ""].join("\n"),
  )

  expect(head).toEqual(["# 笔记", ""])
  // "写法" is a real section; the heading inside its fenced example is content, so it stays in that section's body.
  expect(sections.map((section) => section.area)).toEqual(["写法", "真实区域"])
  expect(sections[0].lines.join("\n")).toContain("## 示例区域")
})

test("only bullets that are new reach the file, and a bare line becomes a bullet", () => {
  const existing = ["- 已经写过的", "  - 缩进的也算"]
  expect(incoming("- 已经写过的\n- 新的一条\n\n裸行\n", existing)).toEqual(["- 新的一条", "- 裸行"])
})

test("rendering keeps the preamble and leaves one blank line between sections", () => {
  const text = render(
    ["# 笔记", "", "引言"],
    [
      { title: "甲", area: "甲", lines: ["- a", "", ""] },
      { title: "乙", area: "乙", lines: ["- b"] },
    ],
  )

  expect(text).toBe("# 笔记\n\n引言\n\n## 甲\n\n- a\n\n## 乙\n\n- b\n")
})

test("a check runs on repo files only, so commands and package names never cry wolf", () => {
  expect(fileOf("packages/core/src/session/compaction.ts:159")).toBe("packages/core/src/session/compaction.ts")
  // A short path quoted from inside a package resolves through `packages/`.
  expect(fileOf("gui-extensions/src/browser/panel.tsx")).toBe("packages/gui-extensions/src/browser/panel.tsx")

  expect(fileOf("@opencode/ui/logo")).toBeUndefined()
  expect(fileOf("bun run generate")).toBeUndefined()
  expect(fileOf(".workbuddy/memory/YYYY-MM-DD.md")).toBeUndefined()
  expect(fileOf("notes/browser.md")).toBeUndefined()
  expect(fileOf("https://example.com/a")).toBeUndefined()
  // Neither routes nor elisions are repo files: reading the leading slash as a segment reported every
  // one of them as `packages//init`, `packages//json`, and so on.
  expect(fileOf("/init")).toBeUndefined()
  expect(fileOf("/api/provider/models")).toBeUndefined()
  expect(fileOf("packages/{client,protocol,core}")).toBeUndefined()
  expect(fileOf("app/.../virtualizer.tsx")).toBeUndefined()
  // A trailing slash is still the directory beside it.
  expect(fileOf("packages/gui-extensions/")).toBe("packages/gui-extensions")
})

test("writers that save at the same time keep every paragraph", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sicode-notes-"))
  const file = path.join(dir, "notes.md")
  const script = path.join(import.meta.dir, "notes.ts")
  fs.writeFileSync(file, "# 笔记\n\n## 已有\n- 旧事实\n")

  // A file per writer: the point is that the three of them save the same notes file at once, not how they quote
  // their bullets. (Bun's stdin pipe on Windows drops the payload, so stdin is not usable here.)
  const write = async (area: string, line: string) => {
    const input = path.join(dir, `${area}-${Math.random().toString(36).slice(2)}.md`)
    fs.writeFileSync(input, `${line}\n`)
    const proc = Bun.spawn([process.execPath, script, "add", "--area", area, "--file", input], {
      env: { ...process.env, SICODE_NOTES: file },
      stdout: "pipe",
      stderr: "pipe",
    })
    return proc.exited
  }

  // The case that lost data before: three writers, two of them on the same area, all at once.
  const codes = await Promise.all([write("甲", "- 甲的事实"), write("乙", "- 乙的事实"), write("甲", "- 甲的第二条")])
  expect(codes).toEqual([0, 0, 0])

  const text = fs.readFileSync(file, "utf8")
  for (const line of ["- 旧事实", "- 甲的事实", "- 甲的第二条", "- 乙的事实"]) expect(text).toContain(line)
  // Two writers on one area merge into one section rather than adding a second heading.
  expect(text.match(/^## 甲$/gm)).toHaveLength(1)
})
