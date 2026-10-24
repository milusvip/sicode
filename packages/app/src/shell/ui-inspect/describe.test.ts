import { afterEach, describe, expect, test } from "bun:test"
import { describeElement, elementAtPoint, elementSelector } from "./describe"

afterEach(() => {
  document.body.innerHTML = ""
})

describe("elementSelector", () => {
  test("prefers a unique id and names classes on the label", () => {
    document.body.innerHTML = `<button id="save" class="primary">Save</button>`
    const button = document.querySelector("#save")!

    expect(elementSelector(button)).toBe("#save")
    expect(describeElement(button)).toMatchObject({
      label: "button#save.primary",
      name: "Save",
      text: "Save",
    })
  })

  test("uses nth-of-type when siblings share a tag", () => {
    document.body.innerHTML = `<div><span>a</span><span class="b">b</span></div>`
    const span = document.querySelector("span.b")!

    expect(elementSelector(span)).toBe("body > div > span:nth-of-type(2)")
  })
})

describe("elementAtPoint", () => {
  test("skips inspect chrome and returns the element underneath", () => {
    document.body.innerHTML = `
      <button id="target">Go</button>
      <div data-component="ui-inspect"></div>
    `
    const target = document.querySelector("#target")!
    const overlay = document.querySelector("[data-component=ui-inspect]")!

    document.elementsFromPoint = ((_x: number, _y: number) => [overlay, target]) as Document["elementsFromPoint"]

    const hit = elementAtPoint(20, 20, (node) => !!node.closest("[data-component=ui-inspect]"))

    expect(hit).toBe(target)
  })
})
