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

  test("routes content search to grep when shell is present", () => {
    const prompt = make(["shell"])

    expect(prompt).toContain("Search file contents with the grep tool")
    expect(prompt).toContain("not rg, Select-String, findstr /s, or grep -r via shell")
    // SiCode: Windows shells are PowerShell; pin the bash-ism ban only on win32.
    if (process.platform === "win32") {
      expect(prompt).toContain("On Windows the shell is PowerShell")
    } else {
      expect(prompt).not.toContain("On Windows the shell is PowerShell")
    }
  })

  test("guides live-tab debugging when browser console/network/screenshot are present", () => {
    const prompt = make(["browser.console", "browser.network.list", "browser.screenshot"])

    expect(prompt).toContain("browser.screenshot for what is on screen")
    expect(prompt).toContain("browser.console for errors/warnings")
    expect(prompt).toContain("Always pass an exact tabID")
  })

  test("when write tools are missing, forbids external CDP workarounds", () => {
    const prompt = make(["browser.screenshot", "browser.snapshot", "browser.tabs.list"])

    expect(prompt).toContain("no click/fill/upload tools")
    expect(prompt).toContain("do not suggest Chrome remote debugging")
  })

  test("skips the missing-write gate when click is already granted", () => {
    const prompt = make(["browser.screenshot", "browser.click"])

    expect(prompt).not.toContain("no click/fill/upload tools")
  })

  test("guides autonomous page operation when click and snapshot are present", () => {
    const prompt = make(["browser.click", "browser.snapshot", "browser.screenshot"])

    expect(prompt).toContain("Drive web pages with the built-in browser tools")
    expect(prompt).toContain("Do not start a second browser")
    expect(prompt).toContain("do not refuse with missing login")
  })

  test("matches underscored production tool ids the same as dotted aliases", () => {
    const prompt = make(["browser_click", "browser_snapshot", "browser_screenshot"])

    expect(prompt).toContain("Drive web pages with the built-in browser tools")
    expect(prompt).toContain("do not refuse with missing login")
    expect(prompt).not.toContain("no click/fill/upload tools")
  })

  test("keeps the guidance out of prompts for models without the tool", () => {
    const prompt = make(["shell", "edit"])

    expect(prompt).not.toContain("browser.preview")
    expect(prompt).not.toContain("browser.screenshot for what is on screen")
    expect(prompt).not.toContain("no click/fill/upload tools")
    expect(prompt).toContain("Do not start a local web server just to show a static page")
  })

  test("leaves no placeholder behind", () => {
    expect(make(["browser.preview"])).not.toContain("${OPENCODE_TOOL_GUIDANCE}")
    expect(make([])).not.toContain("${OPENCODE_TOOL_GUIDANCE}")
  })

  // SiCode: dense path/symbol ledgers were reading as handover reports; pin the plain-reply contract.
  test("pins plain-language user replies over engineering ledgers", () => {
    const prompt = make([])

    expect(prompt).toContain("not like an engineering handover")
    expect(prompt).toContain("what changed, in plain words")
    expect(prompt).toContain("Forbidden as the main reply structure")
    expect(prompt).toContain("已落盘")
    expect(prompt).toContain("当前进度：N%")
  })
})

describe("render", () => {
  test("replaces the guidance placeholder with the matching instructions", () => {
    const prompt = render("${OPENCODE_TOOL_GUIDANCE}", ["shell"])

    expect(prompt).toContain("Prefer dedicated tools over shell commands")
    expect(prompt).not.toContain("${OPENCODE_TOOL_GUIDANCE}")
  })

})
