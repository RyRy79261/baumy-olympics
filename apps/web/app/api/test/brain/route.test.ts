// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearMemoryShopping } from "@/lib/integrations/brain-memory";
import { GET, POST } from "./route";

// The test-only Telegram stand-in: 404 outside test mode, a 400 for a bad
// body, and adds and check-offs on the fake brain's list.

function post(body: unknown) {
  return POST(
    new Request("http://localhost:3000/api/test/brain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  clearMemoryShopping();
});

describe("/api/test/brain", () => {
  it("does not exist outside test mode", async () => {
    vi.stubEnv("E2E_TEST_MODE", "");
    expect((await GET()).status).toBe(404);
    expect((await post({ add: ["milk"] })).status).toBe(404);
  });

  it("refuses a body it does not know", async () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    for (const body of ["not json", { add: [] }, { remove: ["milk"] }]) {
      expect((await post(body)).status).toBe(400);
    }
  });

  it("adds and checks off like Telegram, and lists what is open", async () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    const added = await post({ add: ["milk", "eggs"] });
    expect(await added.json()).toMatchObject({
      added: ["milk", "eggs"],
      already: [],
    });
    const off = await post({ checkOff: ["milk"] });
    expect(await off.json()).toMatchObject({ checkedOff: ["milk"] });
    const list = await (await GET()).json();
    expect(list.items.map((i: { item: string }) => i.item)).toEqual(["eggs"]);
  });
});
