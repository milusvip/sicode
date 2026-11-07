export * as ChatsTool from "./chats.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "../../session/message.js"
import { SessionRecentText } from "../../session/recent-text.js"
import { SessionStore } from "../../session/store.js"
import { clip, search } from "./history.js"

export const name = "chats"

/**
 * SiCode: Cursor-style past-chat lookup across sessions in the same project directory.
 *
 * `history` only reaches before this session's last compaction. Decisions made in another chat —
 * why a sidebar looked that way, which approach was rejected — live elsewhere. This tool searches
 * those transcripts on demand so a fresh session can stay clean without forgetting prior conclusions.
 *
 * Scope is structural: same `directory` as the current session, other session IDs only. Nothing is
 * auto-injected into the prompt.
 */

const DEFAULT_HIT_LIMIT = 5
const DEFAULT_SESSION_SCAN = 20
const MESSAGE_SCAN = 80

export const Input = Schema.Struct({
  query: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "Words to find in other sessions of this project (decisions, errors, file names). Omit to list the newest other sessions with a short preview.",
    }),
  ),
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(15)).annotate({
      description: `Maximum hits (or listed sessions) to return (default: ${DEFAULT_HIT_LIMIT})`,
    }),
  ),
})

export const Output = Schema.Array(
  Schema.Struct({
    sessionID: Schema.String,
    title: Schema.String,
    text: Schema.String,
  }),
)

type EncodedOutput = typeof Output.Encoded

/** User/assistant lines worth searching — skips synthetic guidance and bare tool shells. */
export const exchangesOf = (messages: ReadonlyArray<SessionMessage.Info>) =>
  messages
    .filter((message) => message.type === "user" || message.type === "assistant")
    .map((message) => SessionRecentText.messageToText(message).trim())
    .filter((text) => text !== "")

export const toModelContent = (matches: EncodedOutput, input: { query?: string; scanned: number }) => {
  if (matches.length === 0) {
    if (!input.query?.trim())
      return "No other sessions in this project directory yet. Start another chat later, or stay in this one."
    if (input.scanned === 0) return "No other sessions in this project directory to search."
    return `No other session matched that. Scanned ${input.scanned} session${input.scanned === 1 ? "" : "s"} in this project; try another word, or use \`recall\` for short remembered facts.`
  }
  if (!input.query?.trim()) {
    return [
      `${matches.length} other session${matches.length === 1 ? "" : "s"} in this project (newest first):`,
      ...matches.flatMap((match) => [`### ${match.title} (${match.sessionID})`, match.text, "---"]),
    ].join("\n")
  }
  return [
    `${matches.length} hit${matches.length === 1 ? "" : "s"} in other project sessions:`,
    ...matches.flatMap((match) => [`### ${match.title} (${match.sessionID})`, match.text, "---"]),
  ].join("\n")
}

/**
 * Ranked hits across peer sessions. Pure over already-loaded transcripts so tests need no DB.
 * Newest sessions first; within a session, `search` already returns the newest matching slices.
 */
export const searchSessions = (input: {
  readonly peers: ReadonlyArray<{
    readonly id: string
    readonly title: string
    readonly texts: readonly string[]
  }>
  readonly query?: string
  readonly limit: number
}): EncodedOutput => {
  const query = input.query?.trim()
  const hits: Array<EncodedOutput[number]> = []

  for (const peer of input.peers) {
    if (hits.length >= input.limit) break
    if (!query) {
      const preview = peer.texts.at(-1)
      if (!preview) continue
      hits.push({ sessionID: peer.id, title: peer.title, text: clip(preview) })
      continue
    }
    for (const text of search(peer.texts, query, input.limit - hits.length)) {
      hits.push({ sessionID: peer.id, title: peer.title, text: clip(text) })
      if (hits.length >= input.limit) break
    }
  }
  return hits
}

const titleOf = (session: Session.Info) => session.title?.trim() || session.id

export const Plugin = {
  id: "opencode.tool.chats",
  effect: Effect.fn("ChatsTool.Plugin")(function* (ctx: Context) {
    const store = yield* SessionStore.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description:
            "Search or list other sessions in this project for past conclusions, decisions, and discussion. Use when a fresh chat needs something decided earlier elsewhere — not for this session's compacted archive (`history`) and not for short remembered facts (`recall`). Pass query words to search; omit query to list recent other sessions.",
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const current = yield* store.get(context.sessionID)
              const directory = current?.location.directory
              if (!directory)
                return {
                  output: [] as EncodedOutput,
                  content: "This session has no project directory, so other sessions cannot be scoped.",
                  metadata: { matches: 0, scanned: 0 },
                }

              const peers = (yield* store.list({
                directory,
                limit: DEFAULT_SESSION_SCAN,
                parentID: null,
                archived: false,
              })).filter((session) => session.id !== context.sessionID)

              const loaded = yield* Effect.forEach(
                peers,
                (session) =>
                  Effect.gen(function* () {
                    const messages = yield* store.messages({
                      sessionID: session.id,
                      order: "desc",
                      limit: MESSAGE_SCAN,
                    })
                    return {
                      id: session.id,
                      title: titleOf(session),
                      texts: exchangesOf(messages.toReversed()),
                    }
                  }).pipe(Effect.catch(() => Effect.succeed(undefined))),
                { concurrency: 4 },
              )

              const ready = loaded.filter((peer): peer is NonNullable<typeof peer> => peer !== undefined)
              const limit = input.limit ?? DEFAULT_HIT_LIMIT
              const output = searchSessions({ peers: ready, query: input.query, limit })
              return {
                output,
                content: toModelContent(output, { query: input.query, scanned: ready.length }),
                metadata: { matches: output.length, scanned: ready.length },
              }
            }).pipe(Effect.orDie),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
