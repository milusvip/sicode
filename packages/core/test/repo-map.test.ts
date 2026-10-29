import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { RepoMap } from "../src/repo-map/index.js"
import { RepoMapCallGraph } from "../src/repo-map/call-graph.js"
import { RepoMapLanguages } from "../src/repo-map/languages.js"
import { RepoMapParse } from "../src/repo-map/parse.js"
import { RepoMapRender } from "../src/repo-map/render.js"

/**
 * The extractor is the only part that needs a real grammar, so it runs against the bundled wasm
 * rather than a mocked tree. That also proves the `#repo-map-wasm` wiring resolves.
 */
const names = async (source: string, language: string) => {
  const result = await RepoMapParse.parse(source, language)
  expect(result).toBeDefined()
  return result!.symbols.map((symbol) => symbol.name)
}

describe("extract", () => {
  test("typescript: export wrapper is unwrapped, values included, imports recorded", async () => {
    const source = [
      'import { bus } from "./bus.js"',
      'export * from "./shared.js"',
      "export function load(path: string) {",
      "  return path",
      "}",
      "export class Client {}",
      "export const helper = (x: number) => x",
      "const internal = 1",
    ].join("\n")
    const result = await RepoMapParse.parse(source, "typescript")
    expect(result!.symbols.map((symbol) => symbol.name)).toEqual(["load", "Client", "helper"])
    expect(result!.symbols[0]!.line).toBe(3)
    expect(result!.imports).toEqual(["./bus.js", "./shared.js"])
  })

  test("collects calls by their leaf name across languages", async () => {
    const cases: Array<[string, string, string[]]> = [
      ["typescript", "export function a() { b(); c.d(); new Foo() }", ["b", "d", "Foo"]],
      ["python", "def a():\n    b()\n    c.d()\n    X()", ["b", "d", "X"]],
      ["go", "package m\nfunc a() { b()\n c.D() }", ["b", "D"]],
      ["rust", "fn a() { b(); c::d(); X::new() }", ["b", "d", "new"]],
      ["java", "class A { void a() { b(); c.d(); new Foo(); } }", ["b", "d", "Foo"]],
      ["c", "int a() { b(); c_d(); }", ["b", "c_d"]],
      ["php", "<?php function a() { b(); $c->d(); new Foo(); }", ["b", "d", "Foo"]],
    ]
    for (const [language, source, expected] of cases) {
      const result = await RepoMapParse.parse(source, language)
      expect(result!.calls, language).toEqual(expected)
    }
  })

  test("python: decorators do not hide the definition, import names are not symbols", async () => {
    expect(await names(["import os", "from .util import helper", "@cache", "def load_config(path):", "    return path", "", "class Client:", "    pass"].join("\n"), "python")).toEqual([
      "load_config",
      "Client",
    ])
  })

  test("go: the name sits on type_spec, one level below type_declaration", async () => {
    const source = ["package main", "", "type Client struct {", "  Name string", "}", "", "func Load(path string) string { return path }"].join("\n")
    expect(await names(source, "go")).toEqual(["Client", "Load"])
  })

  test("rust: impl blocks have no name and must not duplicate the type", async () => {
    const source = ["pub struct Client {", "  name: String,", "}", "", "impl Client {", "  fn send(&self) {}", "}", "", "enum Mode { Fast }"].join("\n")
    expect(await names(source, "rust")).toEqual(["Client", "Mode"])
  })

  test("c: the identifier is at the bottom of a declarator chain", async () => {
    expect(await names(["#include <stdio.h>", "int load_config(const char *path) { return 0; }"].join("\n"), "c")).toEqual(["load_config"])
  })

  test("java: classes and interfaces, package declaration ignored", async () => {
    expect(await names(["package com.example;", "class Client {", "  void send(int x) {}", "}", "interface Loader {", "  void load();", "}"].join("\n"), "java")).toEqual(["Client", "Loader"])
  })
})

describe("languages", () => {
  test("routes extensions to a grammar and ignores the rest", () => {
    expect(RepoMapLanguages.ofPath("src/a.tsx")).toBe("tsx")
    expect(RepoMapLanguages.ofPath("src/a.mts")).toBe("typescript")
    expect(RepoMapLanguages.ofPath("cmd/main.go")).toBe("go")
    expect(RepoMapLanguages.ofPath("src/style.css")).toBeUndefined()
    expect(RepoMapLanguages.ofPath("Makefile")).toBeUndefined()
  })
})

describe("resolve", () => {
  const files = new Set(["src/b.ts", "src/c/index.ts", "pkg/mod.py", "pkg/__init__.py", "src/b.test.ts"])

  test("relative specifiers resolve to a real file, trying extensions", () => {
    expect(RepoMapRender.resolve(files, "src/a.ts", "./b")).toBe("src/b.ts")
    expect(RepoMapRender.resolve(files, "src/a.ts", "./b.js")).toBe("src/b.ts")
    expect(RepoMapRender.resolve(files, "src/a.ts", "./c")).toBe("src/c/index.ts")
  })

  test("python writes the path with dots", () => {
    expect(RepoMapRender.resolve(files, "pkg/a.py", ".mod")).toBe("pkg/mod.py")
    expect(RepoMapRender.resolve(files, "pkg/a.py", ".")).toBe("pkg/__init__.py")
  })

  test("bare package names never resolve", () => {
    expect(RepoMapRender.resolve(files, "src/a.ts", "react")).toBeUndefined()
  })
})

