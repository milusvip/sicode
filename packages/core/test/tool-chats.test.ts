import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "@opencode/schema/session-message"
import { exchangesOf, searchSessions, toModelContent } from "@opencode/core/tool/plugin/chats"

const user = (text: string) => ({ type: "user", text }) as unknown as SessionMessage.Info
const assistant = (text: string) =>
  ({ type: "assistant", content: [{ type: "text", text }] }) as unknown as SessionMessage.Info
const synthetic = (text: string) =>
  ({ type: "synthetic", text, description: "hint" }) as unknown as SessionMessage.Info

describe("exchangesOf", () => {
  test("keeps user and assistant text, drops synthetic", () => {
    expect(exchangesOf([user("ask"), synthetic("ignore"), assistant("answer")])).toEqual([
      "[User]: ask",
      "[Assistant]: answer",
    ])
  })
})

describe("searchSessions", () => {
  const peers = [
    {
      id: "ses_new",
      title: "Sidebar spinner",
      texts: ["[User]: add spinner when running", "[Assistant]: used SessionProgressIndicatorV2"],
    },
    {
      id: "ses_old",
      title: "Memory vector",
      texts: ["[User]: feat-hash for beliefs", "[Assistant]: keep entity and edge tables"],
    },
  ]

  test("lists newest peers with a preview when query is omitted", () => {
    expect(searchSessions({ peers, limit: 5 })).toEqual([
      {
        sessionID: "ses_new",
        title: "Sidebar spinner",
        text: "[Assistant]: used SessionProgressIndicatorV2",
      },
      {
        sessionID: "ses_old",
        title: "Memory vector",
        text: "[Assistant]: keep entity and edge tables",
      },
    ])
  })

  test("returns matching slices from other sessions", () => {
    // Half of the query terms must hit (same rule as `history.search`), so both peer1 lines match.
    const hits = searchSessions({ peers, query: "spinner SessionProgress", limit: 5 })
    expect(hits).toHaveLength(2)
    expect(hits.every((hit) => hit.sessionID === "ses_new")).toBe(true)
    expect(hits.some((hit) => hit.text.includes("SessionProgressIndicatorV2"))).toBe(true)
  })

  test("respects the hit limit across sessions", () => {
    expect(searchSessions({ peers, query: "User", limit: 1 })).toHaveLength(1)
  })
})

describe("toModelContent", () => {
  test("explains a miss after scanning peers", () => {
    expect(toModelContent([], { query: "xyzzy", scanned: 3 })).toContain("Scanned 3 sessions")
    expect(toModelContent([], { query: "xyzzy", scanned: 0 })).toContain("No other sessions")
  })

  test("names session titles on hits", () => {
    const text = toModelContent(
      [{ sessionID: "ses_1", title: "Sidebar", text: "[User]: spinner" }],
      { query: "spinner", scanned: 2 },
    )
    expect(text).toContain("Sidebar (ses_1)")
    expect(text).toContain("[User]: spinner")
  })
})
