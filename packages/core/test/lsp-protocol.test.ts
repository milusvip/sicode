import { describe, expect, test } from "bun:test"
import { LspProtocol } from "@opencode/core/lsp/protocol"

const request = (id: number) => ({ jsonrpc: "2.0", id, method: "textDocument/definition", params: {} })

describe("lsp protocol framing", () => {
  test("decodes a complete frame in one chunk", () => {
    const decoder = new LspProtocol.FrameDecoder()
    const messages = decoder.push(LspProtocol.encodeMessage(request(1)))
    expect(messages).toHaveLength(1)
    expect(messages[0]).toEqual(request(1))
  })

  test("decodes across chunk boundaries, including mid-header", () => {
    const frame = LspProtocol.encodeMessage(request(2))
    const decoder = new LspProtocol.FrameDecoder()
    expect(decoder.push(frame.subarray(0, 3))).toHaveLength(0)
    expect(decoder.push(frame.subarray(3, 9))).toHaveLength(0)
    expect(decoder.push(frame.subarray(9))).toHaveLength(1)
  })

  test("decodes several frames from one chunk", () => {
    const frame = Buffer.concat([LspProtocol.encodeMessage(request(1)), LspProtocol.encodeMessage(request(2))])
    const decoder = new LspProtocol.FrameDecoder()
    const messages = decoder.push(frame)
    expect(messages).toHaveLength(2)
    expect(messages.map((message) => message.id)).toEqual([1, 2])
  })

  test("counts bytes, not characters, for non-ASCII bodies", () => {
    // JSON.stringify keeps the CJK characters literal, so the body's UTF-8 byte length exceeds
    // its character length; a character-counted header would desync the stream here.
    const message = { jsonrpc: "2.0", method: "test", params: { text: "重试逻辑 🚀" } }
    const body = Buffer.from(JSON.stringify(message), "utf8")
    expect(body.byteLength).toBeGreaterThan(JSON.stringify(message).length)
    const decoder = new LspProtocol.FrameDecoder()
    const messages = decoder.push(LspProtocol.encodeMessage(message))
    expect(messages).toEqual([message])
  })

  test("splits a multi-byte character across chunks without corrupting it", () => {
    const message = { jsonrpc: "2.0", method: "test", params: { text: "重" } }
    const frame = LspProtocol.encodeMessage(message)
    const decoder = new LspProtocol.FrameDecoder()
    // Split inside the body so the "重" (3 bytes) lands in two chunks.
    expect(decoder.push(frame.subarray(0, frame.length - 2))).toHaveLength(0)
    const messages = decoder.push(frame.subarray(frame.length - 2))
    expect(messages).toEqual([message])
  })

  test("throws on a frame without Content-Length", () => {
    const decoder = new LspProtocol.FrameDecoder()
    const bad = Buffer.from("Content-Type: application/vscode-jsonrpc\r\n\r\n{}\r\n")
    expect(() => decoder.push(bad)).toThrow(/Content-Length/)
  })

  test("throws on invalid JSON bodies", () => {
    const decoder = new LspProtocol.FrameDecoder()
    const body = Buffer.from("not json", "utf8")
    const bad = Buffer.concat([Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`), body])
    expect(() => decoder.push(bad)).toThrow(/not valid JSON/)
  })
})
