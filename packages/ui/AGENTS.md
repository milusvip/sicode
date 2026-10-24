## Localization

- NEVER hardcode user-visible English strings in production code. ALWAYS use an i18n key for visible copy, placeholders, accessible labels, tooltips, menus, dialogs, toasts, empty states, and displayed errors.
- Feature work adds English source strings only. Leave non-English keys absent so the runtime English fallback applies; translations land separately after language review.
- Render count-sensitive copy only through `plural(baseKey, count, params)`. Never select or pass `.zero`, `.one`, `.two`, `.few`, `.many`, or `.other` variants to `t(...)`. `pluralForm(...)` is reserved for components that animate individual grammatical forms.
- Keep locale machinery out of feature code: do not inspect the active locale, call `Intl.PluralRules`, construct or select plural-category keys, or branch on locale-specific grammar. Use `t(...)` for ordinary copy and `plural(baseKey, count, params)` for count-sensitive copy.
- Never let a call site assemble a sentence. Prefer one complete phrase over concatenated fragments, and keep placeholders to irreducible values such as names, paths, and counts. When one UI concept needs several coordinated keys, add a single language-context operation that owns the composition.
- When the current API cannot express a translation, deepen the shared i18n module so one typed call owns locale selection, plural resolution, fallback, and interpolation. Do not leak that machinery into product code.
- When migrating existing copy to i18n, preserve the English text byte-for-byte unless the task explicitly requests a copy change. Never change existing English text or keys to facilitate translation: English is intentional, designer-written source copy.
- Choosing a term, judging whether a locale is ready to ship, or deciding whether an English string stays English: read `.opencode/skills/localization` first. Do not settle terminology from model knowledge alone.

## Typography

- Use the shared typography metrics instead of copying solid line heights from design exports: `--line-height-tight` is `12px`, `--line-height-compact` is `16px`, and `--line-height-base` is `20px`.
- Inter text at `13px` must use at least the compact `16px` line height. A `13px` solid line box can clip `g`, `j`, `p`, `q`, and `y` when the text or an ancestor truncates or hides overflow.
- Reserve `line-height: 1` and `leading-none` for non-text glyphs, icons, or deliberately reviewed display marks. Do not compensate text with transforms, negative margins, or clip-padding hacks.
- `TextShimmer` inherits font metrics. Put typography overrides on its parent when they must supersede the component defaults.

## Design tokens

- Take `font-size`, `line-height`, `border-radius`, `box-shadow`, and spacing from the tokens in `src/styles/theme.css`. The scales, the grids, and the platform weight facts are in `DESIGN.md`. A value that is not on a ladder means a token is missing: add it to the theme first, then use it. Do not inline the number as a one-off.
- Carry hierarchy with `font-weight: 400` against `700`. A 460-against-400 distinction does not survive Microsoft YaHei and renders as the same weight.
- Separate groups with distance, not with an extra border, divider, or background fill.
- Align numbers that are compared down a column to the right and set them in `--font-family-mono`.
- Change the primitive under `src/` when every instance changes; add a variant prop when one call site differs. If you reach for a page-level selector override to fix appearance, a variant or a token is missing — add that instead.
