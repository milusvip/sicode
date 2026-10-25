export * as Decode from "./decode.js"

const utf8 = new TextDecoder("utf-8")
const strict = new TextDecoder("utf-8", { fatal: true })

/** Where the last complete UTF-8 character ends; a chunked read can stop in the middle of one. */
const completeEnd = (bytes: Uint8Array) => {
  for (let back = 1; back < Math.min(5, bytes.length + 1); back++) {
    const byte = bytes[bytes.length - back]!
    if ((byte & 0xc0) === 0x80) continue // a continuation byte, keep walking back to its leading byte
    const width = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1
    return back >= width ? bytes.length : bytes.length - back
  }
  return bytes.length
}

const isUtf8 = (bytes: Uint8Array) => {
  try {
    strict.decode(bytes)
    return true
  } catch {
    return false
  }
}

/**
 * Output arrives as bytes on a code page the child picked, not as text. Windows console programs and
 * PowerShell answer in the system code page, so decoding as UTF-8 turns a Chinese error message into a row
 * of replacement characters — exactly the line that explains why a command failed.
 */
export const outputText = (bytes: Uint8Array) => {
  if (bytes.length === 0) return ""
  // Judge only complete characters: a read window can split one, and that must not read as "not UTF-8".
  if (isUtf8(bytes.subarray(0, completeEnd(bytes)))) return utf8.decode(bytes)
  if (process.platform !== "win32") return utf8.decode(bytes)
  try {
    return new TextDecoder("gbk").decode(bytes)
  } catch {
    return utf8.decode(bytes)
  }
}
