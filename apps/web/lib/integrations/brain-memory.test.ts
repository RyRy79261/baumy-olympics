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
  clearMemoryShopping,
  memoryAdd,
  memoryBrain,
  memoryCheckOff,
  memoryShopping,
  normalizeItem,
} = await import("./brain-memory");

beforeEach(() => {
  clearMemoryShopping();
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
    const brain = memoryBrain();
    expect(BRAIN_DOWN_COOKIE).toBe("baumy_e2e_brain");
    jar.value = "down";
    const down = { ok: false, reason: "unavailable" };
    expect(await brain.listShopping()).toEqual(down);
    expect(await brain.addShopping(["eggs"])).toEqual(down);
    expect(await brain.checkOffShopping(["milk"])).toEqual(down);
    expect(memoryShopping().map((i) => i.item)).toEqual(["milk"]);
    jar.value = "up";
    expect((await brain.listShopping()).ok).toBe(true);
    jar.throws = true;
    expect((await brain.listShopping()).ok).toBe(true);
  });
});
