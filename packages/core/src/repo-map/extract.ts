export * as RepoMapExtract from "./extract.js"

import type { Node as SyntaxNode } from "web-tree-sitter"

/**
 * SiCode: pulls the exported definitions and the module dependencies out of a parsed file.
 *
 * Grammars disagree about node names, so the rule is deliberately structural rather than a
 * per-language table: a top-level node that carries a `name` field *is* a definition. Verified
 * against python / go / rust / java / js / ts. Three shapes need a small correction on top:
 *
 * - `export_statement` (js/ts) and `decorated_definition` (python) wrap the real declaration, so
 *   the wrapper is recursed into instead of being read for a name;
 * - go puts the name on the `type_spec` child of `type_declaration`, not on the declaration;
 * - c function definitions carry no `name` field at all — the identifier sits at the bottom of a
 *   `declarator` chain.
 *
 * Imports are collected because they are the only edges available for ranking files: without them
 * every file scores zero and the map degenerates into directory order.
 */

export interface Symbol {
  readonly name: string
  readonly line: number
}

export interface Result {
  readonly symbols: Symbol[]
  readonly imports: string[]
}

/** Transparent wrappers: the declaration worth recording is one of their children. */
const WRAPPERS = new Set(["export_statement", "decorated_definition", "ambient_declaration"])

/** Nodes that hold the declaration names one level down. */
const CONTAINERS = new Set(["type_declaration"])

/**
 * `export const x = …` hides the name on a `variable_declarator`, and only there is a binding
 * worth listing: an unexported module-level `const` is usually a constant, not an entry point.
 */
const BINDINGS = new Set(["lexical_declaration", "variable_declaration"])

/** Node types whose name lives at the end of a `declarator` chain rather than in `name`. */
const DECLARATORS = new Set(["function_definition"])

/**
 * Nodes that must never become map entries. Most carry a `name` field that means something else
 * entirely — python's `import_statement` would otherwise fill the map with dependency names.
 */
const IMPORTS = new Set([
  "import_statement",
  "import_from_statement",
  "import_declaration",
  "use_declaration",
  "preproc_include",
  "namespace_use_declaration",
  "require",
  "require_call",
])

const SKIP = new Set(["comment", "line_comment", "block_comment", "package_clause", "package_declaration", "namespace_definition", "program", "module"])

const importSpec = (node: SyntaxNode): string | undefined => {
  const source = node.childForFieldName("source")?.text ?? node.childForFieldName("path")?.text
  if (source) return source.replace(/^["'`]|["'`]$/g, "")
  const module = node.childForFieldName("module_name")?.text
  if (module) return module
  const argument = node.childForFieldName("argument")?.text
  if (argument) return argument
  return undefined
}

/** Walks down `declarator` until an identifier surfaces — c/cpp function definitions need this. */
const declaratorName = (node: SyntaxNode): string | undefined => {
  let current: SyntaxNode | null = node
  while (current) {
    const name = current.childForFieldName("name")?.text
    if (name) return name
    if (current.type === "identifier" || current.type === "field_identifier") return current.text
    current = current.childForFieldName("declarator")
  }
  return undefined
}

/**
 * Names that carry no information in a map: they are either too generic to search for or a
 * language keyword. Whitespace and length caps keep multi-line expressions out.
 */
const usable = (name: string): boolean => name.length > 0 && name.length <= 80 && !/\s/.test(name)

export const walk = (root: SyntaxNode): Result => {
  const symbols: Symbol[] = []
  const imports: string[] = []
  const seen = new Set<string>()

  const record = (node: SyntaxNode, name: string | undefined) => {
    if (!name || !usable(name) || seen.has(name)) return
    seen.add(name)
    symbols.push({ name, line: node.startPosition.row + 1 })
  }

  const visit = (node: SyntaxNode, exported: boolean): void => {
    if (SKIP.has(node.type)) return
    if (IMPORTS.has(node.type)) {
      const spec = importSpec(node)
      if (spec) imports.push(spec)
      return
    }
    if (WRAPPERS.has(node.type)) {
      // `export * from "./x"` and `export { a } from "./x"` are dependencies, not definitions.
      const spec = importSpec(node)
      if (spec) imports.push(spec)
      const inherits = node.type === "export_statement" ? true : exported
      for (const child of node.namedChildren) if (child) visit(child, inherits)
      return
    }
    if (CONTAINERS.has(node.type)) {
      for (const child of node.namedChildren) if (child) visit(child, exported)
      return
    }
    if (exported && BINDINGS.has(node.type)) {
      for (const child of node.namedChildren) if (child) visit(child, exported)
      return
    }
    const name = node.childForFieldName("name")?.text ?? (DECLARATORS.has(node.type) ? declaratorName(node) : undefined)
    if (name) record(node, name)
  }

  for (const node of root.namedChildren) if (node) visit(node, false)
  return { symbols, imports }
}
