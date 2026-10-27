/**
 * SiCode: an MCP call reaches the transcript as one flattened name. Core registers MCP tools as
 * `<namespace>_<tool>` — `McpTool.namespace` sanitizes the server name, then the registry's
 * `effectiveName` joins it to the tool — and the message part carries nothing else about where the
 * tool came from. Cursor labels every MCP call with its server, so the name is split back here
 * against the servers configured for this Location.
 *
 * The longest namespace wins: a server named `figma` must not swallow the tools of `figma-dev`,
 * whose namespace `figma_dev` is what the call actually starts with.
 */
export type McpToolIdentity = {
  server: string
  tool: string
}

// Mirrors `McpTool.namespace` (which keeps `_` and `-`) followed by the registry's `effectiveName`,
// which turns the dots a remaining namespace may hold into underscores.
const namespace = (server: string) => server.replace(/[^a-zA-Z0-9_-]/g, "_").replaceAll(".", "_")

export function mcpToolIdentity(name: string, servers: readonly string[] | undefined): McpToolIdentity | undefined {
  let match: McpToolIdentity | undefined

  for (const server of servers ?? []) {
    const prefix = `${namespace(server)}_`

    if (!name.startsWith(prefix)) continue

    const tool = name.slice(prefix.length)

    if (!tool) continue
    if (match && match.server.length >= server.length) continue

    match = { server, tool }
  }

  return match
}
