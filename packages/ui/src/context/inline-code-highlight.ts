/**
 * Inline code is one line of somebody's source, so it gets the treatment fenced code gets: a neutral
 * foreground with the theme's syntax colours on the parts that carry meaning. The colours name app
 * CSS variables (`--syntax-*`), the same palette `@pierre/highlights` paints fenced blocks with.
 *
 * Deliberately not a real parser. Inline snippets are 1–3 tokens long (a flag, a class list, a tag,
 * a call) and carry no language, so the rules below cover the shapes that actually show up in
 * developer chat and leave everything else on the inherited colour. An unknown snippet still reads as
 * code, never as a rainbow.
 */

const COLOR = {
  comment: "var(--syntax-comment)",
  tag: "var(--syntax-type)",
  property: "var(--syntax-property)",
  string: "var(--syntax-string)",
  number: "var(--syntax-constant)",
  call: "var(--syntax-primitive)",
  punct: "var(--v2-text-text-faint)",
}

// Order matters: a string is a string before it is punctuation, `--var` is a custom property before
// it is a flag, and a call is recognised before its name falls through as a plain identifier.
const definitions: { source: string; color?: string }[] = [
  { source: String.raw`\/\/[^\n]*`, color: COLOR.comment },
  { source: String.raw`\/\*[\s\S]*?\*\/`, color: COLOR.comment },
  // `<div`, `</div`, `<My.Component` — the bracket itself stays punctuation.
  { source: String.raw`<\/?[A-Za-z][\w.:-]*`, color: COLOR.tag },
  { source: String.raw`\/?>`, color: COLOR.punct },
  // `class=` — an attribute name is whatever sits before the equals sign.
  { source: String.raw`[A-Za-z_:][\w.:-]*(?=\s*=)`, color: COLOR.property },
  { source: String.raw`=`, color: COLOR.punct },
  { source: String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'`, color: COLOR.string },
  // `8px`, `1.5rem`, `0.5`, `100%`
  { source: String.raw`\d+(?:\.\d+)?(?:px|rem|em|%|ms|s|deg|vh|vw|fr)?`, color: COLOR.number },
  // `--markdown-code` is lowercase; `--noEmit` must fail here as a whole token (the trailing boundary
  // is what stops the match at `--no`, which would otherwise half-colour a shell flag) and fall
  // through to the flag rule below.
  { source: String.raw`--(?:[a-z][a-z0-9-]*)+(?![\w-])`, color: COLOR.property },
  { source: String.raw`(?<![\w-])--?[A-Za-z][\w-]*`, color: COLOR.number },
  // `getComputedStyle(` — the call, not its arguments.
  { source: String.raw`[A-Za-z_$][\w$.]*(?=\s*\()`, color: COLOR.call },
  // `inset-inline-end:` — a declaration's property.
  { source: String.raw`[A-Za-z][\w-]*(?=\s*:)`, color: COLOR.property },
  // Identifiers, class lists and file names inherit the code colour: they are the sentence, not the
  // emphasis.
  { source: String.raw`[A-Za-z_$#][\w$.#-]*` },
  { source: String.raw`\s+` },
  { source: String.raw`[^\sA-Za-z0-9_$#]`, color: COLOR.punct },
]

// Sticky so no rule can match later in the string than the cursor: each step must consume from here.
const rules = definitions.map((rule) => ({ ...rule, pattern: new RegExp(rule.source, "y") }))

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export function highlightInlineCode(text: string) {
  let html = ""
  let index = 0

  while (index < text.length) {
    let token: { text: string; color?: string } | undefined

    for (const rule of rules) {
      rule.pattern.lastIndex = index
      const match = rule.pattern.exec(text)

      if (match && match[0].length > 0) {
        token = { text: match[0], color: rule.color }
        break
      }
    }

    if (!token) {
      html += escape(text[index]!)
      index += 1

      continue
    }

    const value = escape(token.text)
    html += token.color ? `<span style="color:${token.color}">${value}</span>` : value
    index += token.text.length
  }

  return html
}
