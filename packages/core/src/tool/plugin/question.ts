export * as QuestionTool from "./question.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai/effect"
import { Effect, Schema } from "effect"
import { Form } from "../../form.js"
import { Permission } from "../../permission.js"
import { Question } from "@opencode/schema/question"

export const name = "question"

export const description = `Blocking ask path — the only way to wait for the user. Do not ask in assistant prose and stop.

Default: pick the recommended approach yourself and keep working. Do not use this tool to confirm obvious next steps, to dump an A/B menu of equivalent approaches, or to ask mid-checklist whether to continue.

Use it only when a wrong choice is costly and you cannot recover from context:
1. Two incompatible directions (e.g. delete vs keep; A/B API that both change product behavior)
2. Missing a secret / path / credential that is not in the repo or prior messages
3. The user explicitly asked you to choose with them

Usage notes:
- Put your recommended option first and mark it "(Recommended)" — never a flat "you choose" list
- A "Type your own answer" option is added automatically; don't add a free-form option yourself
- Set \`multiple: true\` only when selecting more than one option is real`

export const Input = Schema.Struct({
  questions: Schema.Array(Question.Prompt).check(Schema.isNonEmpty()).annotate({ description: "Questions to ask" }),
})

export const Output = Schema.Struct({
  answers: Schema.Array(Question.Answer),
})
export type Output = typeof Output.Type

export class CancelledError extends Schema.TaggedError<CancelledError>()("QuestionTool.CancelledError", {}) {
  override get message() {
    return "The user dismissed this question"
  }
}

export const toModelContent = (questions: ReadonlyArray<Question.Prompt>, answers: ReadonlyArray<Question.Answer>) => {
  const formatted = questions
    .map(
      (question, index) =>
        `"${question.question}"="${answers[index]?.length ? answers[index].join(", ") : "Unanswered"}"`,
    )
    .join(", ")
  return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`
}

export const Plugin = {
  id: "opencode.tool.question",
  effect: Effect.fn("QuestionTool.Plugin")(function* (ctx: Context) {
    const forms = yield* Form.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            permission
              .assert({
                action: "question",
                resources: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              .pipe(
                Effect.mapError((error) => new ToolFailure({ message: "Permission denied: question", error })),
                Effect.andThen(
                  forms
                    .ask({
                      sessionID: context.sessionID,
                      title: "Questions",
                      metadata: {
                        kind: "question",
                        tool: { messageID: context.messageID, id: context.id },
                      },
                      fields: [
                        toField(input.questions[0], 0),
                        ...input.questions.slice(1).map((question, index) => toField(question, index + 1)),
                      ],
                    })
                    .pipe(Effect.orDie),
                ),
                Effect.flatMap((state) => {
                  // Deliberate defect tunnel (see Permission.assert): a dismissal must dodge
                  // leaf `mapError` blankets so it never becomes model-facing tool output; it
                  // resurfaces as a typed failure at SessionModelRequest.executeTool.
                  // A dismissal with a message (e.g. from a non-interactive client) is ordinary
                  // model-facing feedback: the model continues instead of the step ending.
                  if (state.status === "cancelled" && state.message !== undefined)
                    return Effect.fail(new ToolFailure({ message: state.message }))
                  if (state.status === "cancelled") return Effect.die(new CancelledError())
                  const output = {
                    answers: input.questions.map((_, index): Question.Answer => {
                      const value = state.answer[`q${index}`]
                      if (value === undefined) return []
                      if (Array.isArray(value)) return Array.from(value)
                      return [String(value)]
                    }),
                  }
                  return Effect.succeed({
                    output,
                    content: toModelContent(input.questions, output.answers),
                    metadata: { answers: output.answers },
                  })
                }),
              ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}

function toField(question: Question.Prompt, index: number): Form.Field {
  return {
    key: `q${index}`,
    title: question.header,
    description: question.question,
    type: question.multiple === true ? "multiselect" : "string",
    options: question.options.map((option) => ({
      value: option.label,
      label: option.label,
      description: option.description,
    })),
    custom: true,
  }
}
