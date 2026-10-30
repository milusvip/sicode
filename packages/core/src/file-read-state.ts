export * as FileReadState from "./file-read-state.js"

import { createHash } from "node:crypto"
import { Effect } from "effect"
import type { Files } from "./environment/index.js"

/**
 * What a session last saw of a file, recorded by the read tool and consulted by write. This is
 * optimistic concurrency, not a lock: nothing is blocked, and a writer whose snapshot went stale
 * simply fails with "read it again". It turns the one silent data-loss path — write overwriting
 * changes that landed between the model's read and its write, from a user, a formatter, codegen,
 * or another session — into an error the model can recover from in one turn.
 *
 * Keyed per session: another session's write must show up as staleness here, so a global
 * path-keyed map would let the writer refresh its own evidence away. Entries are tiny (a
 * timestamp and a 32-char hash) and live for the process, mirroring the server's lifetime.
 */
interface Snapshot {
  readonly mtimeMs: number
  /**
   * Hash of the file's full BOM-stripped text. Absent when the model never saw the whole file
   * (paged read, or a read whose long lines were truncated) — there a same-content false positive
   * cannot be ruled out, so staleness is judged on mtime alone.
   */
  readonly hash?: string
}

const snapshots = new Map<string, Snapshot>()

const key = (sessionID: string, absolute: string) => `${sessionID}\u0000${absolute}`

export const hashText = (text: string) => createHash("sha256").update(text, "utf8").digest("hex")

export const record = (sessionID: string, absolute: string, snapshot: Snapshot) => {
  snapshots.set(key(sessionID, absolute), snapshot)
}

export const get = (sessionID: string, absolute: string): Snapshot | undefined =>
  snapshots.get(key(sessionID, absolute))

/**
 * Whether the file's mtime has moved past what this session last recorded. `undefined` means the
 * question could not be asked (never read, or stat failed) and callers must proceed as before.
 */
export const changedSince = (sessionID: string, absolute: string, files: Files) =>
  Effect.gen(function* () {
    const recorded = get(sessionID, absolute)
    if (recorded === undefined) return undefined
    const info = yield* files.stat(absolute).pipe(Effect.orElseSucceed(() => undefined))
    if (info === undefined) return undefined
    return info.mtimeMs > recorded.mtimeMs
  })

/**
 * Refresh the snapshot after this session itself changed the file (write, edit, formatter), so a
 * follow-up write in the same turn is not tripped by the mtime the session's own work moved.
 */
export const track = (sessionID: string, absolute: string, files: Files, text: string) =>
  Effect.gen(function* () {
    const info = yield* files.stat(absolute).pipe(Effect.orElseSucceed(() => undefined))
    if (info === undefined) return
    record(sessionID, absolute, { mtimeMs: info.mtimeMs, hash: hashText(text) })
  }).pipe(Effect.catch(() => Effect.void), Effect.catchDefect(() => Effect.void))
