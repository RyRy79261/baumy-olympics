import type { RequestCtx } from "@/lib/actions/define";
import {
  fail,
  type ActionErrorCode,
  type ActionFailure,
  type ActionResult,
} from "@/lib/actions/result";
import { REQUEST_ID_PATTERN } from "@/lib/actions/run";
import type { ToolSpec } from "@/lib/actions/tool-specs";
import type { ServiceActor } from "@/lib/auth";
import { getClientIp, type RateLimiter } from "@/lib/rate-limit";
import { BRAIN_SCOPE } from "@baumy/db/service-tokens";
import { TelegramUserId } from "@baumy/types";
import { z } from "zod";

// The brain endpoint (SPEC §6.3, §6.6, ADR 0003, issue #27): baumy-brain,
// the Telegram bot, calls the action registry over HTTP. It is only an
// adapter: every call is `runAction` with `source: "brain"`. The contract
// brain codes against is docs/brain-integration.md.
//
//   GET  /api/v1/actions         the brain tools (`toolSpecs("brain")`)
//   POST /api/v1/actions/{name}  run one, with the JSON body as its input
//
// Every request, in order:
//   1. `Authorization: Bearer <service token>`, looked up by hash (constant
//      time); missing, unknown or revoked → 401. The token needs the `brain`
//      scope → else 403.
//   2. a rate limit per token (all calls), → 429;
//   3. (POST) the action must be on the brain surface: unknown → 404
//      UNKNOWN_ACTION; admin-only or otherwise not offered to brain → 403
//      SURFACE_FORBIDDEN;
//   4. `X-Baumy-Actor: tg:<telegram user id>`, mapped to an active member
//      through `members.telegram_user_id` on every call. An unlinked user
//      gets 403 TELEGRAM_NOT_LINKED, except for `link_telegram`, where the
//      member comes from the code (and which has its own per-token bucket);
//   5. optional `X-Baumy-On-Behalf-Of: <member id>` (issue #70): the action
//      runs as that housemate, an active member of this household (else 404
//      NOT_FOUND), and the audit row names the asker as its initiator. Not
//      for `link_telegram`, nor for an action that names its member in its
//      input (`member_field`, e.g. log_completion's doneBy) → 400; a claim
//      event (`own_word_only`: confirm, dispute, undo, withdraw, concede)
//      → 403, so nobody confirms their own claim as a housemate;
//   6. a `confirm` or `destructive` action, and any write on someone's
//      behalf, needs `X-Baumy-Confirmed: 1`, which brain sends only after
//      the person tapped its inline confirm button → else 428
//      CONFIRMATION_REQUIRED;
//   7. a write needs `Idempotency-Key`, used as the `requestId`: the same key
//      again returns the stored result without running twice.
//
// Failures come back as `{ok: false, code, message}` plus only `issues`,
// `retryAt` and `retryAfterSeconds`; INTERNAL gets a fixed sentence and the
// detail goes to the server log.

export interface ServiceCaller {
  name: string;
  scopes: string[];
}

export interface BrainEndpointDeps {
  /** The live service token with this plaintext, or null. */
  verifyToken: (token: string) => Promise<ServiceCaller | null>;
  /** The active member linked to this Telegram user id, or null. */
  findMember: (
    telegramUserId: number,
  ) => Promise<{ id: string; role?: "admin" | "member" } | null>;
  /** The active member of this household with this id, or null. */
  findHousemate: (memberId: string) => Promise<{ id: string } | null>;
  /** `toolSpecs("brain")`: admin and UI-only actions already dropped. */
  specs: () => readonly ToolSpec[];
  /** Whether `name` is a registered action at all (registry.ts). */
  isAction: (name: string) => boolean;
  runAction: (
    name: string,
    input: unknown,
    ctx: RequestCtx,
  ) => Promise<ActionResult<unknown>>;
  rateLimiter: RateLimiter;
  householdId: string;
  /** lib/clock.ts `now`, never `new Date()`. */
  now: () => Date;
  logError: (message: string, err: unknown) => void;
}

