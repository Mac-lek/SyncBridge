import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadEnv } from "../../config/env";
import { createDatabase } from "./client";

async function main() {
  const env = loadEnv();
  const { db, pool } = createDatabase(env);
  await migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
  await pool.end();
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
