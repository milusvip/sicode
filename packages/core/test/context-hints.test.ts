import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import type { SessionMessage } from "@opencode/schema/session-message"
import { Session } from "@opencode/schema/session"
import { FileSystem } from "@opencode/schema/filesystem"
import { RelativePath } from "@opencode/core/schema"
import { hintTerms, taskStart, SessionContextHints } from "../src/session/context-hints"
import { FileSystemSearch } from "../src/filesystem/search"

function user(text: string, id = "msg_user"): SessionMessage.Info {
  return { id, type: "user", text, time: { created: 1 } } as unknown as SessionMessage.Info
}

function assistant(id = "msg_assistant"): SessionMessage.Info {
  return { id, type: "assistant", content: [], time: { created: 2 } } as unknown as SessionMessage.Info
}

describe("context hint terms", () => {
  test("takes explicit mentions, file names, paths and signal-bearing identifiers", () => {
    const terms = hintTerms(
      "为什么 `htmlArtifactsForTurn` 没触发？看 session/context.ts 和 settings/model.tsx，还有 plan.ts",
    )

    expect(terms).toContain("htmlArtifactsForTurn")
    expect(terms).toContain("session/context.ts")
    expect(terms).toContain("settings/model.tsx")
    expect(terms).toContain("plan.ts")
  })

  test("skips plain lowercase words, noise, and duplicates", () => {
    const terms = hintTerms("session session request please something")

    expect(terms).toEqual([])
  })

  test("keeps the most explicit terms when there are many, capped at five", () => {
    const terms = hintTerms(
      "a.ts b.ts c.ts d.ts e.ts f.ts g.ts `pickedOne` createTimelineController",
    )

    expect(terms.length).toBeLessThanOrEqual(5)
    // A backticked token is explicit, so it outranks the file names that follow it.
    expect(terms[0]).toBe("pickedOne")
  })

  test("a prompt with no usable terms yields nothing", () => {
    expect(hintTerms("继续")).toEqual([])
    expect(hintTerms("")).toEqual([])
  })
})

describe("task start", () => {
  test("a prompt with nothing after it is a new task", () => {
    const start = taskStart([assistant(), user("这个会话的折叠箭头为什么不一致？")])

    expect(start?.index).toBe(1)
  })

  test("a turn that already produced work is mid-flight, not a new task", () => {
    expect(taskStart([user("看看侧边栏的箭头为什么不一致，改一下"), assistant()])).toBeUndefined()
  })

  test("short continuations are not worth a lookup", () => {
    expect(taskStart([user("继续")])).toBeUndefined()
  })

  test("no user message means nothing to hint", () => {
    expect(taskStart([assistant()])).toBeUndefined()
    expect(taskStart([])).toBeUndefined()
  })
})

describe("inject", () => {
  // The hint rides a real service, so these pin what happens when the lookup it depends on is not
  // there: a missing index, or a ripgrep binary that cannot be resolved on a machine with no
  // network. Both must leave the request untouched rather than fail the turn.
  const sessionID = Session.ID.make("ses_context_hints")
  const prompt = [assistant(), user("为什么 `htmlArtifactsForTurn` 没触发？看 session/context.ts")]
  const entry = (path: string) => FileSystem.Entry.make({ path: RelativePath.make(path), type: "file" })

  const withSearch = (find: (input: FileSystem.FindInput) => Effect.Effect<FileSystem.Entry[]>) =>
    Layer.succeed(FileSystemSearch.Service, { find })

  const run = (find: (input: FileSystem.FindInput) => Effect.Effect<FileSystem.Entry[]>) =>
    Effect.gen(function* () {
      const service = yield* SessionContextHints.Service
      return yield* service.inject({ sessionID, messages: prompt })
    }).pipe(Effect.provide(SessionContextHints.layer.pipe(Layer.provide(withSearch(find)))))

  const textOf = (message: SessionMessage.Info) => (message as { text?: string }).text ?? ""

  test("puts the leads right after the prompt it belongs to", async () => {
    const messages = await Effect.runPromise(run(() => Effect.succeed([entry("packages/core/src/session/context.ts")])))

    expect(messages).toHaveLength(3)
    expect(messages[2].type).toBe("synthetic")
    expect(textOf(messages[2])).toContain("packages/core/src/session/context.ts")
  })

  test("stays silent when the lookup finds nothing", async () => {
    const messages = await Effect.runPromise(run(() => Effect.succeed([])))

    expect(messages).toHaveLength(2)
  })

  test("stays silent when the lookup fails in the error channel", async () => {
    // The service type says the lookup cannot fail; the cast is the point of the test — a failure
    // arriving anyway must not take the turn down with it.
    const failing = (): Effect.Effect<FileSystem.Entry[]> =>
      Effect.fail(new Error("index unavailable")) as unknown as Effect.Effect<FileSystem.Entry[]>
    const messages = await Effect.runPromise(run(failing))

    expect(messages).toHaveLength(2)
  })

  test("stays silent when the lookup dies, as ripgrep does without a binary", async () => {
    // ripgrep reports a missing binary by yielding an Error inside its generator, which Effect
    // treats as a defect. `orElseSucceed` cannot see that channel, so this is the case that
    // regressed: every turn on a machine with no cached ripgrep used to fail outright.
    const messages = await Effect.runPromise(run(() => Effect.die(new Error("ripgrep execution failed"))))

    expect(messages).toHaveLength(2)
  })

  test("never hints the same task twice", async () => {
    const once = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SessionContextHints.Service
        const first = yield* service.inject({ sessionID, messages: prompt })
        const second = yield* service.inject({ sessionID, messages: prompt })
        return [first, second] as const
      }).pipe(
        Effect.provide(
          SessionContextHints.layer.pipe(
            Layer.provide(withSearch(() => Effect.succeed([entry("packages/core/src/session/context.ts")]))),
          ),
        ),
      ),
    )

    expect(once[0]).toHaveLength(3)
    expect(once[1]).toHaveLength(2)
  })
})
