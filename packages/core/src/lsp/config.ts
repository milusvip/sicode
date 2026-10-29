export * as LspConfig from "./config.js"

import { ConfigLSP } from "@opencode/schema/config/lsp"

/**
 * SiCode: choosing a language server from the `lsp` config section.
 *
 * The config shape is upstream's (see `@opencode/schema/config/lsp`): `false` disables everything,
 * `true` is reserved for future built-ins, and a record maps a server name to its command plus the
 * file extensions it handles. Pure so the tool's selection can be tested without config plumbing.
 */

/** The decoded `lsp` config value: `false`, `true`, or a record of named servers. */
export type Info = typeof ConfigLSP.Info["Type"]

export interface Server {
  readonly name: string
  readonly command: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly initialization: Readonly<Record<string, unknown>>
}

export type Selection = Server | "disabled" | "unconfigured"

/** A normalized extension including its dot, or `""` for a file with none. */
export const extensionOf = (file: string): string => {
  const separator = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"))
  const base = file.slice(separator + 1)
  const dot = base.lastIndexOf(".")
  return dot <= 0 ? "" : base.slice(dot).toLowerCase()
}

/** A config entry as read: the Disabled member and the Server member share these keys. */
interface RawEntry {
  readonly disabled?: boolean
  readonly command?: readonly string[]
  readonly extensions?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly initialization?: Readonly<Record<string, unknown>>
}

/**
 * Pick the server handling `extension`, or say why there is none. Entries without `extensions`
 * match every file; an entry disabled explicitly or with no command is skipped rather than
 * selected and failing at spawn time.
 */
export const select = (config: Info, file: string): Selection => {
  if (config === false) return "disabled"
  if (config === true) return "unconfigured"
  const extension = extensionOf(file)
  const names = Object.keys(config).sort()
  for (const name of names) {
    const entry = config[name] as RawEntry | undefined
    if (!entry || entry.disabled === true) continue
    if (!entry.command || entry.command.length === 0) continue
    if (entry.extensions && !entry.extensions.some((candidate) => candidate.toLowerCase() === extension)) continue
    return {
      name,
      command: entry.command,
      env: entry.env ?? {},
      initialization: entry.initialization ?? {},
    }
  }
  return "unconfigured"
}
