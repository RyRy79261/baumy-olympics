import "server-only";

import { z } from "zod";
import { now } from "@/lib/clock";
import { redactSecrets } from "@/lib/redact";
import { isTestMode } from "@/lib/test-mode";
import { downWhenAsked, memoryBrain } from "./brain-memory";

// baumy-brain's kitchen shopping API (SPEC §3.4, §6.6, ADR 0003, issue #26).
// Brain owns the house shopping list (`baumy_list_items`); Telegram and the
// kitchen screen read and write the same rows through it:
//
//   GET  {BRAIN_BASE_URL}/api/kitchen/shopping           → { ok, items }
//   POST {BRAIN_BASE_URL}/api/kitchen/shopping/add       { items } → { ok, added, already, items }
//   POST {BRAIN_BASE_URL}/api/kitchen/shopping/checkoff  { items } → { ok, checkedOff, notFound, items }
//
//   POST {BRAIN_BASE_URL}/api/kitchen/login-approval  { requestId, telegramUserId, device, choices, expiresAt, purpose? } → { ok, sent }
//
// all with `Authorization: Bearer $KITCHEN_API_TOKEN`. The last one (issue
// #80) asks brain to DM a member "Sign in on <device>? Tap the number on the
// screen" with the five numbers (the right one and four decoys) and Deny as buttons; the tap comes back
// through `/api/v1/actions` (`approve_login`, `deny_login`). With
// `purpose: "step_up"` (issue #135) the member is already signed in there and
// is confirming it is them, so the DM says "Confirm it's you on <device>?"
// instead; the buttons are the same. Brain scopes the house
// itself; nothing here names it. Its 503 `not_configured` means the bot is
// not in the house group yet.
//
// Like every integration (AGENTS.md "Integrations"):
// - Every call returns a result union (`ok`, `not_configured`,
//   `unavailable`) and never throws. A failure is logged with its HTTP
//   status only, never brain's body or the token.
// - Every request has a 5s timeout.
// - The list is cached for 30 seconds per server. Any write of ours clears
//   it, so the page shows our change at once; the kitchen screen's periodic
//   refresh clears it too (`forgetShoppingReads`, called by the kiosk home),
//   so something added in Telegram shows there within the minute.
// - Which brain: the in-memory fake under E2E_TEST_MODE=1
//   (brain-memory.ts), the real one when BRAIN_BASE_URL and
//   KITCHEN_API_TOKEN are both set, and otherwise one that answers
//   `not_configured` to everything.

/** How long each brain request may take. */
export const BRAIN_TIMEOUT_MS = 5000;
/** How long one read of the list is reused, per server instance. */
export const SHOPPING_CACHE_MS = 30_000;

export type BrainFailureReason = "not_configured" | "unavailable";

export interface BrainFailure {
  ok: false;
  reason: BrainFailureReason;
}

export type BrainResult<T> = { ok: true; data: T } | BrainFailure;

/** One open item on the list. */
export interface ShoppingEntry {
  id: string;
  item: string;
  /** When it was added, ISO 8601. */
  addedAt: string;
}

export interface ShoppingAddResult {
  /** What was new. */
  added: string[];
  /** What was on the list already (re-adding is a no-op). */
  already: string[];
  /** The open list after the write. */
  items: ShoppingEntry[];
}

export interface ShoppingCheckOffResult {
  checkedOff: string[];
  /** Named but not on the list (or not one clear match). */
  notFound: string[];
  items: ShoppingEntry[];
}

/** What brain DMs a member for "Sign in with Baumy" (issue #80). */
export interface LoginApprovalMessage {
  /** The login request's id; the buttons send it back with the number. */
  requestId: string;
  /** The member's linked Telegram account: the DM goes there only. */
  telegramUserId: number;
  /** "Chrome on macOS". */
  device: string;
  /** The number on the screen and four decoys, in button order. */
  choices: number[];
  /** When the request stops being answerable, ISO 8601. */
  expiresAt: string;
  /**
   * `sign_in` (the default when absent): "Sign in on <device>?".
   * `step_up` (issue #135): the member is already signed in there and is
   * confirming it is them: "Confirm it's you on <device>?". Either way the
   * buttons are the same and send `approve_login` / `deny_login`.
   */
  purpose?: "sign_in" | "step_up";
}

