import { hashKioskToken } from "@baumy/db/kiosk-devices";
import type { KioskPairingState } from "@baumy/db/kiosk-pairing";
import { rejectCrossSite } from "@/lib/http/origin";
import { deviceLabel } from "@/lib/login-approval/device";
import { getClientIp, type RateLimiter } from "@/lib/rate-limit";
import {
  KIOSK_COOKIE,
  KIOSK_COOKIE_MAX_AGE_S,
  KIOSK_MEMBER_COOKIE,
} from "./cookies";

// Pairing the kitchen iPad by QR code (issue #126, SPEC §6.2): the three
// routes the unpaired iPad at /kiosk/pair talks to. Like "Sign in with
// Baumy" (lib/login-approval/flow.ts), they are a sign-in, not actions:
// nobody is signed in on the iPad. The admin's approval IS an action
// (`approve_kiosk_pairing`), audited.
//
//   POST /api/kiosk-pairing/start     → { code, expiresAt } + cookie
//   GET  /api/kiosk-pairing/status    → { status }
//   POST /api/kiosk-pairing/exchange  → the `baumy_kiosk` cookie, once
//
// - The iPad gets 32 random bytes in an httpOnly, SameSite=Strict cookie
//   scoped to these routes; only its sha256 is stored. The short code it
//   shows (and its QR code carries) is a separate random value, also stored
//   only as a hash: it lets an admin name the request, and nothing more.
// - Single use: the exchange claims the approved request and pairs its
//   device in one transaction of compare-and-set UPDATEs.
// - Rate-limited per IP; 10 minutes to approve. The iPad starts a fresh
//   request by itself when one expires.
// - The POSTs check Origin / Sec-Fetch-Site (lib/http/origin.ts).

export const PAIRING_COOKIE = "baumy_kiosk_pairing";
export const PAIRING_COOKIE_PATH = "/api/kiosk-pairing";

/** The request's 10 minutes, its exchange grace, and a little slack. */
export const PAIRING_COOKIE_MAX_AGE_S = 11 * 60;

/** Per IP: a new code every 10 minutes and a few reloads, not a script. */
export const START_LIMIT = { limit: 20, windowMs: 10 * 60_000 };
export const EXCHANGE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };

/** A code collision is astronomically rare, but never fatal. */
const MINT_ATTEMPTS = 5;

export interface NewPairingRequest {
  secret: string;
  code: string;
  device: string;
  now: Date;
}

export interface KioskPairingDeps {
  now: () => Date;
  rateLimiter: RateLimiter;
  randomSecret: () => string;
  newCode: () => string;
  newToken: () => string;
  /** Stores the request; null when the code or secret is taken. */
  createRequest: (
    input: NewPairingRequest,
  ) => Promise<{ id: string; expiresAt: Date } | null>;
  findBySecret: (
    secret: string,
    now: Date,
  ) => Promise<{ id: string; state: KioskPairingState } | null>;
  /** Claims the approved request and pairs its device, in one transaction. */
  claim: (input: {
    secret: string;
    tokenHash: string;
    now: Date;
  }) => Promise<{ deviceId: string; name: string } | null>;
  logError: (message: string, err?: unknown) => void;
}

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

function cookie(name: string, value: string, path: string, maxAge: number) {
  return [
    `${name}=${value}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

/** Set-Cookie for the iPad's pairing secret, or to clear it (`maxAge` 0). */
export function pairingCookie(value: string, maxAge: number): string {
  return cookie(PAIRING_COOKIE, value, PAIRING_COOKIE_PATH, maxAge);
}

/** The secret this browser holds, or null. */
export function readPairingCookie(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === PAIRING_COOKIE) {
      const value = rest.join("=");
      // 32 bytes of base64url are 43 characters; refuse anything odd.
      return /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : null;
    }
  }
  return null;
}

async function limited(
  deps: KioskPairingDeps,
  key: string,
  opts: { limit: number; windowMs: number },
): Promise<Response | null> {
  const rl = await deps.rateLimiter.limit(key, opts);
  if (rl.ok) return null;
  return refusal(
    429,
    "RATE_LIMITED",
    `Too many pairing codes. Wait ${rl.retryAfterSeconds}s and try again.`,
    { retryAfterSeconds: rl.retryAfterSeconds },
    { "retry-after": String(rl.retryAfterSeconds) },
  );
}

/** POST /api/kiosk-pairing/start */
export async function handleStart(
  req: Request,
  deps: KioskPairingDeps,
): Promise<Response> {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  try {
    const tooMany = await limited(
      deps,
      `kiosk_pair:start:ip:${getClientIp(req.headers)}`,
      START_LIMIT,
    );
    if (tooMany) return tooMany;
    const now = deps.now();
    const device = deviceLabel(req.headers.get("user-agent"));
    for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
      const secret = deps.randomSecret();
      const code = deps.newCode();
      const request = await deps.createRequest({ secret, code, device, now });
      if (!request) continue;
      return json(
        { ok: true, code, expiresAt: request.expiresAt.toISOString() },
        200,
        { "set-cookie": pairingCookie(secret, PAIRING_COOKIE_MAX_AGE_S) },
      );
    }
    throw new Error("no free pairing code after several attempts");
  } catch (err) {
    deps.logError("[kiosk-pairing] start failed", err);
    return refusal(500, "INTERNAL", "Something went wrong. Please try again.");
  }
}

/** GET /api/kiosk-pairing/status */
export async function handleStatus(
  req: Request,
  deps: KioskPairingDeps,
): Promise<Response> {
  try {
    const secret = readPairingCookie(req);
    const found = secret ? await deps.findBySecret(secret, deps.now()) : null;
    // No cookie (it lapsed) or no row reads as expired: start again.
    return json({ ok: true, status: found?.state ?? "expired" });
  } catch (err) {
    deps.logError("[kiosk-pairing] status failed", err);
    return refusal(500, "INTERNAL", "Something went wrong. Please try again.");
  }
}

/** POST /api/kiosk-pairing/exchange */
export async function handleExchange(
  req: Request,
  deps: KioskPairingDeps,
): Promise<Response> {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  try {
    const tooMany = await limited(
      deps,
      `kiosk_pair:exchange:ip:${getClientIp(req.headers)}`,
      EXCHANGE_LIMIT,
    );
    if (tooMany) return tooMany;
    const secret = readPairingCookie(req);
    const token = deps.newToken();
    const paired = secret
      ? await deps.claim({
          secret,
          tokenHash: hashKioskToken(token),
          now: deps.now(),
        })
      : null;
    if (!paired) {
      return refusal(
        409,
        "INVALID_STATE",
        "This iPad was not approved, or the approval was already used. Show a new code.",
        {},
        { "set-cookie": pairingCookie("", 0) },
      );
    }
    const headers = new Headers({ "cache-control": "no-store" });
    headers.append(
      "set-cookie",
      cookie(KIOSK_COOKIE, token, "/", KIOSK_COOKIE_MAX_AGE_S),
    );
    // A fresh kiosk starts with nobody picked.
    headers.append("set-cookie", cookie(KIOSK_MEMBER_COOKIE, "", "/", 0));
    headers.append("set-cookie", pairingCookie("", 0));
    return Response.json(
      { ok: true, name: paired.name },
      { status: 200, headers },
    );
  } catch (err) {
    deps.logError("[kiosk-pairing] exchange failed", err);
    return refusal(500, "INTERNAL", "Something went wrong. Please try again.");
  }
}
