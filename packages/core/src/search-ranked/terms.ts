export * as SearchRankedTerms from "./terms.js"

/**
 * SiCode: turns text into the bag of terms the ranked search scores.
 *
 * One tokenizer for both sides on purpose — the model's query and the code must be cut the same
 * way or `paddingInline` on one side never meets `padding` + `inline` on the other. Chinese is
 * handled as overlapping bigrams: there are no spaces to split on, and dictionary values rarely
 * match a whole phrase, so "设置页留白" has to reach "设置页面留白" through 设置 / 置页 / 留白.
 */

const SPLIT = /[^a-zA-Z0-9㐀-鿿]+/u
/** `paddingInline` -> `padding` + `inline`; also splits `HTTPServer` -> `HTTP` + `Server`. */
const CAMEL = /(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/gu
const CJK = /[㐀-鿿]/u

const pushCjk = (run: string, out: string[]) => {
  if (run.length <= 4) out.push(run)
  for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2))
  if (run.length > 4) out.push(run)
}

export const termsOf = (text: string): string[] => {
  const out: string[] = []
  // Split camelCase before folding case: the boundary is the capital letter, and it is gone after.
  for (const raw of text.split(SPLIT)) {
    if (raw.length < 2) continue
    if (CJK.test(raw)) {
      pushCjk(raw, out)
      continue
    }
    const parts = raw.split(CAMEL).filter((part) => part.length >= 2)
    for (const part of parts) out.push(part.toLowerCase())
    const joined = raw.toLowerCase()
    if (!parts.includes(raw) || parts.length > 1) out.push(joined)
  }
  return out
}

/** Terms of a path: the segments carry more meaning than the punctuation between them. */
export const pathTerms = (relative: string): string[] => termsOf(relative.replaceAll(/[\\/]/g, " "))

export const count = (terms: readonly string[], into = new Map<string, number>()): Map<string, number> => {
  for (const term of terms) into.set(term, (into.get(term) ?? 0) + 1)
  return into
}
