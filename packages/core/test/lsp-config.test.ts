import { describe, expect, test } from "bun:test"
import { LspConfig } from "@opencode/core/lsp/config"

const typescript = { command: ["typescript-language-server", "--stdio"], extensions: [".ts", ".tsx"] }

describe("lsp config selection", () => {
  test("disabled when config is false", () => {
    expect(LspConfig.select(false, "src/retry.ts")).toBe("disabled")
  })

  test("unconfigured when config is true (no built-ins yet)", () => {
    expect(LspConfig.select(true, "src/retry.ts")).toBe("unconfigured")
  })

  test("unconfigured when nothing matches the extension", () => {
    expect(LspConfig.select({ typescript: { ...typescript, extensions: [".ts"] } }, "src/main.rs")).toBe("unconfigured")
  })

  test("matches by extension, case-insensitively", () => {
    const selected = LspConfig.select({ typescript }, "src/Retry.TS")
    expect(selected).not.toBe("unconfigured")
    if (selected !== "unconfigured" && selected !== "disabled") expect(selected.name).toBe("typescript")
  })

  test("an entry without extensions matches every file", () => {
    const selected = LspConfig.select({ pyright: { command: ["pyright-langserver", "--stdio"] } }, "app.py")
    expect(selected).not.toBe("unconfigured")
    if (selected !== "unconfigured" && selected !== "disabled") expect(selected.name).toBe("pyright")
  })

  test("skips a disabled entry and falls through to the next", () => {
    const selected = LspConfig.select({
      zed: { ...typescript, disabled: true },
      typescript,
    }, "src/retry.ts")
    if (selected !== "unconfigured" && selected !== "disabled") expect(selected.name).toBe("typescript")
    else throw new Error("expected a server")
  })

  test("skips an entry with an empty command", () => {
    expect(LspConfig.select({ empty: { command: [] } }, "src/retry.ts")).toBe("unconfigured")
  })

  test("normalizes Windows paths and extensionless files", () => {
    expect(LspConfig.extensionOf("C:\\repo\\src\\retry.ts")).toBe(".ts")
    expect(LspConfig.extensionOf("/repo/Makefile")).toBe("")
    expect(LspConfig.extensionOf("/repo/.gitignore")).toBe("")
  })
})
