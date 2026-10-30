import { describe, expect, test } from "bun:test"
import {
  isDestructiveWebUiLabel,
  isDestructiveWebUiScript,
  assertSafeWebUiLabel,
  DESTRUCTIVE_WEB_UI_BLOCKED,
} from "./destructive-web-ui.js"

describe("destructive-web-ui labels", () => {
  test("blocks common delete controls", () => {
    expect(isDestructiveWebUiLabel("删除")).toBe(true)
    expect(isDestructiveWebUiLabel("永久删除")).toBe(true)
    expect(isDestructiveWebUiLabel("确认删除")).toBe(true)
    expect(isDestructiveWebUiLabel("Delete")).toBe(true)
    expect(isDestructiveWebUiLabel("Permanently delete")).toBe(true)
    expect(isDestructiveWebUiLabel("Empty trash")).toBe(true)
    expect(isDestructiveWebUiLabel("Remove selected files")).toBe(true)
    expect(isDestructiveWebUiLabel("Cancel subscription")).toBe(true)
    expect(isDestructiveWebUiLabel("btn-delete icon")).toBe(true)
    expect(isDestructiveWebUiLabel("https://x.test/api/delete?id=1")).toBe(true)
  })

  test("allows ordinary debug actions", () => {
    expect(isDestructiveWebUiLabel("保存")).toBe(false)
    expect(isDestructiveWebUiLabel("提交")).toBe(false)
    expect(isDestructiveWebUiLabel("Download")).toBe(false)
    expect(isDestructiveWebUiLabel("Open settings")).toBe(false)
    expect(isDestructiveWebUiLabel("Login")).toBe(false)
    expect(isDestructiveWebUiLabel("Remove filter")).toBe(false)
    expect(isDestructiveWebUiLabel("清空搜索")).toBe(false)
    expect(isDestructiveWebUiLabel("Clear search")).toBe(false)
    expect(isDestructiveWebUiLabel("deleted_at column")).toBe(false)
    expect(isDestructiveWebUiLabel("Deactivate plugin")).toBe(false)
  })

  test("assert throws without env escape", () => {
    expect(() => assertSafeWebUiLabel("删除文件")).toThrow(DESTRUCTIVE_WEB_UI_BLOCKED)
  })
})

describe("destructive-web-ui scripts", () => {
  test("blocks remove / delete-style evaluate mutations", () => {
    expect(isDestructiveWebUiScript("(el) => el.remove()")).toBe(true)
    expect(isDestructiveWebUiScript("document.querySelector('.row').removeChild(x)")).toBe(true)
    expect(isDestructiveWebUiScript("api.deleteItem(id)")).toBe(true)
    expect(isDestructiveWebUiScript("document.querySelector('[data-action=delete]').click()")).toBe(true)
  })

  test("allows read-only evaluate that mentions delete", () => {
    expect(isDestructiveWebUiScript("(el) => el.textContent")).toBe(false)
    expect(isDestructiveWebUiScript("document.title")).toBe(false)
    expect(isDestructiveWebUiScript("document.querySelector('[data-action=delete]')")).toBe(false)
    expect(isDestructiveWebUiScript("(el) => el.textContent.includes('Delete')")).toBe(false)
  })
})
