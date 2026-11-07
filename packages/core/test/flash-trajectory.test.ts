/**
 * SiCode: Flash session-trajectory golden — re-scores the recorded dual-track trial.
 *
 * Caps leave headroom above the recorded median/p90. Re-export a fresher session with
 * `.sicode/scratch/export-flash-trajectory.ts` when adoption improves and tighten caps.
 */
import { describe, expect, test } from "bun:test"
import fixture from "./fixtures/flash-trajectory-baseline.json"
import { SearchRankedConcepts } from "../src/search-ranked/concepts.js"
import {
  scoreSession,
  scoreTurn,
  withinCaps,
  type TrajectoryFixture,
} from "../src/session/runner/flash-trajectory.js"

const baseline = fixture as TrajectoryFixture

describe("Flash trajectory baseline", () => {
  test("recorded dual-track session stays within soft caps", () => {
    const score = scoreSession(baseline)
    expect(score.turns.length).toBeGreaterThanOrEqual(5)
    expect(score.expectHitRate).toBeGreaterThanOrEqual(baseline.caps.minExpectHitRate)
    expect(score.searchMedian).toBeLessThanOrEqual(baseline.caps.maxSearchMedian)
    expect(score.searchP90).toBeLessThanOrEqual(baseline.caps.maxSearchP90)
    // SiCode: PR1/PR2 bars — first useful ≤8, batched fan-out is the default shape.
    expect(score.firstUsefulMedian).toBeLessThanOrEqual(baseline.caps.maxFirstUsefulMedian ?? 8)
    expect(score.batchedRate).toBeGreaterThanOrEqual(baseline.caps.minBatchedRate ?? 0)
    expect(withinCaps(baseline, score)).toBe(true)
  })

  test("every retrieval turn hit at least one expected path", () => {
    for (const turn of baseline.turns) {
      const scored = scoreTurn(turn)
      expect(scored.expectHit).toBe(true)
    }
  })

  test("Chinese concept queries still expand to English identifiers", () => {
    const cases: Array<{ needle: string; must: string }> = [
      { needle: "侧边栏", must: "sidebar" },
      { needle: "权限弹窗", must: "permission-dock" },
      { needle: "上下文压缩", must: "compaction" },
      { needle: "仓库地图", must: "repo-map" },
      { needle: "项目记忆", must: "project-memory" },
      { needle: "线索码头", must: "context-hints" },
    ]
    for (const turn of baseline.turns) {
      const match = cases.find((item) => turn.query.includes(item.needle))
      if (!match) continue
      expect(SearchRankedConcepts.expand(turn.query)).toContain(match.must)
    }
  })

  test("a worse trajectory (doubled searches, no reads) breaches caps", () => {
    const worse: TrajectoryFixture = {
      ...baseline,
      turns: baseline.turns.map((turn) => ({
        ...turn,
        tools: [
          ...turn.tools.filter((tool) => tool.name === "grep" || tool.name === "glob"),
          ...turn.tools.filter((tool) => tool.name === "grep" || tool.name === "glob"),
          // Drop reads so expectHit fails.
        ],
      })),
    }
    const score = scoreSession(worse)
    expect(withinCaps(worse, score)).toBe(false)
  })
})
