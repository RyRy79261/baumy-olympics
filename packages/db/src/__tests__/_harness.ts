import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, afterEach, beforeAll } from "vitest";
import * as schema from "../schema";
import { __setDbOverride, type Database, type PooledDatabase } from "../index";

// In-process Postgres (PGlite: real Postgres compiled to WASM) for the db
// suite. Ported from camp-404 `packages/db/src/__tests__/_harness.ts`.
//
// The committed migrations are replayed into a throwaway database, and the
// production modules are pointed at it through __setDbOverride, so the tests
// run the REAL queries against real Postgres (enums, ON CONFLICT, jsonb,
// transactions) with no Docker, no Neon and no secrets.

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../migrations", import.meta.url),
);

/**
 * Data a fresh database gets from the migrations, not from a test. Truncation
 * wipes it, so the reset re-runs these files and every test starts from the
 * same state a real deploy starts from.
 */
const SEED_MIGRATIONS = ["0001_seed_household.sql"];

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let client: PGlite | null = null;
let db: TestDb | null = null;

async function setup(): Promise<void> {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  // PGlite has transactions, so one handle backs both createHttpDb and
  // createPooledDb. The pool's only method anyone calls is end(), a no-op here.
  __setDbOverride({
    http: db as unknown as Database,
    pooled: {
      db: db as unknown as PooledDatabase["db"],
      pool: { end: async () => {} } as unknown as PooledDatabase["pool"],
    },
  });
}

async function teardown(): Promise<void> {
  __setDbOverride(null);
  await client?.close();
  client = null;
  db = null;
}

async function reset(): Promise<void> {
  if (!client) return;
  const res = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  if (res.rows.length > 0) {
    // The names come from the catalogue, not from input, and are quoted as
    // identifiers; TRUNCATE cannot take parameters. The migration journal
    // lives in the `drizzle` schema, so it survives.
    const list = res.rows.map((r) => `"public"."${r.tablename}"`).join(", ");
    await client.query(`truncate ${list} restart identity cascade`);
  }
  for (const file of SEED_MIGRATIONS) {
    await client.exec(readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8"));
  }
}

/**
 * Register the PGlite lifecycle for one test file: a freshly migrated database
 * for the file, reset to its migrated state after each test. Returns accessors
 * to the raw drizzle handle and client for arranging and asserting; the code
 * under test reaches the same database through createHttpDb/createPooledDb.
 */
export function useTestDb() {
  beforeAll(setup);
  afterEach(reset);
  afterAll(teardown);
  return {
    db: (): TestDb => {
      if (!db) throw new Error("test db not initialised");
      return db;
    },
    client: (): PGlite => {
      if (!client) throw new Error("test db not initialised");
      return client;
    },
  };
}
