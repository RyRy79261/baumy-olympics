// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BRAIN_TIMEOUT_MS,
  SHOPPING_CACHE_MS,
  brainClient,
  brainConfig,
  cachedBrain,
  forgetShoppingReads,
  httpBrain,
  setBrainClientForTests,
  unconfiguredBrain,
  type BrainClient,
  type BrainConfig,
} from "./brain";
import { clearMemoryShopping, memoryAdd } from "./brain-memory";

// The brain client against `fetch` mocks (issue #26): the requests it sends,
// the result union for every kind of failure, the logs (status only, never
// the token), the 30s cache and which client each environment gets.

const CONFIG: BrainConfig = {
  baseUrl: "https://brain.example.com",
  token: "kitchen-token-0123456789abcdef",
};

const ITEM = {
  id: 7,
  item: "Milk",
  addedBy: null,
  createdAt: "2026-09-27T09:00:00.000Z",
};
// ITEM is what a brain from before its PR #30 sends: no `category`, which
// reads as "Not sorted" (issue #208).
const ENTRY = {
  id: "7",
  item: "Milk",
  addedAt: "2026-09-27T09:00:00.000Z",
  category: null,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(answer: (url: string, init: RequestInit) => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const logs: string[] = [];
  const fetchMock = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return answer(String(url), init!);
    },
  );
  const client = httpBrain(CONFIG, {
    fetch: fetchMock as unknown as typeof fetch,
    env: { KITCHEN_API_TOKEN: CONFIG.token },
    log: (l) => logs.push(l),
  });
  return { client, calls, logs };
}

beforeEach(() => forgetShoppingReads());

describe("brainConfig", () => {
  it("needs both the address and the token", () => {
    expect(brainConfig({})).toBeNull();
    expect(brainConfig({ BRAIN_BASE_URL: "https://b.example.com" })).toBeNull();
    expect(brainConfig({ KITCHEN_API_TOKEN: "t" })).toBeNull();
    expect(
      brainConfig({ BRAIN_BASE_URL: "  ", KITCHEN_API_TOKEN: "t" }),
    ).toBeNull();
  });

  it("drops trailing slashes and refuses what is not an http(s) URL", () => {
    expect(
      brainConfig({
        BRAIN_BASE_URL: " https://b.example.com/ ",
        KITCHEN_API_TOKEN: " tok ",
      }),
    ).toEqual({ baseUrl: "https://b.example.com", token: "tok" });
    expect(
      brainConfig({ BRAIN_BASE_URL: "not a url", KITCHEN_API_TOKEN: "t" }),
    ).toBeNull();
    expect(
      brainConfig({
        BRAIN_BASE_URL: "ftp://b.example.com",
        KITCHEN_API_TOKEN: "t",
      }),
    ).toBeNull();
  });

  it("sends the token over plain http to this machine only", () => {
    expect(
      brainConfig({
        BRAIN_BASE_URL: "http://b.example.com",
        KITCHEN_API_TOKEN: "t",
      }),
    ).toBeNull();
    expect(
      brainConfig({
        BRAIN_BASE_URL: "http://localhost:3001/",
        KITCHEN_API_TOKEN: "t",
      }),
    ).toEqual({ baseUrl: "http://localhost:3001", token: "t" });
    for (const url of [
      "https://b.example.com/?x=1",
      "https://b.example.com/#top",
      "https://user:pw@b.example.com",
    ]) {
      expect(
        brainConfig({ BRAIN_BASE_URL: url, KITCHEN_API_TOKEN: "t" }),
      ).toBeNull();
    }
  });
});

