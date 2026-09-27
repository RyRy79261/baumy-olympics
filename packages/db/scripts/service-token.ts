// `pnpm --filter @baumy/db service-token <command>`: mint, rotate, revoke or
// list the service tokens baumy-brain uses for /api/v1/actions (issue #27,
// docs/brain-integration.md). The commands live in src/service-token-cli.ts.
//
//   DATABASE_URL_UNPOOLED=… pnpm --filter @baumy/db --silent service-token mint baumy-brain
//
// The token is printed once, alone on stdout; put it in brain's env as
// BRAIN_SERVICE_TOKEN. Only its sha256 is stored here. Asks the same guard as
// `db:migrate` (src/migrate-guard.ts), so a preview never touches the
// production host, and logs the host only, never the connection string.

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { configureLocalProxy, type Queryable } from "../src/index";
import { planMigrate } from "../src/migrate-guard";
import * as schema from "../src/schema";
import { runServiceTokenCommand } from "../src/service-token-cli";

const plan = planMigrate(process.env);
if (plan.kind === "refuse") {
  console.error(`[service-token] refusing: ${plan.reason}`);
  process.exit(1);
}

configureLocalProxy();
const pool = new Pool({ connectionString: plan.connectionString });
let code: number;
try {
  const db = drizzle(pool, { schema });
  console.error(`[service-token] ${plan.host}`);
  code = await runServiceTokenCommand(process.argv.slice(2), {
    db: db as unknown as Queryable,
    transaction: (fn) => db.transaction((tx) => fn(tx as unknown as Queryable)),
    // Scripts have no request clock (apps/web lib/clock.ts).
    now: new Date(),
    io: {
      out: (line) => process.stdout.write(`${line}\n`),
      info: (line) => console.error(line),
    },
  });
} finally {
  await pool.end();
}
process.exit(code);
