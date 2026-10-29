export * as SessionSystemPrompt from "./system-prompt.js"

import PROMPT from "./runner/prompt/system.txt"

export function make(tools: string[]) {
  return render(PROMPT, tools)
}

/**
 * SiCode: the user describes intent in plain language (often Chinese) while the code is English
 * identifiers, so a single guessed keyword misses and the model spends turns re-guessing. These
 * rules push it to expand one intent into several candidates up front. Static text on purpose: the
 * search tools' own output teaches the same thing, and a hint injected mid-turn would arrive after
 * the wasted calls. `OPENCODE_QEXPAND=0` turns it off for A/B.
 */
const SEARCH_GUIDANCE = [
  "# Finding code from a description",
  "- Translate before you search: a Chinese or plain-language description rarely matches the English identifiers in the code. Turn it into several candidates (component name, CSS class, i18n key, the UI string, the error text) and search them in one turn.",
  "- An empty result means the term was wrong, not that the code is missing: retry with a synonym, a split word (`paddingInline` -> `padding` + `inline`), or another layer (visible string instead of implementation).",
  "- Three empty searches means change method, not guess again: glob for likely filenames or read the directory.",
].join("\n")

export function searchGuidance() {
  return process.env.OPENCODE_QEXPAND === "0" ? "" : SEARCH_GUIDANCE
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
  return prompt
    .replace("${OPENCODE_TOOL_GUIDANCE}", instructions.join("\n"))
    .replace("${OPENCODE_SEARCH_GUIDANCE}", searchGuidance())
}
