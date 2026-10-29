import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client/promise"
import { isHtmlPath, latestHtmlChange } from "./artifact"

function tool(
  partID: string,
  name: "write" | "edit",
  path: string,
  input: Record<string, unknown>,
  status: SessionMessageAssistantTool["state"]["status"] = "completed",
): SessionMessageAssistantTool {
  return {
    id: partID,
    type: "tool",
    name,
    state: { status, input: { path, ...input } },
  } as unknown as SessionMessageAssistantTool
}

function assistant(id: string, content: SessionMessageAssistant["content"]): SessionMessageAssistant {
  return {
    id,
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content,
    time: { created: 1, completed: 2 },
  } as unknown as SessionMessageAssistant
}

describe("html changes", () => {
  test("recognises html paths case-insensitively and rejects others", () => {
    expect(isHtmlPath("demo.html")).toBe(true)
    expect(isHtmlPath("demo.HTML")).toBe(true)
    expect(isHtmlPath("demo.htm")).toBe(true)
    expect(isHtmlPath("demo.tsx")).toBe(false)
    expect(isHtmlPath("demo")).toBe(false)
    expect(isHtmlPath("dir.html/readme")).toBe(false)
  })

  test("a write carries the page it wrote", () => {
    const change = latestHtmlChange([
      assistant("m1", [tool("p1", "write", "demo.html", { content: "<h1>v1</h1>" })]),
    ])

    expect(change?.path).toBe("demo.html")
    expect(change?.ref).toEqual({ messageID: "m1", partID: "p1" })
    expect(change?.content).toBe("<h1>v1</h1>")
    expect(change?.streaming).toBe(false)
  })

  test("an edit names the page but carries no snapshot: the pane reloads it instead", () => {
    const change = latestHtmlChange([
      assistant("m1", [tool("p1", "edit", "demo.html", { oldString: "a", newString: "b" })]),
    ])

    expect(change?.path).toBe("demo.html")
    expect(change?.content).toBeUndefined()
  })

  test("the latest step wins: a write followed by an edit reports the edit", () => {
    const change = latestHtmlChange([
      assistant("m1", [tool("p1", "write", "demo.html", { content: "<h1>v1</h1>" })]),
      assistant("m2", [tool("p2", "edit", "demo.html", { oldString: "v1", newString: "v2" })]),
    ])

    expect(change?.ref.partID).toBe("p2")
    expect(change?.content).toBeUndefined()
  })

  test("non-html paths, other tools and errors never qualify", () => {
    const messages = [
      assistant("m1", [
        tool("p1", "write", "app.tsx", { content: "x" }),
        tool("p2", "write", "demo.html", { content: "x" }, "error"),
        { id: "p3", type: "tool", name: "read", state: { status: "completed", input: { path: "demo.html" } } },
      ] as SessionMessageAssistant["content"]),
    ]

    expect(latestHtmlChange(messages)).toBeUndefined()
    expect(latestHtmlChange([assistant("m1", [{ id: "t1", type: "text", text: "hi" } as never])])).toBeUndefined()
  })

  test("a still-streaming call qualifies but is flagged, with partial content", () => {
    const change = latestHtmlChange([
      assistant("m1", [tool("p1", "write", "demo.html", { content: "<h1>par" }, "streaming")]),
    ])

    expect(change?.streaming).toBe(true)
    expect(change?.content).toBe("<h1>par")
  })
})
