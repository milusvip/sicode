// Replays a synthetic stream through the old fixed-pace reveal and the new time-sliced one and
// reports how far the drawn text trails the source, and how lumpy each frame is.
// Local analysis only — not part of the product.

const PACE = 24
const OLD = { per: 3, backlog: 1200, snap: 8 }
const NEW = { lag: 64, max: 120, snap: 3 }
const SNAP = /[\s.,!?;:)\]]/

function nextChar(text, start, count, slack) {
  const end = Math.min(text.length, start + Math.max(1, count))
  const max = Math.min(text.length, end + slack)
  for (let i = end; i < max; i++) if (SNAP.test(text[i] ?? "")) return i + 1
  return end
}

function advanceOld(pending) {
  if (pending <= OLD.backlog) return Math.min(pending, OLD.per)
  return Math.max(OLD.per, Math.min(64, Math.ceil(pending / 8)))
}

function advanceNew(pending, elapsed) {
  if (pending <= 4) return pending
  const count = Math.ceil((pending * Math.max(elapsed, 1)) / NEW.lag)
  return Math.min(pending, NEW.max, Math.max(1, count))
}

// Source: tokens arrive every `gap` ms, `per` tokens each, ending at `total` chars. Chinese runs
// ~1.5 chars per token at this tokenizer, but characters are what the reveal counts, so keep it 1:1.
function run(kind, { total, gap, per }) {
  const text = "字".repeat(total)
  // Arrival timeline, as timestamps at which the source length becomes N.
  const arrivals = []
  for (let n = per; n < total; n += per) arrivals.push({ at: (n / per) * gap, len: n })
  arrivals.push({ at: Math.ceil(total / per) * gap, len: total })
  const endAt = arrivals[arrivals.length - 1].at

  let shown = 0
  let at = 0
  const trail = []
  const bumps = []
  for (let t = PACE; t <= endAt + 2000; t += PACE) {
    let arrived = 0
    for (const a of arrivals) if (a.at <= t) arrived = a.len
    if (arrived <= shown) {
      if (arrived === shown && t > endAt) break
      at = t
      continue
    }
    const elapsed = t - at
    at = t
    const pending = arrived - shown
    const count = kind === "old" ? advanceOld(pending) : advanceNew(pending, elapsed)
    const end = nextChar(text, shown, count, kind === "old" ? OLD.snap : NEW.snap)
    bumps.push(end - shown)
    shown = end
    trail.push({ t, behind: arrived - shown })
  }

  const behind = trail.map((x) => x.behind)
  const mean = behind.reduce((a, b) => a + b, 0) / behind.length
  const rate = total / (endAt / 1000)
  const meanBump = bumps.reduce((a, b) => a + b, 0) / bumps.length
  const sd = Math.sqrt(bumps.reduce((a, b) => a + (b - meanBump) ** 2, 0) / bumps.length)
  const finish = trail.length ? trail[trail.length - 1].t - endAt : 0

  return {
    kind,
    charsPerSec: Math.round(rate),
    meanBehind: Math.round(mean),
    maxBehind: Math.max(...behind),
    meanBehindMs: Math.round((mean / rate) * 1000),
    maxBehindMs: Math.round((Math.max(...behind) / rate) * 1000),
    meanBump: meanBump.toFixed(1),
    sd: sd.toFixed(1),
    finishMs: finish,
  }
}

const cases = [
  { name: "250 chars @120/s", total: 250, gap: 60, per: 7 },
  { name: "900 chars @257/s (p50)", total: 900, gap: 40, per: 10 },
  { name: "3000 chars @350/s", total: 3000, gap: 30, per: 10 },
  { name: "3000 chars ragged", total: 3000, gap: 90, per: 30 },
]

for (const c of cases) {
  for (const kind of ["old", "new"]) {
    const r = run(kind, c)
    console.log(
      `${c.name.padEnd(24)} ${r.kind.padEnd(4)} behind avg ${String(r.meanBehindMs).padStart(5)}ms (${String(r.meanBehind).padStart(4)} chars) max ${String(r.maxBehindMs).padStart(5)}ms | bump ${r.meanBump}±${r.sd} | finish +${r.finishMs}ms`,
    )
  }
  console.log("")
}
