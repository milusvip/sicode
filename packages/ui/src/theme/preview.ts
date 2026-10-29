import { resolveThemeVariantV2 } from "./v2/resolve"
import type { ThemeVariant } from "./types"

/**
 * The semantic roles a theme preview paints with, named for what the preview shows.
 * Values are concrete colors, so a preview can be painted outside a themed document.
 */
export interface ThemePreviewPalette {
  /** Base app surface. */
  surface: string
  /** Chrome: the title bar and the sidebar rail. */
  chrome: string
  /** Recessed secondary lines. */
  track: string
  /** Primary text line. */
  ink: string
  /** Accent line, the theme's interactive accent. */
  accent: string
  /** Second content line, a different hue from `accent` so the two do not read as one. */
  highlight: string
  /** Status dots in the title bar, in order. */
  danger: string
  info: string
  success: string
}

/**
 * Resolve those roles for one variant. `resolveThemeVariantV2` merges primitives, semantics, and
 * variant `v2Overrides` into one map, and its values are mostly references such as
 * `var(--v2-blue-400)`. Walking each reference within that same map is what makes a preview show the
 * color the app paints: a theme that overrides the ramps (OC-2, Matrix) overrides them in the map,
 * not in the primitives they were generated from.
 */
export function themePreviewPalette(variant: ThemeVariant, isDark: boolean): ThemePreviewPalette {
  const tokens = resolveThemeVariantV2(variant, isDark)

  const color = (token: string) => {
    let value = tokens[token]

    for (let step = 0; step < 8 && typeof value === "string"; step++) {
      const reference = /^var\(--(.+)\)$/.exec(value)

      if (!reference) break
      const next = tokens[reference[1]!]

      if (typeof next !== "string" || next === value) break
      value = next
    }

    return typeof value === "string" ? value : "transparent"
  }

  return {
    surface: color("v2-background-bg-base"),
    chrome: color("v2-background-bg-layer-01"),
    track: color("v2-background-bg-layer-02"),
    ink: color("v2-text-text-base"),
    accent: color("v2-icon-icon-accent"),
    // `v2-text-text-accent` is the same blue ramp step as `v2-icon-icon-accent`, so a preview that
    // used both would draw one line twice.
    highlight: color("v2-state-fg-warning"),
    danger: color("v2-state-fg-danger"),
    info: color("v2-state-fg-info"),
    success: color("v2-state-fg-success"),
  }
}