/** Every call, per token. Brain serves one household; this is generous. */
export const TOKEN_RATE_LIMIT = { limit: 300, windowMs: 60_000 };

/**
 * `link_telegram`, per token, on top of its own per-Telegram-id limit: a
 * bot hammering wrong codes from many accounts still runs out.
 */
export const LINK_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };

export const LINK_ACTION = "link_telegram";

export const ACTOR_HEADER = "x-baumy-actor";
export const CONFIRMED_HEADER = "x-baumy-confirmed";
export const ON_BEHALF_HEADER = "x-baumy-on-behalf-of";
export const IDEMPOTENCY_HEADER = "idempotency-key";

export const GENERIC_ERROR = "Something went wrong. Please try again.";

/** Bodies larger than this are refused before parsing. */
const MAX_BODY_BYTES = 64 * 1024;

const STATUS: Partial<Record<ActionErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  SURFACE_FORBIDDEN: 403,
  TELEGRAM_NOT_LINKED: 403,
  ATTESTATION_REQUIRED: 403,
  ATTESTATION_FAILED: 403,
  PIN_LOCKED: 403,
  UNKNOWN_ACTION: 404,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  RATE_LIMITED: 429,
  CONFIRMATION_REQUIRED: 428,
  IDEMPOTENCY_CONFLICT: 409,
  IN_PROGRESS: 409,
  NOT_CONFIGURED: 503,
  UNAVAILABLE: 503,
  INTERNAL: 500,
};

/**
 * The HTTP status for a failure: the platform codes have their own, and a
 * domain refusal (COOLDOWN, LINK_CODE_INVALID, …) is 422: the request was
 * understood and the action said no.
 */
export function statusFor(code: ActionErrorCode): number {
  return STATUS[code] ?? 422;
}

const NO_STORE = { "cache-control": "no-store" };

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...extra } });
}

/** A failure as the response brain reads: only the fields meant for people. */
export function failureResponse(result: ActionFailure): Response {
  const body =
    result.code === "INTERNAL"
      ? { ok: false, code: "INTERNAL", message: GENERIC_ERROR }
      : {
          ok: false,
          code: result.code,
          message: result.message,
          ...(result.issues ? { issues: result.issues } : {}),
          ...(result.retryAt ? { retryAt: result.retryAt } : {}),
          ...(result.retryAfterSeconds !== undefined
            ? { retryAfterSeconds: result.retryAfterSeconds }
            : {}),
        };
  const extra: Record<string, string> = {};
  if (result.code === "UNAUTHENTICATED") {
    extra["www-authenticate"] = 'Bearer realm="baumy"';
  }
  if (result.retryAfterSeconds !== undefined) {
    extra["retry-after"] = String(result.retryAfterSeconds);
  }
  return json(body, statusFor(result.code), extra);
}

/** The bearer token of an `Authorization` header, or null. */
export function bearerToken(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return m?.[1] ?? null;
}

const MemberId = z.uuid();

/**
 * Whether the request must carry `X-Baumy-Confirmed: 1`: every action that
 * is not `safe`, and any write done on someone else's behalf.
 */
export function needsConfirmation(
  spec: Pick<ToolSpec, "kind" | "risk">,
  onBehalf: boolean,
): boolean {
  return spec.risk !== "safe" || (onBehalf && spec.kind === "write");
}

/** `tg:<id>` to the Telegram user id, or null when it is anything else. */
export function parseActor(header: string | null): number | null {
  const m = /^tg:(\S+)$/.exec(header?.trim() ?? "");
  if (!m) return null;
  const parsed = TelegramUserId.safeParse(m[1]);
  return parsed.success ? parsed.data : null;
}

async function limited(
  deps: BrainEndpointDeps,
  key: string,
  opts: { limit: number; windowMs: number },
): Promise<ActionFailure | null> {
  const rl = await deps.rateLimiter.limit(key, opts);
  return rl.ok
    ? null
    : fail(
        "RATE_LIMITED",
        `Too many requests. Wait ${rl.retryAfterSeconds}s and try again.`,
        { retryAfterSeconds: rl.retryAfterSeconds },
      );
}

