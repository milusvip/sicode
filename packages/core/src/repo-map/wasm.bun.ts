// @ts-ignore Bun embeds static file imports when compiling the CLI.
import runtime from "web-tree-sitter/tree-sitter.wasm" with { type: "file" }
// @ts-ignore Bun embeds static file imports when compiling the CLI.
import typescript from "tree-sitter-wasms/out/tree-sitter-typescript.wasm" with { type: "file" }
// @ts-ignore Bun embeds static file imports when compiling the CLI.
import tsx from "tree-sitter-wasms/out/tree-sitter-tsx.wasm" with { type: "file" }
// @ts-ignore Bun embeds static file imports when compiling the CLI.
import javascript from "tree-sitter-wasms/out/tree-sitter-javascript.wasm" with { type: "file" }
// @ts-ignore Bun embeds static file imports when compiling the CLI.
import python from "tree-sitter-wasms/out/tree-sitter-python.wasm" with { type: "file" }
// @ts-ignore Bun embeds static file imports when compiling the CLI.
import go from "tree-sitter-wasms/out/tree-sitter-go.wasm" with { type: "file" }
// @ts-ignore Bun embeds static file imports when compiling the CLI.
import rust from "tree-sitter-wasms/out/tree-sitter-rust.wasm" with { type: "file" }
// @ts-ignore Bun embeds static file imports when compiling the CLI.
import java from "tree-sitter-wasms/out/tree-sitter-java.wasm" with { type: "file" }
// @ts-ignore Bun embeds static file imports when compiling the CLI.
import c from "tree-sitter-wasms/out/tree-sitter-c.wasm" with { type: "file" }
// @ts-ignore Bun embeds static file imports when compiling the CLI.
import ruby from "tree-sitter-wasms/out/tree-sitter-ruby.wasm" with { type: "file" }
// @ts-ignore Bun embeds static file imports when compiling the CLI.
import php from "tree-sitter-wasms/out/tree-sitter-php.wasm" with { type: "file" }

export const repoMapWasm = {
  runtime,
  languages: { typescript, tsx, javascript, python, go, rust, java, c, ruby, php } as Record<string, string>,
}
