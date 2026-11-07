/** Minimal DOM shape for associating a control with input[type=file]. Keep in sync with chrome-extension/page.js. */
export type FileInputNode = {
  tagName?: string
  type?: string
  control?: FileInputNode | null
  parentElement?: FileInputNode | null
  querySelector?: (selector: string) => FileInputNode | null
  querySelectorAll?: (selector: string) => Iterable<FileInputNode>
  closest?: (selector: string) => FileInputNode | null
}

export function isFileInput(node: FileInputNode | null | undefined): boolean {
  return !!node && String(node.tagName || "").toLowerCase() === "input" && node.type === "file"
}

/**
 * Resolve the file input for browser.files.upload.
 * Prefer the node itself; otherwise a uniquely associated input near a visible control
 * (label.control, descendant, sole form input, or sole input within a few ancestors).
 */
export function resolveAssociatedFileInput(node: FileInputNode): FileInputNode | null {
  if (isFileInput(node)) return node
  if (String(node.tagName || "").toLowerCase() === "label" && isFileInput(node.control)) {
    return node.control ?? null
  }

  const nested = node.querySelector?.("input[type=file]")
  if (isFileInput(nested)) return nested ?? null

  const form = node.closest?.("form")
  if (form?.querySelectorAll) {
    const inputs = [...form.querySelectorAll("input[type=file]")].filter(isFileInput)
    if (inputs.length === 1) return inputs[0] ?? null
  }

  let parent = node.parentElement ?? null
  for (let i = 0; i < 4 && parent; i += 1, parent = parent.parentElement ?? null) {
    if (!parent.querySelectorAll) continue
    const inputs = [...parent.querySelectorAll("input[type=file]")].filter(isFileInput)
    if (inputs.length === 1) return inputs[0] ?? null
  }

  return null
}
