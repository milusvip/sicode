---
description: UI values live in packages/ui/DESIGN.md
globs: packages/{ui,session-ui,app}/**/*.{css,tsx}
---
- Before changing spacing, radius, type or colour in these packages, use the values in `packages/ui/DESIGN.md`. Do not invent a nearby value.
- Read the edited package's own `AGENTS.md` section `## Design tokens` for how the values are applied there; the three packages differ in coverage.

## Anti-slop (judgement, not values)

`DESIGN.md` says what the values are; the package `AGENTS.md` sections say how to apply them. Neither says "this screen looks AI-generated". That judgement is this section. Every value it points at still comes from `DESIGN.md` and `theme.css` — this list never supplies a number.

Adapted from [heydamir/unslop](https://github.com/heydamir/unslop) (CC BY 4.0, Damir Sokolovsky). Kept: the signs, the order to fix them in, the one rule "richness goes to content, chrome stays quiet". Dropped: its landing-page/hero/scene-image direction, its reference and asset pipeline, and its token file — SiCode has no hero, generates no images, and `DESIGN.md` is the only value authority.

Signs, in the order to fix them. Spacing first because the rhythm changes how everything else reads; motion last because it should fit a screen that already works without it.

- **Spacing** — off-grid one-offs (`mt-[13px]`, `py-[11px]`); rows in one list at different heights or gaps; group gaps not smaller than section gaps; icons or numbers nudged off their column.
- **Colour** — hex or a shadow in component CSS (`DESIGN.md` §Color); a hue gradient on a surface or on text; a coloured glow or shadow; a saturated background wash behind content; a semantic colour used as decoration; borders above `--v2-border-border-strong`.
- **Icons** — an emoji where an icon belongs; two stroke weights or sizes in one view; an icon carrying its own colour instead of its text role's; an icon in every row that adds nothing.
- **Copy** — an exclamation mark; a greeting headline (`Welcome back, X!`); a vague label where a short one fits; a change with no comparison (`+12%` with no `vs last month`); a trailing period on a label, button or caption; mock data that reads as `[X]` or `123,456`.
- **Type** — a size off the ladder, or a hand-tuned `12.5px` / `11.5px` / `10.5px` (see `DESIGN.md` §Known drift); uppercase with wide tracking; tracking tightened on small text; a weight between the tokens; italic for emphasis; a second hierarchy carried only by weight.
- **Layout** — a page-level selector overriding a `packages/ui` primitive instead of adding a variant (all three package `AGENTS.md` forbid this); a new divider or border standing in for distance; two elements at the same visual weight fighting for the same look.
- **Details** — an inner radius that is not the outer radius minus the padding; counts and meta as a glowing pill instead of quiet mono text; a stat card padded out with a sparkline or mini-chart; every card in a row the same size and shape.
- **Motion** — a loop with no live state driving it (`animate-pulse`, `animate-ping`, shimmer); `transition-all`; a hover that moves more than a few pixels; a catch-all duration or easing rather than the shared ones; no `prefers-reduced-motion` fallback where the package already has one.

Richness goes to content, chrome stays quiet: one element per screen carries colour and craft, and everything around it sits in the neutral ramp. Two or three loud things competing is the failure.

When a fix needs a value that is not on a ladder, add the token to `theme.css` and `DESIGN.md` first (see the `AGENTS.md` rule "a value that is not on a ladder means a token is missing") — never patch a literal in a component to get the look.
