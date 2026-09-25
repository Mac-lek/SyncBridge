import type { Config } from "drizzle-kit";
import { loadEnv } from "./src/config/env";

const env = loadEnv();

export default {
  schema: "./src/infra/db/schema.ts",
  out: "./src/infra/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: env.DATABASE_URL },
} satisfies Config;
