export * as RepoMapLanguages from "./languages.js"

/**
 * SiCode: the languages the repo map can parse, and the file extensions that route to each one.
 *
 * The wasm artifacts come from `tree-sitter-wasms`, which ships ~36 grammars. Only a subset is
 * bundled (see `wasm.bun.ts`) because every grammar is embedded into the binary: the ten below
 * cover the overwhelming majority of real repositories at ~11MB, while adding e.g. c_sharp or
 * kotlin would cost another 4MB each. Adding a language is two edits — one row here and one
 * import in `wasm.bun.ts` — and nothing else in the module needs to change.
 *
 * `tsx` also handles `.jsx`: it is a superset of the JavaScript grammar plus JSX, so a plain
 * JavaScript file with JSX in it parses correctly, while `javascript` alone would not.
 */
export interface Language {
  /** Base name of the artifact in `tree-sitter-wasms/out`, without the `tree-sitter-` prefix. */
  readonly wasm: string
  readonly extensions: readonly string[]
}

export const languages: Record<string, Language> = {
  typescript: { wasm: "typescript", extensions: [".ts", ".mts", ".cts"] },
  tsx: { wasm: "tsx", extensions: [".tsx", ".jsx"] },
  javascript: { wasm: "javascript", extensions: [".js", ".mjs", ".cjs"] },
  python: { wasm: "python", extensions: [".py", ".pyi"] },
  go: { wasm: "go", extensions: [".go"] },
  rust: { wasm: "rust", extensions: [".rs"] },
  java: { wasm: "java", extensions: [".java"] },
  c: { wasm: "c", extensions: [".c", ".h"] },
  ruby: { wasm: "ruby", extensions: [".rb"] },
  php: { wasm: "php", extensions: [".php"] },
}

const route = new Map<string, string>()
for (const [name, language] of Object.entries(languages)) {
  for (const extension of language.extensions) route.set(extension, name)
}

/** Extension of `file` (lowercase, with the dot), or `""` when it has none. */
export const extensionOf = (file: string): string => {
  const base = file.slice(file.lastIndexOf("/") + 1)
  const dot = base.lastIndexOf(".")
  return dot <= 0 ? "" : base.slice(dot).toLowerCase()
}

/** Language name for a file path, or `undefined` when no bundled grammar handles it. */
export const ofPath = (file: string): string | undefined => route.get(extensionOf(file))

/** Every extension the map can index, for building the scan glob. */
export const extensions = (): string[] => [...route.keys()]
