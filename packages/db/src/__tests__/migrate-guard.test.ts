import { describe, expect, it } from "vitest";
import { connectionHost, normalizeHost, planMigrate } from "../migrate-guard";

// ADR 0004, decision 6: on a preview, `db:migrate` must never reach the
// production database.

const PROD_DIRECT =
  "postgresql://owner:secret@ep-prod-123.eu-central-1.aws.neon.tech/baumy?sslmode=require";
const PROD_POOLED =
  "postgresql://owner:secret@ep-prod-123-pooler.eu-central-1.aws.neon.tech/baumy?sslmode=require";
const PREVIEW_DIRECT =
  "postgresql://owner:secret@ep-preview-456.eu-central-1.aws.neon.tech/baumy?sslmode=require";
const PREVIEW_POOLED =
  "postgresql://owner:secret@ep-preview-456-pooler.eu-central-1.aws.neon.tech/baumy?sslmode=require";
const PROD_HOST = "ep-prod-123.eu-central-1.aws.neon.tech";

function reason(plan: ReturnType<typeof planMigrate>): string {
  if (plan.kind !== "refuse") throw new Error("expected a refusal");
  return plan.reason;
}

describe("connectionHost", () => {
  it("returns the lower-cased host without port or credentials", () => {
    expect(connectionHost("postgres://u:p@EXAMPLE.test:5432/db")).toBe(
      "example.test",
    );
    expect(connectionHost(PROD_DIRECT)).toBe(PROD_HOST);
  });

  it("returns null for anything that is not a postgres URL", () => {
    expect(connectionHost("not a url")).toBeNull();
    expect(connectionHost("https://example.test/db")).toBeNull();
    expect(connectionHost("postgres:///db")).toBeNull();
  });
});

describe("normalizeHost", () => {
  it("maps a Neon pooler host onto its direct host", () => {
    expect(normalizeHost("ep-prod-123-pooler.eu-central-1.aws.neon.tech")).toBe(
      PROD_HOST,
    );
  });

  it("accepts a host with a port, a whole URL, and odd case", () => {
    expect(normalizeHost(` ${PROD_HOST.toUpperCase()}:5432 `)).toBe(PROD_HOST);
    expect(normalizeHost(PROD_POOLED)).toBe(PROD_HOST);
  });
});

describe("planMigrate: preview", () => {
  it("runs against a preview branch host and returns only that host to log", () => {
    const plan = planMigrate({
      VERCEL_ENV: "preview",
      PROD_DB_HOST: PROD_HOST,
      DATABASE_URL: PREVIEW_POOLED,
      DATABASE_URL_UNPOOLED: PREVIEW_DIRECT,
    });
    expect(plan).toEqual({
      kind: "run",
      connectionString: PREVIEW_DIRECT,
      host: "ep-preview-456.eu-central-1.aws.neon.tech",
    });
  });

  it("refuses when DATABASE_URL_UNPOOLED is the production host", () => {
    const plan = planMigrate({
      VERCEL_ENV: "preview",
      PROD_DB_HOST: PROD_HOST,
      DATABASE_URL_UNPOOLED: PROD_DIRECT,
    });
    expect(reason(plan)).toMatch(/production host/);
    // The refusal names the host but never the password.
    expect(reason(plan)).toContain(PROD_HOST);
    expect(reason(plan)).not.toContain("secret");
  });

  it("refuses when PROD_DB_HOST was written as the pooler host or a URL", () => {
    for (const prod of [
      "ep-prod-123-pooler.eu-central-1.aws.neon.tech",
      PROD_POOLED,
    ]) {
      const plan = planMigrate({
        VERCEL_ENV: "preview",
        PROD_DB_HOST: prod,
        DATABASE_URL_UNPOOLED: PROD_DIRECT,
      });
      expect(reason(plan)).toMatch(/production host/);
    }
  });

  it("refuses when only the pooled DATABASE_URL points at production", () => {
    const plan = planMigrate({
      VERCEL_ENV: "preview",
      PROD_DB_HOST: PROD_HOST,
      DATABASE_URL: PROD_POOLED,
      DATABASE_URL_UNPOOLED: PREVIEW_DIRECT,
    });
    expect(reason(plan)).toMatch(/DATABASE_URL on a preview/);
  });

  it("refuses when DATABASE_URL_UNPOOLED is unset or blank", () => {
    for (const url of [undefined, "", "   "]) {
      const plan = planMigrate({
        VERCEL_ENV: "preview",
        PROD_DB_HOST: PROD_HOST,
        DATABASE_URL_UNPOOLED: url,
      });
      expect(reason(plan)).toMatch(/DATABASE_URL_UNPOOLED is not set/);
    }
  });

  it("fails closed when PROD_DB_HOST is unset", () => {
    const plan = planMigrate({
      VERCEL_ENV: "preview",
      DATABASE_URL_UNPOOLED: PREVIEW_DIRECT,
    });
    expect(reason(plan)).toMatch(/PROD_DB_HOST is not set/);
  });
});

describe("planMigrate: production", () => {
  it("migrates the production host", () => {
    const plan = planMigrate({
      VERCEL_ENV: "production",
      PROD_DB_HOST: PROD_HOST,
      DATABASE_URL: PROD_POOLED,
      DATABASE_URL_UNPOOLED: PROD_DIRECT,
    });
    expect(plan).toEqual({
      kind: "run",
      connectionString: PROD_DIRECT,
      host: PROD_HOST,
    });
  });

  it("refuses without DATABASE_URL_UNPOOLED", () => {
    const plan = planMigrate({ VERCEL_ENV: "production" });
    expect(reason(plan)).toMatch(/DATABASE_URL_UNPOOLED is not set/);
  });
});

describe("planMigrate: any environment", () => {
  it("runs locally with no VERCEL_ENV and no PROD_DB_HOST", () => {
    const local = "postgres://postgres:postgres@localhost:54329/baumy";
    expect(planMigrate({ DATABASE_URL_UNPOOLED: local })).toEqual({
      kind: "run",
      connectionString: local,
      host: "localhost",
    });
  });

  it("refuses a pooler host, which a migration must not run through", () => {
    const plan = planMigrate({
      VERCEL_ENV: "production",
      DATABASE_URL_UNPOOLED: PROD_POOLED,
    });
    expect(reason(plan)).toMatch(/pooler/);
  });

  it("refuses a value that is not a postgres URL", () => {
    const plan = planMigrate({ DATABASE_URL_UNPOOLED: "ep-prod-123" });
    expect(reason(plan)).toMatch(/not a postgres/);
  });
});
