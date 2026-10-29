export * as RepoMapParse from "./parse.js"

import path from "path"
import { fileURLToPath } from "url"
import type { Parser as TreeSitterParser } from "web-tree-sitter"
import { repoMapWasm } from "#repo-map-wasm"
import { RepoMapExtract, type Result } from "./extract.js"

/**
 * SiCode: lazily loads the tree-sitter runtime and one grammar per language actually encountered.
 *
 * Everything here degrades to `undefined` rather than throwing: the repo map is an optimisation,
 * and a missing wasm artifact in a packaged build must leave the session working exactly as it did
 * before the map existed.
 */

type Runtime = typeof import("web-tree-sitter")

const absolute = (asset: string): string => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (path.isAbsolute(asset)) return asset
  return fileURLToPath(new URL(asset, import.meta.url))
}

let runtime: Promise<Runtime | undefined> | undefined

const load = (): Promise<Runtime | undefined> => {
  runtime ??= (async () => {
    if (!repoMapWasm.runtime) return undefined
    try {
      const module = await import("web-tree-sitter")
      await module.Parser.init({ locateFile: () => absolute(repoMapWasm.runtime) })
      return module
    } catch {
      return undefined
    }
  })()
  return runtime
}

/** Grammars are compiled once per process — `Language.load` is the expensive half of parsing. */
const grammars = new Map<string, Promise<TreeSitterParser | undefined>>()

const parser = (language: string): Promise<TreeSitterParser | undefined> => {
  const existing = grammars.get(language)
  if (existing) return existing
  const created = (async () => {
    const artifact = repoMapWasm.languages[language]
    if (!artifact) return undefined
    const module = await load()
    if (!module) return undefined
    try {
      const grammar = await module.Language.load(absolute(artifact))
      const instance = new module.Parser()
      instance.setLanguage(grammar)
      return instance
    } catch {
      return undefined
    }
  })()
  grammars.set(language, created)
  return created
}

export const parse = async (source: string, language: string): Promise<Result | undefined> => {
  const instance = await parser(language)
  if (!instance) return undefined
  const tree = instance.parse(source)
  if (!tree) return undefined
  try {
    return RepoMapExtract.walk(tree.rootNode)
  } finally {
    // Trees are wasm allocations and are not garbage collected with the JS object.
    tree.delete()
  }
}

/** Whether a grammar for this language can be loaded at all, without parsing anything. */
export const available = async (language: string): Promise<boolean> => (await parser(language)) !== undefined
