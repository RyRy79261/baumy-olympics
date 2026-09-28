import { createHash } from "node:crypto";
import type { LoginRequestState } from "@baumy/db/login-requests";
import { LoginApprovalStart } from "@baumy/types";
import { rejectCrossSite } from "@/lib/http/origin";
import type {
  BrainResult,
  LoginApprovalMessage,
} from "@/lib/integrations/brain";
import { getClientIp, type RateLimiter } from "@/lib/rate-limit";
import { pickLoginCodes, type RandomInt } from "./codes";
import { deviceLabel } from "./device";

// "Sign in with Baumy" (issue #80, ADR 0006): the three routes the sign-in
// page talks to. They are a sign-in, like Better Auth's own, not actions:
// nobody is signed in yet. The member's decision IS an action
// (`approve_login` / `deny_login`, from brain's buttons).
//
//   POST /api/login-approval/start     { email } → { code, expiresAt } + cookie
//   GET  /api/login-approval/status    → { status }
//   POST /api/login-approval/exchange  → the session cookie, once
//
// - Enumeration-safe: every well-formed address gets the same answer (a
//   number on the screen and "if this account is linked, Baumy has sent you
//   a message"), a stored request and the same cookie. Only an active member
//   with a linked Telegram account, not locked by a recent wrong tap, is
//   actually messaged, and the message goes out after the response
//   (`afterResponse`), so its time does not show either. The limits are per
//   address and per IP, so they cannot tell accounts apart.
// - Browser-bound: the browser gets 32 random bytes in an httpOnly,
//   SameSite=Strict cookie scoped to these routes; only its sha256 is
//   stored. Nothing secret ever goes in a URL.
// - Single use: the exchange claims the approved request with one
//   `UPDATE … RETURNING`, then Better Auth makes the session.

export const LOGIN_COOKIE = "baumy_login_request";
export const LOGIN_COOKIE_PATH = "/api/login-approval";

/** The cookie outlives the request by the exchange grace, then goes. */
export const LOGIN_COOKIE_MAX_AGE_S = 150;

/** Per IP, per address: generous for a person, tight for a script. */
export const START_LIMITS = {
  ip: { limit: 30, windowMs: 10 * 60_000 },
  email: { limit: 5, windowMs: 10 * 60_000 },
};
export const EXCHANGE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };

/** What the screen says while it waits, for every address. */
export const NEUTRAL_MESSAGE =
  "If this account is linked to Telegram, Baumy has sent you a message. Tap the number shown here.";

export interface LoginCandidate {
  memberId: string;
  authUserId: string;
  telegramUserId: number;
}

export interface NewRequest {
  memberId: string | null;
  secret: string;
  code: number;
  choices: number[];
  device: string;
  now: Date;
  /** Only for a real candidate: the audit row written with the request. */
  audit?: { ip: string };
}

export interface LoginApprovalDeps {
  now: () => Date;
  rateLimiter: RateLimiter;
  randomInt: RandomInt;
  randomSecret: () => string;
  findCandidate: (email: string) => Promise<LoginCandidate | null>;
  isLocked: (memberId: string, now: Date) => Promise<boolean>;
  /** Stores the request (and its audit row) in one transaction. */
  createRequest: (
    input: NewRequest,
  ) => Promise<{ id: string; expiresAt: Date }>;
  findBySecret: (
    secret: string,
    now: Date,
  ) => Promise<{ id: string; state: LoginRequestState } | null>;
  claim: (
    secret: string,
    now: Date,
  ) => Promise<{ requestId: string; authUserId: string } | null>;
  sendApproval: (
    message: LoginApprovalMessage,
  ) => Promise<BrainResult<{ sent: boolean }>>;
  /** Runs `fn` once the response has gone (Next's `after`). */
  afterResponse: (fn: () => Promise<void>) => void;
  /** Better Auth's session for this user: the `Set-Cookie` values. */
  signIn: (authUserId: string, headers: Headers) => Promise<string[]>;
  /** Whether auth may serve on this deployment (`authMayServe`). */
  authMayServe: () => boolean;
  logError: (message: string, err?: unknown) => void;
}

const NO_STORE = { "cache-control": "no-store" };

/** No member has it: the lock lookup for an address without one. */
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set("cache-control", "no-store");
  return Response.json(body, { status, headers: h });
}

function refusal(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
  headers?: HeadersInit,
): Response {
  return json({ ok: false, code, message, ...extra }, status, headers);
}

const CLOSED = () =>
  refusal(
    503,
    "NOT_CONFIGURED",
    "Sign-in is switched off on this deployment until BETTER_AUTH_SECRET is set.",
  );

