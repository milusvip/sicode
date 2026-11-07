import { expect, test } from "bun:test"
import { isFileInput, resolveAssociatedFileInput, type FileInputNode } from "./file-input"

function file(partial: Partial<FileInputNode> = {}): FileInputNode {
  return { tagName: "INPUT", type: "file", ...partial }
}

function node(partial: FileInputNode): FileInputNode {
  return partial
}

test("isFileInput requires input type=file", () => {
  expect(isFileInput(file())).toBe(true)
  expect(isFileInput({ tagName: "INPUT", type: "text" })).toBe(false)
  expect(isFileInput({ tagName: "BUTTON" })).toBe(false)
})

test("resolveAssociatedFileInput returns the file input itself", () => {
  const input = file()
  expect(resolveAssociatedFileInput(input)).toBe(input)
})

test("resolveAssociatedFileInput follows label.control", () => {
  const input = file()
  const label = node({ tagName: "LABEL", control: input })
  expect(resolveAssociatedFileInput(label)).toBe(input)
})

test("resolveAssociatedFileInput finds a nested file input", () => {
  const input = file()
  const button = node({
    tagName: "BUTTON",
    querySelector: (sel) => (sel === "input[type=file]" ? input : null),
  })
  expect(resolveAssociatedFileInput(button)).toBe(input)
})

test("resolveAssociatedFileInput uses the sole file input in a form", () => {
  const input = file()
  const form = node({
    tagName: "FORM",
    querySelectorAll: (sel) => (sel === "input[type=file]" ? [input] : []),
  })
  const button = node({
    tagName: "BUTTON",
    closest: (sel) => (sel === "form" ? form : null),
  })
  expect(resolveAssociatedFileInput(button)).toBe(input)
})

test("resolveAssociatedFileInput uses the sole file input under a nearby ancestor", () => {
  const input = file()
  const wrap = node({
    tagName: "DIV",
    querySelectorAll: (sel) => (sel === "input[type=file]" ? [input] : []),
  })
  const button = node({
    tagName: "BUTTON",
    parentElement: wrap,
  })
  expect(resolveAssociatedFileInput(button)).toBe(input)
})

test("resolveAssociatedFileInput returns null when multiple nearby file inputs exist", () => {
  const a = file({ type: "file" })
  const b = file({ type: "file" })
  const wrap = node({
    tagName: "DIV",
    querySelectorAll: (sel) => (sel === "input[type=file]" ? [a, b] : []),
  })
  const button = node({
    tagName: "BUTTON",
    parentElement: wrap,
  })
  expect(resolveAssociatedFileInput(button)).toBeNull()
})
