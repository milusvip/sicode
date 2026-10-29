// A minimal language server for tests: completes the initialize handshake, answers
// definition/references/hover with fixed results, publishes one diagnostic after didOpen, and
// answers every other server-received request with null (mirroring what real servers do with
// the requests they do not care about).
import path from "node:path"
import { pathToFileURL } from "node:url"

let buffer = Buffer.alloc(0)

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const terminator = buffer.indexOf("\r\n\r\n")
    if (terminator < 0) return
    const header = buffer.subarray(0, terminator).toString("utf8")
    const length = Number(/Content-Length: (\d+)/i.exec(header)?.[1])
    if (!Number.isInteger(length) || buffer.length < terminator + 4 + length) return
    const body = buffer.subarray(terminator + 4, terminator + 4 + length).toString("utf8")
    buffer = buffer.subarray(terminator + 4 + length)
    handle(JSON.parse(body))
  }
})

const send = (message) => {
  const body = Buffer.from(JSON.stringify(message), "utf8")
  process.stdout.write(`Content-Length: ${body.byteLength}\r\n\r\n${body.toString("latin1") === body ? body : body}`)
}

const uriOf = (file) => pathToFileURL(path.resolve(process.cwd(), file)).href

function handle(message) {
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { capabilities: {} } })
    return
  }
  if (message.method === "textDocument/definition") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { uri: message.params.textDocument.uri, range: { start: { line: 4, character: 7 }, end: { line: 4, character: 13 } } },
    })
    return
  }
  if (message.method === "textDocument/references") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: [
        { uri: message.params.textDocument.uri, range: { start: { line: 9, character: 0 }, end: { line: 9, character: 6 } } },
        { uri: uriOf("other.ts"), range: { start: { line: 2, character: 4 }, end: { line: 2, character: 10 } } },
      ],
    })
    return
  }
  if (message.method === "textDocument/hover") {
    send({ jsonrpc: "2.0", id: message.id, result: { contents: { kind: "markdown", value: "const retry: number" } } })
    return
  }
  if (message.method === "textDocument/didOpen") {
    send({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: message.params.textDocument.uri,
        diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 1, message: "mock error" }],
      },
    })
    return
  }
  if (message.method === "shutdown") {
    send({ jsonrpc: "2.0", id: message.id, result: null })
    return
  }
  if (message.id !== undefined && message.id !== null && typeof message.method === "string") {
    send({ jsonrpc: "2.0", id: message.id, result: null })
  }
}
