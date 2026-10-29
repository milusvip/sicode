/**
 * Syntax errors in PowerShell scripts, found in-process.
 *
 * `.ps1` was 11.4% of the 687 editor calls measured on this machine, and this host is Windows, so
 * leaving it uncovered would drop a tenth of the benefit. The alternatives were worse:
 * `[System.Management.Automation.Language.Parser]::ParseFile` costs a `pwsh` process per write and
 * is unavailable where PowerShell is not installed, while the tree-sitter grammar is already a
 * dependency of this package and is loaded from disk exactly once.
 *
 * Verified against here-strings, `class` blocks and pipelines: all parse clean, so a correct script
 * is never flagged. The grammar reports an error node or a missing node, and nothing else.
 */
export * as PowerShellCheck from "./powershell.js"

import { Effect } from "effect"
import { fileURLToPath } from "url"
import path from "path"
import { shellParserWasm } from "#shell-parser-wasm"
import type { Diagnostic } from "../syntax-check.js"

/** A tree-sitter parse is a pure function of the source, so one parser serves every call. */
let parser: Promise<import("web-tree-sitter").Parser> | undefined

const initialize = async () => {
  const { Parser, Language } = await import("web-tree-sitter")
  await Parser.init({ locateFile: () => resolve(shellParserWasm.runtime) })
  const instance = new Parser()
  instance.setLanguage(await Language.load(resolve(shellParserWasm.powershell)))
  return instance
}

/** Same resolution the shell scanner uses: bun hands back a path, node an absolute one. */
function resolve(asset: string) {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (path.isAbsolute(asset)) return asset
  return fileURLToPath(new URL(asset, import.meta.url))
}

/**
 * `true` when this build has the grammar at all. workerd replaces the wasm paths with empty
 * strings, and a host without the grammar should skip rather than fail.
 */
export const available = () => shellParserWasm.powershell !== ""

const message = (node: { type: string; isMissing: boolean }) => {
  if (node.isMissing) return `Expected \`${node.type}\``
  if (node.type === "ERROR") return "Unexpected or invalid syntax"
  return `Unexpected \`${node.type}\``
}

export const parse = (source: string, instance: import("web-tree-sitter").Parser): Diagnostic[] => {
  const tree = instance.parse(source)
  if (!tree) return []
  try {
    const root = tree.rootNode
    if (!root.hasError) return []

    const diagnostics: Diagnostic[] = []
    // Depth-first walk. A malformed line often yields an ERROR node wrapping a missing child; keep the
    // outermost one and drop the nested copies so the model gets one line per real mistake.
    const seen = new Set<string>()
    const walk = (node: import("web-tree-sitter").Node) => {
      if (node.type === "ERROR" || node.isMissing) {
        const line = node.startPosition.row + 1
        const character = node.startPosition.column + 1
        const key = `${line}:${character}`
        if (!seen.has(key)) {
          seen.add(key)
          diagnostics.push({ line, character, message: message(node) })
        }
        return
      }
      // `children`, not `namedChildren`: a missing closer such as `}` is an anonymous token, and it
      // is exactly the node that reports an unclosed block.
      for (const child of node.children) if (child) walk(child)
    }
    walk(root)
    return diagnostics
  } finally {
    // tree-sitter trees are wasm-side allocations; the shell scanner releases its own for the same reason.
    tree.delete()
  }
}

export const check = Effect.fnUntraced(function* (source: string) {
  parser ??= initialize()
  const instance = yield* Effect.promise(() => parser!)
  return parse(source, instance)
})
