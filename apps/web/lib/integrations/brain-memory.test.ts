// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The E2E fake brain (issue #26): it behaves like baumy-brain's kitchen API,
// and a browser carrying the "down" cookie gets `unavailable` from it.

const jar = vi.hoisted(() => ({
  value: undefined as string | undefined,
  throws: false,
}));
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (jar.throws) throw new Error("outside a request");
    return {
      get: (name: string) =>
        name === "baumy_e2e_brain" && jar.value !== undefined
          ? { name, value: jar.value }
          : undefined,
    };
  },
}));

const {
  BRAIN_DOWN_COOKIE,
  clearMemoryLoginApprovals,
  clearMemoryShopping,
  downWhenAsked,
  memoryLoginApproval,
  memoryAdd,
  memoryBrain,
  memoryCheckOff,
  memoryShopping,
  normalizeItem,
} = await import("./brain-memory");

const DM = {
  requestId: "0b0e6c1a-3a7e-4c38-9a53-6f1f3f0d2a11",
  telegramUserId: 42,
  device: "Chrome on macOS",
  choices: [12, 47, 83],
  expiresAt: "2026-09-28T10:02:00.000Z",
};

beforeEach(() => {
  clearMemoryShopping();
  clearMemoryLoginApprovals();
  jar.value = undefined;
  jar.throws = false;
});

describe("the fake brain", () => {
  it("adds new items, oldest first, and leaves open ones alone", async () => {
    const brain = memoryBrain();
    const first = await brain.addShopping(["Milk", "  eggs  ", " "]);
    expect(first.ok && first.data.added).toEqual(["Milk", "eggs"]);
    const again = await brain.addShopping(["MILK", "bread"]);
    expect(again.ok && again.data).toMatchObject({
      added: ["bread"],
      already: ["MILK"],
    });
    const list = await brain.listShopping();
    expect(list.ok && list.data.map((i) => i.item)).toEqual([
      "Milk",
      "eggs",
      "bread",
    ]);
    expect(list.ok && list.data[0]!.id).toBe("1");
  });

  it("checks off by the normalised name", async () => {
    memoryAdd(["Oat  Milk", "eggs"]);
    const brain = memoryBrain();
    const r = await brain.checkOffShopping(["oat milk", "tea "]);
    expect(r.ok && r.data).toEqual({
      checkedOff: ["Oat Milk"],
      notFound: ["tea"],
      items: [expect.objectContaining({ item: "eggs" })],
    });
    expect(memoryShopping().map((i) => i.item)).toEqual(["eggs"]);
    expect(memoryCheckOff(["eggs"])).toEqual({
      checkedOff: ["eggs"],
      notFound: [],
    });
  });

  it("normalises case and spacing", () => {
    expect(normalizeItem("  Oat \t MILK ")).toBe("oat milk");
  });

  it("is down for a browser with the cookie, and only for it", async () => {
    memoryAdd(["milk"]);
    const brain = downWhenAsked(memoryBrain());
    expect(BRAIN_DOWN_COOKIE).toBe("baumy_e2e_brain");
    jar.value = "down";
    const down = { ok: false, reason: "unavailable" };
    expect(await brain.listShopping()).toEqual(down);
    expect(await brain.addShopping(["eggs"])).toEqual(down);
    expect(await brain.checkOffShopping(["milk"])).toEqual(down);
    expect(await brain.requestLoginApproval(DM)).toEqual(down);
    expect(memoryLoginApproval(DM.telegramUserId)).toBeNull();
    expect(memoryShopping().map((i) => i.item)).toEqual(["milk"]);
    jar.value = "up";
    expect((await brain.listShopping()).ok).toBe(true);
    jar.throws = true;
    expect((await brain.listShopping()).ok).toBe(true);
  });
});

describe("the fake approval DMs", () => {
  it("keeps what brain would send, newest per Telegram user", async () => {
    const brain = memoryBrain();
    expect(memoryLoginApproval(42)).toBeNull();
    expect(await brain.requestLoginApproval(DM)).toEqual({
      ok: true,
      data: { sent: true },
    });
    const newer = { ...DM, requestId: "second", choices: [20, 30, 40] };
    await brain.requestLoginApproval(newer);
    await brain.requestLoginApproval({ ...DM, telegramUserId: 7 });
    expect(memoryLoginApproval(42)).toEqual(newer);
    expect(memoryLoginApproval(99)).toBeNull();
  });

  it("keeps only the last 200", async () => {
    const brain = memoryBrain();
    await brain.requestLoginApproval(DM);
    for (let i = 0; i < 200; i++) {
      await brain.requestLoginApproval({ ...DM, telegramUserId: 1000 + i });
    }
    expect(memoryLoginApproval(42)).toBeNull();
    expect(memoryLoginApproval(1199)).not.toBeNull();
  });
});
