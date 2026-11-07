/**
 * SiCode: gather Observations from the live prompt turn + recent user texts.
 * Policies stay here; the plugin only calls this then Consolidate.admit.
 */
import type { Observation } from "../observation.js"
import * as ExplicitPolicy from "./explicit.js"
import { fromUserTexts } from "./repeated-constraint.js"
import { fromEditPaths } from "./edit-locus.js"

export const fromPromptTurn = (input: {
  readonly text: string
  readonly recentUserTexts?: readonly string[]
  readonly editPaths?: readonly string[]
}): Observation[] => [
  ...ExplicitPolicy.fromUserText(input.text),
  ...fromUserTexts([...(input.recentUserTexts ?? []), input.text]),
  ...fromEditPaths(input.editPaths ?? []),
]

export const fromCompactionSummary = (markdown: string): Observation[] => ExplicitPolicy.fromSummary(markdown)
