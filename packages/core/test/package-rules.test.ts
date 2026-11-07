import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import type { SessionMessage } from "../src/session/message.js"
import { collectPaths, inject, loadRules, ruleDirs } from "../src/session/package-rules.js"

const user = (text: string, id = "u1") =>
  ({ id, type: "user", text, time: { created: 0 }, files: [], agents: [], skills: [] }) as unknown as SessionMessage.Info

const tool = (name: string, path: string, id = "a1") =>
  ({
    id,
    type: "assistant",
    time: { created: 0 },
    content: [{ type: "tool", name, state: { status: "completed", input: { path } } }],
  }) as unknown as SessionMessage.Info

describe("collectPaths", () => {
  test("pulls package paths out of the user message", () => {
    expect(collectPaths([user("改 packages/ui/src/button.tsx 的圆角")])).toEqual([
      "packages/ui/src/button.tsx",
    ])
  })

  test("pulls paths from the prior assistant turn's file tools", () => {
    expect(
      collectPaths([
        user("先看看", "u0"),
        tool("edit", "packages/app/src/shell/left-sidebar.tsx"),
        user("继续"),
      ]),
    ).toEqual(["packages/app/src/shell/left-sidebar.tsx"])
  })

  test("still sees the assistant turn immediately before the current user message", () => {
    // Same window as design-hint: the prior turn counts; only turns before that user message do not.
    expect(
      collectPaths([
        user("old", "u0"),
        tool("edit", "packages/core/src/a.ts", "a0"),
        user("mid", "u1"),
        tool("edit", "packages/ui/src/a.tsx", "a1"),
        user("unrelated"),
      ]),
    ).toEqual(["packages/ui/src/a.tsx"])
  })
})

describe("ruleDirs", () => {
  test("walks ancestors deepest-first and drops the filename", () => {
    expect(ruleDirs("packages/ui/src/button.tsx", "/repo")).toEqual([
      "packages/ui/src",
      "packages/ui",
      "packages",
    ])
  })

  test("ignores paths outside the root", () => {
    expect(ruleDirs("D:/other/packages/ui/a.tsx", "E:/repo")).toEqual([])
  })
})

describe("loadRules / inject", () => {
  test("loads the deepest AGENTS.md under budget and skips the repo root", async () => {
    const root = await mkdtemp(join(tmpdir(), "sicode-package-rules-"))
    await mkdir(join(root, "packages", "ui", "src"), { recursive: true })
    await writeFile(join(root, "AGENTS.md"), "# Root\n- never inject me\n")
    await writeFile(join(root, "packages", "ui", "AGENTS.md"), "## Design tokens\n- use theme tokens\n")

    const rules = await loadRules({
      directory: root,
      paths: ["packages/ui/src/button.tsx"],
    })
    expect(rules.map((rule) => rule.source)).toEqual(["packages/ui/AGENTS.md"])
    expect(rules[0]!.text).toContain("use theme tokens")
  })

  test("prefers the deeper file when both a package and a nested guide exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "sicode-package-rules-"))
    await mkdir(join(root, "packages", "core", "src", "tool"), { recursive: true })
    await writeFile(join(root, "packages", "core", "AGENTS.md"), "# Core package\n- package level\n")
    await writeFile(join(root, "packages", "core", "src", "tool", "AGENTS.md"), "# Tool arch\n- tool level\n")

    const rules = await loadRules({
      directory: root,
      paths: ["packages/core/src/tool/plugin/grep.ts"],
      budget: 500,
    })
    expect(rules[0]!.source).toBe("packages/core/src/tool/AGENTS.md")
  })

  test("injects a synthetic block after the current user message", async () => {
    const root = await mkdtemp(join(tmpdir(), "sicode-package-rules-"))
    await mkdir(join(root, "packages", "app"), { recursive: true })
    await writeFile(join(root, "packages", "app", "AGENTS.md"), "## Debugging\n- NEVER restart the app\n")

    const messages = await inject({
      directory: root,
      messages: [user("fix packages/app/src/shell/left-sidebar.tsx")],
    })
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ type: "user" })
    expect(messages[1]).toMatchObject({ type: "synthetic", metadata: { notice: "package-rules" } })
    expect((messages[1] as { text: string }).text).toContain("NEVER restart the app")
    expect((messages[1] as { text: string }).text).toContain("packages/app/AGENTS.md")
  })

  test("stays silent when disabled or when no package path is in play", async () => {
    const root = await mkdtemp(join(tmpdir(), "sicode-package-rules-"))
    await mkdir(join(root, "packages", "ui"), { recursive: true })
    await writeFile(join(root, "packages", "ui", "AGENTS.md"), "- tokens\n")

    expect(await inject({ directory: root, messages: [user("随便聊聊")], enabled: true })).toHaveLength(1)
    expect(
      await inject({
        directory: root,
        messages: [user("改 packages/ui/src/a.tsx")],
        enabled: false,
      }),
    ).toHaveLength(1)
  })
})
