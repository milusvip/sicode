// SiCode: platform stub for the trigram candidate index. Only the Bun runtime
// (where the core sidecar runs) gets the real implementation; node and workerd
// always report "no candidates" so callers fall back to a plain ripgrep sweep.
export const SCHEMA_VERSION = 2

/** See trigram.bun.ts: what the indexed content looked like, for reuse decisions. */
export interface Fingerprint {
  readonly mtimeMs: number
  readonly size: number
}

/** See trigram.bun.ts: a file that was enumerated but is not in the index. */
export const NOT_INDEXED = -1

export class TrigramIndex {
  static open(): TrigramIndex {
    throw new Error("trigram index is not supported on this platform")
  }

  get size(): number {
    return 0
  }

  get indexed(): number {
    return 0
  }

  getMeta(): string | undefined {
    return undefined
  }

  setMeta(): void {}

  paths(): string[] {
    return []
  }

  fingerprints(): Map<string, Fingerprint> {
    return new Map()
  }

  replaceAll(): void {}

  upsert(): void {}

  candidates(): string[] | null {
    return null
  }

  close(): void {}
}
