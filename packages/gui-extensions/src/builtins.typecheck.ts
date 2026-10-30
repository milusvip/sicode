// Type-level check of the built-in compositions, run by `bun typecheck`. Nothing imports this file. Every Ipc a
// renderer entry declares in `provides`, `uses` or `requires` needs a main entry that provides it: an unprovided Ipc in
// `ctx.uses` stays pending forever, and an unprovided `requires` would also hold the window's startup gate. Each
// `@ts-expect-error` fails the typecheck if its line stops being an error.
import { Extension, Ipc, type IpcsProvided } from "./sdk"
import type { builtins } from "./renderer"
// Both compositions export `builtins`, and this file names the two together.
import type { builtins as mainBuiltins } from "./main"
import type browser from "./browser"

export const ipcs: IpcsProvided<typeof builtins, typeof mainBuiltins> = true

// The main composition with the browser's definition but not its main entry, which provides the pane.
type Mainless = readonly (Exclude<(typeof mainBuiltins)[number], { readonly id: "browser" }> | typeof browser)[]

// @ts-expect-error no main entry provides browser.pane, which the browser's renderer reads through `provides`
export const mainless: IpcsProvided<typeof builtins, Mainless> = true

// SiCode: typecheck the main-less browser's missing Ipcs one at a time while porting chromeBridge.
// SiCode: the browser definition now also provides chromeBridge, so a main-less browser misses both it and
// browser.pane; the `@ts-expect-error` above already pins "something is missing" without duplicating the union here.

const Orphan = Ipc.define({ id: "fixture.orphan", methods: {} })

// A renderer that uses an Ipc nothing in main provides.
const Uses = Extension.define({ id: "fixture", uses: { orphan: Orphan } })

// @ts-expect-error no main entry provides fixture.orphan
export const used: IpcsProvided<readonly [...typeof builtins, typeof Uses], typeof mainBuiltins> = true

// A renderer that requires it, from an extension listed in main without the main entry that would provide it.
const Provider = Extension.define({ id: "fixture.provider", provides: { orphan: Orphan } })

const Requires = Extension.define({ id: "fixture.requires", requires: { orphan: Orphan } })

// @ts-expect-error a renderer `requires` with no main provider would hold the startup gate
export const held: IpcsProvided<
  readonly [...typeof builtins, typeof Provider, typeof Requires],
  readonly [...typeof mainBuiltins, typeof Provider]
> = true
