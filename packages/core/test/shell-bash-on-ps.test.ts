import { describe, expect, test } from "bun:test"
import { BASH_ON_POWERSHELL_NOTICE, detectBashOnPowerShell } from "@opencode/core/tool/plugin/shell"

const pwsh = "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
const bash = "/usr/bin/bash"

const detects = (command: string, shell = pwsh) => detectBashOnPowerShell({ command, shell })

describe("detectBashOnPowerShell", () => {
  test("blocks bash-only shapes on PowerShell", () => {
    expect(detects(`Get-Content log.txt | tail -n 20`)).toBe(BASH_ON_POWERSHELL_NOTICE)
    expect(detects(`tail -n 20 log.txt`)).toBe(BASH_ON_POWERSHELL_NOTICE)
    expect(detects(`for f in *.ts; do echo $f; done`)).toBe(BASH_ON_POWERSHELL_NOTICE)
    expect(detects(`sed -i 's/a/b/' file.txt`)).toBe(BASH_ON_POWERSHELL_NOTICE)
    expect(detects(`ls -la packages/core`)).toBe(BASH_ON_POWERSHELL_NOTICE)
    expect(detects(`cat README.md`)).toBe(BASH_ON_POWERSHELL_NOTICE)
    expect(detects(`bun script/notes.ts add --area x <<'EOF'\n- bullet\nEOF`)).toBe(BASH_ON_POWERSHELL_NOTICE)
  })

  test("allows PowerShell equivalents", () => {
    expect(detects(`Get-Content log.txt | Select-Object -Last 20`)).toBeUndefined()
    expect(detects(`Get-ChildItem packages/core`)).toBeUndefined()
    expect(detects(`foreach ($f in Get-ChildItem *.ts) { $f.Name }`)).toBeUndefined()
    expect(detects(`Get-Content README.md`)).toBeUndefined()
  })

  test("does nothing when the session shell is not PowerShell", () => {
    expect(detectBashOnPowerShell({ command: `tail -n 20 log.txt`, shell: bash })).toBeUndefined()
    expect(detectBashOnPowerShell({ command: `ls -la`, shell: bash })).toBeUndefined()
  })

  test("ignores a missing command or shell", () => {
    expect(detectBashOnPowerShell({ shell: pwsh })).toBeUndefined()
    expect(detectBashOnPowerShell({ command: `tail -n 1 x` })).toBeUndefined()
  })
})
