export * as RepoMapCallGraph from "./call-graph.js"

import type { State } from "./cache.js"

/**
 * SiCode: the call graph behind `callers` / `callees` / `impact`.
 *
 * Built in memory from the same parsed cache the map already writes — no extra index on disk and
 * no resident state, just a re-derivation when asked. Names are matched by their bare leaf, the
 * same shape `extract.ts` stores, so `c.d()` in one file meets the `d` definition in another.
 * This is deliberately a *symbol-name* graph, not a type-resolved one: it answers "who calls
 * `loadConfig`" quickly and cheaply, and it can be wrong about overloads and dynamic dispatch in
 * the same way every static call graph is — the answer is a lead, never a proof.
 */

export interface Node {
  /** Files where a symbol with this name is defined. */
  readonly definedIn: readonly string[]
  /** Files whose code calls this name. */
  readonly calledBy: readonly string[]
}

export interface Graph {
  /** Symbols a file calls. */
  readonly callees: (file: string) => readonly string[]
  /** Files that call the given symbol name. */
  readonly callers: (name: string) => readonly string[]
  /**
   * Files affected by changing a symbol: its callers, their callers, and so on. Stops when the
   * closure saturates, so a hub function can fan out but never loops forever.
   */
  readonly impact: (name: string) => readonly string[]
}

export const build = (state: State): Graph => {
  // symbol name -> files that define it
  const defined = new Map<string, Set<string>>()
  // file -> symbol names it calls
  const calls = new Map<string, Set<string>>()
  // file -> symbols it defines (so `impact` can walk up through definitions, not just names)
  const symbolsOf = new Map<string, Set<string>>()

  for (const [file, stored] of Object.entries(state.files)) {
    const syms = new Set<string>()
    for (const symbol of stored.symbols) {
      syms.add(symbol.name)
      const bucket = defined.get(symbol.name)
      if (bucket) bucket.add(file)
      else defined.set(symbol.name, new Set([file]))
    }
    symbolsOf.set(file, syms)

    const callees = new Set<string>()
    for (const callee of stored.calls ?? []) callees.add(callee)
    calls.set(file, callees)
  }

  const callers = (name: string): readonly string[] => {
    const result = new Set<string>()
    for (const [file, callees] of calls) if (callees.has(name)) result.add(file)
    return [...result].sort()
  }

  const impact = (name: string): readonly string[] => {
    // Start from the files that define the name, then walk outward: anything that (transitively)
    // calls a symbol defined in those files is affected. Iterate until no new file is reached.
    const reached = new Set<string>()
    const frontier = new Set<string>(defined.get(name) ?? [])
    while (frontier.size > 0) {
      const callersOfFrontier = new Set<string>()
      for (const file of frontier) {
        for (const symbol of symbolsOf.get(file) ?? []) {
          for (const caller of callers(symbol)) callersOfFrontier.add(caller)
        }
      }
      frontier.clear()
      for (const file of callersOfFrontier) {
        if (!reached.has(file) && !defined.get(name)?.has(file)) {
          reached.add(file)
          frontier.add(file)
        }
      }
    }
    return [...reached].sort()
  }

  return {
    callees: (file: string) => [...(calls.get(file) ?? [])].sort(),
    callers,
    impact,
  }
}

/** Rendered for the model: the answer to a structure question, with file:line pointers. */
export const render = (state: State, query: { kind: "callers" | "callees" | "impact"; name: string }): string => {
  const graph = build(state)
  if (query.kind === "callees") {
    const callees = graph.callees(query.name)
    return callees.length === 0
      ? `No calls found from ${query.name}.`
      : `${query.name} calls:\n${callees.map((c) => `- ${c}`).join("\n")}`
  }
  if (query.kind === "callers") {
    const callers = graph.callers(query.name)
    return callers.length === 0
      ? `No callers found for ${query.name}.`
      : `Callers of ${query.name}:\n${callers.map((f) => `- ${f}`).join("\n")}`
  }
  const impacted = graph.impact(query.name)
  return impacted.length === 0
    ? `Changing ${query.name} affects no other files (by name).`
    : `Changing ${query.name} affects:\n${impacted.map((f) => `- ${f}`).join("\n")}`
}
