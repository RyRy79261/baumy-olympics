import { beforeEach, describe, expect, it, vi } from "vitest";

// The proofs of "Confirm it's you" (issue #135), with Better Auth stubbed:
// each goes to the right endpoint with this request's headers, and a 4xx is
// a refusal while anything else is an outage.

let answer: () => Promise<unknown>;
const calls: { endpoint: string; body: unknown; headers: Headers }[] = [];

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "baumy.session_token=x" }),
}));
vi.mock("@baumy/auth", () => {
  const endpoint =
    (name: string) => (arg: { body: unknown; headers: Headers }) => {
      calls.push({ endpoint: name, ...arg });
      return answer();
    };
  return {
    getAuth: () => ({
      api: {
        verifyPassword: endpoint("verifyPassword"),
        verifyStepUpTotp: endpoint("verifyStepUpTotp"),
        verifyStepUpPasskey: endpoint("verifyStepUpPasskey"),
      },
    }),
  };
});

const { verifyPasskeyStepUp, verifyPasswordStepUp, verifyTotpStepUp } =
  await import("./step-up-verify");

const failWith = (statusCode?: number) => async () => {
  throw Object.assign(new Error("no"), statusCode ? { statusCode } : {});
};

beforeEach(() => {
  calls.length = 0;
});

describe.each([
  [
    "verifyPassword",
    () => verifyPasswordStepUp("pw"),
    { password: "pw" },
    true,
    false,
  ],
  // The code's answer is the time step it matched, so it is used once.
  [
    "verifyStepUpTotp",
    () => verifyTotpStepUp("123456"),
    { code: "123456" },
    77,
    null,
  ],
  [
    "verifyStepUpPasskey",
    () => verifyPasskeyStepUp({ id: "cred" }),
    { response: { id: "cred" } },
    true,
    false,
  ],
] as const)("%s", (endpoint, run, body, accepted, refused) => {
  it("answers what Better Auth accepted for this request's session", async () => {
    answer = async () => ({ step: 77 });
    await expect(run()).resolves.toBe(accepted);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ endpoint, body });
    expect(calls[0]!.headers.get("cookie")).toBe("baumy.session_token=x");
  });

  it("answers a refusal as no", async () => {
    answer = failWith(401);
    await expect(run()).resolves.toBe(refused);
    answer = failWith(400);
    await expect(run()).resolves.toBe(refused);
  });

  it("throws an outage", async () => {
    answer = failWith(500);
    await expect(run()).rejects.toThrow("no");
    answer = failWith();
    await expect(run()).rejects.toThrow("no");
  });
});
