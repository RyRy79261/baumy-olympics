import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as AuthModule from "@baumy/auth";

// getActor against a mocked Better Auth: what it returns for each kind of
// session, and that a Vercel deployment without a secret never reads one.

const getSession = vi.fn();
const headersMock = vi.fn(async () => new Headers({ cookie: "x=y" }));
const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT ${to}`);
});

vi.mock("next/headers", () => ({ headers: () => headersMock() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));
vi.mock("@baumy/auth", async (importOriginal) => {
  const real = await importOriginal<typeof AuthModule>();
  return {
    authMayServe: real.authMayServe,
    getAuth: () => ({ api: { getSession } }),
  };
});

const { getActor, getActorOrRedirect, redirectIfSignedIn } =
  await import("./auth");

const session = {
  user: { id: "u_1", email: "ryan@example.com", name: "Ryan" },
  session: { id: "s_1" },
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("BETTER_AUTH_SECRET", "");
  getSession.mockReset();
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
    });
    const passed = getSession.mock.calls[0]?.[0] as { headers: Headers };
    expect(passed.headers.get("cookie")).toBe("x=y");
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
    getSession.mockResolvedValue(session);
    await expect(redirectIfSignedIn()).rejects.toThrow("NEXT_REDIRECT /");
  });
});
