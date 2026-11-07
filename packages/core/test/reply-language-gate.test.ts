import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import {
  isChineseUserText,
  isEnglishReply,
  replyLanguageFingerprint,
  sessionWantsChinese,
} from "../src/session/runner/reply-language-gate.js"

const user = (id: string, text: string) =>
  ({ type: "user", id, text, content: [] }) as unknown as SessionMessage.Info

const assistant = (id: string, text: string) =>
  ({
    type: "assistant",
    id,
    content: [{ type: "text", text }],
  }) as unknown as SessionMessage.Info

describe("reply language gate", () => {
  test("detects Chinese user asks and English idle replies", () => {
    expect(isChineseUserText("这个能安装 就是打开闪退")).toBe(true)
    expect(isChineseUserText("请用中文说结论")).toBe(true)
    expect(isChineseUserText("fix the flaky test in packages/core")).toBe(false)
    expect(
      isEnglishReply(
        "The install succeeded but the app crashes at launch. That points to a runtime fault in CardAuth.dylib, not the signing chain.",
      ),
    ).toBe(true)
    expect(isEnglishReply("装上了，一开就退。签名已经过了，下一步看崩溃日志。")).toBe(false)
  })

  test("fires when a Chinese session gets an English answer", () => {
    const messages = [
      user("u0", "还是一样"),
      user("u1", "这个能安装 就是打开闪退"),
      assistant(
        "a1",
        "The package installs now, so signing is fine. The crash is a runtime issue — please send the latest Podcasts ips log.",
      ),
    ]
    expect(sessionWantsChinese(messages)).toBe(true)
    expect(replyLanguageFingerprint(messages)).toContain("u1")
  })

  test("ignores Chinese answers and English-only sessions", () => {
    expect(
      replyLanguageFingerprint([
        user("u1", "这个能安装 就是打开闪退"),
        assistant("a1", "装上了说明签名过了。闪退是运行时问题，把最新的崩溃日志发我。"),
      ]),
    ).toBeUndefined()
    expect(
      replyLanguageFingerprint([
        user("u1", "fix the crash on launch"),
        assistant("a1", "The crash is a runtime fault after a successful install."),
      ]),
    ).toBeUndefined()
  })
})
