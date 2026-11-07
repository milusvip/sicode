/**
 * SiCode: reply language must follow the user (UI is often 简体中文).
 *
 * Soft "same language as the user" only existed on kimi; Flash still answered English after
 * Chinese asks / English tool dumps. Structural: when recent user turns are Chinese-dominant
 * and the idle reply is English prose, force one 简体中文 rewrite.
 *
 * Kill: OPENCODE_REPLY_LANGUAGE=0.
 */

import type { SessionMessage } from "../message.js"

export const REPLY_LANGUAGE_PROMPT = `刚才的收尾语言和用户不一致。用跟用户相同的语言、按编排重写：一句人话开场说清结论，有多点就用短列表（每条 **加粗关键词** + 一句说明）。代码标识符可保留原文。本步不要再调工具。`

const CJK = /[\u3400-\u9fff]/g
const LATIN = /[A-Za-z]/g

function stripFences(text: string): { prose: string; fenceChars: number } {
  let fenceChars = 0
  const prose = text.replace(/```[\s\S]*?```/g, (block) => {
    fenceChars += block.length
    return "\n"
  })
  return { prose, fenceChars }
}

function counts(text: string) {
  return {
    cjk: text.match(CJK)?.length ?? 0,
    latin: text.match(LATIN)?.length ?? 0,
  }
}

/** User text that expects a Chinese reply — CJK density only, no phrase list. */
export function isChineseUserText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  const { prose, fenceChars } = stripFences(trimmed)
  // Log dumps / pasted English dominate the message — ignore fence-heavy bodies.
  if (fenceChars > 0 && fenceChars >= trimmed.length * 0.45) return false
  const body = prose.replace(/https?:\/\/\S+/g, " ").replace(/[A-Za-z]:\\[^\s]+/g, " ")
  const { cjk, latin } = counts(body)
  if (cjk < 4) return false
  if (cjk >= 12 && cjk >= latin * 0.35) return true
  if (cjk >= 4 && latin < 20) return true
  return false
}

/** Idle assistant prose that is English while the user wanted Chinese. */
export function isEnglishReply(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 24) return false
  const { prose, fenceChars } = stripFences(trimmed)
  if (fenceChars > 0 && fenceChars >= trimmed.length * 0.55) return false
  const body = prose.trim()
  if (body.length < 20) return false
  const { cjk, latin } = counts(body)
  if (latin < 40) return false
  if (cjk >= 24) return false
  if (cjk === 0) return true
  return cjk / (cjk + latin) < 0.18
}

function latestAssistantText(messages: ReadonlyArray<SessionMessage.Info>): string | undefined {
  const index = messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return undefined
  let last: SessionMessage.Info | undefined
  for (let i = messages.length - 1; i > index; i--) {
    const message = messages[i]!
    if (message.type === "assistant") {
      last = message
      break
    }
  }
  if (!last || last.type !== "assistant") return undefined
  if (last.content.some((part) => part.type === "tool")) return undefined
  const text = last.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()
  return text.length > 0 ? text : undefined
}

/** Recent user turns want Chinese (look back a few prompts, not just the latest paste). */
export function sessionWantsChinese(messages: ReadonlyArray<SessionMessage.Info>): boolean {
  let seen = 0
  for (let i = messages.length - 1; i >= 0 && seen < 6; i--) {
    const message = messages[i]!
    if (message.type !== "user") continue
    seen++
    if (isChineseUserText(message.text)) return true
  }
  return false
}

/**
 * Fingerprint when an idle English reply follows a Chinese-expecting session, or undefined.
 */
export function replyLanguageFingerprint(messages: ReadonlyArray<SessionMessage.Info>): string | undefined {
  if (process.env.OPENCODE_REPLY_LANGUAGE === "0") return undefined
  if (!sessionWantsChinese(messages)) return undefined
  const index = messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return undefined
  const prompt = messages[index]!
  if (prompt.type !== "user") return undefined
  const text = latestAssistantText(messages)
  if (!text || !isEnglishReply(text)) return undefined
  return `${prompt.id}\n${text.slice(0, 120)}`
}
