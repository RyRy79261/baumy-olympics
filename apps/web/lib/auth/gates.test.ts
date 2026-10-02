import { describe, expect, it, vi } from "vitest";
import type { RequestCtx } from "@/lib/actions/define";
import type { Actor } from "./actor";
import {
  requireAccount,
  requireAdmin,
  requireAttested,
  requireDisplay,
  requireMember,
  requireService,
  requireSession,
  runGate,
  type GatedAction,
} from "./gates";
import type { PinCheck, PinVerdict } from "./pin";

// Each gate against each actor kind. The kiosk rules are the ones that matter
// most: it passes `requireMember` only for kiosk actions, never passes
// `requireSession` or `requireAdmin`, and needs a PIN for `requireAttested`.

const NOW = new Date("2026-09-27T10:00:00Z");

const PASS: PinVerdict = { ok: true };
const WRONG: PinVerdict = { ok: false, reason: "wrong" };
const pinIs =
  (right: string) =>
  async ({ pin }: PinCheck): Promise<PinVerdict> =>
    pin === right ? PASS : WRONG;

const admin: Actor = {
  kind: "member",
  userId: "u1",
  email: "a@b.c",
  name: "A",
  emailVerified: true,
  sessionCreatedAt: "2026-09-27T09:00:00.000Z",
  memberId: "m1",
  role: "admin",
};
const member: Actor = { ...admin, memberId: "m2", role: "member" };
const account: Actor = {
  kind: "member",
  userId: "u3",
  email: "x@y.z",
  name: "X",
  emailVerified: false,
  sessionCreatedAt: "2026-09-27T09:00:00.000Z",
};
const kiosk: Actor = { kind: "kiosk", deviceId: "d1", memberId: "m1" };
const kioskNobody: Actor = { kind: "kiosk", deviceId: "d1" };
const brain: Actor = {
  kind: "service",
  tokenName: "baumy-brain",
  memberId: "m1",
};
const brainUnlinked: Actor = { kind: "service", tokenName: "baumy-brain" };
const mcpRead: Actor = { kind: "mcp", memberId: "m1", scopes: ["baumy:read"] };
const mcpWrite: Actor = {
  kind: "mcp",
  memberId: "m1",
  scopes: ["baumy:read", "baumy:write"],
};

const everywhere: GatedAction = {
  kind: "write",
  surfaces: ["ui", "kiosk", "ai", "mcp", "brain"],
};
const notKiosk: GatedAction = { kind: "write", surfaces: ["ui", "ai", "mcp"] };
const readAction: GatedAction = { kind: "read", surfaces: ["ui", "mcp"] };

function ctx(actor: Actor, pin?: string): RequestCtx {
  return {
    actor,
    source: "ui",
    householdId: "h",
    now: NOW,
    ...(pin ? { pin } : {}),
  };
}

describe("requireMember", () => {
  it("accepts any actor linked to a member", () => {
    for (const a of [admin, member, kiosk, brain, mcpWrite]) {
      expect(requireMember(ctx(a), everywhere)).toEqual({ ok: true });
    }
  });

  it("refuses an account with no member row, and a kiosk with nobody picked", () => {
    for (const a of [account, kioskNobody, brainUnlinked]) {
      expect(requireMember(ctx(a), everywhere)).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
    }
  });

  it("refuses the kiosk for an action not offered on the kiosk", () => {
    expect(requireMember(ctx(kiosk), notKiosk)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
      message: "This can't be done on the kiosk.",
    });
    expect(requireMember(ctx(member), notKiosk)).toEqual({ ok: true });
  });

  it("needs the MCP scope for the action's kind", () => {
    expect(requireMember(ctx(mcpRead), readAction)).toEqual({ ok: true });
    expect(requireMember(ctx(mcpRead), everywhere)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(requireMember(ctx(mcpWrite), everywhere)).toEqual({ ok: true });
    expect(
      requireMember(ctx({ ...mcpRead, scopes: [] }), readAction),
    ).toMatchObject({ ok: false });
  });
});

