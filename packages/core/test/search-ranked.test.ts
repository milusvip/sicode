import { expect, test } from "bun:test"
import { SearchRanked } from "@opencode/core/search-ranked/index"
import { SearchRankedConcepts } from "@opencode/core/search-ranked/concepts"
import { SearchRankedTerms } from "@opencode/core/search-ranked/terms"

const source = (files: Record<string, string>): SearchRanked.Source => ({
  files: async () => Object.keys(files),
  read: async (relative) => files[relative],
})

test("splits identifiers and chinese into comparable terms", () => {
  expect(SearchRankedTerms.termsOf("paddingInline")).toContain("padding")
  expect(SearchRankedTerms.termsOf("paddingInline")).toContain("inline")
  // Bigrams are how a chinese query reaches a differently worded dictionary value.
  expect(SearchRankedTerms.termsOf("设置页留白")).toContain("设置")
  expect(SearchRankedTerms.termsOf("设置页面留白")).toContain("留白")
  expect(SearchRankedTerms.pathTerms("packages/app/src/session/header.tsx")).toContain("header")
})

test("expands chinese intent into english code names", () => {
  expect(SearchRankedConcepts.expand("为什么压缩之后模型变笨了")).toContain("compaction")
  expect(SearchRankedConcepts.expand("上下文压缩什么时候会触发")).toContain("compaction")
  // Bare 压缩 alone is too broad; phrase rows must carry the bridge.
  expect(SearchRankedConcepts.extrasOf("图片压缩怎么做")).toEqual([])
  expect(SearchRankedConcepts.expand("hello world")).toBe("hello world")
})

test("maps an english behavior word onto the file that implements it", async () => {
  // `compress` names a behavior; the code calls it `compaction`. No dictionary bridges two English
  // words, so the ranked search needs the mapping — this is the failure definition-line ordering
  // cannot fix, because the target's filename and declarations never contain the query word.
  const suggestions = await SearchRanked.suggest(
    source({
      "packages/core/src/session/compaction.ts": "export function compact() {}",
      "packages/core/src/config/normalize.ts": "// compress the config before writing",
      "packages/core/src/compaction-metrics.ts": "// how long compress took",
    }),
    "compress",
  )
  expect(suggestions[0]?.path).toBe("packages/core/src/session/compaction.ts")
})

test("matches a behavior word whole, never as a prefix of a longer word", async () => {
  // `compress` must not fire on `compressor`; otherwise the mapping over-fires on unrelated queries.
  expect(SearchRankedConcepts.extrasOf("compressor tuning")).toEqual([])
  expect(SearchRankedConcepts.extrasOf("re-compress this")).toContain("compaction")
})

test("only a phrase about the concept fires a behavior word", () => {
  // A verb-first row only fires when the phrase is about the concept: "超出时压缩" is about the
  // overflow, not about compaction, and the Chinese row 压缩 must not drag compaction in. `compress`
  // is the exception and fires on the word — a repo that calls the behavior compaction is the only
  // reason a query would say `compress`, so even "measure how long compress takes" is about it.
  expect(SearchRankedConcepts.extrasOf("超出时压缩")).not.toContain("compaction")
  expect(SearchRankedConcepts.extrasOf("measure how long compress takes")).toContain("compaction")
  // The concept itself, asked about or asked for, still fires.
  expect(SearchRankedConcepts.extrasOf("为什么压缩之后模型变笨了")).toContain("compaction")
  expect(SearchRankedConcepts.extrasOf("compress a long session")).toContain("compaction")
})

test("a bare behavior word still names the file that implements it", () => {
  // The gate above must not swallow the plain word — `validate` alone is how a model asks for
  // `runtime.ts`'s validateStandard, the same way `compress` asks for compaction. Regression from
  // making the noun gate mandatory: both dropped out of the extras entirely.
  expect(SearchRankedConcepts.extrasOf("validate")).toContain("runtime")
  expect(SearchRankedConcepts.extrasOf("truncate")).toContain("recent-text")
  expect(SearchRankedConcepts.extrasOf("emit")).toContain("session-event")
  expect(SearchRankedConcepts.extrasOf("emit")).toContain("bus")
})

test("prefers the implementation over a config watcher that shares its filename", async () => {
  // Measured on the real repository: `compress` ties `session/compaction.ts` against
  // `config/plugin/compaction.ts` — both stems equal the extra, neither is a test — and BM25F is a
  // length-normalized average, so the short config file won by 0.002. The implementation stays at
  // the top now: infrastructure directories lose the tie, then the file that names the term in its
  // own body beats one that only observes it.
  const suggestions = await SearchRanked.suggest(
    source({
      "packages/core/src/session/compaction.ts":
        "export function compact() {}\n// compaction compaction compaction compaction",
      "packages/core/src/config/plugin/compaction.ts":
        "export const Plugin = define({ id: 'opencode.config.compaction' })",
    }),
    "compress",
  )
  expect(suggestions[0]?.path).toBe("packages/core/src/session/compaction.ts")
})

test("reaches compaction through a chinese compress phrasing", async () => {
  const suggestions = await SearchRanked.suggest(
    source({
      "packages/core/src/session/compaction.ts": "export const precompute = true",
      "packages/ui/src/i18n/zh.ts": 'export default { "ui.other": "为什么" }',
      "packages/core/src/unrelated.ts": "const a = 1",
    }),
    "为什么压缩之后模型变笨了",
  )
  expect(suggestions[0]?.path).toBe("packages/core/src/session/compaction.ts")
})

test("ranks a file whose path matches above one that only mentions the term", async () => {
  const suggestions = await SearchRanked.suggest(
    source({
      "src/session-header.tsx": "export function header() {}",
      "src/random.ts": "const header = 1\n// header header header",
      "src/other.ts": "nothing here",
    }),
    "header",
  )
  expect(suggestions[0]?.path).toBe("src/session-header.tsx")
  expect(suggestions.map((hit) => hit.path)).not.toContain("src/other.ts")
})

test("reaches code through a chinese dictionary value", async () => {
  const suggestions = await SearchRanked.suggest(
    source({
      "src/i18n/zh.ts": 'export default { "ui.settings.title": "设置页面", "ui.other": "别的" }',
      "src/theme.css": ".settings-panel__header { padding: 0 }",
      "src/unrelated.ts": "const a = 1",
    }),
    "设置页面",
  )
  expect(suggestions[0]?.path).toBe("src/i18n/zh.ts")
})

test("indexes css class names split by BEM", async () => {
  const suggestions = await SearchRanked.suggest(source({ "src/theme.css": ".session-header__actions { }" }), "session header actions")
  expect(suggestions[0]?.path).toBe("src/theme.css")
})

test("renders nothing when there is nothing to offer", async () => {
  const suggestions = await SearchRanked.suggest(source({ "src/a.ts": "const x = 1" }), "zzzz-nothing")
  expect(SearchRanked.render("zzzz-nothing", suggestions)).toBe("")
})

test("renders the closest files with a reason", async () => {
  const suggestions = await SearchRanked.suggest(source({ "src/settings-panel.tsx": "export function panel() {}" }), "settings panel")
  const rendered = SearchRanked.render("settings panel", suggestions)
  expect(rendered).toContain("No matches for")
  expect(rendered).toContain("src/settings-panel.tsx")
})
