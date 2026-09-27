import { describe, expect, it, vi } from "vitest";
import type { RequestCtx } from "@/lib/actions/define";
import type { Actor } from "./actor";
import {
  requireAccount,
  requireAdmin,
  requireAttested,
  requireMember,
  requireService,
  requireSession,
  runGate,
  type GatedAction,
} from "./gates";
import { verifyKioskPin } from "./pin";

// Each gate against each actor kind. The kiosk rules are the ones that matter
// most: it passes `requireMember` only for kiosk actions, never passes
// `requireSession` or `requireAdmin`, and needs a PIN for `requireAttested`.

const NOW = new Date("2026-09-27T10:00:00Z");

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
  it("accepts an admin session only", () => {
    expect(requireAdmin(ctx(admin))).toEqual({ ok: true });
    expect(requireAdmin(ctx(member))).toMatchObject({
      ok: false,
      message: "Only a household admin can do this.",
    });
    // An admin at the kiosk, through MCP or brain, is still not an admin.
    for (const a of [kiosk, brain, mcpWrite, account]) {
      expect(requireAdmin(ctx(a))).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
    }
  });
});

describe("requireAttested", () => {
  it("takes a session, MCP or brain actor as its own attestation", async () => {
    const verify = vi.fn(async () => false);
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
    const verify = vi.fn(async ({ pin }: { pin: string }) => pin === "4321");
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
      deviceId: "d1",
      memberId: "m1",
      pin: "4321",
      now: NOW,
    });
  });

  it("checks membership first", async () => {
    const verify = vi.fn(async () => true);
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
    const verify = vi.fn(async () => true);
    const gates = [
      "member",
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
      false,
      true,
      false,
      true,
    ]);
    await expect(
      runGate("attested", ctx(kiosk, "1"), everywhere, verify),
    ).resolves.toEqual({ ok: true });
    expect(verify).toHaveBeenCalledTimes(1);
  });
});

describe("verifyKioskPin", () => {
  it("fails closed until kiosk attestation lands (issue #10)", async () => {
    await expect(
      verifyKioskPin({ deviceId: "d1", memberId: "m1", pin: "1234", now: NOW }),
    ).resolves.toBe(false);
  });
});
