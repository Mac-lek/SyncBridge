import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import type { Env } from "../../config/env";

export type Database = NodePgDatabase<typeof schema>;

export function createDatabase(env: Env): { db: Database; pool: Pool } {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/**
 * Runs `fn` inside a single Postgres transaction. Everything `fn` does through
 * the `tx` handle it receives either all commits or all rolls back together --
 * this is what lets us treat "record the idempotency key" and "write the
 * domain row" as one atomic all-or-nothing unit (see schema.ts, processedEvents).
 */
export async function withTransaction<T>(
  db: Database,
  fn: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(fn);
}
