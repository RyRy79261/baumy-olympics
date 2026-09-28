// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { decideLoginRequest } from "@baumy/db/login-requests";
import { auditEvents, loginRequests, members, user } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import type * as NextServerModule from "next/server";
import {
  setBrainClientForTests,
  unconfiguredBrain,
} from "@/lib/integrations/brain";

// The real dependencies of the "Sign in with Baumy" routes on PGlite
// (issue #80): the request and its audit row in one transaction, the lookups,
// the one-time claim, and the seams to brain, `after` and Better Auth.

type NextServer = typeof NextServerModule;
const afterMock = vi.hoisted(() => vi.fn());
vi.mock("next/server", async (original) => ({
  ...(await original<NextServer>()),
  after: afterMock,
}));
const signInApproved = vi.hoisted(() => vi.fn());
vi.mock("@baumy/auth", () => ({
  authMayServe: () => true,
  getAuth: () => ({ api: { signInApproved } }),
}));

const { loginApprovalDeps } = await import("./wiring");

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const NOW = new Date("2026-09-28T10:00:00Z");
const SECRET = "C".repeat(43);

afterEach(() => {
  setBrainClientForTests(null);
  afterMock.mockReset();
  signInApproved.mockReset();
});

async function ryan() {
  await t
    .db()
    .insert(user)
    .values({ id: "user-ryan", name: "Ryan", email: "ryan@example.com" });
  const [m] = await t
    .db()
    .insert(members)
    .values({
      householdId: HOUSEHOLD_ID,
      authUserId: "user-ryan",
      displayName: "Ryan",
      avatarSprite: "cat",
      color: "#112233",
      telegramUserId: 42,
    })
    .returning({ id: members.id });
  return m!.id;
}

describe("loginApprovalDeps", () => {
  it("stores a member's request with its audit row, and a stranger's without", async () => {
    const memberId = await ryan();
    const deps = loginApprovalDeps();
    const candidate = await deps.findCandidate("RYAN@example.com");
    expect(candidate).toEqual({
      memberId,
      authUserId: "user-ryan",
      telegramUserId: 42,
    });
    expect(await deps.isLocked(memberId, NOW)).toBe(false);

    const base = {
      code: 47,
      choices: [12, 47, 83],
      device: "Chrome on macOS",
      now: NOW,
    };
    const mine = await deps.createRequest({
      ...base,
      memberId,
      secret: SECRET,
      audit: { ip: "203.0.113.7" },
    });
    await deps.createRequest({
      ...base,
      memberId: null,
      secret: "D".repeat(43),
    });
    expect(await t.db().select().from(loginRequests)).toHaveLength(2);
    const audits = await t.db().select().from(auditEvents);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorMemberId: memberId,
      source: "ui",
      action: "request_login",
      entity: "login_request",
      entityId: mine.id,
      payload: { device: "Chrome on macOS", ip: "203.0.113.7" },
    });

    expect(await deps.findBySecret(SECRET, NOW)).toEqual({
      id: mine.id,
      state: "pending",
    });
    expect(await deps.claim(SECRET, NOW)).toBeNull();
    await decideLoginRequest(db(), mine.id, { status: "approved", now: NOW });
    expect(await deps.claim(SECRET, NOW)).toEqual({
      requestId: mine.id,
      memberId,
      authUserId: "user-ryan",
    });
  });

  it("sends through the brain client, and runs work after the response", async () => {
    setBrainClientForTests(unconfiguredBrain);
    const deps = loginApprovalDeps();
    expect(
      await deps.sendApproval({
        requestId: "r",
        telegramUserId: 42,
        device: "d",
        choices: [10, 11, 12],
        expiresAt: NOW.toISOString(),
      }),
    ).toEqual({ ok: false, reason: "not_configured" });

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const work = vi.fn(async () => {
      throw new Error("brain exploded");
    });
    deps.afterResponse(work);
    expect(afterMock).toHaveBeenCalledTimes(1);
    await (afterMock.mock.calls[0]![0] as () => Promise<void>)();
    expect(work).toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(
      "[login-approval] after the response",
      expect.any(Error),
    );
    deps.logError("one line");
    deps.logError("with detail", new Error("x"));
    expect(errors).toHaveBeenCalledWith("one line");
    errors.mockRestore();
  });

  it("makes the session through Better Auth and returns its cookies", async () => {
    signInApproved.mockResolvedValue({
      headers: new Headers([
        ["set-cookie", "baumy.session_token=abc; Path=/"],
        ["set-cookie", "baumy.session_data=def; Path=/"],
      ]),
      response: { userId: "user-ryan", sessionId: "s1" },
    });
    const deps = loginApprovalDeps();
    const headers = new Headers({ "user-agent": "UA" });
    expect(await deps.signIn("user-ryan", headers)).toEqual([
      "baumy.session_token=abc; Path=/",
      "baumy.session_data=def; Path=/",
    ]);
    expect(signInApproved).toHaveBeenCalledWith({
      body: { userId: "user-ryan" },
      headers,
      returnHeaders: true,
    });
    expect(deps.authMayServe()).toBe(true);
    expect(deps.randomSecret()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const n = deps.randomInt(10, 100);
    expect(n).toBeGreaterThanOrEqual(10);
    expect(n).toBeLessThan(100);
  });
});
