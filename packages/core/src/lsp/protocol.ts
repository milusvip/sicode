export * as LspProtocol from "./protocol.js"

/**
 * SiCode: LSP base protocol framing.
 *
 * Unlike the MCP stdio transport (newline-delimited JSON), LSP frames messages HTTP-style:
 * a `Content-Length` header block, then exactly that many *bytes* of JSON. The byte count is
 * load-bearing — JSON.stringify keeps non-ASCII characters literal, so a character count is
 * wrong for any body containing them. Everything here is therefore measured with
 * `Buffer.byteLength`, never `string.length`.
 *
 * Pure on purpose: the client feeds chunks in and gets whole messages out, so the framing can
 * be tested without a process.
 */

/** Largest header block accepted, so a chatty non-LSP process cannot buffer forever. */
const MAX_HEADER_BYTES = 64 * 1024
/** Largest single message body accepted; language servers emit diffs, not megabytes. */
const MAX_BODY_BYTES = 16 * 1024 * 1024

const HEADER_TERMINATOR = "\r\n\r\n"

/** A request or notification, or the server's response to one of ours. */
export type Message = Record<string, unknown>

/** Serialize one message into a complete wire frame. */
export const encodeMessage = (message: Message): Buffer => {
  const body = Buffer.from(JSON.stringify(message), "utf8")
  const header = Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, "utf8")
  return Buffer.concat([header, body])
}

/** Pull the byte length out of a header block; `undefined` when the header is malformed. */
const contentLength = (header: string): number | undefined => {
  let found: number | undefined
  for (const line of header.split("\r\n")) {
    const separator = line.indexOf(":")
    if (separator < 0) continue
    const name = line.slice(0, separator).trim().toLowerCase()
    if (name !== "content-length") continue
    const value = Number(line.slice(separator + 1).trim())
    if (!Number.isInteger(value) || value < 0) return undefined
    found = value
  }
  return found
}

/**
 * Incremental frame decoder. Feed it whatever stdout produced; it returns every message whose
 * frame is complete and holds the partial remainder for the next chunk. A malformed frame throws,
 * which the client treats as a dead server: byte-level desync cannot be recovered from.
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0)
  private body: { readonly length: number; collected: Buffer } | undefined = undefined

  push(chunk: Uint8Array): Message[] {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)])
    const messages: Message[] = []
    while (true) {
      if (this.body === undefined) {
        const terminator = this.buffer.indexOf(HEADER_TERMINATOR)
        if (terminator < 0) {
          if (this.buffer.byteLength > MAX_HEADER_BYTES) throw new Error("LSP header block exceeded 64 KiB")
          return messages
        }
        const header = this.buffer.subarray(0, terminator).toString("utf8")
        const length = contentLength(header)
        if (length === undefined) throw new Error("LSP frame had no valid Content-Length header")
        if (length > MAX_BODY_BYTES) throw new Error(`LSP message body exceeded ${MAX_BODY_BYTES} bytes`)
        this.buffer = Buffer.from(this.buffer.subarray(terminator + HEADER_TERMINATOR.length))
        this.body = { length, collected: Buffer.alloc(0) }
      }
      const pending = this.body
      const needed = pending.length - pending.collected.byteLength
      if (this.buffer.byteLength < needed) {
        this.body = { length: pending.length, collected: Buffer.concat([pending.collected, this.buffer]) }
        this.buffer = Buffer.alloc(0)
        return messages
      }
      const body = Buffer.concat([pending.collected, this.buffer.subarray(0, needed)])
      this.buffer = Buffer.from(this.buffer.subarray(needed))
      this.body = undefined
      const text = body.toString("utf8")
      let message: unknown
      try {
        message = JSON.parse(text)
      } catch (cause) {
        throw new Error(`LSP frame was not valid JSON: ${text.slice(0, 200)}`, { cause })
      }
      if (typeof message !== "object" || message === null) throw new Error("LSP frame was not a JSON object")
      messages.push(message as Message)
    }
  }
}
