import { describe, expect, test } from "bun:test"
import { CHROME_BRIDGE_PROTOCOL_VERSION, parseBridgeClientMessage } from "./protocol"

describe("parseBridgeClientMessage", () => {
  test("parses hello", () => {
    expect(parseBridgeClientMessage(JSON.stringify({ type: "hello", version: 2 }))).toEqual({
      type: "hello",
      version: 2,
    })
  })

  test("protocol version is v3", () => {
    expect(CHROME_BRIDGE_PROTOCOL_VERSION).toBe(3)
  })

  test("parses snapshot.result", () => {
    const message = parseBridgeClientMessage(
      JSON.stringify({
        type: "snapshot.result",
        requestID: "r1",
        snapshot: { content: '@e1 [button] "Go"', truncated: false },
        tab: {
          id: "chrome_tab_1",
          chromeTabId: 1,
          url: "https://a",
          title: "A",
          active: true,
          windowId: 1,
        },
      }),
    )
    expect(message?.type).toBe("snapshot.result")
  })

  test("parses offer.tab", () => {
    expect(
      parseBridgeClientMessage(
        JSON.stringify({
          type: "offer.tab",
          tab: {
            id: "chrome_tab_9",
            chromeTabId: 9,
            url: "https://example.com/",
            title: "Example",
            active: true,
            windowId: 1,
          },
        }),
      ),
    ).toEqual({
      type: "offer.tab",
      tab: {
        id: "chrome_tab_9",
        chromeTabId: 9,
        url: "https://example.com/",
        title: "Example",
        active: true,
        windowId: 1,
      },
    })
  })

  test("parses offer.element", () => {
    expect(
      parseBridgeClientMessage(
        JSON.stringify({
          type: "offer.element",
          tab: {
            id: "chrome_tab_9",
            chromeTabId: 9,
            url: "https://example.com/app",
            title: "App",
            active: true,
            windowId: 1,
          },
          element: {
            selector: "button.submit",
            label: "Submit",
            role: "button",
            name: "Submit",
          },
          comment: "Look at this element",
        }),
      ),
    ).toEqual({
      type: "offer.element",
      tab: {
        id: "chrome_tab_9",
        chromeTabId: 9,
        url: "https://example.com/app",
        title: "App",
        active: true,
        windowId: 1,
      },
      element: {
        selector: "button.submit",
        label: "Submit",
        role: "button",
        name: "Submit",
      },
      elements: [
        {
          selector: "button.submit",
          label: "Submit",
          role: "button",
          name: "Submit",
        },
      ],
      comment: "Look at this element",
    })
  })

  test("parses offer.element with elements[]", () => {
    expect(
      parseBridgeClientMessage(
        JSON.stringify({
          type: "offer.element",
          tab: {
            id: "chrome_tab_9",
            chromeTabId: 9,
            url: "https://example.com/app",
            title: "App",
            active: true,
            windowId: 1,
          },
          element: { selector: "button.a", label: "A" },
          elements: [
            { selector: "button.a", label: "A" },
            { selector: "button.b", label: "B", role: "button" },
          ],
        }),
      ),
    ).toEqual({
      type: "offer.element",
      tab: {
        id: "chrome_tab_9",
        chromeTabId: 9,
        url: "https://example.com/app",
        title: "App",
        active: true,
        windowId: 1,
      },
      element: { selector: "button.a", label: "A" },
      elements: [
        { selector: "button.a", label: "A" },
        { selector: "button.b", label: "B", role: "button" },
      ],
    })
  })

  test("rejects junk", () => {
    expect(parseBridgeClientMessage("not-json")).toBeUndefined()
    expect(parseBridgeClientMessage("{}")).toBeUndefined()
  })
})