/** Steps 1 and 2: the token, its scope and its rate limit. */
async function authenticate(
  req: Request,
  deps: BrainEndpointDeps,
): Promise<{ ok: true; caller: ServiceCaller } | ActionFailure> {
  const token = bearerToken(req.headers.get("authorization"));
  const caller = token ? await deps.verifyToken(token) : null;
  if (!caller) {
    return fail(
      "UNAUTHENTICATED",
      "The service token is missing, unknown or revoked.",
    );
  }
  if (!caller.scopes.includes(BRAIN_SCOPE)) {
    return fail("FORBIDDEN", "This token may not call the brain actions.");
  }
  const tooMany = await limited(
    deps,
    `brain:token:${caller.name}`,
    TOKEN_RATE_LIMIT,
  );
  return tooMany ?? { ok: true, caller };
}

/** The request body as the action's input: a JSON object, or `{}` if empty. */
async function readInput(
  req: Request,
): Promise<{ ok: true; input: unknown } | ActionFailure> {
  const bad = fail(
    "INVALID_INPUT",
    "The body must be a JSON object with the action's input.",
  );
  let text: string;
  try {
    text = await req.text();
  } catch {
    return bad;
  }
  if (text.length > MAX_BODY_BYTES) return bad;
  if (text.trim() === "") return { ok: true, input: {} };
  try {
    const input: unknown = JSON.parse(text);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return bad;
    }
    return { ok: true, input };
  } catch {
    return bad;
  }
}

/** GET /api/v1/actions: the tools brain may call, with their `risk`. */
export async function handleListActions(
  req: Request,
  deps: BrainEndpointDeps,
): Promise<Response> {
  try {
    const auth = await authenticate(req, deps);
    if (!auth.ok) return failureResponse(auth);
    return json({ ok: true, actions: deps.specs() });
  } catch (err) {
    deps.logError("[brain] listing the actions failed", err);
    return failureResponse(fail("INTERNAL", GENERIC_ERROR));
  }
}

/**
 * Step 5: the housemate named by `X-Baumy-On-Behalf-Of`, or null when the
 * header is absent or names the asker themself.
 */
async function onBehalfOf(
  req: Request,
  name: string,
  spec: ToolSpec,
  asker: { id: string } | null,
  deps: BrainEndpointDeps,
): Promise<{ ok: true; target: { id: string } | null } | ActionFailure> {
  const raw = req.headers.get(ON_BEHALF_HEADER)?.trim();
  if (!raw) return { ok: true, target: null };
  const issue = (message: string) =>
    fail("INVALID_INPUT", message, {
      issues: [{ path: [ON_BEHALF_HEADER], message }],
    });
  const linking = "Linking is always for the person who sent /link.";
  // An unlinked asker only gets this far for link_telegram, and has no id
  // of their own to name: refuse before looking anyone up.
  if (!asker) return issue(linking);
  const id = MemberId.safeParse(raw);
  if (!id.success) return issue("Expected a member id (a UUID).");
  // Postgres answers an upper-case uuid too: compare the row it found.
  const target = await deps.findHousemate(id.data.toLowerCase());
  if (!target) {
    return fail(
      "NOT_FOUND",
      "That person is not an active member of the household.",
    );
  }
  // The asker's own id counts as no header at all, for every action; the
  // refusals below are about acting for someone else.
  if (target.id === asker.id) return { ok: true, target: null };
  if (name === LINK_ACTION) return issue(linking);
  if (spec.own_word_only) {
    // Before the confirm check: no point asking for a tap that cannot help.
    return fail(
      "FORBIDDEN",
      `Only that housemate can ${spec.title.toLowerCase()} themself. Ask them to do it in the app or in Telegram.`,
    );
  }
  if (spec.member_field) {
    return issue(
      `${spec.title} names who it is for in ${spec.member_field}. Send that instead of X-Baumy-On-Behalf-Of.`,
    );
  }
  return { ok: true, target };
}

