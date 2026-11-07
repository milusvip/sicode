import { describe, expect, test } from "bun:test"
import {
  METADATA_KEY,
  blocked,
  enabled,
  fold,
  remember,
  sync,
  withScope,
} from "../src/session/constraint-ledger.js"
import type { SessionMessage } from "../src/session/message.js"

const user = (text: string, files?: string[]) =>
  ({
    id: "u",
    type: "user",
    text,
    time: { created: 0 },
    files: (files ?? []).map((name) => ({
      data: "",
      mime: "text/plain",
      source: { type: "uri", uri: `file:///repo/${name}` },
      name,
    })),
    agents: [],
    skills: [],
  }) as unknown as SessionMessage.Info

describe("constraint ledger removed", () => {
  test("never locks writes", () => {
    expect(enabled()).toBe(false)
    expect(fold([user("看看这个", ["packages/app/src/a.tsx"])])).toEqual([])
    remember("ses_1", ["packages/app/src/a.tsx"])
    expect(blocked("ses_1", "packages/app/src/b.tsx")).toBeUndefined()
    expect(
      sync({
        sessionID: "ses_2",
        messages: [user("看看这个", ["packages/app/src/a.tsx"])],
      }),
    ).toEqual([])
  })

  test("withScope scrubs stale metadata", () => {
    const scrubbed = withScope({ [METADATA_KEY]: { scope: ["packages/app/src/a.tsx"] }, keep: true }, [])
    expect(scrubbed[METADATA_KEY]).toBeUndefined()
    expect(scrubbed.keep).toBe(true)
  })
})
