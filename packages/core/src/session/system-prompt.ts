export * as SessionSystemPrompt from "./system-prompt.js"

import PROMPT from "./runner/prompt/system.txt"

export function make(tools: string[]) {
  return render(PROMPT, tools)
}

export function render(prompt: string, tools: string[]) {
  const instructions: string[] = []
  if (tools.includes("shell")) {
    instructions.push(
      "- Prefer dedicated tools over shell commands; fall back to the shell when a tool cannot do what you need.",
      "- Do not chain shell commands with separators like `echo \"====\";` or `printf '---'`; the output becomes noisy in a way that makes the user's side of the conversation worse.",
    )
  }
  if (tools.includes("write")) {
    instructions.push(
      "- Use the write tool to create files or completely replace their content. Prefer using the edit tool for targeted changes.",
    )
  }
  if (tools.includes("edit")) {
    instructions.push(
      "- Use the edit tool for targeted changes to existing text files. It replaces the exact text in `oldString` with `newString`, and the values must differ. By default, `oldString` must occur exactly once. If it occurs multiple times, include more surrounding context to make it unique or set `replaceAll` to true to replace every occurrence.",
    )
  }
  if (tools.includes("browser.preview")) {
    instructions.push(
      "- Show files you created or changed with browser.preview: local HTML pages, images, charts, PDFs and SVGs open directly in the side browser as file:// tabs. There is nothing to serve — a static file never needs an HTTP server.",
      "- To check a page's rendering yourself, preview it first and then screenshot that tab. Do not start a server to verify a static page.",
      "- Preview a file once, when it is worth looking at — not after every edit — and never open a second tab for the same file.",
    )
  }
  return prompt.replace("${OPENCODE_TOOL_GUIDANCE}", instructions.join("\n"))
}
