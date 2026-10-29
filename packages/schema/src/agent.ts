export * as Agent from "./agent.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { optional } from "./schema.js"
import { Model } from "./model.js"
import { Permission } from "./permission.js"
import { Provider } from "./provider.js"
import { PositiveInt, statics } from "./schema.js"

const Updated = ephemeral({ type: "agent.updated", schema: {} })

export const ID = Schema.String.pipe(Schema.brand("Agent.ID"), Schema.annotate({ identifier: "Agent.ID" }))
export type ID = typeof ID.Type

export const Name = Schema.String.pipe(Schema.brand("Agent.Name"))
export type Name = typeof Name.Type

export const Color = Schema.String.annotate({ identifier: "Agent.Color" })
export type Color = typeof Color.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  name: Name,
  model: Model.Ref.pipe(optional),
  request: Provider.Request,
  system: Schema.String.pipe(optional),
  description: Schema.String.pipe(optional),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  hidden: Schema.Boolean,
  color: Color.pipe(optional),
  steps: PositiveInt.pipe(optional),
  permissions: Permission.Ruleset,
})
  .annotate({ identifier: "Agent.Info" })
  .pipe(
    statics(() => ({
      default: (id: ID) =>
        ({
          id,
          name: Name.make(id),
          request: { settings: {}, headers: {}, body: {} },
          mode: "primary",
          hidden: false,
          permissions: [
            { action: "*", resource: "*", effect: "allow" },
            { action: "read", resource: "*.env", effect: "ask" },
            { action: "read", resource: "*.env.*", effect: "ask" },
            { action: "read", resource: "*.env.example", effect: "allow" },
            // SiCode: irreversible shell work asks once before it runs — recursive delete, and the git
            // commands that discard commits or the working tree. A single-file `rm` stays allowed on
            // purpose: it is routine cleanup, and confirming it every time would spend the whole point
            // of running unattended. The shell tool reports each parsed sub-command as its resource, so
            // these match the command line as typed (`rm -rf build`, not the whole shell string).
            { action: "shell", resource: "rm -rf*", effect: "ask" },
            { action: "shell", resource: "rm -fr*", effect: "ask" },
            { action: "shell", resource: "rm -r*", effect: "ask" },
            { action: "shell", resource: "sudo rm -rf*", effect: "ask" },
            { action: "shell", resource: "rmdir *", effect: "ask" },
            { action: "shell", resource: "git push --force*", effect: "ask" },
            { action: "shell", resource: "git push -f*", effect: "ask" },
            { action: "shell", resource: "git reset --hard*", effect: "ask" },
            { action: "shell", resource: "git clean -f*", effect: "ask" },
            { action: "shell", resource: "del /s*", effect: "ask" },
            { action: "shell", resource: "del /f*", effect: "ask" },
            { action: "shell", resource: "format *", effect: "ask" },
          ],
        }) satisfies Info,
    })),
  )

export const Event = {
  Updated,
  Definitions: inventory(Updated),
}
