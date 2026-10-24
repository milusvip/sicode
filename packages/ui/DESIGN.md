# Web UI design system

Values shared by `packages/ui`, `packages/session-ui`, and `packages/app`. Each package's `AGENTS.md` holds the rules for applying them; this file holds the values themselves. A number changes here and in `src/styles/theme.css` together — never inside a component.

## Font stack

- Sans: `--font-family-sans` — system stack (`-apple-system`, PingFang SC, Microsoft YaHei), with Noto Sans SC registered as the fallback for machines that have neither.
- Mono: `--font-family-mono` — IBM Plex Mono, falling back to Consolas.

## Weight

`theme.css` declares `--font-weight-regular: 460`, `--font-weight-medium: 500`, `--font-weight-bold: 670`. Only two of those are real everywhere:

| platform | real weights |
| --- | --- |
| Windows / Microsoft YaHei | 300, 400, 700 |
| macOS / PingFang SC | continuous 200–600 |

On Windows `460` and `500` both resolve to `400`, so a level separated by 460 against 400 carries no hierarchy there. Separate with 400 against 700, or with size and color.

## Type scale

| token | value | role |
| --- | --- | --- |
| `--font-size-x-small` | 12px | metadata, badge, keybind |
| `--font-size-small` | 14px | secondary row |
| `--font-size-base` | 15px | body |
| `--font-size-large` | 16px | section title |
| `--font-size-x-large` | 20px | view title |

Line heights are separate metrics, not derived from size: `--line-height-tight` 12px, `--line-height-compact` 16px, `--line-height-base` 20px. Transcript text at 13px pairs with compact, never with a solid 13px box.

## Space

`--spacing` is `0.25rem` (4px). The working grid is **4 / 8 / 12 / 24**; anything off it is a local patch. Whatever the gap between groups is, the gap inside a group must be smaller — distance groups things, borders do not.

## Radius

| token | value |
| --- | --- |
| `--radius-xs` | 2px |
| `--radius-sm` | 4px |
| `--radius-md` | 6px |
| `--radius-lg` | 8px |
| `--radius-xl` | 10px |

10px is the ceiling. This is not a pill-shaped system; `999px` is reserved for avatars and tags.

## Elevation

Flat by default. Surfaces are separated by background color and hairline borders, not by shadow. Only genuinely floating layers — menu, popover, hover card, dialog, toast — take a `--v2-elevation-*` token. Everything else declares `box-shadow: none` explicitly so a later refactor cannot inherit one.

## Color

Pick by semantic role from `--text-*`, `--background-*`, `--border-*`, `--icon-*`, and the `--v2-*` set. Raw hex belongs in `src/styles/theme.css` and `src/styles/tokens/` only. If no role fits, add the role to the theme and resolve it in every theme file — do not repurpose a neighbouring token for a similar-looking color.

## Numbers

Anything compared down a column — diff counts, byte sizes, durations, percentages — is right-aligned and set in the mono font, so digit widths line up and the eye can scan the column without re-reading the labels.

## Changing a surface

1. Every instance changes → edit the primitive under `src/<area>/`.
2. One call site needs a different treatment → add a variant to the primitive and pass it as a prop.
3. It is page layout, not component appearance → compose in the page, but style from tokens.
4. None of the above → a token is probably missing. Add it here and in `theme.css`, then use it.

Never reach step 1's outcome with a selector override from `packages/app` or `session-ui`.

## Known drift (2026-10-25)

Recorded so nobody copies the leftovers as precedent.

- `font-size` still appears as a literal in roughly 75 places across 10 distinct values. `12.5px`, `11.5px`, and `10.5px` are hand-tuning residue and should collapse into the scale.
- `13px` and `11px` are the two most common literal sizes and have no token. 13px is legitimate — it has its own line-height rule in all three packages — the gap is that it was never tokenized.
- `--radius-*` is referenced about 20 times against ~100 literals; the ladder exists but is not the default path yet.
- `--font-weight-regular: 460` predates the switch to a system font stack and no longer earns its keep on Windows.