describe("render", () => {
  const entries = [
    { file: "src/low.ts", symbols: [{ name: "low", line: 1 }], imports: [] },
    { file: "src/hub.ts", symbols: [{ name: "hub", line: 3 }], imports: [] },
    { file: "src/a.ts", symbols: [{ name: "a", line: 1 }], imports: ["./hub", "./hub.js"] },
    { file: "src/b.ts", symbols: [{ name: "b", line: 1 }], imports: ["./hub"] },
  ]

  test("files imported by more files rank first, duplicate imports count once", () => {
    const ranked = RepoMapRender.rank(entries)
    expect(ranked[0]!.entry.file).toBe("src/hub.ts")
    expect(ranked[0]!.references).toBe(2)
  })

  test("symbols per file are capped and the remainder is counted", () => {
    const text = RepoMapRender.render([{ file: "a.ts", symbols: Array.from({ length: 5 }, (_, i) => ({ name: `s${i}`, line: i + 1 })), imports: [] }], {
      symbolsPerFile: 3,
    })
    expect(text).toBe("a.ts: s0(1) s1(2) s2(3) +2")
  })

  test("budget is respected and skipped files are reported in one line", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      file: `packages/some/deep/path/file-${i}.ts`,
      symbols: [{ name: `symbol${i}`, line: i + 1 }],
      imports: [],
    }))
    const text = RepoMapRender.render(many, { budget: 400 })
    expect(text.length).toBeLessThanOrEqual(400)
    expect(text).toContain("more file")
  })

  test("one long line does not blank out the files behind it", () => {
    const text = RepoMapRender.render(
      [
        { file: "a.ts", symbols: Array.from({ length: 30 }, (_, i) => ({ name: `verylongsymbolname${i}`, line: i + 1 })), imports: [] },
        { file: "z.ts", symbols: [{ name: "tiny", line: 1 }], imports: [] },
      ],
      { budget: 120, lineLimit: 300 },
    )
    expect(text).toContain("z.ts")
  })
})

describe("call graph", () => {
  const state = {
    version: 2,
    root: "/repo",
    files: {
      "src/hub.ts": {
        mtimeMs: 1, size: 1, language: "typescript",
        symbols: [{ name: "hub", line: 1 }], imports: [], calls: [],
      },
      "src/a.ts": {
        mtimeMs: 1, size: 1, language: "typescript",
        symbols: [{ name: "a", line: 1 }], imports: [], calls: ["hub"],
      },
      "src/b.ts": {
        mtimeMs: 1, size: 1, language: "typescript",
        symbols: [{ name: "b", line: 1 }], imports: [], calls: ["hub"],
      },
      "src/deep.ts": {
        mtimeMs: 1, size: 1, language: "typescript",
        symbols: [{ name: "deep", line: 1 }], imports: [], calls: ["a"],
      },
    },
  }

  test("callers and callees answer in both directions", () => {
    const graph = RepoMapCallGraph.build(state)
    expect(graph.callers("hub")).toEqual(["src/a.ts", "src/b.ts"])
    expect(graph.callees("src/a.ts")).toEqual(["hub"])
    expect(graph.callers("missing")).toEqual([])
  })

  test("impact returns direct callers only, no avalanche", () => {
    const graph = RepoMapCallGraph.build(state)
    // hub -> called by a and b directly; deep calls a (not hub). Impact is one hop.
    expect(graph.impact("hub")).toEqual(["src/a.ts", "src/b.ts"])
    expect(graph.impact("deep")).toEqual([])
  })
})

describe("repo map", () => {
  test("builds from disk, caches, and picks up a new file", async () => {
    const root = await mkdtemp(join(tmpdir(), "sicode-repo-map-"))
    const cache = await mkdtemp(join(tmpdir(), "sicode-repo-map-cache-"))
    try {
      await mkdir(join(root, "src"), { recursive: true })
      await writeFile(join(root, "src", "hub.ts"), "export function shared() {}\n")
      await writeFile(join(root, "src", "use.ts"), 'import { shared } from "./hub.js"\nexport function use() {}\n')
      await writeFile(join(root, "src", "hub.test.ts"), "export function ignored() {}\n")

      const first = await RepoMap.get(root, { cache, wait: true })
      expect(first).toBeDefined()
      expect(first!).toContain("src/hub.ts")
      // Test files are pruned before parsing.
      expect(first!).not.toContain("hub.test.ts")

      // Second read comes from the disk cache and still parses nothing new.
      RepoMap.invalidate(root)
      await writeFile(join(root, "src", "laters.ts"), "export class Later {}\n")
      const second = await RepoMap.get(root, { cache, wait: true })
      expect(second!).toContain("src/laters.ts")
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(cache, { recursive: true, force: true })
    }
  })

  test("an empty directory yields no map instead of an error", async () => {
    const root = await mkdtemp(join(tmpdir(), "sicode-repo-map-empty-"))
    try {
      expect(await RepoMap.get(root, { cache: await mkdtemp(join(tmpdir(), "sicode-repo-map-empty-cache-")), wait: true })).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
