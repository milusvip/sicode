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