describe("requireDisplay", () => {
  const kioskRead: GatedAction = { kind: "read", surfaces: ["ui", "kiosk"] };
  const kioskWrite: GatedAction = { kind: "write", surfaces: ["ui", "kiosk"] };

  it("lets the kiosk with nobody picked read what the kiosk offers", () => {
    expect(requireDisplay(ctx(kioskNobody), kioskRead)).toEqual({ ok: true });
    expect(requireDisplay(ctx(kiosk), kioskRead)).toEqual({ ok: true });
  });

  it("never lets the kiosk with nobody picked write", () => {
    expect(requireDisplay(ctx(kioskNobody), kioskWrite)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it("keeps the kiosk off reads it is not offered", () => {
    expect(requireDisplay(ctx(kioskNobody), readAction)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(requireDisplay(ctx(kiosk), readAction)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it("holds everyone else to requireMember", () => {
    expect(requireDisplay(ctx(member), kioskRead)).toEqual({ ok: true });
    for (const a of [account, brainUnlinked]) {
      expect(requireDisplay(ctx(a), kioskRead)).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
    }
    expect(requireDisplay(ctx(mcpWrite), kioskRead)).toEqual({ ok: true });
  });
});

describe("requireSession", () => {
  it("accepts only a member session", () => {
    expect(requireSession(ctx(member))).toEqual({ ok: true });
    expect(requireSession(ctx(admin))).toEqual({ ok: true });
    for (const a of [kiosk, brain, mcpWrite]) {
      expect(requireSession(ctx(a))).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
    }
  });

  it("refuses a session with no member row", () => {
    expect(requireSession(ctx(account))).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
  });
});

describe("requireAccount", () => {
  it("accepts any real session, member row or not", () => {
    for (const a of [account, member, admin]) {
      expect(requireAccount(ctx(a))).toEqual({ ok: true });
    }
  });

  it("refuses the kiosk, MCP and brain", () => {
    for (const a of [kiosk, brain, mcpWrite]) {
      expect(requireAccount(ctx(a))).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
    }
  });
});

describe("requireAdmin", () => {
  const admin_ = (a: Actor, action: GatedAction = notKiosk, pin?: string) =>
    requireAdmin(ctx(a, pin), action, pinIs("2580"));

  it("accepts an admin session only", async () => {
    expect(await admin_(admin)).toEqual({ ok: true });
    expect(await admin_(member)).toMatchObject({
      ok: false,
      message: "Only a household admin can do this.",
    });
    // An admin through MCP is still not an admin; nor is a brain actor
    // whose linked member's role was not read as admin, nor the kiosk for
    // an action not offered there.
    for (const a of [
      { ...kiosk, role: "admin" } as Actor,
      brain,
      mcpWrite,
      account,
    ]) {
      expect(await admin_(a)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
  });

  it("accepts brain in a linked admin's own name, never on someone's behalf (issue #107)", async () => {
    const brainAdmin: Actor = { ...brain, role: "admin" } as Actor;
    expect(await admin_(brainAdmin)).toEqual({ ok: true });
    expect(await admin_({ ...brain, role: "member" } as Actor)).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "Only a household admin can do this.",
    });
    // Acting for a housemate: even an admin asker may not.
    expect(
      await admin_({ ...brainAdmin, initiatorMemberId: "m9" } as Actor),
    ).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message:
        "Admin changes can't be made on someone's behalf. Ask an admin to do it themself.",
    });
    expect(
      await admin_({ ...brainUnlinked, role: "admin" } as Actor),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("on the kiosk, needs an admin picked AND their PIN, for a kiosk action only (issue #147)", async () => {
    const kioskAdmin = { ...kiosk, role: "admin" } as Actor;
    const kioskMember = { ...kiosk, role: "member" } as Actor;
    // A non-admin with a right PIN is refused.
    expect(await admin_(kioskMember, everywhere, "2580")).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "Only a household admin can do this.",
    });
    // Nobody picked.
    expect(await admin_(kioskNobody, everywhere, "2580")).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    // An admin without a PIN, or with a wrong one, is refused.
    expect(await admin_(kioskAdmin, everywhere)).toMatchObject({
      ok: false,
      code: "ATTESTATION_REQUIRED",
    });
    expect(await admin_(kioskAdmin, everywhere, "1111")).toMatchObject({
      ok: false,
      code: "ATTESTATION_FAILED",
    });
    // An admin with their PIN passes.
    expect(await admin_(kioskAdmin, everywhere, "2580")).toEqual({ ok: true });
    // Not for an admin action that is not offered on the kiosk, PIN or not.
    expect(await admin_(kioskAdmin, notKiosk, "2580")).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "This can only be done signed in on your own phone or computer.",
    });
  });
});

describe("requireAttested", () => {
  it("takes a session, MCP or brain actor as its own attestation", async () => {
    const verify = vi.fn(async (): Promise<PinVerdict> => WRONG);
    for (const a of [member, brain, mcpWrite]) {
      await expect(
        requireAttested(ctx(a), everywhere, verify),
      ).resolves.toEqual({
        ok: true,
      });
    }
    expect(verify).not.toHaveBeenCalled();
  });

  it("needs the kiosk member's PIN, checked in this request", async () => {
    const verify = vi.fn(pinIs("4321"));
    await expect(
      requireAttested(ctx(kiosk), everywhere, verify),
    ).resolves.toMatchObject({
      ok: false,
      code: "ATTESTATION_REQUIRED",
    });
    expect(verify).not.toHaveBeenCalled();
    await expect(
      requireAttested(ctx(kiosk, "0000"), everywhere, verify),
    ).resolves.toMatchObject({ ok: false, code: "ATTESTATION_FAILED" });
    await expect(
      requireAttested(ctx(kiosk, "4321"), everywhere, verify),
    ).resolves.toEqual({ ok: true });
    expect(verify).toHaveBeenLastCalledWith({
      householdId: "h",
      deviceId: "d1",
      memberId: "m1",
      pin: "4321",
      now: NOW,
    });
  });

  it("says why a PIN failed, in a sentence to act on", async () => {
    const cases: [PinVerdict, string, RegExp][] = [
      [WRONG, "ATTESTATION_FAILED", /not right/],
      [
        { ok: false, reason: "no_pin" },
        "PIN_NOT_SET",
        /haven't set a personal PIN/,
      ],
      [
        { ok: false, reason: "locked" },
        "PIN_LOCKED",
        /^Your kiosk PIN is locked/,
      ],
      [
        { ok: false, reason: "locked", justLocked: true },
        "PIN_LOCKED",
        /not right, and after 10 wrong tries/,
      ],
      [
        { ok: false, reason: "rate_limited", retryAfterSeconds: 61 },
        "RATE_LIMITED",
        /Wait 2 min/,
      ],
      [{ ok: false, reason: "rate_limited" }, "RATE_LIMITED", /Wait 1 min/],
      [
        { ok: false, reason: "unavailable" },
        "ATTESTATION_FAILED",
        /could not be checked/,
      ],
    ];
    for (const [verdict, code, message] of cases) {
      const out = await requireAttested(
        ctx(kiosk, "1234"),
        everywhere,
        async () => verdict,
      );
      expect(out).toMatchObject({ ok: false, code });
      expect(out.ok ? "" : out.message).toMatch(message);
    }
    await expect(
      requireAttested(ctx(kiosk, "1234"), everywhere, async () => ({
        ok: false,
        reason: "rate_limited",
        retryAfterSeconds: 30,
      })),
    ).resolves.toMatchObject({ retryAfterSeconds: 30 });
  });

  it("checks membership first", async () => {
    const verify = vi.fn(async (): Promise<PinVerdict> => PASS);
    await expect(
      requireAttested(ctx(kioskNobody, "4321"), everywhere, verify),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(
      requireAttested(ctx(kiosk, "4321"), notKiosk, verify),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("requireService", () => {
  it("accepts only a service token", () => {
    expect(requireService(ctx(brainUnlinked))).toEqual({ ok: true });
    for (const a of [admin, kiosk, mcpWrite]) {
      expect(requireService(ctx(a))).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
    }
  });
});

describe("runGate", () => {
  it("dispatches each gate name to its function", async () => {
    const verify = vi.fn(async (): Promise<PinVerdict> => PASS);
    const gates = [
      "member",
      "display",
      "session",
      "admin",
      "attested",
      "service",
      "account",
    ] as const;
    const verdicts = await Promise.all(
      gates.map((g) => runGate(g, ctx(member), everywhere, verify)),
    );
    expect(verdicts.map((v) => v.ok)).toEqual([
      true,
      true,
      true,
      false,
      true,
      false,
      true,
    ]);
    await expect(
      runGate("attested", ctx(kiosk, "1"), everywhere, verify),
    ).resolves.toEqual({ ok: true });
    expect(verify).toHaveBeenCalledTimes(1);
    await expect(
      runGate(
        "display",
        ctx(kioskNobody),
        { kind: "read", surfaces: ["kiosk"] },
        verify,
      ),
    ).resolves.toEqual({ ok: true });
  });
});
