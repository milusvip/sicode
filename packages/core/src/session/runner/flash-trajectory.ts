/**
 * SiCode: score recorded Flash search turns without a live model.
 *
 * A fixture is a stripped session: user query + grep/glob/read calls + expected paths.
 * Caps (median / p90 search counts, expect-path hit rate, first useful step, batched rate) are
 * the regression gate — when a change makes Flash wander more on the same questions, these numbers move.
 */
export * as FlashTrajectory from "./flash-trajectory.js"

export type TrajectoryTool = {
  readonly name: string
  readonly pattern?: string
  readonly patterns?: readonly string[]
  readonly path?: string
  readonly matches?: number
  readonly count?: number
}

export type TrajectoryTurn = {
  readonly id: string
  /** User question as asked (Chinese concept queries preferred). */
  readonly query: string
  /** Paths that count as "found the right place". */
  readonly expectPaths: readonly string[]
  readonly tools: readonly TrajectoryTool[]
}

export type TrajectoryFixture = {
  readonly sessionID: string
  readonly model: string
  readonly turns: readonly TrajectoryTurn[]
  /** Soft caps — fail the golden if a re-score exceeds these. */
  readonly caps: {
    readonly maxSearchMedian: number
    readonly maxSearchP90: number
    /** Fraction of turns that must read at least one expect path (0–1). */
    readonly minExpectHitRate: number
    /**
     * SiCode: PR1 bar — 1-based tool index of the first expect-hit read or edit/write/patch,
     * median across turns. Edit/答 should land by step 8.
     */
    readonly maxFirstUsefulMedian?: number
    /** SiCode: PR2 bar — fraction of turns that batched a grep (patterns[] or a|b|c). */
    readonly minBatchedRate?: number
  }
}

export type TurnScore = {
  readonly id: string
  readonly searchCount: number
  readonly emptySearch: number
  /** True when any grep used `patterns[]` or a plain `a|b|c` batch. */
  readonly batched: boolean
  /** True when a read path covers one of expectPaths. */
  readonly expectHit: boolean
  readonly readPaths: readonly string[]
  /**
   * 1-based index of the first useful tool (expect-hit read, or edit/write/patch).
   * 0 when the turn never got there.
   */
  readonly firstUseful: number
}

export type SessionScore = {
  readonly turns: readonly TurnScore[]
  readonly searchMedian: number
  readonly searchP90: number
  readonly expectHitRate: number
  readonly batchedRate: number
  readonly firstUsefulMedian: number
}

const isSearch = (tool: TrajectoryTool) => tool.name === "grep" || tool.name === "glob"

const isEmpty = (tool: TrajectoryTool) => {
  if (tool.name === "grep") return tool.matches === 0
  if (tool.name === "glob") return tool.count === 0
  return false
}

const isBatched = (tool: TrajectoryTool) => {
  if (tool.name !== "grep") return false
  if ((tool.patterns?.length ?? 0) > 0) return true
  const pattern = tool.pattern ?? ""
  return pattern.includes("|") && !/[()[\]{}*+?\\^$]/.test(pattern)
}

const covers = (readPath: string, expect: string) => {
  const a = readPath.replaceAll("\\", "/")
  const b = expect.replaceAll("\\", "/")
  return a === b || a.endsWith("/" + b) || a.endsWith(b) || b.endsWith(a)
}

const isAct = (tool: TrajectoryTool) => tool.name === "edit" || tool.name === "write" || tool.name === "patch"

export function scoreTurn(turn: TrajectoryTurn): TurnScore {
  const searches = turn.tools.filter(isSearch)
  const reads = turn.tools.filter((tool) => tool.name === "read" && typeof tool.path === "string")
  const readPaths = reads.map((tool) => tool.path!)
  let firstUseful = 0
  for (let index = 0; index < turn.tools.length; index++) {
    const tool = turn.tools[index]!
    if (isAct(tool)) {
      firstUseful = index + 1
      break
    }
    if (tool.name === "read" && typeof tool.path === "string" && turn.expectPaths.some((expect) => covers(tool.path!, expect))) {
      firstUseful = index + 1
      break
    }
  }
  return {
    id: turn.id,
    searchCount: searches.length,
    emptySearch: searches.filter(isEmpty).length,
    batched: searches.some(isBatched),
    expectHit: turn.expectPaths.some((expect) => readPaths.some((path) => covers(path, expect))),
    readPaths,
    firstUseful,
  }
}

const percentile = (sorted: readonly number[], p: number) => {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]!
}

export function scoreSession(fixture: TrajectoryFixture): SessionScore {
  const turns = fixture.turns.map(scoreTurn)
  const searches = turns.map((turn) => turn.searchCount).slice().sort((a, b) => a - b)
  const firstUseful = turns
    .map((turn) => turn.firstUseful)
    .filter((value) => value > 0)
    .slice()
    .sort((a, b) => a - b)
  return {
    turns,
    searchMedian: percentile(searches, 50),
    searchP90: percentile(searches, 90),
    expectHitRate: turns.length === 0 ? 0 : turns.filter((turn) => turn.expectHit).length / turns.length,
    batchedRate: turns.length === 0 ? 0 : turns.filter((turn) => turn.batched).length / turns.length,
    firstUsefulMedian: percentile(firstUseful, 50),
  }
}

/** True when the scored session stays within the fixture's soft caps. */
export function withinCaps(fixture: TrajectoryFixture, score = scoreSession(fixture)): boolean {
  if (score.searchMedian > fixture.caps.maxSearchMedian) return false
  if (score.searchP90 > fixture.caps.maxSearchP90) return false
  if (score.expectHitRate < fixture.caps.minExpectHitRate) return false
  if (
    fixture.caps.maxFirstUsefulMedian !== undefined &&
    score.firstUsefulMedian > fixture.caps.maxFirstUsefulMedian
  )
    return false
  if (fixture.caps.minBatchedRate !== undefined && score.batchedRate < fixture.caps.minBatchedRate) return false
  return true
}
