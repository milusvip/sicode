/**
 * SiCode: frequent edit package locus → project convention Observation.
 */
import { normalizeAll, type Observation } from "../observation.js"

const SKIP = /(?:^|\/)(?:\.sicode\/scratch|scratch|tmp|temp|node_modules|\.git)(?:\/|$)/i

const packageRoot = (path: string) => {
  const normalized = path.replace(/\\/g, "/")
  if (SKIP.test(normalized)) return undefined
  const match = normalized.match(/(?:^|\/)((?:packages|apps|services)\/[^/]+)/)
  return match?.[1]
}

/** Paths edited this turn/session; ≥ `min` under one package → convention observation. */
export const fromEditPaths = (paths: readonly string[], min = 3): Observation[] => {
  const counts = new Map<string, number>()
  for (const path of paths) {
    const root = packageRoot(path)
    if (!root) continue
    counts.set(root, (counts.get(root) ?? 0) + 1)
  }

  return normalizeAll(
    [...counts.entries()]
      .filter(([, count]) => count >= min)
      .map(([root]) => ({
        scope: "project" as const,
        kind: "convention" as const,
        text: `Frequent edit locus: ${root}`,
        strength: 0.65,
        paths: [root],
        source: { type: "tool" as const },
        explicit: false,
      })),
  )
}
