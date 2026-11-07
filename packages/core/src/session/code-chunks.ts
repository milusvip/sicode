/**
 * SiCode: passive related-source chunks — the other half of Cursor's context feel.
 *
 * Memory inject already rides the request; context-hints only lists paths. Flash still pays a
 * round-trip to open the obvious file. This mounts a short excerpt for the top named/ranked leads
 * so the first model call already sees code, not just names.
 *
 * Tight budget on purpose: wrong excerpts mislead harder than missing ones. Cap files, lines, and
 * characters; prefer a keyword hit window over the file head; skip when env disables it.
 */
export * as SessionCodeChunks from "./code-chunks.js"

/** Hard cap on how many files may contribute a chunk. */
export const MAX_FILES = 2
/** Lines around a keyword hit (or from the top when no hit). */
export const MAX_LINES = 40
/** Total characters across all chunks in one request. */
export const CHAR_BUDGET = 2_000

export const envDisabled = () => process.env.OPENCODE_CODE_CHUNKS === "0"

export type ChunkSource = {
  readonly path: string
  readonly text: string
  /** Query terms / extras used to find a hit window; empty → file head. */
  readonly needles?: readonly string[]
}

export type Chunk = {
  readonly path: string
  readonly startLine: number
  readonly text: string
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** 1-based start line of a window centred on the first needle hit, or 1 for the file head. */
export function windowStart(text: string, needles: readonly string[], maxLines = MAX_LINES): number {
  const lines = text.split(/\r?\n/)
  if (lines.length === 0) return 1
  const lowered = needles.map((needle) => needle.trim().toLowerCase()).filter((needle) => needle.length >= 2)
  if (lowered.length === 0) return 1

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.toLowerCase()
    if (lowered.some((needle) => line.includes(needle))) {
      const half = Math.floor(maxLines / 2)
      return clamp(index + 1 - half, 1, Math.max(1, lines.length - maxLines + 1))
    }
  }
  return 1
}

export function extractChunk(source: ChunkSource, options?: { maxLines?: number; budget?: number }): Chunk | undefined {
  const maxLines = options?.maxLines ?? MAX_LINES
  const budget = options?.budget ?? CHAR_BUDGET
  if (source.text.trim().length === 0) return undefined

  const lines = source.text.split(/\r?\n/)
  const start = windowStart(source.text, source.needles ?? [], maxLines)
  const slice = lines.slice(start - 1, start - 1 + maxLines)
  let body = slice.join("\n")
  if (body.length > budget) body = body.slice(0, budget)
  if (body.trim().length === 0) return undefined
  return { path: source.path, startLine: start, text: body }
}

/** Render budgeted chunks for a request-only synthetic message. */
export function render(
  sources: readonly ChunkSource[],
  options?: { maxFiles?: number; maxLines?: number; budget?: number },
): string | undefined {
  if (envDisabled()) return undefined
  const maxFiles = options?.maxFiles ?? MAX_FILES
  let remaining = options?.budget ?? CHAR_BUDGET
  const parts: string[] = []

  for (const source of sources.slice(0, maxFiles)) {
    if (remaining < 80) break
    const chunk = extractChunk(source, { maxLines: options?.maxLines, budget: remaining })
    if (!chunk) continue
    const block = [`### ${chunk.path}:${chunk.startLine}`, "```", chunk.text, "```"].join("\n")
    if (block.length > remaining) continue
    parts.push(block)
    remaining -= block.length
  }

  if (parts.length === 0) return undefined
  return [
    "<code-chunks>",
    "Related source already loaded for this request (budgeted excerpts — verify before editing):",
    ...parts,
    "</code-chunks>",
  ].join("\n")
}
