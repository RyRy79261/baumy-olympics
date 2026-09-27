// `db:seed`: give the household the starter chores of SPEC §4.7, once.
//
// Safe to run on every deploy and by hand: `seedStarterChores` adds them only
// when the household has no chores at all, so an admin's renames and
// archives are never undone. Runs after `db:migrate` in apps/web
// `vercel-build`, and from scripts/e2e-local.sh. Asks the same guard as
// `db:migrate` (src/migrate-guard.ts): on a preview it refuses the production
// host. Only the host is logged, never the connection string.

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { seedStarterChores } from "../src/chores";
import { HOUSEHOLD_ID } from "../src/household";
import { configureLocalProxy, type Queryable } from "../src/index";
import { planMigrate } from "../src/migrate-guard";
import * as schema from "../src/schema";

const plan = planMigrate(process.env);

if (plan.kind === "refuse") {
  console.error(`[seed] refusing: ${plan.reason}`);
  process.exit(1);
}

configureLocalProxy();
const pool = new Pool({ connectionString: plan.connectionString });
try {
  const db = drizzle(pool, { schema });
  const created = await db.transaction((tx) =>
    seedStarterChores(tx as unknown as Queryable, {
      householdId: HOUSEHOLD_ID,
      // Scripts have no request clock (apps/web lib/clock.ts); the seed's
      // rule versions start at this season's 1 Jan either way.
      now: new Date(),
    }),
  );
  console.log(
    created > 0
      ? `[seed] ${plan.host}: added ${created} starter chores.`
      : `[seed] ${plan.host}: the household already has chores; nothing to do.`,
  );
} finally {
  await pool.end();
}
