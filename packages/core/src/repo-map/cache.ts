export * as RepoMapCache from "./cache.js"

import { createHash } from "crypto"
import { access, mkdir, readFile, rename, writeFile } from "fs/promises"
import { dirname, join } from "path"
import type { Symbol } from "./extract.js"

/**
 * SiCode: the on-disk half of the repo map.
 *
 * A full parse of this repository takes ~6 seconds, which is far too much to pay per process, let
 * alone per request. `mtimeMs + size` per file is what makes an incremental refresh cheap: the
 * file is stat'ed, and only files whose timestamp or length moved are parsed again. That pair is
 * the same invalidation signal the trigram index uses, and it is enough in practice — an editor
 * save changes both.
 *
 * The cache is keyed by a hash of the absolute directory and lives outside the project, so a
 * checkout never gains a stray file and deleting the cache is always safe.
 */

const VERSION = 2
export { VERSION }

export interface Stored {
  readonly mtimeMs: number
  readonly size: number
  readonly language: string
  readonly symbols: readonly Symbol[]
  readonly imports: readonly string[]
  /** SiCode: names this file calls; version 2 added them, so older caches rebuild. */
  readonly calls?: readonly string[]
}

export interface State {
  readonly version: number
  readonly root: string
  readonly files: Record<string, Stored>
}

export const path = (directory: string, cacheDir: string): string =>
  join(cacheDir, `${createHash("sha1").update(directory).digest("hex").slice(0, 16)}.json`)

export const read = async (file: string): Promise<State | undefined> => {
  try {
    const state = JSON.parse(await readFile(file, "utf8")) as State
    if (state.version !== VERSION || typeof state.files !== "object") return undefined
    return state
  } catch {
    return undefined
  }
}

export const exists = async (file: string): Promise<boolean> => {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

/**
 * Written through a temporary file: the context hook may run while a previous refresh is still
 * being killed by process shutdown, and a half-written JSON would be discarded by `read` anyway —
 * but an atomic rename means the next start never sees one.
 */
export const write = async (file: string, state: State): Promise<void> => {
  try {
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(state))
    await rename(temporary, file)
  } catch {
    // A cache that cannot be written only costs a re-parse next time.
  }
}
