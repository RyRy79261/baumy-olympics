import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "./actor";

// The page gate ladder: the pure verdict for every kind of visitor, then the
// wrappers that turn it into Next's redirect and notFound.

const getActor = vi.fn<() => Promise<Actor | null>>();
vi.mock("./actor", () => ({ getActor: () => getActor() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { pageGate, requireAdminPage, requireJoiningPage, requireMemberPage } =
  await import("./page-gate");

const base = {
  kind: "member" as const,
  userId: "u1",
  email: "a@b.c",
  name: "A",
  emailVerified: true,
  sessionCreatedAt: "2026-09-27T09:00:00.000Z",
};
const account: Actor = base;
const member: Actor = {
  ...base,
  memberId: "m1",
  role: "member",
  displayName: "A",
};
const admin: Actor = { ...member, role: "admin" };
const kiosk: Actor = { kind: "kiosk", deviceId: "d1", memberId: "m1" };
const mcp: Actor = { kind: "mcp", memberId: "m1", scopes: ["baumy:read"] };
const brain: Actor = { kind: "service", tokenName: "baumy-brain" };

describe("pageGate", () => {
  it("sends nobody to sign-in, whatever the page", () => {
    for (const need of ["member", "admin", "joining"] as const) {
      expect(pageGate(null, need)).toEqual({
        kind: "redirect",
        to: "/auth/sign-in",
      });
    }
  });

  it("sends an account with no member row to /join, and lets it stay there", () => {
    expect(pageGate(account, "member")).toEqual({
      kind: "redirect",
      to: "/join",
    });
    expect(pageGate(account, "admin")).toEqual({
      kind: "redirect",
      to: "/join",
    });
    expect(pageGate(account, "joining")).toEqual({ kind: "ok" });
  });

  it("lets a member into hub pages, sends them home from /join, and hides admin pages", () => {
    expect(pageGate(member, "member")).toEqual({ kind: "ok" });
    expect(pageGate(member, "joining")).toEqual({ kind: "redirect", to: "/" });
    expect(pageGate(member, "admin")).toEqual({ kind: "not_found" });
  });

  it("lets an admin into admin pages", () => {
    expect(pageGate(admin, "admin")).toEqual({ kind: "ok" });
    expect(pageGate(admin, "member")).toEqual({ kind: "ok" });
  });

  it("sends a paired kiosk to its own shell, and never to admin pages", () => {
    const nobody: Actor = { kind: "kiosk", deviceId: "d1" };
    for (const a of [kiosk, nobody]) {
      expect(pageGate(a, "member")).toEqual({ kind: "redirect", to: "/kiosk" });
      expect(pageGate(a, "joining")).toEqual({
        kind: "redirect",
        to: "/kiosk",
      });
      expect(pageGate(a, "admin")).toEqual({ kind: "not_found" });
    }
  });

  it("never shows these pages to MCP or brain", () => {
    for (const a of [mcp, brain]) {
      for (const need of ["member", "admin", "joining"] as const) {
        expect(pageGate(a, need)).toEqual({ kind: "not_found" });
      }
    }
  });
});

describe("the page wrappers", () => {
  beforeEach(() => getActor.mockReset());

  it("return the actor when the ladder says ok", async () => {
    getActor.mockResolvedValue(admin);
    await expect(requireAdminPage()).resolves.toBe(admin);
    await expect(requireMemberPage()).resolves.toBe(admin);
    getActor.mockResolvedValue(account);
    await expect(requireJoiningPage()).resolves.toBe(account);
  });

  it("redirect or 404 otherwise", async () => {
    getActor.mockResolvedValue(null);
    await expect(requireMemberPage()).rejects.toThrow(
      "NEXT_REDIRECT /auth/sign-in",
    );
    getActor.mockResolvedValue(account);
    await expect(requireMemberPage()).rejects.toThrow("NEXT_REDIRECT /join");
    getActor.mockResolvedValue(member);
    await expect(requireAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(requireJoiningPage()).rejects.toThrow("NEXT_REDIRECT /");
  });

  it("sends a visitor who is not signed in back to returnTo after sign-in", async () => {
    getActor.mockResolvedValue(null);
    await expect(
      requireMemberPage({ returnTo: "/oauth/consent?client_id=a&state=b" }),
    ).rejects.toThrow(
      "NEXT_REDIRECT /auth/sign-in?callbackURL=%2Foauth%2Fconsent%3Fclient_id%3Da%26state%3Db",
    );
    // An account with no member row still goes to /join: no code for it.
    getActor.mockResolvedValue(account);
    await expect(
      requireMemberPage({ returnTo: "/oauth/consent" }),
    ).rejects.toThrow("NEXT_REDIRECT /join");
  });
});
