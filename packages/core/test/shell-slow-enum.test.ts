import { describe, expect, test } from "bun:test"
import { SLOW_ENUM_NOTICE, detectSlowEnumeration } from "@opencode/core/tool/plugin/shell"

const detects = (command: string) => detectSlowEnumeration({ command })

describe("detectSlowEnumeration", () => {
  test("blocks unbounded Recycle Bin COM Namespace(10) scans", () => {
    const command = `$sh = New-Object -ComObject Shell.Application
$rb = $sh.Namespace(10)
$rb.Items() | ForEach-Object { $_.Name }`
    expect(detects(command)).toBe(SLOW_ENUM_NOTICE)
  })

  test("blocks Shell.Application Items() without -First", () => {
    expect(detects(`(New-Object -ComObject Shell.Application).Namespace(0).Items() | Select-Object Name`)).toBe(
      SLOW_ENUM_NOTICE,
    )
  })

  test("allows Shell.Application Items() when Select-Object -First caps it", () => {
    expect(
      detects(
        `$sh = New-Object -ComObject Shell.Application; $sh.Namespace(0).Items() | Select-Object -First 20 Name`,
      ),
    ).toBeUndefined()
  })

  test("blocks unbounded $Recycle.Bin listing", () => {
    expect(detects(`Get-ChildItem C:\\$Recycle.Bin -Recurse -Force`)).toBe(SLOW_ENUM_NOTICE)
    expect(detects(`gci 'D:\\$Recycle.Bin' -Force`)).toBe(SLOW_ENUM_NOTICE)
  })

  test("allows $Recycle.Bin when -Depth or -First is set", () => {
    expect(detects(`Get-ChildItem C:\\$Recycle.Bin -Depth 1 -Force`)).toBeUndefined()
    expect(detects(`Get-ChildItem C:\\$Recycle.Bin -Force | Select-Object -First 10`)).toBeUndefined()
  })

  test("leaves ordinary listings alone", () => {
    // SiCode: neutral placeholder path, not the developer's real drive layout.
    expect(detects(`Get-ChildItem E:\\Projects -Directory`)).toBeUndefined()
    expect(detects(`Get-Process PBZ`)).toBeUndefined()
  })

  test("ignores a missing command", () => {
    expect(detectSlowEnumeration({})).toBeUndefined()
  })
})
