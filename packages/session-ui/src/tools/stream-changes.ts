import { diffLines } from "diff"

/** A live counter runs on every token, so very large edits fall back to the cheap head/tail count. */
const diffLineLimit = 2000

/**
 * Line counts for a file change whose arguments are still arriving.
 *
 * The row used to show nothing until the tool finished, because the counts came from the completion
 * metadata. These are the same numbers drawn from the arguments themselves, so they climb while the
 * model types.
 */
export function streamedLineChanges(input: Record<string, unknown>) {
  const patch = text(input.patchText) ?? text(input.patch)

  if (patch) return patchLineChanges(patch)

  // `edit` writes `newString`, `write` writes `content`; a patch carries its own diff above.
  const after = text(input.newString) ?? text(input.content)

  // Nothing typed yet: `-N` for a file that has not been touched reads as a deletion that never happened.
  if (!after) return undefined

  const before = text(input.oldString)

  // A write has no old text: every line is an addition, and the empty string is not a removed line.
  if (!before) return { additions: lines(after).length, deletions: 0 }

  return editLineChanges(before, after)
}

function text(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function lines(value: string) {
  return value.split("\n")
}

/** What the model changed in an `edit`: a real line diff, because one edit can sit in several places. */
export function editLineChanges(before: string, after: string) {
  const previous = lines(before)
  const next = lines(after)

  if (previous.length > diffLineLimit || next.length > diffLineLimit) return headTailLineChanges(previous, next)

  let additions = 0
  let deletions = 0

  // A missing trailing newline makes `diffLines` treat the last line as rewritten, so both sides end
  // with one and every chunk is a whole number of lines.
  for (const part of diffLines(`${before}\n`, `${after}\n`)) {
    if (part.added) additions += part.value.split("\n").length - 1
    else if (part.removed) deletions += part.value.split("\n").length - 1
  }

  return { additions, deletions }
}

/** The untouched head and tail of a huge file are most of it, so this stays linear. */
function headTailLineChanges(previous: string[], next: string[]) {
  let head = 0

  while (head < previous.length && head < next.length && previous[head] === next[head]) head++

  let tail = 0

  while (
    tail < previous.length - head &&
    tail < next.length - head &&
    previous[previous.length - 1 - tail] === next[next.length - 1 - tail]
  )
    tail++

  return {
    additions: next.length - head - tail,
    deletions: previous.length - head - tail,
  }
}

/** Counts the `+`/`-` lines of a unified patch, ignoring the `+++`/`---` file headers. */
export function patchLineChanges(patch: string) {
  let additions = 0
  let deletions = 0

  for (const line of lines(patch)) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++
  }

  return { additions, deletions }
}
