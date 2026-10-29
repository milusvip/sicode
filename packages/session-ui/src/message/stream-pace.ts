// SiCode: the numbers here decide what streaming *looks* like, not what it delivers.
//
// Measured on this machine a step arrives at ~257 output tokens/s (p90 328), so a whole answer is on
// disk in under a second — at a 24 ms frame that is 7–10 characters per frame. Drawn flat out the
// text reads as blocks jumping in rather than as writing. Drawn at a fixed slow pace it reads well
// but falls further behind every second, and the answer is still typing itself out after the turn
// has moved on. So the drawn text trails the source by a fixed slice of *time* instead of a fixed
// number of characters: each frame reveals the share of the backlog that one lag window would have
// delivered, which is exponential approach. The gap settles at ~one window while the source keeps
// growing, and closes by itself the moment it stops.

/** Frame interval. One frame is one markdown re-parse, so this is a budget, not a preference. */
export const TEXT_RENDER_PACE_MS = 24

/** The gap the drawn text keeps behind the source, in milliseconds of arrival. */
export const TEXT_RENDER_LAG_MS = 64

/** Ceiling for one frame (retry replaying a paragraph, a tab that came back from the background). */
export const TEXT_RENDER_MAX = 120

/** Backstop for the curve's tail once the source stops; past it the text snaps. */
export const TEXT_RENDER_DRAIN_MS = 400

/**
 * A backlog this small is drawn at once: spreading four characters over frames is spacing no one
 * can see, and holding them back only leaves a slow model a frame behind. Deliberately far below a
 * single delta, so a normal arrival is still smoothed.
 */
const TEXT_RENDER_SNAP_ALL = 4

const TEXT_RENDER_SNAP = /[\s.,!?;:)\]]/

/**
 * How many characters this frame reveals. `elapsed` is real wall clock since the previous frame, so
 * a late timer reveals proportionally more instead of losing ground.
 */
export function streamPaceAdvance(pending: number, elapsed: number) {
  if (pending <= 0) return 0

  if (pending <= TEXT_RENDER_SNAP_ALL) return pending

  const count = Math.ceil((pending * Math.max(elapsed, 1)) / TEXT_RENDER_LAG_MS)

  return Math.min(pending, TEXT_RENDER_MAX, Math.max(1, count))
}

/**
 * Offset to draw up to. Lands just past a break when one is within a couple of characters, so a
 * frame never stops halfway through a word. The overshoot is deliberately short: it is what turns a
 * steady reveal back into clumps.
 */
export function streamPaceNext(text: string, start: number, count: number) {
  const end = Math.min(text.length, start + Math.max(1, count))
  const max = Math.min(text.length, end + 3)

  for (let i = end; i < max; i++) {
    if (TEXT_RENDER_SNAP.test(text[i] ?? "")) return i + 1
  }

  return end
}
