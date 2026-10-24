## Priorities

- Prioritise, in this order: stability, simplicity, performance.
- Before changing session or timeline code, record a production benchmark baseline and compare it after the change.

## Debugging

- NEVER try to restart the app, or the server process, EVER.

## Local Dev

- `opencode dev web` proxies `https://app.opencode.ai`, so local UI/CSS changes will not show there.
- For local UI changes, run the backend and app dev servers separately.
- Backend (from the repository root): `bun dev serve --port 4096`
- App (from `packages/app`): `bun dev -- --port 4444`
- Open `http://localhost:4444` to verify UI changes (it targets the backend at `http://localhost:4096`).

## SolidJS

- Always prefer `createStore` over multiple `createSignal` calls

## Suspense

A flash, a blanked area, a dialog that resizes or a reset scroll on first open almost always means a read entered Suspense. Do not ship UI that reads async data without the guard below.

- Reading `resource()` suspends while it loads. So does `resource.latest` until the resource has resolved once: before the first value, `latest` behaves like a plain read. `resource.loading` and `resource.state` never suspend.
- Guard every render-time read on state, and show the data you already have until then:

  ```ts
  const loaded = () => resource.state === "ready" || resource.state === "refreshing"
  const items = () => (loaded() ? resource.latest : cached) ?? []
  ```

  Precedent: `src/new-session/workspace/controller.ts` (`worktreesLoaded`).

- When the source can change (a drilled project, a selected session), include its key in the fetched value and use the result only when the key matches. Otherwise `latest` shows the previous key's data while the next loads.
- A `<Suspense>` boundary only chooses what blanks; it does not prevent the suspension. Without a local boundary, the nearest one is often a whole dialog or route.
- Suspend only on purpose, on first load, with a comment that says why.

## Typography

- Use `--line-height-compact` (`16px`) for `13px` compact UI text and `--line-height-base` (`20px`) for body text.
- Do not use `leading-none`, `line-height: 1`, or a `13px` line height for normal text. Inter descenders clip inside truncation and overflow containers.
- Keep control and row heights explicit. Fix font metrics directly rather than using transforms, negative margins, or clip-padding compensation.

## Design tokens

- This package owns layout, not appearance. Values come from `packages/ui/src/styles/theme.css` and are documented in `packages/ui/DESIGN.md`; do not write literal colors, sizes, radii, or shadows in page CSS.
- When a page seems to need its own styling, that is a signal the primitive is missing a variant — add the variant to `packages/ui` and pass it as a prop, rather than overriding the primitive from a page selector.

## Localization

- NEVER hardcode user-visible English strings in production code. ALWAYS use an i18n key for visible copy, placeholders, accessible labels, tooltips, menus, dialogs, toasts, empty states, and displayed errors.
- Feature work adds English source strings only. Leave non-English keys absent so the runtime English fallback applies; translations land separately after language review.
- Render count-sensitive copy only through `language.plural(baseKey, count, params)`. Never select or pass `.zero`, `.one`, `.two`, `.few`, `.many`, or `.other` variants to `language.t(...)`.
- Keep locale machinery out of feature code: do not inspect the active locale, call `Intl.PluralRules`, construct or select plural-category keys, or branch on locale-specific grammar. Use `language.t(...)` for ordinary copy and `language.plural(baseKey, count, params)` for count-sensitive copy.
- Never let a call site assemble a sentence. Prefer one complete phrase over concatenated fragments, and keep placeholders to irreducible values such as names, paths, and counts. When one UI concept needs several coordinated keys, add a single language-context operation that owns the composition.
- When the current API cannot express a translation, deepen the shared i18n module so one typed call owns locale selection, plural resolution, fallback, and interpolation. Do not leak that machinery into product code.
- When migrating existing copy to i18n, preserve the English text byte-for-byte unless the task explicitly requests a copy change. Never change existing English text or keys to facilitate translation: English is intentional, designer-written source copy.
- Choosing a term, judging whether a locale is ready to ship, or deciding whether an English string stays English: read `.opencode/skills/localization` first. Do not settle terminology from model knowledge alone.

## Tests

A test must pay for its upkeep. Before adding one, answer three questions: which observable contract does it protect, which credible regression makes it fail, and why does no existing test already catch that regression. If any answer is missing, do not add the test.

- One contract, one owner. Test each behavior once, at the strongest boundary that observes it: the area's e2e keeper suite, or the owning module's unit test. Extend an existing table or keeper case before creating a file.
- Do not unit-test what an e2e keeper already proves, what a dependency does (for example `@pierre/trees`), config that passes values through, or source text (import or string greps). Source text is fair game only when that text is the contract, such as a persisted key.
- Never add production seams for tests: no test-only exports, parameters such as `now`, `delay` or `budget`, flags, globals, or `data-*` attributes. Control time with `setSystemTime` from `bun:test` and drive the real entry point.
- A test must be able to fail. Do not assert values the code under test produced, mock the behavior you assert, use soft assertions for the order the test guards, or leave `rejects`/`resolves` un-awaited. A regression test must fail on the code before the fix.
- Do not repeat a case per theme, text direction, viewport or channel. Use one table, and only when the behavior differs.
- When you delete or move coverage, name the test that still proves the contract. When you move a contract, mutate its owner once and confirm the new test fails.
- A contract proven by a `packages/session-ui/component-tests` test does not also get an app e2e copy.

## Tool Calling

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
