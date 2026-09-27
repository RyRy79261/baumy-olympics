import { neon, neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzleServerless } from "drizzle-orm/neon-serverless";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

// Ported from camp-404 `packages/db/src/index.ts`, with afrikaburn's
// (origin/main `packages/db/src/index.ts`, `local-proxy.ts`) local proxy
// switch: fixed local proxy addresses, and HTTP reads over the WebSocket pool.

export * as schema from "./schema";

export type Database = NeonHttpDatabase<typeof schema>;
export type PooledDatabase = { db: NeonDatabase<typeof schema>; pool: Pool };

/**
 * Anything that runs queries against our schema: the HTTP driver, the pooled
 * driver or a transaction handle. For code that takes the caller's handle
 * (AGENTS.md "Domain functions take the caller's tx") and must not care which.
 */
export type Queryable = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Used when DATABASE_URL is unset, for example during `next build`'s
 * page-data collection without secrets. Nothing listens there, so any real
 * query fails loudly instead of reaching a database by accident.
 */
export const BUILD_PLACEHOLDER_URL =
  "postgres://build:build@localhost:5432/build?sslmode=disable";

export function databaseUrl(): string {
  return process.env.DATABASE_URL || BUILD_PLACEHOLDER_URL;
}

/** Where docker-compose.local.yml publishes the two Neon proxies. */
export const LOCAL_PROXY = {
  host: "localhost",
  /** neondatabase/wsproxy: WebSocket, for the pooled driver. */
  wsPort: 5433,
  /** local-neon-http-proxy: SQL over HTTP, for the stateless driver. */
  httpPort: 4444,
} as const;

export function isLocalProxy(): boolean {
  return process.env.NEON_LOCAL_PROXY === "1";
}

/**
 * With NEON_LOCAL_PROXY=1, point BOTH Neon protocols at the local proxies.
 *
 * The proxy addresses are fixed, not derived from the host in DATABASE_URL:
 * that host is resolved by the proxy (inside the compose network), while the
 * proxy address is resolved by this process. The function form of `wsProxy`
 * also means the driver sends no `?address=`, so wsproxy connects only to the
 * compose Postgres it was started with. Under the switch nothing can reach a
 * remote database.
 */
export function configureLocalProxy(): void {
  if (!isLocalProxy()) return;
  const { host, wsPort, httpPort } = LOCAL_PROXY;
  neonConfig.wsProxy = () => `${host}:${wsPort}/v1`;
  neonConfig.fetchEndpoint = () => `http://${host}:${httpPort}/sql`;
  // The proxies speak plain ws/http; the driver must not try TLS on top.
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
}

// Test-only seam. Production never calls __setDbOverride, so these stay null.
// The PGlite harness (src/__tests__/_harness.ts) injects one in-process handle
// that serves both the HTTP path and the transactional pooled path.
let httpOverride: Database | null = null;
let pooledOverride: PooledDatabase | null = null;

/** @internal test-only: inject a db handle for both paths, or clear with null. */
export function __setDbOverride(
  override: { http: Database; pooled: PooledDatabase } | null,
): void {
  httpOverride = override?.http ?? null;
  pooledOverride = override?.pooled ?? null;
}

/** Process-wide, so a `createHttpDb()` per request costs nothing locally. */
let localReadPool: Pool | undefined;

function makeLocalReadPool(): Pool {
  const pool = new Pool({
    connectionString: databaseUrl(),
    max: 10,
    // A short script (migrate, seed) exits when done instead of being held
    // open by an idle pool.
    allowExitOnIdle: true,
  });
  // An error on an IDLE client is emitted on the pool, and an unhandled
  // 'error' event kills the process. A dropped local connection must not.
  pool.on("error", (err: Error) => {
    console.warn("[db] local read pool client error (ignored):", err.message);
  });
  return pool;
}

/**
 * The HTTP driver: stateless, for reads in route handlers and server
 * components. It has NO transactions; use `withTransaction` for writes that
 * span more than one statement.
 *
 * Under NEON_LOCAL_PROXY=1 (local dev, e2e, never a deploy) reads go over the
 * WebSocket proxy on one shared pool instead. afrikaburn measured the local
 * HTTP shim at about 150 ms per statement (a fresh backend per request) against
 * about 2 ms over WebSocket. Same drizzle API and SQL; only `execute()`'s
 * result shape differs (a pg Result instead of `{ rows }`, both carry `rows`).
 */
export function createHttpDb(): Database {
  if (httpOverride) return httpOverride;
  configureLocalProxy();
  if (isLocalProxy()) {
    localReadPool ??= makeLocalReadPool();
    return drizzleServerless(localReadPool, {
      schema,
    }) as unknown as Database;
  }
  return drizzleHttp(neon(databaseUrl()), { schema });
}

/**
 * The pooled WebSocket driver, for transactions. The caller closes the pool;
 * prefer `withTransaction`, which does.
 */
export function createPooledDb(): PooledDatabase {
  if (pooledOverride) return pooledOverride;
  configureLocalProxy();
  const pool = new Pool({ connectionString: databaseUrl() });
  const db = drizzleServerless(pool, { schema });
  return { db, pool };
}

/**
 * The handle a `db.transaction()` callback receives, derived from the pooled
 * driver so it cannot drift from the driver's real type.
 */
export type Tx = Parameters<
  Parameters<PooledDatabase["db"]["transaction"]>[0]
>[0];

/**
 * Run `fn` in one pooled transaction and always close the pool afterwards.
 * A throw from `fn` rolls back and propagates unchanged.
 */
export async function withTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const { db, pool } = createPooledDb();
  try {
    return await db.transaction(fn);
  } finally {
    await pool.end();
  }
}
