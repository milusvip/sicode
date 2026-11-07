/**
 * SiCode: repeated user constraints → Observation (persona or project if a path is named).
 */
import { normalizeAll, type Observation } from "../observation.js"

const CONSTRAINT =
  /(?:不要|别|勿|禁止|never|do\s+not|don't)\s*(?:再)?(?:改|动|碰|修改|edit|touch|change)?\s*[：:\s]*([^\n。；;]{4,120})/gi

const PATHISH = /(?:packages|src|apps|services)\/[\w./-]+|[\w.-]+\.[a-z]{1,8}/i

/** Same constraint emphasized ≥2 times in user turns becomes one observation. */
export const fromUserTexts = (texts: readonly string[]): Observation[] => {
  const counts = new Map<string, { text: string; path?: string; n: number }>()

  for (const raw of texts) {
    for (const match of raw.matchAll(CONSTRAINT)) {
      const clause = (match[1] ?? "").trim().replace(/[。.]+$/, "")
      if (clause.length < 4) continue
      const key = clause.toLowerCase()
      const path = PATHISH.exec(clause)?.[0]
      const prev = counts.get(key)
      counts.set(key, { text: clause, path: path ?? prev?.path, n: (prev?.n ?? 0) + 1 })
    }
  }

  return normalizeAll(
    [...counts.values()]
      .filter((item) => item.n >= 2)
      .map((item) => ({
        scope: (item.path ? "project" : "persona") as "project" | "persona",
        kind: "constraint" as const,
        text: item.path ? `Do not modify: ${item.path}` : `User constraint: ${item.text}`,
        strength: 0.75,
        paths: item.path ? [item.path] : undefined,
        source: { type: "user" as const },
        explicit: false,
      })),
  )
}
