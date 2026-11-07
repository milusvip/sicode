export * as SessionConstraintLedger from "./constraint-ledger.js"

/**
 * SiCode: allow-scope ledger removed. It locked write/edit/patch to attached paths and then
 * refused sibling scripts / log pastes until the user unlocked scope — repeatedly worse than
 * the drift it was meant to stop. Stubs stay so call sites compile; everything is a no-op.
 * Decision-freeze (do-not-touch) is unchanged.
 */

import { SessionMessage } from "./message.js"

export const METADATA_KEY = "sicode.constraintLedger"

export const enabled = () => false

export const fold = (
  _messages: ReadonlyArray<SessionMessage.Info>,
  _initial: ReadonlyArray<string> = [],
): readonly string[] => []

export const scopeOf = (_metadata: Record<string, unknown> | undefined): readonly string[] => []

export const withScope = (
  metadata: Record<string, unknown> | undefined,
  _scope: ReadonlyArray<string>,
): Record<string, unknown> => {
  if (!metadata) return {}
  const next = { ...metadata }
  delete next[METADATA_KEY]
  return next
}

export const inScope = (_scope: ReadonlyArray<string>, _target: string): boolean => true

export const refuseMessage = (_path: string, _scope: ReadonlyArray<string>) => ""

export const remember = (_sessionID: string, _scope: ReadonlyArray<string>) => {}

export const cached = (_sessionID: string): readonly string[] => []

export const clear = (_sessionID?: string) => {}

export const sync = (_input: {
  readonly sessionID: string
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly metadata?: Record<string, unknown>
  readonly child?: boolean
}) => [] as const

export const blocked = (
  _sessionID: string,
  _path: string,
  _metadata?: Record<string, unknown>,
): undefined => undefined
