// Apply every committed migration to the local stack (docker-compose.local.yml)
// through the app's own pooled Neon driver. Ported from camp-404
// `packages/db/scripts/migrate-local.ts`. drizzle-kit migrate cannot reach the
// local stack: with only @neondatabase/serverless installed it opens a
// WebSocket straight to the database host, with no proxy.
//
//   pnpm db:local:migrate

import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { createPooledDb, isLocalProxy } from "../src/index";

// Under NEON_LOCAL_PROXY=1 both drivers can only reach the local proxies
// (src/index.ts), so this switch is what keeps the script off a real database.
if (!isLocalProxy() || !process.env.DATABASE_URL) {
  console.error(
    "Refusing: this script only migrates the local stack. Set NEON_LOCAL_PROXY=1 and DATABASE_URL (the root db:local:migrate script does).",
  );
  process.exit(1);
}

const { db, pool } = createPooledDb();
try {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
  });
  console.log("Local database is up to date.");
} finally {
  await pool.end();
}
