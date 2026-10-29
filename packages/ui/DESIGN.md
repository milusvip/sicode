# Web UI design system

Values shared by `packages/ui`, `packages/session-ui`, and `packages/app`. Each package's `AGENTS.md` holds the rules for applying them; this file holds the values themselves. A number changes here and in `src/styles/theme.css` together — never inside a component.

## Font stack

- Sans: `--font-family-sans` — system first, the bundled Noto face last. On macOS this is PingFang SC, on Windows Microsoft YaHei UI / Microsoft YaHei; the Latin in between comes from the platform's own UI face (SF on mac, Segoe UI on Windows). That is the order the reference client uses, and it is why mixed text renders crisper at UI sizes than a bundled CJK webfont did: Chromium under Windows hinted the bundled variable face thin. The cost is a deliberate two-face sentence — Latin and CJK come from different families, so glyph width steps at the script boundary. `思源黑体` (registered via `local()` in `packages/app/src/index.css`), `Source Han Sans SC` and `Noto Sans SC` are one family under several names, `Noto Sans SC Variable` is the bundled `@fontsource-variable` copy, and those only load on a machine with no system CJK face.
- Mono: `--font-family-mono` — IBM Plex Mono, then `ui-monospace` / Consolas, and only then the CJK faces. Fallback is per-glyph, so Chinese comments still land on the system CJK face through the generic `monospace` (Consolas has no CJK), while a failed Plex webfont cannot hand Latin to the CJK face's proportional glyphs.

`packages/app/src/settings/model.tsx` writes both variables inline on `:root` when settings load, so the strings there override the initial values in `theme.css`. `sansFallback` / `monoFallback` and the two `theme.css` declarations must stay byte-identical; only the runtime one has any effect.

## Weight

`theme.css` declares `--font-weight-regular: 400`, `--font-weight-medium: 500`, `--font-weight-bold: 670`. Regular is the face's own default, so every install renders body text at exactly 400 without relying on interpolation or the CSS upward-search rule: a static three-weight family (400/500/700) and a variable one (wght 100–900) both land on 400. Bold at `670` only interpolates on a variable face: Microsoft YaHei has no 600, so the browser searches upward and Windows renders bold CJK at 700.

| face | real weights | `400` resolves to |
| --- | --- | --- |
| 思源黑体 → variable install (`local("Noto Sans SC")` → `NotoSansSC-VF.ttf`) | continuous 100–900 | 400 |
| 思源黑体 → static three-weight install | 400, 500, 700 | 400 |
| Noto Sans SC Variable (bundled `@fontsource-variable`) | continuous 100–900 | 400 |
| PingFang SC | continuous 200–600 | 400 |
| Microsoft YaHei | 300, 400, 700 | 400 |

Earlier the regular token was `460`. That only worked because variable installs interpolate; a truly static family jumps to 500 (for a target between 400 and 500 the browser searches upward before going below), so the same token produced different weights per machine. Verify a machine's row by its font file, not its registry entries — Windows lists named instances of one variable file as separate `Noto Sans SC` / `Medium` / `Bold` entries, which reads like three static weights.

`--font-weight-regular` only governs declarations that reference the token. The upstream CSS also hardcodes `440` (secondary text) and `530` (titles, labels) in a few hundred places; those are upstream values and were left alone, and they remain distinct from 400 on a variable install. Weight steps below about one hundred units do not survive a family that only ships 400/700: separate hierarchy with 400 against 700, or with size and color.

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
- `--font-weight-regular: 460` predates the switch to a system font stack and no longer earns its keep on Windows. `--font-weight-bold: 600` was chosen for the static MiSans cuts (400/500/600) and went back to `670` with the system stack.
