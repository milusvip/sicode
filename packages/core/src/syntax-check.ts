/**
 * Model-facing syntax check for freshly written source files.
 *
 * Why a syntax check and not a type check: measured over 687 editor calls in this machine's
 * session database, `.ts`/`.tsx` edits were **zero**. The real mix was `.js` 33%, `.cpp` 28%,
 * `.ps1` 11%, `.md` 6%, `.py` 4%, `.sh` 3%, `.html` 3%. A TypeScript-only guard would never
 * have fired. A per-extension syntax check covers the files the model actually writes.
 *
 * Why `bun build --no-bundle` for the JS/TS family: it reports syntax errors and, verified
 * against missing modules, missing files, css imports and bundled entry points, reports
 * *nothing* for unresolved imports. A checker that cries about modules is worse than no
 * checker, because the model then "fixes" a correct file.
 */
export * as SyntaxCheck from "./syntax-check.js"

import path from "path"

export interface Diagnostic {
  readonly message: string
  /** 1-based, matching what the UI renders (`range.start.line + 1`). */
  readonly line: number
  /** 1-based. */
  readonly character: number
}

/**
 * Parse `error: <message>` / `at <file>:<line>:<col>` blocks from `bun build` and oxc.
 * A syntax error's message always follows this shape; anything else is ignored on purpose.
 */
export function parseBunOutput(output: string, file: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const lines = output.split("\n")
  for (let index = 0; index < lines.length; index++) {
    if (!/^error:/.test(lines[index].trim())) continue
    const message = lines[index].trim().replace(/^error:\s*/, "")
    // The location is reported on a following `at <path>:<line>:<col>` line.
    const location = lines
      .slice(index + 1, index + 4)
      .map((candidate) => /at\s+(.+):(\d+):(\d+)\s*$/.exec(candidate.trim()))
      .find((candidate) => candidate !== null && sameFile(candidate[1], file))
    if (!location) continue
    diagnostics.push({ line: Number(location[2]), character: Number(location[3]), message })
  }
  return diagnostics
}

/** `ast.parse` prints `File "path", line N` then the exception line. */
export function parsePythonOutput(output: string, file: string): Diagnostic[] {
  const lines = output.split("\n")
  const location = lines
    .map((line) => /File "(.+?)", line (\d+)/.exec(line))
    .find((match) => match !== null && sameFile(match[1], file))
  if (!location) return []
  const messageLine = lines.find((line) => /^\s*(SyntaxError|IndentationError|TabError)\b/.test(line))
  return [
    {
      line: Number(location[2]),
      character: 1,
      message: messageLine?.trim() ?? "Syntax error",
    },
  ]
}

/** `bash -n` prints `path: line N: <message>`. */
export function parseBashOutput(output: string, file: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const line of output.split("\n")) {
    const match = /^(.+?):\s*line\s+(\d+):\s*(.+)$/.exec(line.trim())
    if (!match || !sameFile(match[1], file)) continue
    diagnostics.push({ line: Number(match[2]), character: 1, message: match[3].trim() })
  }
  return diagnostics
}

/**
 * `clang++ -fsyntax-only` prints GCC-style `path:line:col: error: message`, followed by the source
 * line and a caret. Only errors are kept: notes explain an error already reported, and warnings
 * would have the model "fixing" code that compiles.
 */
export function parseClangOutput(output: string, file: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const line of output.split("\n")) {
    const match = /^(.+?):(\d+):(\d+):\s*(?:fatal )?error:\s*(.+)$/.exec(line.trim())
    if (!match || !sameFile(match[1], file)) continue
    diagnostics.push({ line: Number(match[2]), character: Number(match[3]), message: match[4].trim() })
  }
  return diagnostics
}

/** `JSON.parse` throws `... at position N (line L column C)`. */
export function parseJsonError(error: unknown, text: string): Diagnostic[] {
  const message = error instanceof Error ? error.message : String(error)
  const position = /position (\d+)/.exec(message)?.[1]
  if (position === undefined) return [{ line: 1, character: 1, message }]
  const offset = Number(position)
  const before = text.slice(0, offset)
  const line = before.split("\n").length
  const character = offset - (before.lastIndexOf("\n") + 1) + 1
  return [{ line, character, message }]
}

const normalizePath = (value: string) => value.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase()

/** Each tool prints the path differently; bun echoes what it was given, python resolves it. */
const sameFile = (reported: string, file: string) => {
  const left = normalizePath(reported)
  const right = normalizePath(file)
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`)
}

/** The extension a checker keys on, lowercased, or undefined for an extensionless file. */
export const extensionOf = (file: string) => {
  const extension = path.extname(file)
  return extension === "" ? undefined : extension.toLowerCase()
}
