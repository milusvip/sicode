export * as SessionAskMode from "./ask-mode.js"

import { Agent } from "@opencode/schema/agent"
import type { Permission } from "../permission.js"
import { Wildcard } from "../util/wildcard.js"

/**
 * SiCode: Ask is an admit-time tool table, not a drain-side classify gate (smart-no-spin).
 * Selecting agent `ask` merges these denies into `Tool.snapshot`, which drops write/edit/patch
 * (permission "edit") and execute before the model ever sees them — zero steer changes.
 */
export const ID = Agent.ID.make("ask")

/** Tool names that must not appear on an Ask snapshot. */
export const MUTATIONS = ["write", "edit", "patch", "execute"] as const

/** Permission actions that map to those mutations in the registry. */
export const DENY: Permission.Ruleset = [
  { action: "edit", resource: "*", effect: "deny" },
  { action: "execute", resource: "*", effect: "deny" },
]

/** Same rule Tool.snapshot uses: last matching action with resource `*` and effect deny. */
export const whollyDisabled = (action: string, rules: Permission.Ruleset) => {
  const rule = rules.findLast((item) => Wildcard.match(action, item.action))
  return rule?.resource === "*" && rule.effect === "deny"
}

/**
 * Pure: which of `names` survive after Ask denies. `permissionOf` maps a tool name to its
 * registry permission action (write/edit/patch → "edit", execute → "execute").
 */
export const advertised = (
  names: ReadonlyArray<string>,
  rules: Permission.Ruleset,
  permissionOf: (name: string) => string = (name) =>
    name === "write" || name === "edit" || name === "patch" ? "edit" : name,
) => names.filter((name) => !whollyDisabled(permissionOf(name), rules))
