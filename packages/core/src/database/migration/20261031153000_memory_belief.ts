import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261031153000_memory_belief",
  up(tx) {
    return Effect.gen(function* () {
      // SiCode: durable beliefs for project + persona memory (M1). importance/confidence are 0–100.
      yield* tx.run(`
        CREATE TABLE \`memory_belief\` (
          \`id\` text PRIMARY KEY NOT NULL,
          \`project_key\` text NOT NULL,
          \`persona_id\` text,
          \`session_id\` text,
          \`kind\` text NOT NULL,
          \`proposition\` text NOT NULL,
          \`paths\` text NOT NULL,
          \`entities\` text NOT NULL,
          \`valid_at\` integer NOT NULL,
          \`invalid_at\` integer,
          \`importance\` integer NOT NULL,
          \`confidence\` integer NOT NULL,
          \`misses\` integer NOT NULL,
          \`seen_at\` integer NOT NULL,
          \`superseded_by\` text,
          \`contradicts\` text NOT NULL,
          \`provenance\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`memory_belief_project_idx\` ON \`memory_belief\` (\`project_key\`, \`persona_id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`memory_belief_seen_idx\` ON \`memory_belief\` (\`project_key\`, \`seen_at\`);`)
    })
  },
}

export default migration
