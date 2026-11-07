/**
 * SiCode: M4 embeddings — feature-hash only (sync, zero deps, no model download).
 *
 * A real ONNX/MiniLM path was prototyped then withdrawn: for ≤200 beliefs, BM25 + concept
 * expand already carry CN/EN recall; a local embedder's CPU/RAM cost is not worth it.
 */
export * as SessionMemoryEmbed from "./embed.js"

export const HASH_VERSION = "feat-hash-v1"
export const HASH_DIM = 256

/** @deprecated use HASH_VERSION */
export const EMBED_VERSION = HASH_VERSION
/** @deprecated use HASH_DIM */
export const EMBED_DIM = HASH_DIM

export type EmbedMeta = { readonly version: string; readonly dim: number }

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

const fnv1a = (text: string) => {
  let hash = FNV_OFFSET
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

const addFeature = (vec: Float32Array, feature: string) => {
  const hash = fnv1a(feature)
  const index = hash % HASH_DIM
  vec[index]! += (hash & 1) === 0 ? 1 : -1
}

const l2normalize = (vec: Float32Array) => {
  let sum = 0
  for (let index = 0; index < vec.length; index++) sum += vec[index]! * vec[index]!
  if (sum <= 0) return vec
  const scale = 1 / Math.sqrt(sum)
  for (let index = 0; index < vec.length; index++) vec[index]! *= scale
  return vec
}

/** Sync feature-hash embed. Empty input → zero vector. */
export function embedHash(text: string): Float32Array {
  const vec = new Float32Array(HASH_DIM)
  const normalized = text.toLowerCase().trim()
  if (normalized.length === 0) return vec

  for (let index = 0; index + 2 < normalized.length; index++) {
    addFeature(vec, `c:${normalized.slice(index, index + 3)}`)
  }
  for (const token of normalized.split(/[^a-z0-9_\u3400-\u9fff]+/)) {
    if (token.length < 2) continue
    addFeature(vec, `t:${token}`)
  }
  return l2normalize(vec)
}

export const activeEmbedMeta = (): EmbedMeta => ({ version: HASH_VERSION, dim: HASH_DIM })

export function embedText(text: string): Float32Array {
  return embedHash(text)
}

/** Same as `embedText`, Promise-shaped for write-path callers. */
export async function embedTextAsync(text: string): Promise<{ vec: Float32Array; meta: EmbedMeta }> {
  return { vec: embedHash(text), meta: activeEmbedMeta() }
}

export const cosine = (a: Float32Array, b: Float32Array) => {
  const dim = Math.min(a.length, b.length)
  let sum = 0
  for (let index = 0; index < dim; index++) sum += a[index]! * b[index]!
  return sum
}

export const encodeVectorBlob = (vec: Float32Array) => Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)

export const decodeVectorBlob = (blob: Buffer | Uint8Array, dim: number) => {
  const copy = blob instanceof Buffer ? blob : Buffer.from(blob)
  const aligned = new Float32Array(copy.buffer, copy.byteOffset, Math.floor(copy.byteLength / 4))
  if (aligned.length === dim) return aligned
  const out = new Float32Array(dim)
  out.set(aligned.subarray(0, Math.min(dim, aligned.length)))
  return out
}
