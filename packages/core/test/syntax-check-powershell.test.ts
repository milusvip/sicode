import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { PowerShellCheck } from "../src/syntax-check/powershell"

// `.ps1` was 11.4% of the editor calls measured on this machine, so this checker carries real
// weight. It uses the tree-sitter grammar the package already depends on, which also means the
// cases below double as the proof that ordinary PowerShell is not flagged.

const check = (source: string) => Effect.runPromise(PowerShellCheck.check(source))

describe("powershell syntax check", () => {
  test("reports an unclosed block", async () => {
    const diagnostics = await check('if ($true) {\n  Write-Output "hi"\n')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.line).toBe(2)
    expect(diagnostics[0]?.message).toContain("}")
  })

  test("reports an unclosed parenthesis", async () => {
    const diagnostics = await check('Get-ChildItem -Path "C:\\tmp"\nWrite-Output (1 + \n')
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.line).toBe(2)
  })

  test("reports a malformed function header", async () => {
    const diagnostics = await check("function f( {\n}\n")
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.line).toBe(1)
  })

  test("collapses nested error nodes to one diagnostic per position", async () => {
    // An ERROR node wrapping a missing child would otherwise report the same spot twice.
    const diagnostics = await check("function f( {\n}\n")
    const keys = diagnostics.map((diagnostic) => `${diagnostic.line}:${diagnostic.character}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test.each([
    ["plain block", 'if ($true) {\n  Write-Output "hi"\n}\n'],
    ["function with param block", "function Get-Thing {\n  param($Name)\n  return $Name\n}\n"],
    ["here-string", "$x = @'\nhello\n'@\n"],
    ["class", "class Foo {\n  [string]$Name\n  [int] Bar() { return 1 }\n}\n"],
    ["pipeline with script block", "Get-Process | Where-Object { $_.CPU -gt 1 } | Sort-Object CPU\n"],
    ["try/catch/finally", "try {\n  Get-Item missing\n} catch {\n  Write-Error $_\n} finally {\n  Write-Output done\n}\n"],
    ["hashtable and splat", "$opts = @{ Path = 'C:\\'; Recurse = $true }\nGet-ChildItem @opts\n"],
  ])("does not flag %s", async (_name, source) => {
    expect(await check(source)).toEqual([])
  })
})

describe("powershell availability", () => {
  test("is available when the grammar path is set", () => {
    // The bundled grammar resolves on bun and node; workerd blanks the path and must report false.
    expect(PowerShellCheck.available()).toBe(true)
  })
})
