import type { FormInfo, PermissionRequest, SessionInfo } from "@opencode/client/promise"

function sessionTreeRequest<T>(
  session: SessionInfo[],
  request: Record<string, T[] | undefined> | ((sessionID: string) => T[] | undefined),
  sessionID?: string,
  include: (item: T) => boolean = () => true,
) {
  const ids = sessionTreeIDs(session, sessionID)

  if (!ids.length) return
  const list = (id: string) => (request instanceof Function ? request(id) : request[id])
  const id = ids.find((id) => list(id)?.some(include))

  if (!id) return

  return list(id)?.find(include)
}

export function sessionTreeIDs(session: SessionInfo[], sessionID?: string) {
  if (!sessionID) return []

  const map = session.reduce((acc, item) => {
    if (!item.parentID) return acc
    const list = acc.get(item.parentID)

    if (list) list.push(item.id)

    if (!list) acc.set(item.parentID, [item.id])

    return acc
  }, new Map<string, string[]>())

  const seen = new Set([sessionID])
  const ids = [sessionID]

  for (const id of ids) {
    const list = map.get(id)

    if (!list) continue

    for (const child of list) {
      if (seen.has(child)) continue
      seen.add(child)
      ids.push(child)
    }
  }

  return ids
}

export function sessionPermissionRequest(
  session: SessionInfo[],
  request: Record<string, PermissionRequest[] | undefined> | ((sessionID: string) => PermissionRequest[] | undefined),
  sessionID?: string,
  include?: (item: PermissionRequest) => boolean,
) {
  return sessionTreeRequest(session, request, sessionID, include)
}

/**
 * SiCode: every pending permission in the session tree, depth-first. Used to batch same-action
 * asks (N concurrent edits) into one dock instead of N serial popups.
 */
export function sessionPermissionRequests(
  session: SessionInfo[],
  request: Record<string, PermissionRequest[] | undefined> | ((sessionID: string) => PermissionRequest[] | undefined),
  sessionID?: string,
  include: (item: PermissionRequest) => boolean = () => true,
): PermissionRequest[] {
  const ids = sessionTreeIDs(session, sessionID)
  if (!ids.length) return []

  const list = (id: string) => (request instanceof Function ? request(id) : request[id])
  const out: PermissionRequest[] = []
  for (const id of ids) {
    for (const item of list(id) ?? []) {
      if (include(item)) out.push(item)
    }
  }
  return out
}

/** First pending ask, plus every later ask that shares its action (edit with edit, shell with shell). */
export function sessionPermissionBatch(pending: readonly PermissionRequest[]): PermissionRequest[] {
  const first = pending[0]
  if (!first) return []
  return pending.filter((item) => item.action === first.action)
}

export function sessionFormRequest(
  session: SessionInfo[],
  request: Record<string, FormInfo[] | undefined> | ((sessionID: string) => FormInfo[] | undefined),
  sessionID?: string,
) {
  return sessionTreeRequest(
    session,
    request,
    sessionID,
    (item) =>
      item.metadata?.kind === "question" ||
      item.metadata?.kind === "websearch.provider" ||
      item.metadata?.kind === "mcp-elicitation",
  )
}
