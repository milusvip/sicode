import { createRequire } from "node:module"

/**
 * Node has no static asset imports, so the artifacts are resolved from the installed package
 * instead. `OPENCODE_REPO_MAP_WASM_DIR` points at any directory holding the same file names,
 * which is what a packaged build uses when `tree-sitter-wasms` is not next to the executable.
 */
const require = createRequire(import.meta.url)

const file = (name: string) =>
  process.env.OPENCODE_REPO_MAP_WASM_DIR
    ? `${process.env.OPENCODE_REPO_MAP_WASM_DIR}/tree-sitter-${name}.wasm`
    : require.resolve(`tree-sitter-wasms/out/tree-sitter-${name}.wasm`)

export const repoMapWasm = {
  runtime: process.env.OPENCODE_TREE_SITTER_WASM_PATH ?? require.resolve("web-tree-sitter/tree-sitter.wasm"),
  languages: {
    typescript: file("typescript"),
    tsx: file("tsx"),
    javascript: file("javascript"),
    python: file("python"),
    go: file("go"),
    rust: file("rust"),
    java: file("java"),
    c: file("c"),
    ruby: file("ruby"),
    php: file("php"),
  } as Record<string, string>,
}
