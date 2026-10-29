import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { setupExternalLinks } from "./markdown-external-links"

beforeAll(() => GlobalRegistrator.register())

afterAll(() => GlobalRegistrator.unregister())

function mount(html: string) {
  const root = document.createElement("div")
  root.innerHTML = html

  return root
}

describe("external link routing", () => {
  test("hands the href to the host and stops the default navigation", () => {
    const root = mount(`<p><a class="external-link" href="https://example.com/a?b=1" target="_blank">example</a></p>`)
    const opened: string[] = []
    const dispose = setupExternalLinks(root, () => (url) => opened.push(url))
    const link = root.querySelector("a")!
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })

    link.dispatchEvent(event)
    expect(opened).toEqual(["https://example.com/a?b=1"])
    expect(event.defaultPrevented).toBe(true)
    dispose()
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))
    expect(opened).toEqual(["https://example.com/a?b=1"])
  })

  test("routes a click on the link's inline code or favicon, not just its text", () => {
    const root = mount(
      `<p><a class="external-link" href="https://example.com"><code>example.com</code></a><a class="external-link" href="https://example.org"><span class="markdown-link-favicon"></span>org</a></p>`,
    )
    const opened: string[] = []
    setupExternalLinks(root, () => (url) => opened.push(url))

    root.querySelector("code")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    root.querySelector(".markdown-link-favicon")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    )
    expect(opened).toEqual(["https://example.com", "https://example.org"])
  })

  test("leaves plain links, local file links and modified clicks alone", () => {
    const root = mount(
      `<p><a href="https://plain.example.com">plain</a><a class="external-link" data-local-link="src/app.ts">local</a><a class="external-link" href="https://modified.example.com">mod</a></p>`,
    )
    const opened: string[] = []
    setupExternalLinks(root, () => (url) => opened.push(url))
    const plain = new MouseEvent("click", { bubbles: true, cancelable: true })
    const local = new MouseEvent("click", { bubbles: true, cancelable: true })
    const modified = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true })

    root.querySelectorAll("a")[0]!.dispatchEvent(plain)
    root.querySelectorAll("a")[1]!.dispatchEvent(local)
    root.querySelectorAll("a")[2]!.dispatchEvent(modified)
    expect(opened).toEqual([])
    expect(plain.defaultPrevented).toBe(false)
    expect(modified.defaultPrevented).toBe(false)
  })

  test("does not swallow the click when the host offers no handler", () => {
    const root = mount(`<p><a class="external-link" href="https://example.com">example</a></p>`)
    setupExternalLinks(root, () => undefined)
    const event = new MouseEvent("click", { bubbles: true, cancelable: true })

    root.querySelector("a")!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  test("ignores non-primary buttons", () => {
    const root = mount(`<p><a class="external-link" href="https://example.com">example</a></p>`)
    const opened: string[] = []
    setupExternalLinks(root, () => (url) => opened.push(url))
    root.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 1 }))
    expect(opened).toEqual([])
  })
})
