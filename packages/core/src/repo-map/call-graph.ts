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

export interface Graph {
  /** Symbols a file calls. */
  readonly callees: (file: string) => readonly string[]
  /** Files that call the given symbol name. */
  readonly callers: (name: string) => readonly string[]
  /**
   * Files affected by changing a symbol — its direct callers. One hop only: a transitive closure
   * over bare names avalanches (a hub file exports many symbols and every one of their callers
   * gets swept in), so the model is told to follow up for the next hop if it needs it.
   */
  readonly impact: (name: string) => readonly string[]
}

export const build = (state: State): Graph => {
  // file -> symbol names it calls
  const calls = new Map<string, Set<string>>()

  for (const [file, stored] of Object.entries(state.files)) {
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
    // SiCode: "what does changing this reach" is only well-defined one hop out, because we match
    // by bare name. Walking the caller closure was tried and it avalanched — a hub file defines
    // several symbols, and every one of *their* callers got swept in, so `makeLocationNode` (whose
    // defining file also exports `tags` and `makeGlobalNode`) reported 2767 files instead of the
    // 59 that actually call it. Direct callers are the honest, non-exploding answer; the model can
    // follow up with a second query if it wants the next hop.
    return callers(name)
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
    ? `No direct callers found for ${query.name}.`
    : `Direct callers of ${query.name} (${impacted.length} files; for the next hop, re-run impact on one of these):\n${impacted.map((f) => `- ${f}`).join("\n")}`
}
