import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client/promise"
import { htmlArtifactsForTurn, isHtmlPath, latestHtmlArtifact } from "./artifact"

function writeTool(partID: string, path: string, content: string, status: SessionMessageAssistantTool["state"]["status"] = "completed"): SessionMessageAssistantTool {
  return {
    id: partID,
    type: "tool",
    name: "write",
    state: { status, input: { path, content } },
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

describe("html artifacts", () => {
  test("recognises html paths case-insensitively and rejects others", () => {
    expect(isHtmlPath("demo.html")).toBe(true)
    expect(isHtmlPath("demo.HTML")).toBe(true)
    expect(isHtmlPath("demo.htm")).toBe(true)
    expect(isHtmlPath("demo.tsx")).toBe(false)
    expect(isHtmlPath("demo")).toBe(false)
    expect(isHtmlPath("dir.html/readme")).toBe(false)
  })

  test("one card per path per turn, last write wins", () => {
    const messages = [
      assistant("m1", [
        writeTool("p1", "demo.html", "<h1>v1</h1>"),
        writeTool("p2", "demo.html", "<h1>v2</h1>"),
        writeTool("p3", "other.html", "<h1>o</h1>"),
      ]),
    ]

    const artifacts = htmlArtifactsForTurn(messages)

    expect(artifacts).toHaveLength(2)
    // Map order keeps first-insertion position: demo.html was written first, other.html second.
    expect(artifacts[0].path).toBe("demo.html")
    expect(artifacts[1].path).toBe("other.html")
    // Last write wins for a path: p2 overwrote p1 in the same turn.
    expect(artifacts[0].ref.partID).toBe("p2")
  })

  test("non-write tools, non-html writes and errors never qualify", () => {
    const edit = { id: "p1", type: "tool", name: "edit", state: { status: "completed", input: { path: "demo.html" } } }
    const failed = writeTool("p2", "demo.html", "", "error")
    const messages = [assistant("m1", [edit, failed] as SessionMessageAssistant["content"])]

    expect(htmlArtifactsForTurn(messages)).toHaveLength(0)
  })

  test("a still-streaming write qualifies but is flagged", () => {
    const messages = [assistant("m1", [writeTool("p1", "demo.html", "", "streaming")])]

    const artifacts = htmlArtifactsForTurn(messages)

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].streaming).toBe(true)
  })

  test("latest artifact is the last write in message order and carries its content", () => {
    const messages = [
      assistant("m1", [writeTool("p1", "demo.html", "<h1>v1</h1>"), writeTool("p2", "chart.html", "<svg/>")]),
      assistant("m2", [writeTool("p3", "demo.html", "<h1>v2</h1>")]),
    ]

    const latest = latestHtmlArtifact(messages)

    expect(latest?.ref.partID).toBe("p3")
    expect(latest?.path).toBe("demo.html")
    expect(latest?.content).toBe("<h1>v2</h1>")
    expect(latest?.streaming).toBe(false)
  })

  test("latest artifact skips errored writes and reports none when absent", () => {
    expect(latestHtmlArtifact([assistant("m1", [writeTool("p1", "demo.html", "<h1>x</h1>", "error")])])).toBeUndefined()
    expect(latestHtmlArtifact([assistant("m1", [{ id: "t1", type: "text", text: "hi" } as never])])).toBeUndefined()
  })

  test("a streaming latest write still reports, flagged, with partial content", () => {
    const latest = latestHtmlArtifact([assistant("m1", [writeTool("p1", "demo.html", "<h1>par", "streaming")])])

    expect(latest?.streaming).toBe(true)
    expect(latest?.content).toBe("<h1>par")
  })
})
