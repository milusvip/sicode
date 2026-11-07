export * as SessionDecisionFreeze from "./decision-freeze.js"

import { SessionMessage } from "./message.js"
import { SessionTopicSwitch } from "./topic-switch.js"

/**
 * SiCode: sticky "do not edit" locks from explicit user decisions.
 *
 * Weak models forget "成品效果还可以 / 别动" across tool turns and rewrite anyway. Prompt text does
 * not stop them; edit/write/patch must refuse frozen paths until the user unlocks that path.
 *
 * Structural first: @attachments and path tokens. Freeze/unfreeze phrases are a tiny closed set —
 * not a general intent engine. `OPENCODE_DECISION_FREEZE=0` disables the gate.
 */

export const METADATA_KEY = "sicode.decisionFreeze"

const FREEZE =
  /别动|不用改|不要改|保持现状|效果还可以|可以出片|先别动|先别改|别改了|don'?t\s+(?:change|touch|edit)|leave\s+it|keep\s+(?:it|as\s*is)|looks?\s+(?:fine|good|ok)\b/i

const UNFREEZE =
  /删除重新写|重写|改一下|改下|动它|修一下|修下|\b(?:rewrite|rewrite\s+it|fix\s+it|change\s+it|edit\s+it)\b|(?:^|[^\w])改(?:啊|吧|！|!|$)|(?:^|[^\w])修(?:啊|吧|！|!|$)/i

const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()

/** Opt-in: freeze phrases are a closed vocabulary; default off until a structural lock exists. */
export const enabled = () => process.env.OPENCODE_DECISION_FREEZE === "1"

export const wantsFreeze = (text: string) => FREEZE.test(text)
export const wantsUnfreeze = (text: string) => UNFREEZE.test(text) && !wantsFreeze(text)

const userPaths = (message: SessionMessage.Info): string[] => {
  if (message.type !== "user") return []
  const found = [...SessionTopicSwitch.pathsInText(message.text)]
  for (const file of message.files ?? []) {
    if (file.name) found.push(file.name)
    if (file.mention?.text) found.push(...SessionTopicSwitch.pathsInText(file.mention.text))
    if (file.source.type === "uri") {
      const fromUri = SessionTopicSwitch.pathsInText(file.source.uri)
      if (fromUri.length > 0) found.push(...fromUri)
      // file.name is the attachment path; raw file:// URIs rarely match edit targets.
      else if (!file.name) found.push(file.source.uri)
    }
  }
  return found.map(normalize).filter(Boolean)
}

/** Pure: fold user messages into the freeze set. Later decisions win for the same path. */
export const fold = (
  messages: ReadonlyArray<SessionMessage.Info>,
  initial: ReadonlyArray<string> = [],
): readonly string[] => {
  const frozen = new Set(initial.map(normalize).filter(Boolean))
  let lastNamed: string[] = []

  for (const message of messages) {
    if (message.type !== "user") continue
    const paths = userPaths(message)
    if (paths.length > 0) lastNamed = paths

    const targets = paths.length > 0 ? paths : lastNamed
    if (targets.length === 0) continue

    if (wantsUnfreeze(message.text)) {
      for (const path of targets) frozen.delete(path)
      continue
    }
    if (wantsFreeze(message.text)) {
      for (const path of targets) frozen.add(path)
    }
  }

  return [...frozen].sort()
}

export const pathsOf = (metadata: Record<string, unknown> | undefined): readonly string[] => {
  const raw = metadata?.[METADATA_KEY]
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
  const paths = (raw as { paths?: unknown }).paths
  if (!Array.isArray(paths)) return []
  return paths.filter((item): item is string => typeof item === "string").map(normalize)
}

export const withPaths = (
  metadata: Record<string, unknown> | undefined,
  paths: ReadonlyArray<string>,
): Record<string, unknown> => ({
  ...(metadata ?? {}),
  [METADATA_KEY]: { paths: [...paths].map(normalize).filter(Boolean).sort() },
})

/** True when `target` is the frozen path or sits under / equals it by normalized suffix. */
export const matches = (frozen: ReadonlyArray<string>, target: string): boolean => {
  const path = normalize(target)
  if (!path) return false
  for (const item of frozen) {
    if (!item) continue
    if (path === item) return true
    if (path.endsWith("/" + item) || path.endsWith(item)) return true
    if (item.endsWith("/" + path) || item.endsWith(path)) return true
  }
  return false
}

export const refuseMessage = (path: string) =>
  `User froze edits to ${path} (said not to change it / that results were fine). Do not edit, write, or patch it until they explicitly ask to change that path.`

// Process-local hot cache so tools can check without racing metadata projection; context.request refreshes it.
const cache = new Map<string, readonly string[]>()

export const remember = (sessionID: string, paths: ReadonlyArray<string>) => {
  cache.set(sessionID, [...paths].map(normalize).filter(Boolean).sort())
}

export const cached = (sessionID: string): readonly string[] => cache.get(sessionID) ?? []

export const clear = (sessionID?: string) => {
  if (sessionID) cache.delete(sessionID)
  else cache.clear()
}

/**
 * Sync freeze set from transcript into the hot cache (and optionally return metadata to persist).
 * Call once per request load so sticky decisions survive tool loops in-process.
 */
export const sync = (input: {
  readonly sessionID: string
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly metadata?: Record<string, unknown>
}) => {
  const next = fold(input.messages, pathsOf(input.metadata))
  remember(input.sessionID, next)
  return next
}

export const blocked = (sessionID: string, path: string, metadata?: Record<string, unknown>) => {
  if (!enabled()) return undefined
  const frozen = cached(sessionID).length > 0 ? cached(sessionID) : pathsOf(metadata)
  if (!matches(frozen, path)) return undefined
  return refuseMessage(path)
}
