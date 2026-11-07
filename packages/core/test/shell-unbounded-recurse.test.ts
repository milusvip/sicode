import { describe, expect, test } from "bun:test"
import { UNBOUNDED_RECURSE_NOTICE, detectUnboundedRecurse } from "@opencode/core/tool/plugin/shell"

const detects = (command: string) => detectUnboundedRecurse({ command })

describe("detectUnboundedRecurse", () => {
  test("blocks drive-wide Get-ChildItem -Recurse without -Depth", () => {
    const notice = detects(
      `Get-ChildItem D:\\ -Recurse -File -Include *.php,*.html,*.json -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch 'node_modules' }`,
    )
    expect(notice).toBe(UNBOUNDED_RECURSE_NOTICE)
  })

  test("blocks gci -Recurse without -Depth", () => {
    expect(detects(`gci D:\\www -Recurse -Filter *.env`)).toBe(UNBOUNDED_RECURSE_NOTICE)
  })

  test("allows Get-ChildItem -Recurse when -Depth is set", () => {
    expect(detects(`Get-ChildItem D:\\www -Recurse -Depth 4 -File -Include *.conf`)).toBeUndefined()
  })

  test("leaves non-recursive listing alone", () => {
    expect(detects(`Get-ChildItem D:\\ -Directory`)).toBeUndefined()
  })

  test("blocks unix find without -maxdepth", () => {
    expect(detects(`find /home/me -name '*.env'`)).toBe(UNBOUNDED_RECURSE_NOTICE)
  })

  test("allows find with -maxdepth", () => {
    expect(detects(`find /home/me -maxdepth 3 -name '*.env'`)).toBeUndefined()
  })

  test("does not treat findstr as find", () => {
    // SiCode: neutral placeholder site name and path, not the developer's real host.
    expect(detects(`findstr /s /i pattern D:\\www\\*.conf`)).toBeUndefined()
  })

  test("ignores a missing command", () => {
    expect(detectUnboundedRecurse({})).toBeUndefined()
  })
})
