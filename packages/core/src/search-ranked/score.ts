export * as SearchRankedScore from "./score.js"

import { count, termsOf } from "./terms.js"

/**
 * SiCode: BM25F over three fields.
 *
 * A plain grep scores every line the same, so a term buried in a 4k-line bundle outranks the file
 * that is actually named after it. Field weighting fixes the part that matters when the model is
 * guessing: a hit in the path or on a symbol is worth several hits in the body.
 */

export type Field = "path" | "symbol" | "content"

export interface Doc {
  readonly path: string
  readonly fields: Readonly<Record<Field, readonly string[]>>
}

export interface Hit {
  readonly path: string
  readonly score: number
  /** Which fields matched, strongest first — the model is told why a file was offered. */
  readonly why: readonly Field[]
}

/**
 * Path first: a file called `session-header-actions.tsx` is the answer to a header question even
 * when fifty other files mention headers. Symbol next, content last because it is the noisiest.
 */
export const WEIGHTS: Readonly<Record<Field, number>> = { path: 3, symbol: 2, content: 1 }

/** Length penalty per field: a long path or a long file should not dilute a term by much. */
const LENGTH: Readonly<Record<Field, number>> = { path: 0.4, symbol: 0.6, content: 0.75 }

const K1 = 1.2
const FIELDS: readonly Field[] = ["path", "symbol", "content"]

export const rank = (docs: readonly Doc[], query: string, limit = 5): Hit[] => {
  const terms = [...new Set(termsOf(query))]
  if (terms.length === 0 || docs.length === 0) return []

  const counts = docs.map((doc) => ({
    path: doc.path,
    fields: {
      path: count(doc.fields.path),
      symbol: count(doc.fields.symbol),
      content: count(doc.fields.content),
    } as Record<Field, Map<string, number>>,
    lengths: {
      path: doc.fields.path.length,
      symbol: doc.fields.symbol.length,
      content: doc.fields.content.length,
    } as Record<Field, number>,
  }))

  const average = {} as Record<Field, number>
  for (const field of FIELDS) {
    const total = counts.reduce((sum, doc) => sum + doc.lengths[field], 0)
    average[field] = Math.max(1, total / counts.length)
  }

  // Document frequency over any field: a term is common if it shows up everywhere regardless of where.
  const df = new Map<string, number>()
  for (const term of terms) {
    let found = 0
    for (const doc of counts) if (FIELDS.some((field) => doc.fields[field].has(term))) found++
    df.set(term, found)
  }
  const idf = (term: string) =>
    Math.log(1 + (counts.length - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5))

  const scored = counts.map((doc) => {
    let score = 0
    const per: Record<Field, number> = { path: 0, symbol: 0, content: 0 }
    for (const term of terms) {
      let weighted = 0
      for (const field of FIELDS) {
        const tf = doc.fields[field].get(term)
        if (!tf) continue
        const norm = tf / (1 + LENGTH[field] * (doc.lengths[field] / average[field] - 1))
        const contribution = WEIGHTS[field] * norm
        weighted += contribution
        per[field] += contribution
      }
      if (weighted === 0) continue
      score += idf(term) * (weighted / (K1 + weighted))
    }
    const why = FIELDS.filter((field) => per[field] > 0).sort((a, b) => per[b] - per[a])
    return { path: doc.path, score, why }
  })

  return scored
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit)
}
