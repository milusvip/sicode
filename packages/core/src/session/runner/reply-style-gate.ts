/**
 * SiCode: final reply must be skimable spoken prose in the harness shape — not a handover dump.
 *
 * Detection is structural only (heading trees, path/arrow inventories, tech density with almost
 * no sentences). No banned-phrase word lists. Soft system shape failed → trigger once, rewrite.
 *
 * Kill: OPENCODE_REPLY_STYLE=0.
 */
import type { SessionMessage } from "../message.js"

export const REPLY_STYLE_PROMPT = `刚才的收尾不像给人看的短答。按编排重写：

1. 一句人话开场说清结论（正常开场可以有）
2. 有多点就用短列表：每条 **加粗关键词** + 一句说明；对比用小表，步骤用编号
3. 说完就停

不要写成进度分区或路径清单。本步不要再调工具。`

/** Markdown heading or bold-only line used as a fake section title. */
const STRUCTURE_LINE = /^(?:#{1,3}\s+\S.*|\*\*[^*\n]{1,40}\*\*)\s*$/u

/** Path-ish or camelCase dumps in prose. */
const TECH_TOKEN =
  /(?:[A-Za-z]:\\|\.\/|packages\/|src\/|[a-z0-9_-]+\.(?:ts|tsx|js|jsx|css|md|json)\b|[A-Za-z_][A-Za-z0-9_]{6,})/g

const CJK = /[\u3400-\u9fff]/g
const INLINE_CODE = /`[^`\n]+`/g

function stripFences(text: string): { prose: string; fenceChars: number } {
  let fenceChars = 0
  const prose = text.replace(/```[\s\S]*?```/g, (block) => {
    fenceChars += block.length
    return "\n"
  })
  return { prose, fenceChars }
}

function sentenceCount(prose: string): number {
  const parts = prose.split(/(?<=[。！？.!?])(?:\s+|$)/u).map((part) => part.trim()).filter(Boolean)
  return parts.filter((part) => /[。！？.!?]$/u.test(part) || part.length >= 12).length
}

function structureLineCount(prose: string): number {
  return prose.split(/\n/).filter((line) => STRUCTURE_LINE.test(line.trim())).length
}

function techDensity(prose: string): boolean {
  const cjk = prose.match(CJK)?.length ?? 0
  const inline = prose.match(INLINE_CODE)?.length ?? 0
  const tech = prose.match(TECH_TOKEN)?.length ?? 0
  if (cjk >= 40 && tech + inline >= 8) return true
  if (cjk < 20 && tech >= 6) return true
  return false
}

/** True when stripped prose looks like a handover dump rather than spoken sentences. */
export function isMessyReply(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return false
  const { prose, fenceChars } = stripFences(trimmed)
  const body = prose.trim()
  // Mostly code fences → user likely got the artifact they asked for.
  if (fenceChars > 0 && fenceChars >= trimmed.length * 0.55) return false
  if (body.length < 20) return false
  if (structureLineCount(body) >= 3) return true
  if (trimmed.length < 40) return false
  const sentences = sentenceCount(body)
  if (sentences < 2 && techDensity(body)) return true
  if (sentences < 2 && /(?:→|->|=>)/.test(body) && (body.match(/\n/g)?.length ?? 0) >= 3) return true
  return false
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
  const text = last.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()
  return text.length > 0 ? text : undefined
}

/**
 * Fingerprint of a messy idle reply after the latest user prompt, or undefined when the reply
 * is already plain / missing / code-heavy.
 */
export function replyStyleFingerprint(messages: ReadonlyArray<SessionMessage.Info>): string | undefined {
  if (process.env.OPENCODE_REPLY_STYLE === "0") return undefined
  const index = messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return undefined
  const prompt = messages[index]!
  if (prompt.type !== "user") return undefined
  const text = latestAssistantText(messages)
  if (!text || !isMessyReply(text)) return undefined
  return `${prompt.id}\n${text.slice(0, 120)}`
}
