import type { Queryable } from "./index";
import {
  BRAIN_SCOPE,
  SERVICE_TOKEN_NAME,
  generateServiceToken,
  insertServiceToken,
  listServiceTokens,
  revokeServiceToken,
} from "./service-tokens";

// The commands of `pnpm --filter @baumy/db service-token` (issue #27), kept
// apart from scripts/service-token.ts so they run on PGlite in tests.
//
//   mint <name> [--scopes a,b]   a new token; printed ONCE, only its hash kept
//   rotate <name> [--scopes a,b] revoke the live one and mint a new one, at once
//   revoke <name>                the token stops working on its next request
//   list                         names, scopes and dates, never a token
//
// The token alone goes to `out` (stdout), so `$(… mint baumy-brain)` captures
// it; everything meant for a person goes to `info` (stderr).

export const SERVICE_TOKEN_USAGE = `Usage:
  service-token mint <name> [--scopes brain]
  service-token rotate <name> [--scopes brain]
  service-token revoke <name>
  service-token list`;

export interface CliIo {
  /** The token, and nothing else. */
  out: (line: string) => void;
  /** Everything a person reads. */
  info: (line: string) => void;
}

export interface CliDeps {
  db: Queryable;
  /** Runs `fn` in one transaction (rotate must not leave two or none). */
  transaction: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;
  now: Date;
  io: CliIo;
}

/** Parse `--scopes a,b`; the default is the brain scope. */
function parseScopes(args: string[]): string[] | null {
  const i = args.indexOf("--scopes");
  if (i < 0) return [BRAIN_SCOPE];
  const raw = args[i + 1];
  if (!raw) return null;
  const scopes = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return scopes.length > 0 && scopes.every((s) => /^[a-z0-9:_-]+$/.test(s))
    ? scopes
    : null;
}

/** Run one command. Returns the process exit code. */
export async function runServiceTokenCommand(
  argv: readonly string[],
  deps: CliDeps,
): Promise<number> {
  const [command, name, ...rest] = argv;
  const { io } = deps;

  if (command === "list") {
    const rows = await listServiceTokens(deps.db);
    if (rows.length === 0) io.info("No service tokens.");
    for (const r of rows) {
      io.info(
        `${r.name}\t${r.scopes.join(",")}\tminted ${r.createdAt.toISOString()}` +
          (r.revokedAt ? `\trevoked ${r.revokedAt.toISOString()}` : "\tlive"),
      );
    }
    return 0;
  }

  if (
    (command !== "mint" && command !== "rotate" && command !== "revoke") ||
    !name ||
    !SERVICE_TOKEN_NAME.test(name)
  ) {
    io.info(SERVICE_TOKEN_USAGE);
    return 2;
  }

  if (command === "revoke") {
    const revoked = await revokeServiceToken(deps.db, { name, now: deps.now });
    io.info(
      revoked
        ? `Revoked ${name}. It stops working on its next request.`
        : `No live token is called ${name}.`,
    );
    return revoked ? 0 : 1;
  }

  const scopes = parseScopes(rest);
  if (!scopes) {
    io.info(SERVICE_TOKEN_USAGE);
    return 2;
  }
  const token = generateServiceToken();
  const minted = await deps.transaction(async (tx) => {
    if (command === "rotate") {
      await revokeServiceToken(tx, { name, now: deps.now });
    }
    return insertServiceToken(tx, { name, token, scopes, now: deps.now });
  });
  if (!minted) {
    io.info(
      `A live token is already called ${name}. Use "rotate ${name}" to replace it, or "revoke ${name}" first.`,
    );
    return 1;
  }
  io.info(
    `Minted ${name} (${scopes.join(",")}). This is the only time the token is shown; only its hash is stored.`,
  );
  io.out(token);
  return 0;
}
