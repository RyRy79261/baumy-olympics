import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as AuthModule from "@baumy/auth";

// The fail-closed wrapper around Better Auth's handler.

const handlerGet = vi.fn(async () => new Response("get", { status: 200 }));
const handlerPost = vi.fn(async () => new Response("post", { status: 200 }));
const getAuth = vi.fn(() => ({}));

vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: () => ({ GET: handlerGet, POST: handlerPost }),
}));
vi.mock("@baumy/auth", async (importOriginal) => {
  const real = await importOriginal<typeof AuthModule>();
  return { authMayServe: real.authMayServe, getAuth };
});

const { GET, POST } = await import("./route");

const req = (method: string) =>
  new Request("http://localhost:3000/api/auth/get-session", { method });

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("BETTER_AUTH_SECRET", "");
  handlerGet.mockClear();
  handlerPost.mockClear();
  getAuth.mockClear();
});

describe("/api/auth/[...path]", () => {
  it("hands requests to Better Auth off Vercel", async () => {
    expect(await (await GET(req("GET"))).text()).toBe("get");
    expect(await (await POST(req("POST"))).text()).toBe("post");
    expect(handlerGet).toHaveBeenCalledTimes(1);
    expect(handlerPost).toHaveBeenCalledTimes(1);
  });

  it("answers 503 on Vercel without a secret, and never builds the instance", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    for (const res of [await GET(req("GET")), await POST(req("POST"))]) {
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        message: expect.stringContaining("BETTER_AUTH_SECRET"),
      });
    }
    expect(handlerGet).not.toHaveBeenCalled();
    expect(handlerPost).not.toHaveBeenCalled();
    expect(getAuth).not.toHaveBeenCalled();
  });

  it("serves on Vercel once the secret is set", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BETTER_AUTH_SECRET", "a-real-secret-that-is-long-enough-012");
    expect((await GET(req("GET"))).status).toBe(200);
  });
});
