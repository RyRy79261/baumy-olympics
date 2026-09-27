// `db:migrate`: apply every committed migration to DATABASE_URL_UNPOOLED.
//
// Runs on every Vercel deploy (apps/web `vercel-build`), and by hand. The
// guard in src/migrate-guard.ts decides first: on a preview it refuses to
// touch the production host (ADR 0004). Only the host is ever logged, never
// the connection string.
//
// Uses the app's own Neon WebSocket driver, like scripts/migrate-local.ts, so
// NEON_LOCAL_PROXY=1 reaches the Docker stack too.

import { fileURLToPath } from "node:url";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { configureLocalProxy } from "../src/index";
import { planMigrate } from "../src/migrate-guard";

const plan = planMigrate(process.env);

if (plan.kind === "refuse") {
  console.error(`[migrate] refusing: ${plan.reason}`);
  process.exit(1);
}

console.log(
  `[migrate] VERCEL_ENV=${process.env.VERCEL_ENV || "(unset)"}, target host: ${plan.host}`,
);

configureLocalProxy();
const pool = new Pool({ connectionString: plan.connectionString });
try {
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
  });
  console.log(`[migrate] ${plan.host} is up to date.`);
} finally {
  await pool.end();
}