/** The shopping list and the sign-in DM, whichever brain this environment talks to. */
export interface BrainClient {
  /** The open items, oldest first. */
  listShopping(): Promise<BrainResult<ShoppingEntry[]>>;
  addShopping(items: string[]): Promise<BrainResult<ShoppingAddResult>>;
  checkOffShopping(
    items: string[],
  ): Promise<BrainResult<ShoppingCheckOffResult>>;
  /** DM the approval buttons; `sent` is false when brain knows no such member. */
  requestLoginApproval(
    message: LoginApprovalMessage,
  ): Promise<BrainResult<{ sent: boolean }>>;
}

// --- Configuration -----------------------------------------------------------

export type EnvBag = Readonly<Record<string, string | undefined>>;

export interface BrainConfig {
  /** No trailing slash. */
  baseUrl: string;
  token: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Brain's address and the kitchen token, or null when either is unset or the
 * address is not https (http is allowed for localhost only).
 */
export function brainConfig(env: EnvBag): BrainConfig | null {
  const raw = env.BRAIN_BASE_URL?.trim();
  const token = env.KITCHEN_API_TOKEN?.trim();
  if (!raw || !token) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // The token rides in every request, so plain http only to this machine.
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    return null;
  }
  if (url.search || url.hash || url.username || url.password) return null;
  return { baseUrl: url.href.replace(/\/+$/, ""), token };
}

// --- Brain's answers ---------------------------------------------------------

const Item = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  item: z.string(),
  createdAt: z.string(),
});
const Items = z.array(Item);

const ListAnswer = z.object({ ok: z.literal(true), items: Items });
const AddAnswer = z.object({
  ok: z.literal(true),
  added: z.array(z.string()),
  already: z.array(z.string()),
  items: Items,
});
const CheckOffAnswer = z.object({
  ok: z.literal(true),
  checkedOff: z.array(z.string()),
  notFound: z.array(z.string()),
  items: Items,
});

const LoginApprovalAnswer = z.object({
  ok: z.literal(true),
  sent: z.boolean(),
});

function entries(items: z.output<typeof Items>): ShoppingEntry[] {
  return items.map((i) => ({ id: i.id, item: i.item, addedAt: i.createdAt }));
}

// --- The read cache (per server, shared by every route bundle) --------------

const CACHE_KEY = Symbol.for("baumy.brain.shopping");
type Cache = { at: number; items: ShoppingEntry[] } | null;
type CacheGlobal = typeof globalThis & { [CACHE_KEY]?: Cache };

function readCache(): Cache {
  return (globalThis as CacheGlobal)[CACHE_KEY] ?? null;
}

function writeCache(value: Cache): void {
  (globalThis as CacheGlobal)[CACHE_KEY] = value;
}

/**
 * Forget the cached list, so the next read asks brain. Our writes call it;
 * so does the kitchen screen's periodic refresh (SPEC §8).
 */
export function forgetShoppingReads(): void {
  writeCache(null);
}

/**
 * `inner` with the 30s read cache in front. Only a good answer is kept; a
 * write clears it whatever it returns, since a write that timed out may still
 * have reached brain.
 */
export function cachedBrain(
  inner: BrainClient,
  clock: () => number = () => now().getTime(),
): BrainClient {
  return {
    async listShopping() {
      const hit = readCache();
      if (hit && clock() - hit.at < SHOPPING_CACHE_MS) {
        return { ok: true, data: hit.items };
      }
      const read = await inner.listShopping();
      if (read.ok) writeCache({ at: clock(), items: read.data });
      return read;
    },
    async addShopping(items) {
      try {
        return await inner.addShopping(items);
      } finally {
        forgetShoppingReads();
      }
    },
    async checkOffShopping(items) {
      try {
        return await inner.checkOffShopping(items);
      } finally {
        forgetShoppingReads();
      }
    },
    requestLoginApproval: (message) => inner.requestLoginApproval(message),
  };
}

// --- The client ----------------------------------------------------------------

