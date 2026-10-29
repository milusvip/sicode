import { describe, expect, test } from "bun:test"
import { detectPollingWait, pollTimings } from "@opencode/core/tool/plugin/shell"

const detects = (command: string, background?: boolean) => detectPollingWait({ command, background })

describe("detectPollingWait", () => {
  test("blocks the polling shape seen in recorded sessions", () => {
    const notice = detects(
      `Start-Sleep -Seconds 120; Get-Content "C:\\Users\\me\\.local\\share\\opencode\\shell\\abc\\sh_1822f1fb70"`,
    )
    expect(notice).toBeDefined()
    expect(notice).toContain("background: true")
    expect(notice).toContain("120s")
  })

  test("blocks the bash spelling of the same shape", () => {
    expect(detects("sleep 45; cat /tmp/out.log")).toBeDefined()
    expect(detects("sleep 30 && tail -n 20 build.log")).toBeDefined()
  })

  test("blocks PowerShell without the -Seconds flag", () => {
    expect(detects("Start-Sleep 60; Get-Content out.txt")).toBeDefined()
  })

  test("uses the longest sleep when a command sleeps more than once", () => {
    expect(detects("Start-Sleep -Seconds 2; Start-Sleep -Seconds 90; Get-Content out.txt")).toContain("90s")
  })

  test("leaves a short sleep alone", () => {
    expect(detects(`Start-Sleep -Seconds 3; Get-Content out.txt`)).toBeUndefined()
    expect(detects(`sleep 5 && cat out.txt`)).toBeUndefined()
  })

  test(`treats ${pollTimings.minSeconds}s as the boundary`, () => {
    expect(detects(`Start-Sleep -Seconds ${pollTimings.minSeconds}; Get-Content out.txt`)).toBeDefined()
    expect(detects(`Start-Sleep -Seconds ${pollTimings.minSeconds - 1}; Get-Content out.txt`)).toBeUndefined()
  })

  test("leaves a wait that never reads a file alone", () => {
    const port = `cd project; Start-Sleep -Seconds 240; Get-NetTCPConnection -State Listen -LocalPort 1081`
    expect(detects(port)).toBeUndefined()
    expect(detects("Start-Sleep -Seconds 90; curl.exe -sS https://example.com")).toBeUndefined()
    expect(detects("Start-Sleep -Seconds 20; node tools/mailbox.js")).toBeUndefined()
  })

  test("leaves a command the model already backgrounded alone", () => {
    const command = `Start-Sleep -Seconds 120; Get-Content out.txt`
    expect(detects(command, true)).toBeUndefined()
    expect(detects(command, false)).toBeDefined()
  })

  test("leaves commands with no sleep alone", () => {
    expect(detects("Get-Content out.txt")).toBeUndefined()
    expect(detects("npm run build")).toBeUndefined()
  })

  test("does not match sleep inside a longer word", () => {
    expect(detects("Get-Process asleep; Get-Content out.txt")).toBeUndefined()
  })

  test("ignores a missing command", () => {
    expect(detectPollingWait({})).toBeUndefined()
    expect(detectPollingWait({ background: false })).toBeUndefined()
  })
})
