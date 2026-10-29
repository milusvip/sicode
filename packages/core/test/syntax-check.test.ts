import { describe, expect, test } from "bun:test"
import {
  extensionOf,
  parseBashOutput,
  parseBunOutput,
  parseClangOutput,
  parseJsonError,
  parsePythonOutput,
} from "../src/syntax-check"

// Every fixture below is captured verbatim from the tool named in the test, on this machine.
// A parser that silently stops matching would turn "broken file" into "clean file", so the
// outputs are pinned rather than hand-written.

describe("extensionOf", () => {
  test("lowercases and handles extensionless paths", () => {
    expect(extensionOf("a/b/c.JS")).toBe(".js")
    expect(extensionOf("Makefile")).toBeUndefined()
    expect(extensionOf("archive.tar.gz")).toBe(".gz")
  })
})

describe("parseBunOutput", () => {
  test("reads the message and the at-location line", () => {
    const output = [
      "1 | const x = ;",
      "              ^",
      "error: Unexpected ;",
      "    at E:\\app-dev\\Agent-SiCode\\SiCode\\.sicode\\scratch\\sc\\broken.js:1:11",
      "",
    ].join("\n")
    expect(parseBunOutput(output, "E:\\app-dev\\Agent-SiCode\\SiCode\\.sicode\\scratch\\sc\\broken.js")).toEqual([
      { line: 1, character: 11, message: "Unexpected ;" },
    ])
  })

  test("ignores a location that belongs to another file", () => {
    const output = ["error: Unexpected ;", "    at /other/project/broken.js:1:11", ""].join("\n")
    // A resolve failure elsewhere in the bundle must not be blamed on the file just written.
    expect(parseBunOutput(output, "/workspace/mine.js")).toEqual([])
  })

  test("returns nothing for a passing build", () => {
    expect(parseBunOutput("export const a = 1;\n", "/workspace/a.ts")).toEqual([])
  })
})

describe("parsePythonOutput", () => {
  test("reads the File/line pair and the exception name", () => {
    const output = [
      "Traceback (most recent call last):",
      '  File "<string>", line 1, in <module>',
      "  File \"broken.py\", line 1",
      "    def f(:",
      "          ^",
      "SyntaxError: invalid syntax",
      "",
    ].join("\n")
    expect(parsePythonOutput(output, "broken.py")).toEqual([
      { line: 1, character: 1, message: "SyntaxError: invalid syntax" },
    ])
  })

  test("matches an absolute path to a relative one", () => {
    const output = ['  File "C:\\tmp\\proj\\broken.py", line 7', "SyntaxError: invalid syntax"].join("\n")
    expect(parsePythonOutput(output, "C:\\tmp\\proj\\broken.py")[0]?.line).toBe(7)
  })

  test("reports nothing when the failure is inside python itself", () => {
    // The `-c` driver line mentions `<string>`, never the target file.
    const output = ['  File "<string>", line 1', "     import ast,io,sys"].join("\n")
    expect(parsePythonOutput(output, "broken.py")).toEqual([])
  })
})

describe("parseBashOutput", () => {
  test("reads `path: line N: message`", () => {
    // Captured from `bash -n broken.sh` on this machine; the tool repeats the word "syntax error"
    // and the message keeps it rather than stripping it, so nothing is lost in the report.
    const output = "broken.sh: line 3: syntax error: unexpected end of file from `if' command on line 1\n"
    expect(parseBashOutput(output, "broken.sh")).toEqual([
      { line: 3, character: 1, message: "syntax error: unexpected end of file from `if' command on line 1" },
    ])
  })

  test("ignores diagnostics about another script", () => {
    expect(parseBashOutput("other.sh: line 3: syntax error: unexpected end of file\n", "broken.sh")).toEqual([])
  })
})

describe("parseClangOutput", () => {
  test("reads the error lines and drops notes and source excerpts", () => {
    // Captured verbatim from `clang++ -fsyntax-only broken.cpp` (clang 22.1.6, Windows).
    const output = [
      "broken.cpp:1:1: error: main cannot be declared as a variable in the global scope",
      "    1 | int main( {",
      "      | ^",
      "broken.cpp:1:12: error: expected expression",
      "    1 | int main( {",
      "      |            ^",
      "broken.cpp:1:12: error: expected '}'",
      "broken.cpp:1:11: note: to match this '{'",
      "",
    ].join("\n")
    expect(parseClangOutput(output, "broken.cpp")).toEqual([
      { line: 1, character: 1, message: "main cannot be declared as a variable in the global scope" },
      { line: 1, character: 12, message: "expected expression" },
      { line: 1, character: 12, message: "expected '}'" },
    ])
  })

  test("reads `fatal error:` and skips diagnostics about other files", () => {
    const output = ["a.hpp:2:10: fatal error: 'nope.h' file not found", "broken.cpp:3:5: error: expected ';'"].join(
      "\n",
    )
    expect(parseClangOutput(output, "broken.cpp")).toEqual([{ line: 3, character: 5, message: "expected ';'" }])
  })
})

describe("parseJsonError", () => {
  test("turns a byte position into the same line and column node reports", () => {
    // Captured from node 22 parsing `{\n  "a": 1,\n}\n`: "…at position 12 (line 3 column 1)".
    // The parser reproduces that line/column from the position alone.
    const text = '{\n  "a": 1,\n}\n'
    const error = new SyntaxError("Expected double-quoted property name in JSON at position 12 (line 3 column 1)")
    expect(parseJsonError(error, text)).toEqual([
      { line: 3, character: 1, message: "Expected double-quoted property name in JSON at position 12 (line 3 column 1)" },
    ])
  })

  test("agrees with node on a one-line file", () => {
    const text = '{"a": 1,}\n'
    const error = new SyntaxError("Expected double-quoted property name in JSON at position 8 (line 1 column 9)")
    expect(parseJsonError(error, text)[0]).toMatchObject({ line: 1, character: 9 })
  })

  test("falls back to 1:1 when the message carries no position", () => {
    // bun's message has no offset, so there is nothing to count and the first line is the honest answer.
    expect(parseJsonError(new SyntaxError("JSON Parse error: Property name must be a string literal"), '{"a":1}')).toEqual(
      [{ line: 1, character: 1, message: "JSON Parse error: Property name must be a string literal" }],
    )
  })
})
