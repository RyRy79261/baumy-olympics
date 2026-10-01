import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as AuthModule from "@baumy/auth";
import type * as KioskDevices from "@baumy/db/kiosk-devices";

// getActor against a mocked Better Auth: what it returns for each kind of
// session, and that a Vercel deployment without a secret never reads one.

const getSession = vi.fn();
const headersMock = vi.fn(async () => new Headers({ cookie: "x=y" }));
const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT ${to}`);
});

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: () => headersMock(),
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));
const findMember = vi.fn();
const findActiveMember = vi.fn();
vi.mock("@baumy/db/members", () => ({
  findActiveMemberByAuthUserId: (id: string) => findMember(id),
  findActiveMember: (_db: unknown, householdId: string, id: string) =>
    findActiveMember(householdId, id),
}));
vi.mock("@baumy/db", () => ({ createHttpDb: () => ({}) }));
const findDevice = vi.fn();
const touchDevice = vi.fn();
vi.mock("@baumy/db/kiosk-devices", async (importOriginal) => {
  const real = await importOriginal<typeof KioskDevices>();
  return {
    hashKioskToken: real.hashKioskToken,
    findPairedKioskDevice: (hash: string) => findDevice(hash),
    touchKioskDevice: (device: unknown, now: Date) => touchDevice(device, now),
  };
});
vi.mock("@baumy/auth", async (importOriginal) => {
  const real = await importOriginal<typeof AuthModule>();
  return {
    authMayServe: real.authMayServe,
    getAuth: () => ({ api: { getSession } }),
  };
});

const { getActor, getActorOrRedirect, getKioskActor, redirectIfSignedIn } =
  await import("./actor");
const { hashKioskToken } = await import("@baumy/db/kiosk-devices");

const session = {
  user: {
    id: "u_1",
    email: "ryan@example.com",
    name: "Ryan",
    emailVerified: true,
  },
  session: { id: "s_1", createdAt: new Date("2026-09-27T09:55:00Z") },
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("BETTER_AUTH_SECRET", "");
  getSession.mockReset();
  findMember.mockReset();
  findActiveMember.mockReset();
  findActiveMember.mockResolvedValue(null);
  findDevice.mockReset();
  findDevice.mockResolvedValue(null);
  touchDevice.mockReset();
  touchDevice.mockResolvedValue(undefined);
  cookieJar.clear();
  findMember.mockResolvedValue(null);
  headersMock.mockClear();
  redirectMock.mockClear();
});

describe("getActor", () => {
  it("resolves a session to a member actor, passing the request headers on", async () => {
    getSession.mockResolvedValue(session);
    await expect(getActor()).resolves.toEqual({
      kind: "member",
      userId: "u_1",
      email: "ryan@example.com",
      name: "Ryan",
      emailVerified: true,
      sessionCreatedAt: "2026-09-27T09:55:00.000Z",
      sessionId: "s_1",
    });
    const passed = getSession.mock.calls[0]?.[0] as { headers: Headers };
    expect(passed.headers.get("cookie")).toBe("x=y");
  });

  it("attaches the active member and role linked to the account", async () => {
    getSession.mockResolvedValue(session);
    findMember.mockResolvedValue({
      id: "m_1",
      householdId: "h_1",
      role: "admin",
      displayName: "Ryan",
    });
    await expect(getActor()).resolves.toEqual({
      kind: "member",
      userId: "u_1",
      email: "ryan@example.com",
      name: "Ryan",
      emailVerified: true,
      sessionCreatedAt: "2026-09-27T09:55:00.000Z",
      sessionId: "s_1",
      memberId: "m_1",
      role: "admin",
      displayName: "Ryan",
    });
    expect(findMember).toHaveBeenCalledWith("u_1");
  });

  it("returns null when there is no session", async () => {
    getSession.mockResolvedValue(null);
    await expect(getActor()).resolves.toBeNull();
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("fails closed on Vercel without a secret, without reading the session", async () => {
    getSession.mockResolvedValue(session);
    vi.stubEnv("VERCEL_ENV", "preview");
    await expect(getActor()).resolves.toBeNull();
    expect(getSession).not.toHaveBeenCalled();
    expect(findMember).not.toHaveBeenCalled();
  });

  it("reads the session on Vercel once the secret is set", async () => {
    getSession.mockResolvedValue(session);
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BETTER_AUTH_SECRET", "a-real-secret-that-is-long-enough-012");
    await expect(getActor()).resolves.toMatchObject({ kind: "member" });
  });

  it("lets a database failure propagate instead of signing everyone out", async () => {
    getSession.mockRejectedValue(new Error("db down"));
    await expect(getActor()).rejects.toThrow("db down");
  });
});

describe("page redirect helpers", () => {
  it("getActorOrRedirect returns the actor, or sends the visitor to sign-in", async () => {
    getSession.mockResolvedValue(session);
    await expect(getActorOrRedirect()).resolves.toMatchObject({
      userId: "u_1",
    });
    getSession.mockResolvedValue(null);
    await expect(getActorOrRedirect()).rejects.toThrow(
      "NEXT_REDIRECT /auth/sign-in",
    );
  });

  it("redirectIfSignedIn sends a signed-in visitor home and lets others stay", async () => {
    getSession.mockResolvedValue(null);
    await expect(redirectIfSignedIn()).resolves.toBeUndefined();
    // A paired kiosk is not a person: someone may sign in on its browser.
    cookieJar.set("baumy_kiosk", "tok");
    findDevice.mockResolvedValue(DEVICE);
    await expect(redirectIfSignedIn()).resolves.toBeUndefined();
    getSession.mockResolvedValue(session);
    await expect(redirectIfSignedIn()).rejects.toThrow("NEXT_REDIRECT /");
  });
});

const DEVICE = {
  id: "d_1",
  householdId: "h_1",
  name: "Kitchen iPad",
  lastSeenAt: null,
};
const MEMBER_ID = "0b6f1c1e-6a6e-4c4b-9d55-6a8f0f3a2b10";

describe("getKioskActor", () => {
  it("is null without the kiosk cookie, or with an overlong one", async () => {
    await expect(getKioskActor()).resolves.toBeNull();
    cookieJar.set("baumy_kiosk", "x".repeat(129));
    await expect(getKioskActor()).resolves.toBeNull();
    expect(findDevice).not.toHaveBeenCalled();
  });

  it("looks the device up by the token's hash, and is null for an unknown or revoked one", async () => {
    cookieJar.set("baumy_kiosk", "tok");
    await expect(getKioskActor()).resolves.toBeNull();
    expect(findDevice).toHaveBeenCalledWith(hashKioskToken("tok"));
  });

  it("resolves a paired device, and records it was seen", async () => {
    cookieJar.set("baumy_kiosk", "tok");
    findDevice.mockResolvedValue(DEVICE);
    await expect(getKioskActor()).resolves.toEqual({
      kind: "kiosk",
      deviceId: "d_1",
      deviceName: "Kitchen iPad",
    });
    expect(touchDevice).toHaveBeenCalledWith(DEVICE, expect.any(Date));
  });

  it("adds the picked member while they are active in the device's household", async () => {
    cookieJar.set("baumy_kiosk", "tok");
    cookieJar.set("baumy_kiosk_member", MEMBER_ID);
    findDevice.mockResolvedValue(DEVICE);
    await expect(getKioskActor()).resolves.not.toHaveProperty("memberId");
    expect(findActiveMember).toHaveBeenCalledWith("h_1", MEMBER_ID);

    findActiveMember.mockResolvedValue({
      id: MEMBER_ID,
      displayName: "Ryan",
      avatarSprite: "cat",
      color: "#112233",
    });
    await expect(getKioskActor()).resolves.toEqual({
      kind: "kiosk",
      deviceId: "d_1",
      deviceName: "Kitchen iPad",
      memberId: MEMBER_ID,
      displayName: "Ryan",
    });
  });

  it("ignores a picked value that is not a member id, without a query", async () => {
    cookieJar.set("baumy_kiosk", "tok");
    cookieJar.set("baumy_kiosk_member", "'; drop table members; --");
    findDevice.mockResolvedValue(DEVICE);
    await expect(getKioskActor()).resolves.not.toHaveProperty("memberId");
    expect(findActiveMember).not.toHaveBeenCalled();
  });

  it("still resolves when last_seen_at cannot be written", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    cookieJar.set("baumy_kiosk", "tok");
    findDevice.mockResolvedValue(DEVICE);
    touchDevice.mockRejectedValue(new Error("db down"));
    await expect(getKioskActor()).resolves.toMatchObject({ kind: "kiosk" });
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});

describe("getActor with a kiosk cookie", () => {
  it("prefers a person's session, and falls back to the kiosk", async () => {
    cookieJar.set("baumy_kiosk", "tok");
    findDevice.mockResolvedValue(DEVICE);
    getSession.mockResolvedValue(session);
    await expect(getActor()).resolves.toMatchObject({ kind: "member" });
    getSession.mockResolvedValue(null);
    await expect(getActor()).resolves.toMatchObject({
      kind: "kiosk",
      deviceId: "d_1",
    });
  });

  it("still resolves the kiosk where auth may not serve", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    cookieJar.set("baumy_kiosk", "tok");
    findDevice.mockResolvedValue(DEVICE);
    await expect(getActor()).resolves.toMatchObject({ kind: "kiosk" });
    expect(getSession).not.toHaveBeenCalled();
  });
});
