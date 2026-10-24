import { describe, expect, test } from "bun:test"
import { contextMenuSections, contextMenuSelected, contextMenuTarget } from "./model"

const actions = (sections: ReturnType<typeof contextMenuSections>) =>
  sections.map((section) => section.map((item) => item.action))

describe("context menu sections", () => {
  test("offers editing history and clipboard actions inside an editor", () => {
    const sections = contextMenuSections(
      contextMenuTarget({ editable: true, selection: "const value = 1", dev: false }),
      "windows",
    )

    expect(actions(sections)).toEqual([
      ["edit.undo", "edit.redo"],
      ["edit.cut", "edit.copy", "edit.paste", "edit.delete"],
      ["edit.selectAll"],
    ])
    expect(sections[1][1].shortcut).toBe("Ctrl+C")
    expect(sections[1][3].danger).toBe(true)
  })

  test("disables clipboard actions that need a selection", () => {
    const sections = contextMenuSections(contextMenuTarget({ editable: true, selection: "  ", dev: false }), "windows")

    expect(sections[1].map((item) => item.disabled)).toEqual([true, true, undefined, true])
    expect(contextMenuSelected(contextMenuTarget({ editable: true, selection: "  ", dev: false }))).toBe(false)
  })

  test("keeps a read-only selection to copy and select all", () => {
    const sections = contextMenuSections(contextMenuTarget({ editable: false, selection: "hello", dev: false }), "macos")

    expect(actions(sections)).toEqual([["edit.copy", "edit.selectAll"]])
    expect(sections[0][0].shortcut).toBe("⌘C")
  })

  test("still offers select all without a selection", () => {
    const sections = contextMenuSections(contextMenuTarget({ editable: false, selection: "", dev: false }), "windows")

    expect(actions(sections)).toEqual([["edit.selectAll"]])
  })

  test("puts link actions first and developer tools last", () => {
    const sections = contextMenuSections(
      contextMenuTarget({ editable: false, selection: "", link: "https://example.com", dev: true }),
      "linux",
    )

    expect(actions(sections)).toEqual([
      ["link.open", "link.copy"],
      ["edit.selectAll"],
      ["view.inspectElement", "view.toggleDevTools", "view.reload"],
    ])
  })

  test("omits developer tools outside development builds", () => {
    const sections = contextMenuSections(contextMenuTarget({ editable: false, selection: "", dev: false }), "windows")

    expect(actions(sections).flat()).not.toContain("view.inspectElement")
  })
})