/** POST /api/v1/actions/{name}: run one action for a Telegram user. */
export async function handleBrainAction(
  req: Request,
  name: string,
  deps: BrainEndpointDeps,
): Promise<Response> {
  try {
    const auth = await authenticate(req, deps);
    if (!auth.ok) return failureResponse(auth);
    const { caller } = auth;

    // 3. Only the brain surface. The registry would say SURFACE_FORBIDDEN
    // too; saying it here keeps an unlinked user from learning more.
    const spec = deps.specs().find((s) => s.name === name);
    if (!spec) {
      return failureResponse(
        deps.isAction(name)
          ? fail("SURFACE_FORBIDDEN", "That action is not available to Baumy.")
          : fail("UNKNOWN_ACTION", `There is no action "${name}".`),
      );
    }

    // 4. Who is asking, on every call.
    const telegramUserId = parseActor(req.headers.get(ACTOR_HEADER));
    if (telegramUserId === null) {
      return failureResponse(
        fail("INVALID_INPUT", "Send X-Baumy-Actor: tg:<telegram user id>.", {
          issues: [{ path: [ACTOR_HEADER], message: "Expected tg:<digits>." }],
        }),
      );
    }
    const member = await deps.findMember(telegramUserId);
    if (!member && name !== LINK_ACTION) {
      return failureResponse(
        fail(
          "TELEGRAM_NOT_LINKED",
          "This Telegram account is not linked to a Baumy member. Create a code in Baumy's Settings and send /link with it.",
        ),
      );
    }
    if (name === LINK_ACTION) {
      const tooMany = await limited(
        deps,
        `brain:link:${caller.name}`,
        LINK_RATE_LIMIT,
      );
      if (tooMany) return failureResponse(tooMany);
    }

    // 5. On a housemate's behalf.
    const behalf = await onBehalfOf(req, name, spec, member, deps);
    if (!behalf.ok) return failureResponse(behalf);
    const target = behalf.target;

    // 6. The person confirmed it in Telegram.
    if (
      needsConfirmation(spec, target !== null) &&
      req.headers.get(CONFIRMED_HEADER)?.trim() !== "1"
    ) {
      return failureResponse(
        fail(
          "CONFIRMATION_REQUIRED",
          target
            ? "Doing this for a housemate needs the asker's confirmation first. Ask them, then send it again with X-Baumy-Confirmed: 1."
            : "Ask the person to confirm this first, then send it again with X-Baumy-Confirmed: 1.",
        ),
      );
    }

    // 7. Writes carry their idempotency key.
    const key = req.headers.get(IDEMPOTENCY_HEADER)?.trim() || undefined;
    if (spec.kind === "write" && !(key && REQUEST_ID_PATTERN.test(key))) {
      return failureResponse(
        fail(
          "INVALID_INPUT",
          "Send an Idempotency-Key header (8 to 128 of A-Z a-z 0-9 . _ : -) with every write.",
          {
            issues: [
              {
                path: [IDEMPOTENCY_HEADER],
                message: "An idempotency key is required.",
              },
            ],
          },
        ),
      );
    }

    const body = await readInput(req);
    if (!body.ok) return failureResponse(body);

    const actor: ServiceActor = {
      kind: "service",
      tokenName: caller.name,
      telegramUserId,
      ...(target
        ? { memberId: target.id, initiatorMemberId: member!.id }
        : member
          ? {
              memberId: member.id,
              ...(member.role ? { role: member.role } : {}),
            }
          : {}),
    };
    const result = await deps.runAction(name, body.input, {
      actor,
      source: "brain",
      householdId: deps.householdId,
      ...(key ? { requestId: key } : {}),
      ip: getClientIp(req.headers),
      now: deps.now(),
    });
    return result.ok
      ? json({ ok: true, data: result.data ?? null })
      : failureResponse(result);
  } catch (err) {
    deps.logError(`[brain] action ${name} threw`, err);
    return failureResponse(fail("INTERNAL", GENERIC_ERROR));
  }
}