describe("httpBrain", () => {
  it("reads the list with the token and a 5s timeout", async () => {
    const { client, calls } = setup(async () =>
      json({ ok: true, items: [ITEM] }),
    );
    expect(await client.listShopping()).toEqual({ ok: true, data: [ENTRY] });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://brain.example.com/api/kitchen/shopping",
    );
    const init = calls[0]!.init;
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${CONFIG.token}`,
    );
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(BRAIN_TIMEOUT_MS).toBe(5000);
  });

  it("adds items with a JSON body", async () => {
    const { client, calls } = setup(async () =>
      json({
        ok: true,
        added: ["Milk"],
        already: ["eggs"],
        attributedTo: null,
        items: [ITEM],
      }),
    );
    expect(await client.addShopping(["Milk", "eggs"])).toEqual({
      ok: true,
      data: { added: ["Milk"], already: ["eggs"], items: [ENTRY] },
    });
    expect(calls[0]!.url).toBe(
      "https://brain.example.com/api/kitchen/shopping/add",
    );
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      items: ["Milk", "eggs"],
    });
    expect(
      (calls[0]!.init.headers as Record<string, string>)["Content-Type"],
    ).toBe("application/json");
  });

  it("checks items off", async () => {
    const { client, calls } = setup(async () =>
      json({
        ok: true,
        checkedOff: ["Milk"],
        notFound: ["tea"],
        attributedTo: null,
        items: [],
      }),
    );
    expect(await client.checkOffShopping(["milk", "tea"])).toEqual({
      ok: true,
      data: { checkedOff: ["Milk"], notFound: ["tea"], items: [] },
    });
    expect(calls[0]!.url).toBe(
      "https://brain.example.com/api/kitchen/shopping/checkoff",
    );
  });

  // Issue #208: brain's PR #30 adds `category` to every item.
  it("reads each item's group, and a missing or unknown one as Not sorted", async () => {
    const { client } = setup(async () =>
      json({
        ok: true,
        items: [
          { ...ITEM, id: "a", category: "coffee" },
          { ...ITEM, id: "b", category: null },
          { ...ITEM, id: "c" },
          { ...ITEM, id: "d", category: "garden" },
          { ...ITEM, id: "e", category: "Coffee" },
          { ...ITEM, id: "f", category: 3, sortedBy: "guess", extra: {} },
        ],
      }),
    );
    const r = await client.listShopping();
    expect(r.ok && r.data.map((i) => [i.id, i.category])).toEqual([
      ["a", "coffee"],
      ["b", null],
      ["c", null],
      ["d", null],
      ["e", null],
      ["f", null],
    ]);
    // Fields it does not read never reach the entries.
    expect(r.ok && r.data[5]).toEqual({ ...ENTRY, id: "f" });
  });

  it("puts an item in a group by id, sending only what was asked", async () => {
    const id = "6f1f3f0d-2a11-4c38-9a53-0b0e6c1a3a7e";
    const { client, calls } = setup(async () =>
      json({
        ok: true,
        outcome: "set",
        id,
        item: "Milk",
        category: "fresh",
        attributedTo: "42",
        items: [{ ...ITEM, id, category: "fresh" }],
      }),
    );
    expect(
      await client.setShoppingCategory({
        id,
        category: "fresh",
        telegramUserId: 42,
      }),
    ).toEqual({
      ok: true,
      data: {
        outcome: "set",
        id,
        item: "Milk",
        category: "fresh",
        items: [{ ...ENTRY, id, category: "fresh" }],
      },
    });
    expect(calls[0]!.url).toBe(
      "https://brain.example.com/api/kitchen/shopping/category",
    );
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      id,
      category: "fresh",
      telegramUserId: 42,
    });
  });

  it("puts an item in no group by name, and passes on a miss or two matches", async () => {
    const { client, calls } = setup(async (_url, init) => {
      const body = JSON.parse(String(init.body)) as { item: string };
      return body.item === "milk"
        ? json({
            ok: true,
            outcome: "ambiguous",
            item: "milk",
            category: null,
            matches: ["Milk", "Oat milk"],
            attributedTo: null,
            items: [ITEM],
          })
        : json({
            ok: true,
            outcome: "not_found",
            item: body.item,
            category: null,
            attributedTo: null,
            items: [ITEM],
          });
    });
    expect(
      await client.setShoppingCategory({ item: "milk", category: null }),
    ).toEqual({
      ok: true,
      data: {
        outcome: "ambiguous",
        item: "milk",
        category: null,
        matches: ["Milk", "Oat milk"],
        items: [ENTRY],
      },
    });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      item: "milk",
      category: null,
    });
    expect(
      await client.setShoppingCategory({ item: "tea", category: "coffee" }),
    ).toEqual({
      ok: true,
      data: {
        outcome: "not_found",
        item: "tea",
        category: null,
        items: [ENTRY],
      },
    });
  });

  it("answers unavailable when brain refuses a group or has no such route", async () => {
    for (const [status, body] of [
      [400, { ok: false, error: "bad_request" }],
      // A brain from before its PR #30.
      [404, { ok: false }],
      [200, { ok: true, outcome: "moved", item: "x", items: [] }],
    ] as const) {
      const { client, logs } = setup(async () => json(body, status));
      expect(
        await client.setShoppingCategory({ item: "x", category: "coffee" }),
      ).toEqual({ ok: false, reason: "unavailable" });
      expect(logs[0]).toContain("[brain] category failed");
    }
  });

  it("asks for a sign-in approval DM with the message as its body", async () => {
    const { client, calls } = setup(async () => json({ ok: true, sent: true }));
    const message = {
      requestId: "0b0e6c1a-3a7e-4c38-9a53-6f1f3f0d2a11",
      telegramUserId: 42,
      device: "Chrome on macOS",
      choices: [12, 47, 83],
      expiresAt: "2026-09-28T10:02:00.000Z",
    };
    expect(await client.requestLoginApproval(message)).toEqual({
      ok: true,
      data: { sent: true },
    });
    expect(calls[0]!.url).toBe(
      "https://brain.example.com/api/kitchen/login-approval",
    );
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(message);
    expect(
      (calls[0]!.init.headers as Record<string, string>).Authorization,
    ).toBe(`Bearer ${CONFIG.token}`);
    // Brain knows no such member: not an error, just not sent.
    const unknown = setup(async () => json({ ok: true, sent: false }));
    expect(await unknown.client.requestLoginApproval(message)).toEqual({
      ok: true,
      data: { sent: false },
    });
    const down = setup(async () => json({ ok: false }, 500));
    expect(await down.client.requestLoginApproval(message)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("answers not_configured when brain is not in the house group yet", async () => {
    const { client, logs } = setup(async () =>
      json({ ok: false, error: "not_configured", message: "…" }, 503),
    );
    expect(await client.listShopping()).toEqual({
      ok: false,
      reason: "not_configured",
    });
    expect(logs[0]).toContain("not in the house group");
  });

  it("answers unavailable for any other failure, logging the status only", async () => {
    for (const [status, hint] of [
      [401, "KITCHEN_API_TOKEN"],
      [500, "HTTP 500"],
      [503, "HTTP 503"],
    ] as const) {
      const { client, logs } = setup(async () =>
        json({ ok: false, error: "secret detail from brain" }, status),
      );
      expect(await client.addShopping(["milk"])).toEqual({
        ok: false,
        reason: "unavailable",
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain(`[brain] add failed: HTTP ${status}`);
      expect(logs[0]).toContain(hint);
      expect(logs[0]).not.toContain("secret detail");
    }
  });

  it("answers unavailable for an answer it does not understand", async () => {
    for (const body of [{ ok: true }, { ok: true, items: [{ id: 1 }] }]) {
      const { client, logs } = setup(async () => json(body));
      expect(await client.checkOffShopping(["milk"])).toEqual({
        ok: false,
        reason: "unavailable",
      });
      expect(logs[0]).toContain("shape this app does not know");
    }
    const { client } = setup(
      async () => new Response("<html>", { status: 200 }),
    );
    expect((await client.listShopping()).ok).toBe(false);
  });

  it("answers unavailable on a timeout", async () => {
    const { client, logs } = setup(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    expect(await client.listShopping()).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(logs[0]).toBe("[brain] list failed: timed out");
  });

  it("really times out a request that hangs", async () => {
    const client = httpBrain(CONFIG, {
      timeoutMs: 20,
      log: () => {},
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal!.addEventListener("abort", () =>
            reject(init.signal!.reason),
          );
        })) as unknown as typeof fetch,
    });
    expect(await client.listShopping()).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("never logs the token, even when a network error names it", async () => {
    const { client, logs } = setup(async () => {
      throw new Error(`connect ECONNREFUSED Bearer ${CONFIG.token}`);
    });
    expect((await client.listShopping()).ok).toBe(false);
    expect(logs[0]).toContain("ECONNREFUSED");
    expect(logs[0]).not.toContain(CONFIG.token);
    const other = httpBrain(CONFIG, {
      env: {},
      log: (l) => logs.push(l),
      fetch: (async () => {
        throw "plain " + CONFIG.token;
      }) as unknown as typeof fetch,
    });
    expect((await other.listShopping()).ok).toBe(false);
    expect(logs[1]).toBe("[brain] list failed: plain [redacted]");
  });
});

describe("cachedBrain", () => {
  function counting(): BrainClient & { reads: number; fail: boolean } {
    const c = {
      reads: 0,
      fail: false,
      async listShopping() {
        c.reads += 1;
        return c.fail
          ? ({ ok: false, reason: "unavailable" } as const)
          : {
              ok: true as const,
              data: [{ ...ENTRY, item: `read ${c.reads}` }],
            };
      },
      addShopping: async () => ({ ok: false, reason: "unavailable" }) as const,
      checkOffShopping: async () => {
        throw new Error("boom");
      },
      setShoppingCategory: async () =>
        ({ ok: false, reason: "unavailable" }) as const,
      requestLoginApproval: async () =>
        ({ ok: true, data: { sent: true } }) as const,
    };
    return c;
  }

  it("passes a sign-in approval straight through, keeping the list", async () => {
    let t = 1_000_000;
    const inner = counting();
    const client = cachedBrain(inner, () => t);
    await client.listShopping();
    expect(
      await client.requestLoginApproval({
        requestId: "r",
        telegramUserId: 1,
        device: "d",
        choices: [10, 11, 12],
        expiresAt: "2026-09-28T10:02:00.000Z",
      }),
    ).toEqual({ ok: true, data: { sent: true } });
    t += 1;
    await client.listShopping();
    expect(inner.reads).toBe(1);
  });

  it("reuses a read for 30 seconds", async () => {
    let t = 1_000_000;
    const inner = counting();
    const client = cachedBrain(inner, () => t);
    await client.listShopping();
    t += SHOPPING_CACHE_MS - 1;
    const again = await client.listShopping();
    expect(inner.reads).toBe(1);
    expect(again).toEqual({ ok: true, data: [{ ...ENTRY, item: "read 1" }] });
    t += 1;
    await client.listShopping();
    expect(inner.reads).toBe(2);
  });

  it("never keeps a failure", async () => {
    const inner = counting();
    inner.fail = true;
    const client = cachedBrain(inner, () => 0);
    await client.listShopping();
    inner.fail = false;
    expect((await client.listShopping()).ok).toBe(true);
    expect(inner.reads).toBe(2);
  });

  it("forgets the list on every write, failed or thrown", async () => {
    const inner = counting();
    const client = cachedBrain(inner, () => 0);
    await client.listShopping();
    await client.addShopping(["milk"]);
    await client.listShopping();
    expect(inner.reads).toBe(2);
    await expect(client.checkOffShopping(["milk"])).rejects.toThrow("boom");
    await client.listShopping();
    expect(inner.reads).toBe(3);
    await client.setShoppingCategory({ item: "milk", category: "fresh" });
    await client.listShopping();
    expect(inner.reads).toBe(4);
  });

  it("forgets the list when the kiosk's refresh asks", async () => {
    const inner = counting();
    const client = cachedBrain(inner, () => 0);
    await client.listShopping();
    forgetShoppingReads();
    await client.listShopping();
    expect(inner.reads).toBe(2);
  });

  it("uses the server clock by default", async () => {
    const inner = counting();
    const client = cachedBrain(inner);
    await client.listShopping();
    await client.listShopping();
    expect(inner.reads).toBe(1);
  });
});

describe("brainClient", () => {
  afterEach(() => {
    setBrainClientForTests(null);
    clearMemoryShopping();
  });

  it("is not configured without BRAIN_BASE_URL and KITCHEN_API_TOKEN", async () => {
    const client = brainClient({});
    expect(client).toBe(unconfiguredBrain);
    for (const r of [
      await client.listShopping(),
      await client.addShopping(["milk"]),
      await client.checkOffShopping(["milk"]),
      await client.setShoppingCategory({ item: "milk", category: null }),
      await client.requestLoginApproval({
        requestId: "r",
        telegramUserId: 1,
        device: "d",
        choices: [10, 11, 12],
        expiresAt: "2026-09-28T10:02:00.000Z",
      }),
    ]) {
      expect(r).toEqual({ ok: false, reason: "not_configured" });
    }
  });

  it("is the in-memory fake in E2E test mode, even with a real config", async () => {
    memoryAdd(["Fake milk"]);
    const client = brainClient({
      E2E_TEST_MODE: "1",
      BRAIN_BASE_URL: "https://brain.example.com",
      KITCHEN_API_TOKEN: "t",
    });
    const r = await client.listShopping();
    expect(r.ok && r.data.map((i) => i.item)).toEqual(["Fake milk"]);
  });

  it("talks HTTP when configured", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(json({ ok: true, items: [ITEM] }));
    try {
      const client = brainClient({
        BRAIN_BASE_URL: "https://brain.example.com/",
        KITCHEN_API_TOKEN: "t",
      });
      expect(await client.listShopping()).toEqual({ ok: true, data: [ENTRY] });
      expect(String(fetchMock.mock.calls[0]![0])).toBe(
        "https://brain.example.com/api/kitchen/shopping",
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("answers with the test override", () => {
    setBrainClientForTests(unconfiguredBrain);
    expect(brainClient({ E2E_TEST_MODE: "1" })).toBe(unconfiguredBrain);
  });
});
