import type { Config } from "drizzle-kit";

// Copied from camp-404 `packages/db/drizzle.config.ts`. `strict` makes
// drizzle-kit ask before any statement that could lose data.
//
// `db:migrate` and `db:studio` talk to the direct (unpooled) endpoint: Neon's
// pooled URL is PgBouncer in transaction mode, which a migration must not run
// through. `db:generate` needs no database at all, which is what lets CI run
// the drift check without secrets.
export default {
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? "",
  },
  strict: true,
  verbose: true,
} satisfies Config;
