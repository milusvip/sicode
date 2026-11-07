import { describe, expect, test } from "bun:test"
import { TAIL_PIPE_NOTICE, detectTailPipeHang } from "@opencode/core/tool/plugin/shell"

const detects = (command: string) => detectTailPipeHang({ command })

describe("detectTailPipeHang", () => {
  test("blocks pack/build piped through Select-Object -Last", () => {
    expect(detects(`pnpm pack:release 2>&1 | Select-Object -Last 40`)).toBe(TAIL_PIPE_NOTICE)
  })

  test("blocks Tee-Object then Select-Object -Last on a long build", () => {
    expect(
      detects(
        `pnpm pack:release *>&1 | Tee-Object -FilePath C:\\Users\\me\\AppData\\Local\\Temp\\opencode\\pack-release.log | Select-Object -Last 60`,
      ),
    ).toBe(TAIL_PIPE_NOTICE)
  })

  test("blocks npm/pnpm/yarn/bun build or pack piped through Select-Object -Last", () => {
    expect(detects(`npm run build 2>&1 | Select-Object -Last 20`)).toBe(TAIL_PIPE_NOTICE)
    expect(detects(`yarn build | Select-Object -Last 10`)).toBe(TAIL_PIPE_NOTICE)
    expect(detects(`bun run build | Select-Object -Last 5`)).toBe(TAIL_PIPE_NOTICE)
    expect(detects(`pnpm --filter @nxstack/api build:prod | Select-Object -Last 30`)).toBe(TAIL_PIPE_NOTICE)
  })

  test("blocks bash-style tail pipe on a long producer (any platform)", () => {
    expect(detects(`pnpm pack:release 2>&1 | tail -n 40`)).toBe(TAIL_PIPE_NOTICE)
    expect(detects(`npm run build | tail -40`)).toBe(TAIL_PIPE_NOTICE)
  })

  test("allows Get-Content of an existing log piped to Select-Object -Last", () => {
    expect(detects(`Get-Content pack-release.log | Select-Object -Last 40`)).toBeUndefined()
    expect(detects(`gc C:\\Temp\\opencode\\pack-release.log | Select-Object -Last 60`)).toBeUndefined()
    expect(detects(`Get-Content -Path out.txt -Tail 40`)).toBeUndefined()
  })

  test("allows Select-Object without -Last (Name/First/property projection)", () => {
    expect(detects(`Get-Process | Select-Object Name`)).toBeUndefined()
    expect(detects(`Get-ChildItem . | Select-Object -First 20`)).toBeUndefined()
  })

  test("allows a bare pack/build with no tail pipe", () => {
    expect(detects(`pnpm pack:release`)).toBeUndefined()
    expect(detects(`pnpm pack:release 2>&1`)).toBeUndefined()
    expect(detects(`npm run build`)).toBeUndefined()
  })

  test("ignores a missing command", () => {
    expect(detectTailPipeHang({})).toBeUndefined()
  })
})
