// SiCode: platform stub for the trigram candidate index. Only the Bun runtime
// (where the core sidecar runs) gets the real implementation; node and workerd
// always report "no candidates" so callers fall back to a plain ripgrep sweep.
export const SCHEMA_VERSION = 1

export class TrigramIndex {
  static open(): TrigramIndex {
    throw new Error("trigram index is not supported on this platform")
  }

  get size(): number {
    return 0
  }

  getMeta(): string | undefined {
    return undefined
  }

  setMeta(): void {}

  paths(): string[] {
    return []
  }

  replaceAll(): void {}

  upsert(): void {}

  candidates(): string[] | null {
    return null
  }

  close(): void {}
}
