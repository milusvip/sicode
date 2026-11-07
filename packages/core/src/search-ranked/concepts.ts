export * as SearchRankedConcepts from "./concepts.js"

/**
 * SiCode: Chinese intent phrases that never appear in identifiers.
 *
 * BM25F bigrams alone land Chinese queries in i18n dictionaries that share characters; the code
 * that answers "压缩之后为什么变笨" lives in `compaction.ts`. Expanding the query with the English
 * names the repository actually uses is the bridge. Keep rows phrase-shaped — bare words like
 * 排序→grep or 压缩→compaction overfit the hints baseline and false-positive elsewhere.
 */

/** Longer phrases first so "上下文压缩" / "markdown 表格" win over shorter leftovers. */
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["上下文压缩", "compaction"],
  ["markdown 表格", "markdown-table"],
  ["线索注入", "context-hints"],
  ["设计值", "design-hint DESIGN"],
  ["仓库地图", "repo-map"],
  ["自动接受", "auto-approve"],
  ["权限弹窗", "permission-dock"],
  ["收件箱", "inbox"],
  ["侧边栏", "left-sidebar sidebar"],
  ["最接近的文件", "search-ranked"],
  ["搜索结果排序", "grep"],
  ["截断", "recent-text"],
  ["澄清", "clarify-hint"],
  ["变笨", "compaction"],
  // SiCode: phase-B memory / Flash dual-track phrases
  ["项目记忆", "project-memory belief recall"],
  ["跨会话", "project-memory belief"],
  ["权限码头", "permission-dock"],
  // SiCode: adversarial Flash query from dual-track session — compound of 线索+码头
  ["线索码头", "context-hints permission-dock"],
]

/**
 * SiCode: English behavior words that never name the file implementing them.
 *
 * Same failure as `压缩 → compaction`, one level down: the query is already English, so no
 * dictionary bridges it. `compress` returns `config/normalize.ts` and `compaction-metrics.ts` (the
 * word is in their content), while the implementation is `session/compaction.ts`, which contains
 * neither the word nor a matching declaration — measured, and the reason definition-line ordering
 * cannot help. The fix is the mapping the model would make if it knew this repository.
 *
 * Left side is the query word, right side the identifiers the repo actually uses. Keep rows
 * behavioral (`compress`, not `compaction`): a row whose left side already appears in the filenames
 * adds nothing, since the path field already ranks those. Match is whole-word and case-insensitive,
 * so `compress` fires while `compressor` does not.
 */
const BEHAVIOR: ReadonlyArray<readonly [string, string]> = [
  ["compress", "compaction"],
  ["summarize", "compaction"],
  ["truncate", "recent-text"],
  ["overflow", "recent-text"],
  ["validate", "runtime"],
  ["validation", "runtime"],
  // SiCode: 20-query baseline failure — `emit` landed on config/bus noise; the durable path is events.
  ["emit", "session-event bus"],
  ["publish", "session-event bus"],
]

/** Whole-word, case-insensitive: `compress` fires on "compress", never on "compressor". */
const hasWord = (query: string, word: string) =>
  new RegExp(`(?:^|[^a-zA-Z0-9])${word}(?![a-zA-Z0-9])`, "i").test(query)

/** English extras for a query, or an empty list when nothing matched. */
export const extrasOf = (query: string): readonly string[] => {
  const seen = new Set<string>()
  const extras: string[] = []
  for (const [phrase, english] of PAIRS) {
    if (!query.includes(phrase)) continue
    for (const term of english.split(/\s+/)) {
      if (!term || seen.has(term)) continue
      seen.add(term)
      extras.push(term)
    }
  }
  // The lesson from the Chinese rows applies here too: a bare verb is too broad. `compress` and
  // `summarize` name the concept by themselves — a request that says them is asking about
  // compaction — so they fire on the word. `overflow` in "超出时压缩" is about the overflow, and
  // `truncate` in "measure how long truncate takes" is about metrics, so those answer only to a
  // phrase that ends in the concept rather than mentioning it in passing.
  for (const [word, english] of BEHAVIOR) {
    if (!hasWord(query, word)) continue
    // A verb-first row (`overflow`, `truncate`, `validate`) only fires when the query is about the
    // concept — it names the behavior word itself or asks about the concept it maps to. `compress`
    // needs no further proof: a repo that calls the behavior compaction is the only reason a query
    // would say it.
    if (!ALWAYS.has(word) && !namesIt(query, word) && !ASKS_ABOUT.test(query.trim())) continue
    for (const term of english.split(/\s+/)) {
      if (!term || seen.has(term)) continue
      seen.add(term)
      extras.push(term)
    }
  }
  return extras
}

/**
 * SiCode: behavior words whose row already names the concept, so the word alone is the signal.
 * `compress` appears nowhere in `compaction.ts` — the only reason a query says `compress` is that
 * the repository calls that behavior compaction, so it fires on the word. Everything else in the
 * table is a verb first (`overflow`, `truncate`, `validate`) and needs the noun gate below.
 */
const ALWAYS: ReadonlySet<string> = new Set(["compress", "summarize", "emit"])

/**
 * SiCode: a phrase about the concept, not one that happens to contain the verb. The query either
 * ends in the concept it is asking about ("为什么压缩之后变笨" asks about 压缩) or is the behavior
 * word itself ("validate" names the thing `runtime.ts` implements, the same way `compress` does).
 * "超出时压缩" is about the overflow, and a sentence that merely uses the verb mid-way is a
 * different topic. A noun phrase in the tail is the only cheap signal available without a parser.
 */
const ASKS_ABOUT = /(压缩|截断|校验|验证|compaction|truncate|truncation|validation)$/i

/** A query that is the behavior word itself, or ends in it, is asking about that behavior. */
const namesIt = (query: string, word: string) =>
  new RegExp(`(?:^|[^a-zA-Z0-9])${word}$`, "i").test(query.trim())

export const expand = (query: string): string => {
  const extras = extrasOf(query)
  if (extras.length === 0) return query
  return `${query} ${extras.join(" ")}`
}

/**
 * Paths that literally contain a concept extra (hyphens allowed). BM25F tokenizes
 * `context-hints` into `context`+`hints`, so this keeps the hyphenated file ahead of i18n noise.
 */
export const pathMatchesExtra = (relative: string, extras: readonly string[]): boolean => {
  if (extras.length === 0) return false
  const lower = relative.toLowerCase()
  return extras.some((term) => lower.includes(term.toLowerCase()))
}