/** `Set-Cookie` for the browser's secret, or to clear it (`maxAge` 0). */
export function loginCookie(value: string, maxAge: number): string {
  return [
    `${LOGIN_COOKIE}=${value}`,
    `Path=${LOGIN_COOKIE_PATH}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

/** The secret this browser holds, or null. */
export function readLoginCookie(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === LOGIN_COOKIE) {
      const value = rest.join("=");
      // 32 bytes of base64url are 43 characters; refuse anything odd.
      return /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : null;
    }
  }
  return null;
}

/** The address's rate-limit key: a hash, so the key never holds it. */
function emailKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

async function limited(
  deps: LoginApprovalDeps,
  key: string,
  opts: { limit: number; windowMs: number },
): Promise<Response | null> {
  const rl = await deps.rateLimiter.limit(key, opts);
  if (rl.ok) return null;
  return refusal(
    429,
    "RATE_LIMITED",
    `Too many sign-in requests. Wait ${rl.retryAfterSeconds}s and try again.`,
    { retryAfterSeconds: rl.retryAfterSeconds },
    { "retry-after": String(rl.retryAfterSeconds) },
  );
}

/** POST /api/login-approval/start */
export async function handleStart(
  req: Request,
  deps: LoginApprovalDeps,
): Promise<Response> {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  if (!deps.authMayServe()) return CLOSED();
  try {
    const parsed = LoginApprovalStart.safeParse(
      await req.json().catch(() => null),
    );
    if (!parsed.success) {
      return refusal(400, "INVALID_INPUT", "Enter a valid email.", {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.map(String),
          message: i.message,
        })),
      });
    }
    const { email } = parsed.data;
    const ip = getClientIp(req.headers);
    const tooMany =
      (await limited(deps, `login-approval:ip:${ip}`, START_LIMITS.ip)) ??
      (await limited(
        deps,
        `login-approval:email:${emailKey(email)}`,
        START_LIMITS.email,
      ));
    if (tooMany) return tooMany;

    const now = deps.now();
    const found = await deps.findCandidate(email);
    // Asked for everyone, so an address with a member takes no longer.
    const locked = await deps.isLocked(found?.memberId ?? NIL_UUID, now);
    const candidate = found && !locked ? found : null;
    const { code, choices } = pickLoginCodes(deps.randomInt);
    const secret = deps.randomSecret();
    const device = deviceLabel(req.headers.get("user-agent"));
    const request = await deps.createRequest({
      memberId: candidate?.memberId ?? null,
      secret,
      code,
      choices,
      device,
      now,
      ...(candidate ? { audit: { ip } } : {}),
    });

    if (candidate) {
      deps.afterResponse(async () => {
        const sent = await deps.sendApproval({
          requestId: request.id,
          telegramUserId: candidate.telegramUserId,
          device,
          choices,
          expiresAt: request.expiresAt.toISOString(),
        });
        if (!sent.ok || !sent.data.sent) {
          // The screen stays neutral; the password still works.
          deps.logError(
            `[login-approval] brain did not send the approval DM (${sent.ok ? "unknown member" : sent.reason})`,
          );
        }
      });
    }

    return json(
      {
        ok: true,
        code,
        expiresAt: request.expiresAt.toISOString(),
        message: NEUTRAL_MESSAGE,
      },
      200,
      { "set-cookie": loginCookie(secret, LOGIN_COOKIE_MAX_AGE_S) },
    );
  } catch (err) {
    deps.logError("[login-approval] start failed", err);
    return refusal(500, "INTERNAL", "Something went wrong. Please try again.");
  }
}

/** GET /api/login-approval/status */
export async function handleStatus(
  req: Request,
  deps: LoginApprovalDeps,
): Promise<Response> {
  try {
    const secret = readLoginCookie(req);
    const found = secret ? await deps.findBySecret(secret, deps.now()) : null;
    // No cookie (it lapsed) or no row reads as expired: start again.
    return json({ ok: true, status: found?.state ?? "expired" });
  } catch (err) {
    deps.logError("[login-approval] status failed", err);
    return refusal(500, "INTERNAL", "Something went wrong. Please try again.");
  }
}

/** POST /api/login-approval/exchange */
export async function handleExchange(
  req: Request,
  deps: LoginApprovalDeps,
): Promise<Response> {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  if (!deps.authMayServe()) return CLOSED();
  try {
    const tooMany = await limited(
      deps,
      `login-approval:exchange:${getClientIp(req.headers)}`,
      EXCHANGE_LIMIT,
    );
    if (tooMany) return tooMany;
    const secret = readLoginCookie(req);
    const claimed = secret ? await deps.claim(secret, deps.now()) : null;
    if (!claimed) {
      return refusal(
        409,
        "INVALID_STATE",
        "This sign-in was not approved, or it was already used. Start again.",
        {},
        { "set-cookie": loginCookie("", 0) },
      );
    }
    const cookies = await deps.signIn(claimed.authUserId, req.headers);
    const headers = new Headers(NO_STORE);
    for (const c of cookies) headers.append("set-cookie", c);
    headers.append("set-cookie", loginCookie("", 0));
    return Response.json({ ok: true }, { status: 200, headers });
  } catch (err) {
    deps.logError("[login-approval] exchange failed", err);
    return refusal(500, "INTERNAL", "Something went wrong. Please try again.");
  }
}
