export * as ConfigProjectMapPlugin from "./project-map.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Effect } from "effect"
import { join } from "path"
import { Environment } from "../../environment/index.js"
import { Location } from "../../location.js"
import { RepoMap } from "../../repo-map/index.js"

/**
 * SiCode: puts the repo map and the notes index in front of the model on every request.
 *
 * Both files already existed, but only as instructions telling the model to go read them — and a
 * read is a full round trip whose output then stays in the context for the rest of the session.
 * Injecting the 4KB map plus a few hundred bytes of section titles costs roughly 1.3k tokens per
 * request, which is less than the one or two turns it saves.
 *
 * `.sicode/structure.md` wins when it exists: it holds architecture notes no parser can derive.
 * Every other repository gets the map generated from the sources instead, which is the case this
 * plugin was previously useless for.
 *
 * The notes index is deliberately titles only. The full file is ~28KB, so replaying it would cost
 * more per request than the searching it replaces; the model still opens the section it needs.
 */

const MAP = join(".sicode", "structure.md")
const NOTES = join(".sicode", "notes.md")

const sections = (notes: string) =>
  notes.split("\n").flatMap((line) => (line.startsWith("## ") ? [line.slice(3).trim()] : []))

/**
 * `source` only changes the closing line: a generated map has no file to send the model to, and
 * telling it to skip reading a file that does not exist is the kind of instruction that makes a
 * model doubt the rest of the prompt.
 */
export const render = (map: string | undefined, notes: string | undefined, source: "written" | "generated" = "written") => {
  const parts: string[] = []
  if (map)
    parts.push(
      [
        "# Repo map",
        "",
        map.trim(),
        "",
        source === "written"
          ? "This is the whole map; it is already here, so do not read `.sicode/structure.md` again."
          : "This map is generated from the sources on every change, so it is already complete — search the files directly instead of looking for a map file.",
      ].join("\n"),
    )
  const titles = notes === undefined ? [] : sections(notes)
  if (titles.length > 0)
    parts.push(
      [
        "# Investigation notes",
        "",
        "Areas that already have a conclusion recorded in `.sicode/notes.md`:",
        ...titles.map((title) => `- ${title}`),
        "",
        "If the task touches one of these, read that section of `.sicode/notes.md` before searching. Only the index is in context, not the sections themselves.",
      ].join("\n"),
    )
  return parts.join("\n\n")
}

export const Plugin = define({
  id: "opencode.config.project-map",
  effect: Effect.fn(function* (ctx) {
    const environment = yield* Environment.Service
    const location = yield* Location.Service

    const read = (path: string) =>
      environment.files.read(path).pipe(
        Effect.map((result) => new TextDecoder().decode(result.bytes)),
        Effect.catch(() => Effect.succeed(undefined)),
      )

    yield* ctx.session.hook("context", (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const template = event.system[0]
        if (!template) return
        // `OPENCODE_REPO_MAP=generated` ignores the hand-written file, which is the only way to
        // compare the two maps inside a repository that has both.
        const preferred = process.env.OPENCODE_REPO_MAP === "generated" ? undefined : yield* read(join(location.directory, MAP))
        const generated =
          preferred === undefined
            ? yield* Effect.tryPromise(() => RepoMap.get(location.directory)).pipe(
                Effect.catch(() => Effect.succeed(undefined)),
              )
            : undefined
        const body = render(
          preferred ?? generated,
          yield* read(join(location.directory, NOTES)),
          preferred === undefined ? "generated" : "written",
        )
        if (body === "") return
        // Appended rather than merged into the first part: the agent's own prompt stays the
        // stable prefix that the provider caches.
        event.system.push({ ...template, text: body })
      }).pipe(Effect.catch(() => Effect.void)),
    )
  }),
})
