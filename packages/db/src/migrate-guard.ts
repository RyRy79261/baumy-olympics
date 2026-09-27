// The preview migrate guard (ADR 0004, decision 6). Pure: it reads an env
// object and decides whether `db:migrate` may run and against which host. The
// script that acts on the decision is `scripts/migrate.ts`.
//
// Why it exists: the build runs `db:migrate && next build` on every Vercel
// deploy. A preview whose branch-scoped DATABASE_URL* are not in place yet
// falls back to the Preview-scope default, and if that default is (or ever
// becomes) the production connection string, a PR's unreviewed migration
// would run against production. afrikaburn's docs/deploy.md describes that
// default as "in practice production, or nothing". This guard makes the
// preview build fail instead.

type Env = Readonly<Record<string, string | undefined>>;

export type MigratePlan =
  | {
      kind: "run";
      /** The direct (unpooled) connection string. Never log it. */
      connectionString: string;
      /** Safe to log: the host only, no credentials. */
      host: string;
    }
  | { kind: "refuse"; reason: string };

/**
 * The lower-cased host of a postgres URL, without port or credentials, or
 * null when the string is not a postgres URL.
 */
export function connectionHost(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return null;
  }
  return parsed.hostname ? parsed.hostname.toLowerCase() : null;
}

/**
 * The host a Neon endpoint is known by, whichever form it was written in.
 *
 * Neon's pooled and direct hosts differ only by `-pooler` on the endpoint
 * label (`ep-x-pooler.eu-central-1.aws.neon.tech` against
 * `ep-x.eu-central-1.aws.neon.tech`), so both collapse to the direct form.
 * `PROD_DB_HOST` may also be pasted as a whole URL, or with a port.
 */
export function normalizeHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const host = trimmed.includes("://")
    ? (connectionHost(trimmed) ?? trimmed)
    : trimmed.replace(/:\d+$/, "");
  const [first = "", ...rest] = host.split(".");
  return [first.replace(/-pooler$/, ""), ...rest].join(".");
}

function isPoolerHost(host: string): boolean {
  const [first = ""] = host.split(".");
  return first.endsWith("-pooler");
}

/**
 * Decide whether `db:migrate` may run.
 *
 * - Always: `DATABASE_URL_UNPOOLED` must be a postgres URL, and not a Neon
 *   pooler host (a migration must not run through PgBouncer).
 * - `VERCEL_ENV=preview`: `PROD_DB_HOST` must be set (without it the guard
 *   cannot tell production apart, so it fails closed), and neither
 *   `DATABASE_URL_UNPOOLED` nor `DATABASE_URL` may point at it.
 * - `VERCEL_ENV=production`, local and CI: no host restriction. Production is
 *   meant to migrate the production database.
 */
export function planMigrate(env: Env): MigratePlan {
  const connectionString = env.DATABASE_URL_UNPOOLED?.trim() ?? "";
  const where = env.VERCEL_ENV
    ? `VERCEL_ENV=${env.VERCEL_ENV}`
    : "no VERCEL_ENV";

  if (!connectionString) {
    return {
      kind: "refuse",
      reason: `DATABASE_URL_UNPOOLED is not set (${where}). On a preview this means the Neon preview branch is not wired yet; see docs/deploy.md.`,
    };
  }

  const host = connectionHost(connectionString);
  if (!host) {
    return {
      kind: "refuse",
      reason: "DATABASE_URL_UNPOOLED is not a postgres:// URL.",
    };
  }

  if (isPoolerHost(host)) {
    return {
      kind: "refuse",
      reason: `DATABASE_URL_UNPOOLED points at a pooler (${host}). Use Neon's direct connection string.`,
    };
  }

  if (env.VERCEL_ENV === "preview") {
    const prod = env.PROD_DB_HOST?.trim() ?? "";
    if (!prod) {
      return {
        kind: "refuse",
        reason:
          "PROD_DB_HOST is not set, so this preview cannot prove it is not about to migrate production. Set it in the Vercel Preview scope; see docs/deploy.md.",
      };
    }
    const prodHost = normalizeHost(prod);
    if (normalizeHost(host) === prodHost) {
      return {
        kind: "refuse",
        reason: `DATABASE_URL_UNPOOLED on a preview points at the production host (${host}).`,
      };
    }
    const pooledHost = env.DATABASE_URL
      ? connectionHost(env.DATABASE_URL)
      : null;
    if (pooledHost && normalizeHost(pooledHost) === prodHost) {
      return {
        kind: "refuse",
        reason: `DATABASE_URL on a preview points at the production host (${pooledHost}).`,
      };
    }
  }

  return { kind: "run", connectionString, host };
}
