export * as HistoryTool from "./history.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import type { SessionMessage } from "../../session/message.js"
import { SessionRecentText } from "../../session/recent-text.js"
import { SessionStore } from "../../session/store.js"

export const name = "history"

/**
 * SiCode: reads the transcript a compaction took away.
 *
 * A summary keeps the decisions that still matter, not the exchanges that produced them — the exact
 * error text, the command that failed, the version someone quoted. Those rows are still in the
 * session's database; `SessionHistory.load` simply starts reading at the last completed compaction,
 * so nothing reaches the model. This tool reaches back past that boundary.
 *
 * Only the archived part is searched. Anything after the boundary is already in the context, and
 * returning it again would spend tokens on what the model can see.
 */
const MAX_TEXT = 1_500

/** The tail kept when one exchange is clipped: an answer's conclusion sits at its end. */
const TAIL = 400

export const Input = Schema.Struct({
  query: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "Words to look for in the part of this session that was compacted away. Omit to read its newest exchanges.",
    }),
  ),
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(20)).annotate({
      description: "Maximum number of exchanges to return (default: 5)",
    }),
  ),
})

export const Output = Schema.Array(Schema.Struct({ text: Schema.String }))

type EncodedOutput = typeof Output.Encoded

export const clip = (text: string) => {
  if (text.length <= MAX_TEXT) return text
  const head = text.slice(0, MAX_TEXT - TAIL)
  const tail = text.slice(-TAIL)
  return `${head}…[${text.length - MAX_TEXT} chars clipped]…${tail}`
}

/**
 * Splits a transcript into the exchanges the last compaction archived and the number of compactions
 * that ran. A newer summary owns everything before it, so an older summary is inside the archive but
 * contributes no text of its own: `messageToText` returns nothing for it.
 */
export const archiveOf = (messages: ReadonlyArray<SessionMessage.Info>) => {
  const boundary = messages.findLastIndex(
    (message) => message.type === "compaction" && message.status === "completed",
  )
  const completed = messages.filter(
    (message) => message.type === "compaction" && message.status === "completed",
  ).length
  return {
    archived: messages
      .slice(0, boundary < 0 ? 0 : boundary)
      .map((message) => SessionRecentText.messageToText(message).trim())
      .filter((text) => text !== ""),
    compacted: completed,
  }
}

export const toModelContent = (matches: EncodedOutput, archived: number) => {
  if (matches.length > 0)
    return [
      `${matches.length} of ${archived} archived exchanges, from before the last compaction:`,
      ...matches.flatMap((match) => [match.text, "---"]),
    ].join("\n")

  if (archived === 0) return "Nothing has been compacted away in this session yet, so there is no archive to read."
  return `No archived exchange matches that. ${archived} exchanges are kept from before the last compaction; try another word.`
}

export const Plugin = {
  id: "opencode.tool.history",
  effect: Effect.fn("HistoryTool.Plugin")(function* (ctx: Context) {
    const store = yield* SessionStore.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description:
            "Read what this session's compaction summarized away: earlier exchanges in full, including exact error text, commands, and file contents. Search it when a summary lost a detail you now need, instead of guessing or re-deriving it from the code.",
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const all = yield* store.messages({ sessionID: context.sessionID, order: "asc" })
              const { archived, compacted } = archiveOf(all)

              const limit = input.limit ?? 5
              const terms = (input.query ?? "")
                .toLowerCase()
                .split(/[\s,;]+/)
                .map((term) => term.trim())
                .filter(Boolean)
              const matched =
                terms.length === 0
                  ? archived.slice(-limit)
                  : archived
                      .filter((text) => {
                        const lower = text.toLowerCase()
                        return terms.some((term) => lower.includes(term))
                      })
                      .slice(-limit)

              const output = matched.map((text) => ({ text: clip(text) }))
              return {
                output,
                content: toModelContent(output, archived.length),
                metadata: { matches: output.length, archived: archived.length, compactions: compacted },
              }
            }).pipe(Effect.orDie),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
