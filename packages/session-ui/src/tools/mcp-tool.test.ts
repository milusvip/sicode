import { describe, expect, test } from "bun:test"
import { mcpToolIdentity } from "./mcp-tool"

describe("mcpToolIdentity", () => {
  test("splits a call into the server it came from and the tool it names", () => {
    // The namespace keeps hyphens, so the flattened name does too.
    expect(mcpToolIdentity("agent-mail_SendMessage", ["agent-mail"])).toEqual({
      server: "agent-mail",
      tool: "SendMessage",
    })
  })

  test("keeps underscores inside the tool name", () => {
    expect(mcpToolIdentity("figma_get_file_version", ["figma"])).toEqual({
      server: "figma",
      tool: "get_file_version",
    })
  })

  test("prefers the longest server, so a sibling server does not swallow the call", () => {
    expect(mcpToolIdentity("acme_ops_run", ["acme", "acme_ops"])).toEqual({
      server: "acme_ops",
      tool: "run",
    })
    expect(mcpToolIdentity("acme_run", ["acme", "acme_ops"])).toEqual({
      server: "acme",
      tool: "run",
    })
  })

  test("matches a server whose own name needed sanitizing", () => {
    expect(mcpToolIdentity("figma_io_get_file", ["figma.io"])).toEqual({
      server: "figma.io",
      tool: "get_file",
    })
  })

  test("leaves a built-in tool alone even when a server name is a prefix of it", () => {
    expect(mcpToolIdentity("read", ["read"])).toBeUndefined()
    expect(mcpToolIdentity("history", ["hist"])).toBeUndefined()
  })

  test("reports nothing while the roster is unknown, so the row keeps its raw name", () => {
    expect(mcpToolIdentity("agent-mail_SendMessage", undefined)).toBeUndefined()
    expect(mcpToolIdentity("agent-mail_SendMessage", [])).toBeUndefined()
    expect(mcpToolIdentity("agent-mail_", ["agent-mail"])).toBeUndefined()
  })
})
