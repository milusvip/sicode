import { describe, expect, test } from "bun:test"
import { make, render } from "../src/session/system-prompt.js"

// The prompt used to leave "show the user a static page" to the model's habits, which meant a
// python -m http.server plus a localhost tab for every demo. These pin both halves of the fix:
// the ban is static (every model reads it), the guidance rides the tool's presence.
describe("make", () => {
  test("bans local servers for static pages even with no browser tool", () => {
    const prompt = make([])

    expect(prompt).toContain("Do not start a local web server just to show a static page")
    expect(prompt).not.toContain("browser.preview")
  })

  test("guides toward preview when the browser tool is present", () => {
    const prompt = make(["browser.preview"])

    expect(prompt).toContain("Show files you created or changed with browser.preview")
    expect(prompt).toContain("never needs an HTTP server")
    expect(prompt).toContain("Do not start a local web server just to show a static page")
  })

  test("keeps the guidance out of prompts for models without the tool", () => {
    const prompt = make(["shell", "edit"])

    expect(prompt).not.toContain("browser.preview")
    expect(prompt).toContain("Do not start a local web server just to show a static page")
  })

  test("leaves no placeholder behind", () => {
    expect(make(["browser.preview"])).not.toContain("${OPENCODE_TOOL_GUIDANCE}")
    expect(make([])).not.toContain("${OPENCODE_TOOL_GUIDANCE}")
  })
})

describe("render", () => {
  test("replaces the guidance placeholder with the matching instructions", () => {
    const prompt = render("${OPENCODE_TOOL_GUIDANCE}", ["shell"])

    expect(prompt).toContain("Prefer dedicated tools over shell commands")
    expect(prompt).not.toContain("${OPENCODE_TOOL_GUIDANCE}")
  })
})
