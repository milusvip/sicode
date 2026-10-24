## Localization

- NEVER hardcode user-visible English strings in production code. ALWAYS use an i18n key for visible copy, placeholders, accessible labels, tooltips, menus, dialogs, toasts, empty states, and displayed errors.
- Feature work adds English source strings only. Leave non-English keys absent so the runtime English fallback applies; translations land separately after language review.
- Render count-sensitive copy only through `i18n.plural(baseKey, count, params)`. Never select or pass `.zero`, `.one`, `.two`, `.few`, `.many`, or `.other` variants to `t(...)`.
- Keep locale machinery out of feature code: do not inspect the active locale, call `Intl.PluralRules`, construct or select plural-category keys, or branch on locale-specific grammar. Use `t(...)` for ordinary copy and `i18n.plural(baseKey, count, params)` for count-sensitive copy.
- Never let a call site assemble a sentence. Prefer one complete phrase over concatenated fragments, and keep placeholders to irreducible values such as names, paths, and counts. When one UI concept needs several coordinated keys, add a single language-context operation that owns the composition.
- When the current API cannot express a translation, deepen the shared i18n module so one typed call owns locale selection, plural resolution, fallback, and interpolation. Do not leak that machinery into product code.
- When migrating existing copy to i18n, preserve the English text byte-for-byte unless the task explicitly requests a copy change. Never change existing English text or keys to facilitate translation: English is intentional, designer-written source copy.
- Choosing a term, judging whether a locale is ready to ship, or deciding whether an English string stays English: read `.opencode/skills/localization` first. Do not settle terminology from model knowledge alone.

## Typography

- Use `--line-height-compact` (`16px`) for `13px` transcript, tool, notice, and truncation text. Use `--line-height-base` (`20px`) for body text.
- Never copy Figma's generated `leading-none` onto text. Inter descenders clip when a solid `13px` line box meets `overflow: hidden`, `overflow: clip`, or truncation.
- Keep fixed row dimensions explicit; correct inner line metrics do not require transforms, negative margins, or paint-space compensation.
- `TextShimmer` inherits font metrics, so put typography overrides on its parent.

## Design tokens

- `packages/ui/DESIGN.md` governs appearance here. Take `font-size`, `border-radius`, spacing, and `box-shadow` from `packages/ui/src/styles/theme.css` rather than writing literals in this package.
- To change how transcript content looks, change the token in `theme.css`; do not patch the component CSS to a new number. If no existing token expresses the value, add one.
- Do not override an `@opencode/ui` primitive from a selector in this package. If a surface needs a different treatment, add the variant to the primitive.
