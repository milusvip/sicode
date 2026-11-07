import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261101120000_memory_graph_vector",
  up(tx) {
    return Effect.gen(function* () {
      // SiCode: persistent entity/edge graph + cached feat-hash belief vectors.
      yield* tx.run(`
        CREATE TABLE \`memory_entity\` (
          \`id\` text PRIMARY KEY NOT NULL,
          \`project_key\` text NOT NULL,
          \`name\` text NOT NULL,
          \`type\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`memory_entity_project_idx\` ON \`memory_entity\` (\`project_key\`);`)

      yield* tx.run(`
        CREATE TABLE \`memory_edge\` (
          \`id\` text PRIMARY KEY NOT NULL,
          \`project_key\` text NOT NULL,
          \`belief_a\` text NOT NULL,
          \`belief_b\` text NOT NULL,
          \`entity_id\` text NOT NULL,
          \`rel\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`memory_edge_project_idx\` ON \`memory_edge\` (\`project_key\`);`)
      yield* tx.run(`CREATE INDEX \`memory_edge_belief_a_idx\` ON \`memory_edge\` (\`belief_a\`);`)
      yield* tx.run(`CREATE INDEX \`memory_edge_belief_b_idx\` ON \`memory_edge\` (\`belief_b\`);`)

      yield* tx.run(`
        CREATE TABLE \`memory_vector\` (
          \`belief_id\` text PRIMARY KEY NOT NULL,
          \`project_key\` text NOT NULL,
          \`version\` text NOT NULL,
          \`dim\` integer NOT NULL,
          \`values\` blob NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`memory_vector_project_idx\` ON \`memory_vector\` (\`project_key\`, \`version\`);`)
    })
  },
}

export default migration
