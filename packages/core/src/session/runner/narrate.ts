/**
 * Narration guard.
 *
 * A turn can run dozens of tool steps without a single word of text: the model batches reads and
 * searches and only writes a summary at the very end. While it works, the transcript shows activity
 * with no story — and if the user stops the turn before that summary exists, the conversation keeps
 * no assistant text at all. This is a reminder to say one sentence, not a change of task.
 */
export const NARRATE_EVERY_STEPS = 6

export const NARRATE_PROMPT = `You have run several steps without writing any text. The user is watching tool calls with no explanation.

Before your next tool call, include one short sentence in the same message: what you just learned, or what you are about to do and why.

Keep it to a sentence — not a plan, not a report, and do not stop working. This is a reminder about saying what you found, not a change of task.`
