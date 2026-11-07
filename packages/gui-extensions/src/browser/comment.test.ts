import { describe, expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import { commentNote, elementOfferNote } from "./comment"

const comment = {
  origin: "browser",
  tabID: Browser.TabID.make("tab_00000000-0000-4000-8000-000000000000"),
  url: "http://localhost:5173/",
  element: { ref: Browser.Ref.make("e42"), selector: "#save", label: "button#save" },
  comment: "Rename this",
}

describe("element comment notes", () => {
  test("explain a selector that crosses into a shadow root", () => {
    expect(
      commentNote({ ...comment, element: { ...comment.element, selector: "#card >>> div > button" } }).subject,
    ).toContain('selector "#card >>> div > button" (">>>" enters a shadow root)')
    expect(commentNote(comment).subject).not.toContain("shadow root")
  })

  test("leave out a selector that was too long to keep", () => {
    expect(commentNote({ ...comment, element: { ...comment.element, selector: "" } }).live?.subject).toBe(
      'the "button#save" element in browser tab tab_00000000-0000-4000-8000-000000000000 at http://localhost:5173/ (browser ref @e42, usable as ref in any browser tool including browser.evaluate until the page navigates)',
    )
  })
})

describe("system-browser element offer notes", () => {
  test("fill a blank comment with the element label so the composer chip stays visible", () => {
    const note = elementOfferNote({
      origin: "browser",
      url: "https://example.com/",
      title: "Example",
      element: { selector: "button.submit", label: "提交" },
    })

    expect(note.comment).toBe("提交")
    expect(note.label).toBe("提交")
    expect(note.subject).toContain("button.submit")
  })

  test("keep an explicit comment when the picker sent one", () => {
    expect(
      elementOfferNote({
        origin: "browser",
        url: "https://example.com/",
        element: { selector: "#x", label: "x" },
        comment: " check this ",
      }).comment,
    ).toBe("check this")
  })

  test("puts design-system hooks ahead of the CSS selector", () => {
    const note = elementOfferNote({
      origin: "browser",
      url: "https://example.com/",
      element: {
        selector: "#root > div:nth-of-type(3) > svg",
        label: "svg · composer-attachment-remove",
        slot: "composer-attachment-remove",
        component: "composer-attachments",
        action: "remove",
      },
    })

    expect(note.subject.indexOf('data-slot "composer-attachment-remove"')).toBeLessThan(note.subject.indexOf("selector "))
    expect(note.subject).toContain('data-component "composer-attachments"')
    expect(note.subject).toContain('data-action "remove"')
  })
})
