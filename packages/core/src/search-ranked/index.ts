export * as SearchRanked from "./index.js"

import { pathTerms, termsOf } from "./terms.js"
import { rank, type Doc, type Hit } from "./score.js"

/**
 * SiCode: what to offer the model when a grep comes back empty.
 *
 * An empty result almost always means the guessed term was wrong, and the model's next move is
 * another guess. Ranking the repository by the words of the query gives it somewhere to look
 * instead. Two rules shape the whole thing:
 *
 * - No resident index. The file list comes from ripgrep, everything else is read on demand and
 *   bounded (dictionary and style files because they are few, then only the top candidates). A
 *   suggestion that costs 30ms once in a while beats an index that costs memory on every session.
 * - Chinese has to reach the code. The user describes intent in Chinese, the identifiers are
 *   English, and the only place the two meet is the i18n dictionary: "设置页留白" matches the zh
 *   string, whose key is what the code actually uses. So dictionary values and CSS class names
 *   (BEM split) are indexed into the symbol field, which is weighted above raw content.
 */

export interface Source {
  /** Relative paths of the files to consider. */
  readonly files: () => Promise<readonly string[]>
  /** File text, or undefined when it cannot be read or is too large to be worth reading. */
  readonly read: (relative: string) => Promise<string | undefined>
}

export type Suggestion = Hit

/** Files considered in one suggestion. Above this the ranking is no cheaper than another search. */
export const MAX_FILES = 20_000
/** Dictionaries and stylesheets are few and small, and they are where a Chinese query pays off. */
const DICTIONARY_FILES = 30
const STYLE_FILES = 30
const DICTIONARY_BYTES = 3_000_000
/** How many files get their content read for the second pass. */
const CANDIDATES = 40
const CONTENT_BYTES = 256_000
const CONCURRENCY = 16

const DICTIONARY_PATH = /(^|\/)(i18n|locales?|locale|messages?|translations?)(\/|\.|$)/i
const STYLE_EXT = /\.(css|scss|less|sass)$/i

/** `"ui.settings.title": "设置"` — the key is what the code uses, the value is what the user said. */
const PAIR = /["']([\w.$-]{2,80})["']\s*:\s*["']([^"'\n]{1,200})["']/g
const CLASS = /\.(-?[_a-zA-Z][\w-]*)/g
const DEFINITION =
  /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|struct|enum|const|let|var|def|fn|func)\s+([A-Za-z_$][\w$]*)/g

/** BEM: `session-header__actions--wide` is three searchable names, not one opaque string. */
const bem = (name: string) => termsOf(name.replaceAll("__", " ").replaceAll("--", " "))

const chunk = async <T>(items: readonly T[], size: number, run: (item: T) => Promise<void>) => {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(run))
  }
}

/** Terms a file contributes above its content: dictionary entries, class names, definitions. */
const symbolTerms = (relative: string, text: string): string[] => {
  const out: string[] = []
  if (DICTIONARY_PATH.test(relative)) {
    for (const [, key, value] of text.matchAll(PAIR)) {
      out.push(...termsOf(key), ...termsOf(value))
    }
  }
  if (STYLE_EXT.test(relative)) {
    for (const [, name] of text.matchAll(CLASS)) out.push(...bem(name))
  }
  for (const [, name] of text.matchAll(DEFINITION)) out.push(...termsOf(name))
  return out
}

export interface Options {
  readonly limit?: number
  /** `OPENCODE_RANKED=0` and tests call this with a smaller repository in mind. */
  readonly candidates?: number
}

export const suggest = async (
  source: Source,
  query: string,
  options: Options = {},
): Promise<readonly Suggestion[]> => {
  const limit = options.limit ?? 5
  const wanted = options.candidates ?? CANDIDATES
  const files = (await source.files()).slice(0, MAX_FILES)
  if (files.length === 0) return []

  const texts = new Map<string, string>()

  // Pass one: the small set of files that translate a Chinese description into code terms.
  // Separate quotas, because a repository with hundreds of stylesheets must not push the
  // dictionaries — the only bridge from Chinese to identifiers — out of the bucket.
  //
  // Inside the quota the user's own language comes first. Alphabetically `zh.ts` sits behind
  // `am/ar/az/bg/...`, so a fixed slice takes thirty dictionaries and none of them is Chinese,
  // which is exactly the case this pass exists for.
  const localeFirst = (relative: string) => {
    const base = relative.slice(relative.lastIndexOf("/") + 1).toLowerCase()
    if (base.startsWith("zh")) return 0
    if (base.startsWith("ja") || base.startsWith("ko")) return 1
    return 2
  }
  const dictionaries = [
    ...files
      .filter((relative) => DICTIONARY_PATH.test(relative))
      .sort((a, b) => localeFirst(a) - localeFirst(b) || a.localeCompare(b))
      .slice(0, DICTIONARY_FILES),
    ...files.filter((relative) => STYLE_EXT.test(relative)).slice(0, STYLE_FILES),
  ]
  let budget = DICTIONARY_BYTES
  await chunk(dictionaries, CONCURRENCY, async (relative) => {
    if (budget <= 0) return
    const text = await source.read(relative)
    if (text === undefined) return
    budget -= text.length
    texts.set(relative, text)
  })

  const doc = (relative: string, content: readonly string[]): Doc => ({
    path: relative,
    fields: {
      path: pathTerms(relative),
      symbol: texts.has(relative) ? symbolTerms(relative, texts.get(relative)!) : [],
      content,
    },
  })

  // Path alone is enough to shortlist: the model's guess often looks like a filename.
  const shortlist = rank(
    files.map((relative) => doc(relative, [])),
    query,
    wanted + dictionaries.length,
  )
    .map((hit) => hit.path)
    .filter((relative) => !texts.has(relative))

  await chunk(shortlist.slice(0, wanted), CONCURRENCY, async (relative) => {
    const text = await source.read(relative)
    if (text === undefined || text.length > CONTENT_BYTES) return
    texts.set(relative, text)
  })

  const scored = [...texts.keys()].map((relative) => {
    const text = texts.get(relative)!
    const content = text.length > CONTENT_BYTES ? [] : termsOf(text)
    return doc(relative, content)
  })

  return rank(scored, query, limit)
}

/** Rendered for the model: the files worth opening, and why each one was offered. */
export const render = (query: string, suggestions: readonly Suggestion[]): string => {
  if (suggestions.length === 0) return ""
  const why = (fields: readonly string[]) =>
    fields.includes("symbol")
      ? "symbols"
      : fields.includes("path")
        ? "path"
        : "content"
  const lines = suggestions.map((hit) => `- ${hit.path} (${why(hit.why)})`)
  return [
    `No matches for ${JSON.stringify(query)}. Closest files by name, symbol and content:`,
    ...lines,
    "Open the closest one before searching again.",
  ].join("\n")
}
