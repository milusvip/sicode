import { describe, expect, test } from "bun:test"
import { Decode } from "./decode.js"

const encoder = new TextEncoder()
const gbkHello = Uint8Array.from([0xc4, 0xe3, 0xba, 0xc3]) // 你好 in the system code page

describe("Decode.outputText", () => {
  test("keeps UTF-8 text as it arrived", () => {
    expect(Decode.outputText(encoder.encode("无法对 Null 数组进行索引"))).toBe("无法对 Null 数组进行索引")
    expect(Decode.outputText(encoder.encode("plain ascii\n"))).toBe("plain ascii\n")
    expect(Decode.outputText(new Uint8Array())).toBe("")
  })

  test("reads a window that stopped mid-character as UTF-8, not as another code page", () => {
    const bytes = encoder.encode("中文")
    expect(Decode.outputText(bytes.subarray(0, bytes.length - 1))).toBe("中\uFFFD")
  })

  test.skipIf(process.platform !== "win32")("decodes the system code page on Windows", () => {
    expect(Decode.outputText(gbkHello)).toBe("你好")
  })
})
