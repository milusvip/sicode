export * as BatchEncoding from "./batch-encoding.js"

// SiCode: cmd.exe parses .bat/.cmd files in the system ANSI code page (GBK on Chinese Windows),
// never UTF-8. The models keep writing Chinese comments into batch scripts; the UTF-8 bytes then
// decode as mojibake, an odd trailing byte swallows the CRLF, lines merge, and cmd executes the
// fragments as garbage commands ("鏂囦欢澶癸細 不是内部或外部命令"). Both the write and edit tools
// append this warning to their result when the final content would break, so the model rewrites
// the file ASCII-only instead of shipping a script that fails at run time.

const BATCH = /\.(bat|cmd)$/i
const NON_ASCII = /[^\x00-\x7F]/

const message =
  "\n\nSiCode warning: this Windows batch file contains non-ASCII characters. cmd.exe parses .bat/.cmd files in the system ANSI code page (GBK on Chinese Windows), not UTF-8, so Chinese text becomes mojibake, splits lines, and the script fails with garbled \"不是内部或外部命令\" errors when run. Rewrite the file with ASCII-only content: English comments, or move Chinese instructions to a separate .md file. Do not rely on chcp 65001; it does not make cmd parse the file as UTF-8 reliably."

/** A model-facing warning when `text` would break as a cmd.exe batch script, or "" when it is safe. */
export function warning(path: string, text: string): string {
  return BATCH.test(path) && NON_ASCII.test(text) ? message : ""
}
