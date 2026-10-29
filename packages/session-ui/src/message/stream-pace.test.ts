import { describe, expect, test } from "bun:test"
import { streamPaceAdvance, streamPaceNext, TEXT_RENDER_LAG_MS, TEXT_RENDER_MAX, TEXT_RENDER_PACE_MS } from "./stream-pace"

// Replays a source that grows at a steady rate through the reveal curve and returns how far behind
// the drawn text was on each frame. This is the property that matters: the gap is a slice of time,
// so it stays put however long the answer is.
function replay(total: number, perFrame: number) {
  let shown = 0
  let arrived = 0
  const behind: number[] = []
  const bumps: number[] = []

  for (;;) {
    arrived = Math.min(total, arrived + perFrame)
    const end = streamPaceNext("x".repeat(arrived), shown, streamPaceAdvance(arrived - shown, TEXT_RENDER_PACE_MS))
    bumps.push(end - shown)
    shown = end
    behind.push(arrived - shown)

    if (shown >= total) break

    if (behind.length > 10_000) throw new Error("never caught up")
  }

  return { behind, bumps }
}

describe("stream pace", () => {
  test("keeps the drawn text within one lag window of the source", () => {
    // ~10 characters every 24 ms is the measured p50 arrival rate.
    const { behind } = replay(3000, 10)

    expect(Math.max(...behind)).toBeLessThanOrEqual(24)
    // Settled, not creeping: the last frame trails about as much as the first.
    expect(behind.at(-1)!).toBeLessThanOrEqual(behind[2]! + 4)
  })

  test("does not fall behind by a fixed number of characters", () => {
    const short = replay(300, 10)
    const long = replay(3000, 10)

    // Ten times the text must not mean ten times the lag — that is exactly what a fixed
    // characters-per-frame pace did, and it left an answer typing itself out after the turn ended.
    expect(Math.max(...long.behind)).toBeLessThanOrEqual(Math.max(...short.behind) + 8)
  })

  test("closes the gap once the source stops growing", () => {
    let total = 600
    let shown = 0
    let frames = 0

    while (shown < total) {
      shown = streamPaceNext("x".repeat(total), shown, streamPaceAdvance(total - shown, TEXT_RENDER_PACE_MS))
      frames++
    }

    // Exponential approach, so the tail finishes in a couple hundred milliseconds — well inside the
    // drain backstop — rather than the seconds a fixed pace needed for the same backlog.
    expect(frames).toBeLessThanOrEqual(14)
  })

  test("spreads a paragraph that landed at once over several frames", () => {
    expect(streamPaceAdvance(400, TEXT_RENDER_PACE_MS)).toBe(TEXT_RENDER_MAX)
    expect(streamPaceAdvance(40, TEXT_RENDER_PACE_MS)).toBeLessThan(40)
    expect(streamPaceAdvance(40, TEXT_RENDER_PACE_MS)).toBeGreaterThan(10)
  })

  test("reveals proportionally more after a late frame", () => {
    expect(streamPaceAdvance(100, 96)).toBeGreaterThan(streamPaceAdvance(100, TEXT_RENDER_PACE_MS))
  })

  test("never stalls and never runs past what arrived", () => {
    expect(streamPaceAdvance(1, 1)).toBe(1)
    expect(streamPaceAdvance(0, TEXT_RENDER_PACE_MS)).toBe(0)
    expect(streamPaceAdvance(5, TEXT_RENDER_PACE_MS)).toBeLessThanOrEqual(5)
    expect(streamPaceAdvance(5, 5_000)).toBe(5)
  })

  test("stops just past a word break when one is near", () => {
    expect(streamPaceNext("one two", 4, 1)).toBe(5)
    expect(streamPaceNext("wordword", 2, 2)).toBe(4)
    expect(streamPaceNext("word", 2, 99)).toBe(4)
  })

  test("a frame's overshoot stays short", () => {
    const text = `${"a".repeat(10)} ${"b".repeat(100)}`

    expect(streamPaceNext(text, 0, 10)).toBe(11)

    for (let i = 0; i < text.length; i++) expect(streamPaceNext(text, i, 3) - i).toBeLessThanOrEqual(TEXT_RENDER_MAX)
  })

  test("keeps the lag window at a few frames", () => {
    expect(TEXT_RENDER_LAG_MS / TEXT_RENDER_PACE_MS).toBeLessThanOrEqual(3)
  })
})
