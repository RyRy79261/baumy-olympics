import { neonConfig } from "@neondatabase/serverless";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { NeonDatabase } from "drizzle-orm/neon-serverless";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILD_PLACEHOLDER_URL,
  LOCAL_PROXY,
  __setDbOverride,
  configureLocalProxy,
  createHttpDb,
  createPooledDb,
  databaseUrl,
  withTransaction,
  type Database,
  type PooledDatabase,
} from "../index";

// The driver factories without a database. Nothing here opens a connection:
// both Neon drivers connect lazily, on the first query.

afterEach(() => {
  vi.unstubAllEnvs();
  __setDbOverride(null);
});

describe("databaseUrl", () => {
  it("uses DATABASE_URL when it is set", () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@example.test/db");
    expect(databaseUrl()).toBe("postgres://u:p@example.test/db");
  });

  it("falls back to the build placeholder when it is unset or empty", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(databaseUrl()).toBe(BUILD_PLACEHOLDER_URL);
    delete process.env.DATABASE_URL;
    expect(databaseUrl()).toBe(BUILD_PLACEHOLDER_URL);
  });
});

describe("configureLocalProxy", () => {
  it("leaves the Neon config alone without NEON_LOCAL_PROXY=1", () => {
    vi.stubEnv("NEON_LOCAL_PROXY", "true");
    const before = neonConfig.fetchEndpoint;
    configureLocalProxy();
    expect(neonConfig.fetchEndpoint).toBe(before);
    expect(neonConfig.useSecureWebSocket).toBe(true);
  });

  it("sends both protocols to the fixed local proxies, whatever the URL host", () => {
    vi.stubEnv("NEON_LOCAL_PROXY", "1");
    configureLocalProxy();
    const ws = neonConfig.wsProxy as (host: string, port: number) => string;
    const http = neonConfig.fetchEndpoint as (
      host: string,
      port: number | string,
      options?: unknown,
    ) => string;
    expect(ws("ep-cool-name.neon.tech", 5432)).toBe(
      `localhost:${LOCAL_PROXY.wsPort}/v1`,
    );
    expect(http("ep-cool-name.neon.tech", 443)).toBe(
      `http://localhost:${LOCAL_PROXY.httpPort}/sql`,
    );
    expect(neonConfig.useSecureWebSocket).toBe(false);
    expect(neonConfig.pipelineConnect).toBe(false);
  });
});

describe("createHttpDb", () => {
  it("is the Neon HTTP driver in production", () => {
    vi.stubEnv("NEON_LOCAL_PROXY", "");
    expect(createHttpDb()).toBeInstanceOf(NeonHttpDatabase);
  });

  it("reads over one shared WebSocket pool under NEON_LOCAL_PROXY=1", async () => {
    vi.stubEnv("NEON_LOCAL_PROXY", "1");
    const a = createHttpDb();
    const b = createHttpDb();
    expect(a).toBeInstanceOf(NeonDatabase);
    const clientOf = (db: Database) =>
      (db as unknown as { $client: PooledDatabase["pool"] }).$client;
    expect(clientOf(a)).toBe(clientOf(b));
    // An error on an idle pooled client must not take the process down.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    clientOf(a).emit("error", new Error("dropped"));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns the test override when one is set", () => {
    const http = {} as Database;
    __setDbOverride({ http, pooled: {} as PooledDatabase });
    expect(createHttpDb()).toBe(http);
  });
});

describe("createPooledDb", () => {
  it("builds a fresh pool per call", async () => {
    const a = createPooledDb();
    const b = createPooledDb();
    expect(a.db).toBeInstanceOf(NeonDatabase);
    expect(a.pool).not.toBe(b.pool);
    await Promise.all([a.pool.end(), b.pool.end()]);
  });
});

describe("withTransaction", () => {
  function fakePooled(transaction: (fn: () => unknown) => unknown) {
    const end = vi.fn(async () => {});
    __setDbOverride({
      http: {} as Database,
      pooled: {
        db: { transaction } as unknown as PooledDatabase["db"],
        pool: { end } as unknown as PooledDatabase["pool"],
      },
    });
    return end;
  }

  it("returns the callback's result and closes the pool", async () => {
    const end = fakePooled((fn) => fn());
    expect(await withTransaction(async () => 7)).toBe(7);
    expect(end).toHaveBeenCalledOnce();
  });

  it("closes the pool when the transaction throws", async () => {
    const end = fakePooled(() => Promise.reject(new Error("rolled back")));
    await expect(withTransaction(async () => 7)).rejects.toThrow("rolled back");
    expect(end).toHaveBeenCalledOnce();
  });
});