export interface HttpBrainDeps {
  fetch: typeof fetch;
  timeoutMs: number;
  /** For scrubbing log lines. */
  env: EnvBag;
  log: (line: string) => void;
}

/** A failed request: the HTTP status and nothing else. */
class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

class NotConfigured extends Error {}

class BadAnswer extends Error {}

/** The real brain, over HTTP. */
export function httpBrain(
  config: BrainConfig,
  deps: Partial<HttpBrainDeps> = {},
): BrainClient {
  const d: HttpBrainDeps = {
    fetch: deps.fetch ?? ((...a) => fetch(...a)),
    timeoutMs: deps.timeoutMs ?? BRAIN_TIMEOUT_MS,
    env: deps.env ?? process.env,
    log: deps.log ?? ((line) => console.error(line)),
  };

  function logFailure(op: string, error: unknown): void {
    let text: string;
    if (error instanceof HttpError) {
      text = error.message;
      if (error.status === 401) {
        text +=
          " (check that KITCHEN_API_TOKEN is the same here and in baumy-brain)";
      }
    } else if (error instanceof NotConfigured) {
      text = "brain is not in the house group yet (503 not_configured)";
    } else if (error instanceof BadAnswer) {
      text = "brain answered in a shape this app does not know";
    } else if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      text = "timed out";
    } else {
      const message = error instanceof Error ? error.message : String(error);
      text = redactSecrets(message, d.env)
        .split(config.token)
        .join("[redacted]");
    }
    d.log(`[brain] ${op} failed: ${text}`);
  }

  async function call<T>(
    op: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<BrainResult<T>> {
    try {
      const res = await d.fetch(`${config.baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        signal: AbortSignal.timeout(d.timeoutMs),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (res.status === 503) {
        const answer = (await res.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        if (answer?.error === "not_configured") throw new NotConfigured();
      }
      if (!res.ok) throw new HttpError(res.status);
      const parsed = schema.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw new BadAnswer();
      return { ok: true, data: parsed.data };
    } catch (error) {
      logFailure(op, error);
      return {
        ok: false,
        reason:
          error instanceof NotConfigured ? "not_configured" : "unavailable",
      };
    }
  }

  return {
    async listShopping() {
      const r = await call("list", "/api/kitchen/shopping", ListAnswer);
      return r.ok ? { ok: true, data: entries(r.data.items) } : r;
    },
    async addShopping(items) {
      const r = await call("add", "/api/kitchen/shopping/add", AddAnswer, {
        items,
      });
      return r.ok
        ? {
            ok: true,
            data: {
              added: r.data.added,
              already: r.data.already,
              items: entries(r.data.items),
            },
          }
        : r;
    },
    async checkOffShopping(items) {
      const r = await call(
        "checkoff",
        "/api/kitchen/shopping/checkoff",
        CheckOffAnswer,
        { items },
      );
      return r.ok
        ? {
            ok: true,
            data: {
              checkedOff: r.data.checkedOff,
              notFound: r.data.notFound,
              items: entries(r.data.items),
            },
          }
        : r;
    },
    async requestLoginApproval(message) {
      const r = await call(
        "login-approval",
        "/api/kitchen/login-approval",
        LoginApprovalAnswer,
        message,
      );
      return r.ok ? { ok: true, data: { sent: r.data.sent } } : r;
    },
  };
}

// --- Which brain -----------------------------------------------------------

const NOT_CONFIGURED = { ok: false, reason: "not_configured" } as const;

export const unconfiguredBrain: BrainClient = {
  listShopping: async () => NOT_CONFIGURED,
  addShopping: async () => NOT_CONFIGURED,
  checkOffShopping: async () => NOT_CONFIGURED,
  requestLoginApproval: async () => NOT_CONFIGURED,
};

let override: BrainClient | null = null;

/** Unit tests only: answer with this client (no cache) until reset with null. */
export function setBrainClientForTests(client: BrainClient | null): void {
  override = client;
}

export function brainClient(env: EnvBag = process.env): BrainClient {
  if (override) return override;
  if (isTestMode(env)) return downWhenAsked(cachedBrain(memoryBrain()));
  const config = brainConfig(env);
  return config ? cachedBrain(httpBrain(config, { env })) : unconfiguredBrain;
}
