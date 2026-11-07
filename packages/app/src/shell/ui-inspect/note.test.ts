import { describe, expect, test } from "bun:test"
import { UI_INSPECT_ORIGIN, uiElementNote } from "./note"

describe("uiElementNote", () => {
  test("builds a durable composer note without a live href", () => {
    const note = uiElementNote(
      {
        label: "button.primary",
        selector: "body > button.primary",
        role: "button",
        name: "Save",
        text: "Save",
        rect: { x: 0, y: 0, width: 40, height: 24 },
      },
      "Match the session header",
    )

    expect(note).toMatchObject({
      type: "note",
      origin: UI_INSPECT_ORIGIN,
      label: "button.primary",
      icon: "select-element",
      comment: "Match the session header",
    })
    expect(note.href).toBeUndefined()
    expect(note.live).toBeUndefined()
    expect(note.subject).toContain("button.primary")
    expect(note.subject).toContain("SiCode UI")
    expect(note.subject).toContain('selector "body > button.primary"')
    expect(note.commentID.length).toBeGreaterThan(0)
  })

  test("puts design-system hooks ahead of the CSS selector", () => {
    const note = uiElementNote(
      {
        label: "svg · composer-attachment-remove",
        selector: "#root > div:nth-of-type(3) > svg",
        slot: "composer-attachment-remove",
        component: "composer-attachments",
        action: "remove",
        rect: { x: 0, y: 0, width: 12, height: 12 },
      },
      "Enlarge and turn red on hover",
    )

    expect(note.subject.indexOf('data-slot "composer-attachment-remove"')).toBeLessThan(
      note.subject.indexOf("selector "),
    )
    expect(note.subject).toContain('data-component "composer-attachments"')
    expect(note.subject).toContain('data-action "remove"')
  })
})
