import { afterEach, describe, expect, test } from "bun:test"
import {
  bindUiInspectComposer,
  cancelUiInspect,
  pickUiInspect,
  startUiInspect,
  submitUiInspect,
  uiInspectPhase,
} from "./controller"

afterEach(() => {
  cancelUiInspect()
  bindUiInspectComposer(undefined)
})

describe("ui inspect controller", () => {
  test("moves from picking to comment to idle on a successful attach", () => {
    const attached: string[] = []

    bindUiInspectComposer((note) => {
      attached.push(note.comment)

      return true
    })

    startUiInspect()
    expect(uiInspectPhase()).toBe("picking")

    pickUiInspect({
      label: "button#save",
      selector: "#save",
      rect: { x: 0, y: 0, width: 10, height: 10 },
    })
    expect(uiInspectPhase()).toBe("comment")

    expect(submitUiInspect("  Look here  ")).toBe(true)
    expect(attached).toEqual(["Look here"])
    expect(uiInspectPhase()).toBe("idle")
  })

  test("keeps the comment open when no composer is bound", () => {
    startUiInspect()
    pickUiInspect({
      label: "div",
      selector: "body > div",
      rect: { x: 0, y: 0, width: 10, height: 10 },
    })

    expect(submitUiInspect("note")).toBe(false)
    expect(uiInspectPhase()).toBe("comment")
  })

  test("cleanup of an old bridge does not clear a newer bind", () => {
    const first = () => true
    const second = () => true

    bindUiInspectComposer(first)
    bindUiInspectComposer(second)
    bindUiInspectComposer(undefined, first)

    startUiInspect()
    pickUiInspect({
      label: "div",
      selector: "body > div",
      rect: { x: 0, y: 0, width: 10, height: 10 },
    })
    expect(submitUiInspect("still bound")).toBe(true)
  })
})
