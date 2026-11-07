import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client/promise"
import { createdArtifacts, isArtifactPath, isCreatedWrite } from "./artifact"

function tool(
  partID: string,
  name: "write" | "edit",
  path: string,
  input: Record<string, unknown>,
  options: {
    status?: SessionMessageAssistantTool["state"]["status"]
    files?: { file: string; patch: string; additions: number; deletions: number; status: "added" | "modified" | "deleted" }[]
  } = {},
): SessionMessageAssistantTool {
  const status = options.status ?? "completed"
  return {
    id: partID,
    type: "tool",
    name,
    state: {
      status,
      input: { path, ...input },
      ...(options.files ? { metadata: { files: options.files } } : {}),
    },
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

const added = (file: string) => ({
  file,
  patch: `--- a/${file}\n+++ b/${file}\n@@ -0,0 +1 @@\n+x\n`,
  additions: 1,
  deletions: 0,
  status: "added" as const,
})

const modified = (file: string) => ({
  file,
  patch: `--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-a\n+b\n`,
  additions: 1,
  deletions: 1,
  status: "modified" as const,
})

describe("artifact paths", () => {
  test("recognises deliverable paths and rejects source files", () => {
    expect(isArtifactPath("demo.html")).toBe(true)
    expect(isArtifactPath("demo.HTML")).toBe(true)
    expect(isArtifactPath("demo.htm")).toBe(true)
    expect(isArtifactPath("notes.md")).toBe(true)
    expect(isArtifactPath("readme.markdown")).toBe(true)
    expect(isArtifactPath("随便写.txt")).toBe(true)
    expect(isArtifactPath("data.csv")).toBe(true)
    expect(isArtifactPath("report.pdf")).toBe(true)
    expect(isArtifactPath("bundle.zip")).toBe(true)
    expect(isArtifactPath("bundle.7z")).toBe(true)
    expect(isArtifactPath("archive.tar")).toBe(true)
    expect(isArtifactPath("archive.tar.gz")).toBe(true)
    expect(isArtifactPath("release.apk")).toBe(true)
    expect(isArtifactPath("invoice.docx")).toBe(true)
    expect(isArtifactPath("sheet.xlsx")).toBe(true)
    expect(isArtifactPath("payload.json")).toBe(true)
    expect(isArtifactPath("run.log")).toBe(true)
    expect(isArtifactPath("demo.tsx")).toBe(false)
    expect(isArtifactPath("app.ts")).toBe(false)
    expect(isArtifactPath("demo")).toBe(false)
    expect(isArtifactPath("dir.html/readme")).toBe(false)
  })
})

describe("created writes", () => {
  test("a write that reports status added is a create", () => {
    expect(isCreatedWrite(tool("p1", "write", "demo.html", { content: "x" }, { files: [added("demo.html")] }))).toBe(
      true,
    )
  })

  test("a write that reports status modified is not a create", () => {
    expect(
      isCreatedWrite(tool("p1", "write", "demo.html", { content: "x" }, { files: [modified("demo.html")] })),
    ).toBe(false)
  })

  test("a write without files metadata is treated as a create", () => {
    expect(isCreatedWrite(tool("p1", "write", "demo.html", { content: "x" }))).toBe(true)
  })

  test("edits, errors and streaming writes never count as creates", () => {
    expect(isCreatedWrite(tool("p1", "edit", "demo.html", { oldString: "a", newString: "b" }))).toBe(false)
    expect(isCreatedWrite(tool("p1", "write", "demo.html", { content: "x" }, { status: "error" }))).toBe(false)
    expect(isCreatedWrite(tool("p1", "write", "demo.html", { content: "x" }, { status: "streaming" }))).toBe(false)
  })
})

describe("created artifacts", () => {
  test("lists newly created deliverables and skips overwrites and source files", () => {
    const items = createdArtifacts([
      assistant("m1", [
        tool("p1", "write", "demo.html", { content: "<h1>v1</h1>" }, { files: [added("demo.html")] }),
        tool("p2", "write", "demo.html", { content: "<h1>v2</h1>" }, { files: [modified("demo.html")] }),
        tool("p3", "write", "notes.md", { content: "# hi" }, { files: [added("notes.md")] }),
        tool("p4", "write", "随便写.txt", { content: "x" }, { files: [added("随便写.txt")] }),
        tool("p5", "write", "app.tsx", { content: "x" }, { files: [added("app.tsx")] }),
      ]),
    ])

    expect(items).toEqual([
      { path: "demo.html", ref: { messageID: "m1", partID: "p1" } },
      { path: "notes.md", ref: { messageID: "m1", partID: "p3" } },
      { path: "随便写.txt", ref: { messageID: "m1", partID: "p4" } },
    ])
  })

  test("dedupes the same path within one turn", () => {
    const items = createdArtifacts([
      assistant("m1", [
        tool("p1", "write", "a.html", { content: "1" }, { files: [added("a.html")] }),
        tool("p2", "write", "a.html", { content: "2" }, { files: [added("a.html")] }),
      ]),
    ])

    expect(items.map((item) => item.ref.partID)).toEqual(["p1"])
  })

  test("collects creates across several assistant messages in the turn", () => {
    const items = createdArtifacts([
      assistant("m1", [tool("p1", "write", "one.html", { content: "1" }, { files: [added("one.html")] })]),
      assistant("m2", [tool("p2", "write", "two.html", { content: "2" }, { files: [added("two.html")] })]),
    ])

    expect(items.map((item) => item.path)).toEqual(["one.html", "two.html"])
  })
})
