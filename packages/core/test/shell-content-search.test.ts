import { describe, expect, test } from "bun:test"
import { CONTENT_SEARCH_NOTICE, detectContentSearch } from "@opencode/core/tool/plugin/shell"

const detects = (command: string) => detectContentSearch({ command })

describe("detectContentSearch", () => {
  test("blocks bare drive-root rg content search", () => {
    expect(detects(`rg -n "foo|bar" D:\\www --glob "!node_modules"`)).toBe(CONTENT_SEARCH_NOTICE)
  })

  test("blocks Select-String content search", () => {
    expect(detects(`Select-String -Path *.ts -Pattern "SessionRunner"`)).toBe(CONTENT_SEARCH_NOTICE)
  })

  test("blocks findstr /s recursive search", () => {
    expect(detects(`findstr /s /i foo D:\\www\\*.conf`)).toBe(CONTENT_SEARCH_NOTICE)
  })

  test("blocks recursive grep", () => {
    expect(detects(`grep -rn "SessionRunner" packages/core`)).toBe(CONTENT_SEARCH_NOTICE)
    expect(detects(`egrep -R "foo" .`)).toBe(CONTENT_SEARCH_NOTICE)
    expect(detects(`grep --recursive "bar" src`)).toBe(CONTENT_SEARCH_NOTICE)
  })

  test("allows rg --version and --help", () => {
    expect(detects(`rg --version`)).toBeUndefined()
    expect(detects(`rg -V`)).toBeUndefined()
    expect(detects(`ripgrep --help`)).toBeUndefined()
  })

  test("allows pipe filters and non-recursive grep", () => {
    expect(detects(`ps aux | grep node`)).toBeUndefined()
    expect(detects(`Get-Process | Select-Object Name`)).toBeUndefined()
    expect(detects(`grep foo /tmp/one-file.log`)).toBeUndefined()
    expect(detects(`findstr /i pattern file.txt`)).toBeUndefined()
  })

  test("allows findstr without /s", () => {
    // SiCode: neutral placeholder site name and path, not the developer's real host.
    expect(detects(`findstr /i pattern D:\\www\\hosts`)).toBeUndefined()
  })

  test("ignores a missing command", () => {
    expect(detectContentSearch({})).toBeUndefined()
  })
})
