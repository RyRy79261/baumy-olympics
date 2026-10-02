// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "@baumy/db";
import { insertLoginRequest } from "@baumy/db/login-requests";
import { loginRequests } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import { seedMember } from "@/test-utils/actions";
import {
  clearMemoryLoginApprovals,
  memoryBrain,
} from "@/lib/integrations/brain-memory";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import { GET, POST } from "./route";

// The test-only Telegram DM (issue #80): 404 outside test mode, what the fake
// brain "sent", and a tap that runs through the real brain endpoint.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const TG = 5_000_000_901;

afterEach(() => {
  vi.unstubAllEnvs();
  clearMemoryLoginApprovals();
  __resetMemoryRateLimits();
});

const get = (tg: string) =>
  GET(
    new Request(`http://localhost/api/test/brain/login?telegramUserId=${tg}`),
  );
const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/test/brain/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

async function dmFor(memberId: string, secret: string) {
  const { id, expiresAt } = await insertLoginRequest(db(), {
    memberId,
    secret,
    code: 47,
    choices: [12, 47, 83],
    device: "Chrome on macOS",
    now: new Date(),
  });
  await memoryBrain().requestLoginApproval({
    requestId: id,
    telegramUserId: TG,
    device: "Chrome on macOS",
    choices: [12, 47, 83],
    expiresAt: expiresAt.toISOString(),
  });
  return id;
}

describe("/api/test/brain/login", () => {
  it("does not exist outside test mode", async () => {
    vi.stubEnv("E2E_TEST_MODE", "");
    expect((await get(String(TG))).status).toBe(404);
    expect((await post({ telegramUserId: TG, tap: 47 })).status).toBe(404);
  });

  it("refuses what it does not know", async () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    expect((await get("nope")).status).toBe(400);
    for (const body of ["x", { telegramUserId: TG }, { tap: 47 }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect((await post({ telegramUserId: TG, tap: 47 })).status).toBe(404);
  });

  it("shows the DM and taps the number through the brain endpoint", async () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    const ryan = await seedMember(db(), { telegramUserId: TG });
    expect(await (await get(String(TG))).json()).toEqual({ message: null });
    const id = await dmFor(ryan, "E".repeat(43));
    const shown = await (await get(String(TG))).json();
    expect(shown.message).toMatchObject({
      requestId: id,
      device: "Chrome on macOS",
      choices: [12, 47, 83],
    });
    const res = await post({ telegramUserId: TG, tap: 47 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      data: {
        outcome: "approved",
        device: "Chrome on macOS",
        purpose: "sign_in",
      },
    });
    const [row] = await t.db().select().from(loginRequests);
    expect(row?.status).toBe("approved");
  });

  it("taps Deny", async () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    const ryan = await seedMember(db(), { telegramUserId: TG });
    await dmFor(ryan, "F".repeat(43));
    const res = await post({ telegramUserId: TG, tap: "deny" });
    expect((await res.json()).data.outcome).toBe("denied");
  });
});
