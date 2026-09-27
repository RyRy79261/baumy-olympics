import { beforeEach, describe, expect, it, vi } from "vitest";

// Better Auth's verifyPassword, stubbed: what it is called with, and how its
// answers map to true, false or a throw.

let answer: () => Promise<unknown>;
const calls: { body: unknown; headers: Headers }[] = [];

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "baumy.session_token=x" }),
}));
vi.mock("@baumy/auth", () => ({
  getAuth: () => ({
    api: {
      verifyPassword: (arg: { body: unknown; headers: Headers }) => {
        calls.push(arg);
        return answer();
      },
    },
  }),
}));

const { verifyCurrentPassword } = await import("./password-check");

function failWith(message: string, statusCode?: number) {
  return async () => {
    throw Object.assign(new Error(message), statusCode ? { statusCode } : {});
  };
}

beforeEach(() => {
  calls.length = 0;
});

describe("verifyCurrentPassword", () => {
  it("is true when Better Auth accepts the password for this request's session", async () => {
    answer = async () => ({ status: true });
    await expect(verifyCurrentPassword("pw")).resolves.toBe(true);
    expect(calls[0]?.body).toEqual({ password: "pw" });
    expect(calls[0]?.headers.get("cookie")).toBe("baumy.session_token=x");
  });

  it("is false for a refusal (wrong password, no session)", async () => {
    answer = failWith("Invalid password", 400);
    await expect(verifyCurrentPassword("pw")).resolves.toBe(false);
    answer = failWith("Unauthorized", 401);
    await expect(verifyCurrentPassword("pw")).resolves.toBe(false);
  });

  it("throws an outage instead of calling it a wrong password", async () => {
    answer = failWith("db down", 500);
    await expect(verifyCurrentPassword("pw")).rejects.toThrow("db down");
    answer = failWith("boom");
    await expect(verifyCurrentPassword("pw")).rejects.toThrow("boom");
  });
});
