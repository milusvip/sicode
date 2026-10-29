import { expect, test } from "bun:test"
import { SearchRanked } from "@opencode/core/search-ranked/index"
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
