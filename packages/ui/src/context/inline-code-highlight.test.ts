import { expect, test } from "bun:test"
import { highlightInlineCode } from "./inline-code-highlight"

const span = (color: string, text: string) => `<span style="color:${color}">${text}</span>`

test("paints an HTML fragment as tag, attribute and string", () => {
  expect(highlightInlineCode('<div class="flex gap-0.5">')).toBe(
    [
      span("var(--syntax-type)", "&lt;div"),
      " ",
      span("var(--syntax-property)", "class"),
      span("var(--v2-text-text-faint)", "="),
      span("var(--syntax-string)", '"flex gap-0.5"'),
      span("var(--v2-text-text-faint)", "&gt;"),
    ].join(""),
  )
})

test("tells a CSS custom property from a shell flag", () => {
  // The flag must not be half-eaten by the property rule: `--no` would colour the wrong prefix.
  expect(highlightInlineCode("--noEmit")).toBe(span("var(--syntax-constant)", "--noEmit"))
  expect(highlightInlineCode("--markdown-code")).toBe(span("var(--syntax-property)", "--markdown-code"))
  expect(highlightInlineCode("bunx tsc --noEmit")).toBe(
    `bunx tsc ${span("var(--syntax-constant)", "--noEmit")}`,
  )
})

test("colours numbers with units and declaration properties", () => {
  expect(highlightInlineCode("gap: 8px;")).toBe(
    [
      span("var(--syntax-property)", "gap"),
      span("var(--v2-text-text-faint)", ":"),
      " ",
      span("var(--syntax-constant)", "8px"),
      span("var(--v2-text-text-faint)", ";"),
    ].join(""),
  )
})

test("keeps identifiers on the inherited colour", () => {
  expect(highlightInlineCode("ScrollView")).toBe("ScrollView")
  expect(highlightInlineCode("px-1.5")).toBe("px-1.5")
})

test("escapes markup instead of emitting it", () => {
  expect(highlightInlineCode("a & b")).toBe(`a ${span("var(--v2-text-text-faint)", "&amp;")} b`)
  expect(highlightInlineCode("</script>")).toBe(
    `${span("var(--syntax-type)", "&lt;/script")}${span("var(--v2-text-text-faint)", "&gt;")}`,
  )
})

test("colours a call and its string argument", () => {
  expect(highlightInlineCode('getComputedStyle(li, "::marker")')).toBe(
    [
      span("var(--syntax-primitive)", "getComputedStyle"),
      span("var(--v2-text-text-faint)", "("),
      "li",
      span("var(--v2-text-text-faint)", ","),
      " ",
      span("var(--syntax-string)", '"::marker"'),
      span("var(--v2-text-text-faint)", ")"),
    ].join(""),
  )
})
