// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Queryable, Tx } from "@baumy/db";
import { actionRequests, auditEvents } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  accountActor,
  allowAll,
  ctxFor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import type { Actor } from "@/lib/auth";
import {
  cachedBrain,
  forgetShoppingReads,
  setBrainClientForTests,
  unconfiguredBrain,
  type BrainClient,
} from "@/lib/integrations/brain";
import {
  clearMemoryShopping,
  memoryAdd,
  memoryBrain,
  memoryShopping,
} from "@/lib/integrations/brain-memory";
import type { RequestCtx } from "./define";
import { REGISTRY } from "./registry";
import { createRunner, defaultDeps, type RunnerDeps } from "./run";
import { shoppingFailure } from "./shopping";
import { listPhrase } from "./shopping-text";

// The shopping actions through the real runner on PGlite (issue #26):
// success, each error code, the surfaces and the permissions, the audit row,
// the undo when it cannot be written, and that no database transaction is
// open while brain is called (the depth each brain call sees must be 0).

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

let txDepth = 0;
/** The open-transaction depth at each brain call, by method. */
let seen: [string, number][] = [];
/** What each group pick asked brain for. */
let picks: unknown[] = [];
let txCalls = 0;
let failTxAt: number | null = null;

function failNextAudit() {
  failTxAt = txCalls + 2;
}

function watching(inner: BrainClient): BrainClient {
  const out = {} as BrainClient;
  for (const key of Object.keys(inner) as (keyof BrainClient)[]) {
    out[key] = (async (...args: unknown[]) => {
      seen.push([key, txDepth]);
      if (key === "setShoppingCategory") picks.push(args[0]);
      return (inner[key] as (...a: unknown[]) => unknown)(...args);
    }) as never;
  }
  return out;
}

let run: ReturnType<typeof createRunner>;

beforeEach(() => {
  txDepth = 0;
  seen = [];
  picks = [];
  txCalls = 0;
  failTxAt = null;
  clearMemoryShopping();
  forgetShoppingReads();
  setBrainClientForTests(watching(memoryBrain()));
  const deps: RunnerDeps = {
    ...defaultDeps,
    rateLimiter: allowAll,
    logError: () => {},
    withTransaction: async <T>(fn: (tx: Tx) => Promise<T>) => {
      txCalls += 1;
      if (txCalls === failTxAt) throw new Error("connection reset");
      txDepth += 1;
      try {
        return await defaultDeps.withTransaction(fn);
      } finally {
        txDepth -= 1;
      }
    },
  };
  run = createRunner(REGISTRY, deps);
});

afterEach(() => setBrainClientForTests(null));

function ok<T>(r: { ok: true; data: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.data as T;
}

const kiosk = (memberId?: string): Actor => ({
  kind: "kiosk",
  deviceId: "dev-1",
  ...(memberId ? { memberId, displayName: "K" } : {}),
});
const mcp = (memberId: string, scopes = ["baumy:read", "baumy:write"]) =>
  ({ kind: "mcp", memberId, scopes }) as Actor;
const brain = (memberId: string): Actor => ({
  kind: "service",
  tokenName: "baumy-brain",
  memberId,
});

const names = () => memoryShopping().map((i) => i.item);
const audits = () => t.db().select().from(auditEvents);
const requests = () => t.db().select().from(actionRequests);

describe("add_shopping_items", () => {
  it("adds every item in one call to brain, with no transaction open, and audits it", async () => {
    const me = await seedMember(db());
    const data = ok(
      await run(
        "add_shopping_items",
        { items: ["milk", "eggs"] },
        ctxFor(sessionActor(me)),
      ),
    ) as { added: string[]; already: string[]; items: { item: string }[] };
    expect(data.added).toEqual(["milk", "eggs"]);
    expect(data.items.map((i) => i.item)).toEqual(["milk", "eggs"]);
    expect(seen).toEqual([["addShopping", 0]]);
    expect(names()).toEqual(["milk", "eggs"]);
    const [row] = await audits();
    expect(row).toMatchObject({
      action: "add_shopping_items",
      entity: "shopping_list",
      actorMemberId: me,
      source: "ui",
      payload: { items: ["milk", "eggs"], added: ["milk", "eggs"] },
    });
    expect((await requests())[0]).toMatchObject({ status: "done" });
  });

  it("takes one form field's item as it is, commas and all", async () => {
    const me = await seedMember(db());
    ok(
      await run(
        "add_shopping_items",
        { items: "Bread, wholemeal" },
        ctxFor(kiosk(me), { source: "kiosk" }),
      ),
    );
    expect(names()).toEqual(["Bread, wholemeal"]);
  });

  it("takes a JSON-string array from an MCP client as its items (issue #206)", async () => {
    const me = await seedMember(db());
    const data = ok(
      await run(
        "add_shopping_items",
        { items: '["Ginger"]' },
        ctxFor(mcp(me), { source: "mcp" }),
      ),
    ) as { added: string[] };
    expect(data.added).toEqual(["Ginger"]);
    ok(
      await run(
        "add_shopping_items",
        { items: '["a","b"]' },
        ctxFor(mcp(me), { source: "mcp" }),
      ),
    );
    expect(names()).toEqual(["Ginger", "a", "b"]);
  });

  it("refuses the whole call when one item is too long, and names it", async () => {
    const me = await seedMember(db());
    const long = `Organic oat milk ${"x".repeat(80)}`;
    const res = await run(
      "add_shopping_items",
      { items: ["milk", long] },
      ctxFor(mcp(me), { source: "mcp" }),
    );
    expect(res).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      issues: [
        {
          path: ["items", 1],
          message: '"Organic oat milk xxx…" is over 80 characters.',
        },
      ],
    });
    expect(seen).toEqual([]);
    expect(names()).toEqual([]);
  });

  it("says what was on the list already", async () => {
    const me = await seedMember(db());
    memoryAdd(["Milk"]);
    const data = ok(
      await run(
        "add_shopping_items",
        { items: ["milk", "tea"] },
        ctxFor(sessionActor(me)),
      ),
    );
    expect(data).toMatchObject({ added: ["tea"], already: ["milk"] });
  });

  it("replays the same request without asking brain twice", async () => {
    const me = await seedMember(db());
    const ctx = ctxFor(sessionActor(me));
    const first = await run("add_shopping_items", { items: ["milk"] }, ctx);
    expect(await run("add_shopping_items", { items: ["milk"] }, ctx)).toEqual(
      first,
    );
    expect(seen.map(([m]) => m)).toEqual(["addShopping"]);
    expect(await audits()).toHaveLength(1);
  });

  it("checks the new items off again when the audit cannot be written", async () => {
    const me = await seedMember(db());
    memoryAdd(["tea"]);
    failNextAudit();
    const res = await run(
      "add_shopping_items",
      { items: ["milk", "tea"] },
      ctxFor(sessionActor(me)),
    );
    expect(res).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(seen).toEqual([
      ["addShopping", 0],
      ["checkOffShopping", 0],
    ]);
    // Only what this request added is taken off again.
    expect(names()).toEqual(["tea"]);
    expect(await audits()).toHaveLength(0);
    expect((await requests())[0]).toMatchObject({ status: "failed" });
  });

  it("undoes nothing when nothing was new", async () => {
    const me = await seedMember(db());
    memoryAdd(["tea"]);
    failNextAudit();
    await run(
      "add_shopping_items",
      { items: ["tea"] },
      ctxFor(sessionActor(me)),
    );
    expect(seen).toEqual([["addShopping", 0]]);
    expect(names()).toEqual(["tea"]);
  });

  it("says the list is not connected, or unavailable, and stores nothing", async () => {
    const me = await seedMember(db());
    setBrainClientForTests(unconfiguredBrain);
    expect(
      await run(
        "add_shopping_items",
        { items: ["milk"] },
        ctxFor(sessionActor(me)),
      ),
    ).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
    setBrainClientForTests({
      ...unconfiguredBrain,
      addShopping: async () => ({ ok: false, reason: "unavailable" }),
    });
    expect(
      await run(
        "add_shopping_items",
        { items: ["milk"] },
        ctxFor(sessionActor(me)),
      ),
    ).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
      message: expect.stringContaining("unavailable"),
    });
    expect(await audits()).toHaveLength(0);
  });

  it("checks the items before calling brain", async () => {
    const me = await seedMember(db());
    for (const items of [[], "", ["x".repeat(81)]]) {
      expect(
        await run("add_shopping_items", { items }, ctxFor(sessionActor(me))),
      ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
    expect(seen).toEqual([]);
  });

  it("needs a member, and a kiosk with someone picked; no PIN", async () => {
    const me = await seedMember(db());
    const denied: [Actor, RequestCtx["source"]][] = [
      [accountActor("nobody"), "ui"],
      [kiosk(), "kiosk"],
      [mcp(me, ["baumy:read"]), "mcp"],
    ];
    for (const [actor, source] of denied) {
      expect(
        await run(
          "add_shopping_items",
          { items: ["milk"] },
          ctxFor(actor, { source }),
        ),
        source,
      ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect(seen).toEqual([]);
    const allowed: [Actor, RequestCtx["source"]][] = [
      [kiosk(me), "kiosk"],
      [mcp(me), "mcp"],
      [sessionActor(me), "ai"],
    ];
    for (const [actor, source] of allowed) {
      expect(
        await run(
          "add_shopping_items",
          { items: [`milk ${source}`] },
          ctxFor(actor, { source }),
        ),
        source,
      ).toMatchObject({ ok: true });
    }
    expect(seen).toHaveLength(3);
  });

  it("is not offered to brain, which has its own", async () => {
    const me = await seedMember(db());
    for (const name of ["add_shopping_items", "check_off_shopping_items"]) {
      expect(
        await run(
          name,
          { items: ["milk"] },
          ctxFor(brain(me), { source: "brain" }),
        ),
      ).toMatchObject({ code: "SURFACE_FORBIDDEN" });
    }
    expect(seen).toEqual([]);
  });

  it("previews every item in one line", async () => {
    const ctx = { ...ctxFor(sessionActor("m")), db: db() };
    expect(
      await REGISTRY.add_shopping_items.preview!(ctx, {
        items: ["milk", "eggs"],
      }),
    ).toBe("Add milk and eggs to the shopping list");
  });
});

// Issue #208: the groups.
const category = () => memoryShopping().map((i) => [i.item, i.category]);

describe("add_shopping_items into a group", () => {
  it("puts only the new items in the group, by id, as the member, with no transaction open", async () => {
    const me = await seedMember(db(), { telegramUserId: 4242 });
    memoryAdd(["coffee filters"]);
    const data = ok(
      await run(
        "add_shopping_items",
        { items: ["beans", "Coffee filters"], category: "coffee" },
        ctxFor(kiosk(me), { source: "kiosk" }),
      ),
    ) as { added: string[]; category: string; notSorted: string[] };
    expect(data).toMatchObject({
      added: ["beans"],
      already: ["Coffee filters"],
      category: "coffee",
      notSorted: [],
      items: [
        expect.objectContaining({ item: "coffee filters", category: null }),
        expect.objectContaining({ item: "beans", category: "coffee" }),
      ],
    });
    expect(category()).toEqual([
      ["coffee filters", null],
      ["beans", "coffee"],
    ]);
    expect(seen).toEqual([
      ["addShopping", 0],
      ["setShoppingCategory", 0],
    ]);
    expect(picks).toEqual([
      {
        id: memoryShopping()[1]!.id,
        category: "coffee",
        telegramUserId: 4242,
      },
    ]);
    expect((await audits())[0]).toMatchObject({
      action: "add_shopping_items",
      payload: {
        items: ["beans", "Coffee filters"],
        added: ["beans"],
        category: "coffee",
      },
    });
  });

  it("asks nothing more when nothing was new, or no group was picked", async () => {
    const me = await seedMember(db());
    memoryAdd(["beans"]);
    const same = ok(
      await run(
        "add_shopping_items",
        { items: ["beans"], category: "coffee" },
        ctxFor(sessionActor(me)),
      ),
    );
    expect(same).not.toHaveProperty("category");
    ok(
      await run(
        "add_shopping_items",
        { items: ["tea"] },
        ctxFor(sessionActor(me)),
      ),
    );
    expect(seen.map(([m]) => m)).toEqual(["addShopping", "addShopping"]);
    expect(category()).toEqual([
      ["beans", null],
      ["tea", null],
    ]);
    expect((await audits())[0]!.payload).not.toHaveProperty("category");
  });

  it("keeps the add when the group cannot be set, and says what stayed Not sorted", async () => {
    const me = await seedMember(db());
    setBrainClientForTests(
      watching({
        ...memoryBrain(),
        setShoppingCategory: async () => ({
          ok: false,
          reason: "unavailable",
        }),
      }),
    );
    const data = ok(
      await run(
        "add_shopping_items",
        { items: ["beans", "milk"], category: "pantry" },
        ctxFor(sessionActor(me)),
      ),
    );
    expect(data).toMatchObject({
      added: ["beans", "milk"],
      category: "pantry",
      notSorted: ["beans", "milk"],
    });
    expect(names()).toEqual(["beans", "milk"]);
    // Sent without a Telegram account: brain records nobody.
    expect(picks[0]).not.toHaveProperty("telegramUserId");
  });

  it("refuses a group that is not one of the six, before calling brain", async () => {
    const me = await seedMember(db());
    for (const cat of ["Coffee", "garden", ""]) {
      expect(
        await run(
          "add_shopping_items",
          { items: ["beans"], category: cat },
          ctxFor(sessionActor(me)),
        ),
        cat,
      ).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
        issues: [expect.objectContaining({ path: ["category"] })],
      });
    }
    expect(seen).toEqual([]);
  });

  it("names the group in its preview", async () => {
    const ctx = { ...ctxFor(sessionActor("m")), db: db() };
    expect(
      await REGISTRY.add_shopping_items.preview!(ctx, {
        items: ["beans", "filters"],
        category: "coffee",
      }),
    ).toBe("Add beans and filters to the shopping list, under Coffee");
  });
});

describe("set_shopping_category", () => {
  it("puts an item in a group by id, as the member, with no transaction open, and audits it", async () => {
    const me = await seedMember(db(), { telegramUserId: 777 });
    memoryAdd(["Oat milk", "beans"]);
    const oat = memoryShopping()[0]!;
    const data = ok(
      await run(
        "set_shopping_category",
        { id: oat.id, category: "fresh" },
        ctxFor(kiosk(me), { source: "kiosk" }),
      ),
    );
    expect(data).toEqual({
      item: "Oat milk",
      category: "fresh",
      items: [
        expect.objectContaining({ item: "Oat milk", category: "fresh" }),
        expect.objectContaining({ item: "beans", category: null }),
      ],
    });
    expect(seen).toEqual([["setShoppingCategory", 0]]);
    expect(picks).toEqual([
      { id: oat.id, category: "fresh", telegramUserId: 777 },
    ]);
    expect((await audits())[0]).toMatchObject({
      action: "set_shopping_category",
      entity: "shopping_list",
      entityId: oat.id,
      actorMemberId: me,
      source: "kiosk",
      payload: { item: "Oat milk", category: "fresh" },
    });
    expect((await requests())[0]).toMatchObject({ status: "done" });
  });

  it("takes the item by name, and null for Not sorted", async () => {
    const me = await seedMember(db());
    memoryAdd(["Oat milk"]);
    ok(
      await run(
        "set_shopping_category",
        { item: "oat milk", category: "pantry" },
        ctxFor(sessionActor(me)),
      ),
    );
    expect(category()).toEqual([["Oat milk", "pantry"]]);
    const back = ok(
      await run(
        "set_shopping_category",
        { item: "Oat milk", category: null },
        ctxFor(mcp(me), { source: "mcp" }),
      ),
    );
    expect(back).toMatchObject({ category: null });
    expect(category()).toEqual([["Oat milk", null]]);
    expect(picks).toEqual([
      { item: "oat milk", category: "pantry" },
      { item: "Oat milk", category: null },
    ]);
  });

  it("says when the item is not on the list, and stores nothing", async () => {
    const me = await seedMember(db());
    memoryAdd(["tea"]);
    expect(
      await run(
        "set_shopping_category",
        { item: "milk", category: "fresh" },
        ctxFor(sessionActor(me)),
      ),
    ).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "milk is not on the shopping list.",
    });
    expect(
      await run(
        "set_shopping_category",
        { id: "00000000-0000-4000-8000-000000000999", category: "fresh" },
        ctxFor(sessionActor(me)),
      ),
    ).toMatchObject({
      code: "NOT_FOUND",
      message: "That item is not on the shopping list any more.",
    });
    expect(await audits()).toHaveLength(0);
  });

  it("asks which one when the name fits more than one item", async () => {
    const me = await seedMember(db());
    setBrainClientForTests({
      ...memoryBrain(),
      setShoppingCategory: async (r) => ({
        ok: true,
        data: {
          outcome: "ambiguous",
          item: r.item!,
          category: null,
          matches: ["Milk", "Oat milk"],
          items: [],
        },
      }),
    });
    expect(
      await run(
        "set_shopping_category",
        { item: "milk", category: "fresh" },
        ctxFor(sessionActor(me)),
      ),
    ).toEqual({
      ok: false,
      code: "AMBIGUOUS_ITEM",
      message: '"milk" could be Milk and Oat milk. Name the one you mean.',
    });
    expect(await audits()).toHaveLength(0);
  });

  it("reports brain's failures", async () => {
    const me = await seedMember(db());
    setBrainClientForTests(unconfiguredBrain);
    expect(
      await run(
        "set_shopping_category",
        { item: "milk", category: "fresh" },
        ctxFor(sessionActor(me)),
      ),
    ).toMatchObject({ code: "NOT_CONFIGURED" });
    setBrainClientForTests({
      ...unconfiguredBrain,
      setShoppingCategory: async () => ({ ok: false, reason: "unavailable" }),
    });
    expect(
      await run(
        "set_shopping_category",
        { item: "milk", category: "fresh" },
        ctxFor(sessionActor(me)),
      ),
    ).toMatchObject({ code: "UNAVAILABLE" });
    expect(await audits()).toHaveLength(0);
  });

  it("checks the input before calling brain", async () => {
    const me = await seedMember(db());
    for (const input of [
      { item: "milk", category: "Coffee" },
      { item: "milk" },
      { category: "fresh" },
      { id: "7", category: "fresh" },
      { item: "", category: "fresh" },
      { item: "milk", category: "fresh", extra: 1 },
    ]) {
      expect(
        await run("set_shopping_category", input, ctxFor(sessionActor(me))),
        JSON.stringify(input),
      ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
    expect(seen).toEqual([]);
  });

  it("needs a member, and a kiosk with someone picked; no PIN; not brain", async () => {
    const me = await seedMember(db());
    memoryAdd(["milk"]);
    const denied: [Actor, RequestCtx["source"], string][] = [
      [accountActor("nobody"), "ui", "FORBIDDEN"],
      [kiosk(), "kiosk", "FORBIDDEN"],
      [mcp(me, ["baumy:read"]), "mcp", "FORBIDDEN"],
      [brain(me), "brain", "SURFACE_FORBIDDEN"],
    ];
    for (const [actor, source, code] of denied) {
      expect(
        await run(
          "set_shopping_category",
          { item: "milk", category: "fresh" },
          ctxFor(actor, { source }),
        ),
        source,
      ).toMatchObject({ ok: false, code });
    }
    expect(seen).toEqual([]);
    const allowed: [Actor, RequestCtx["source"]][] = [
      [kiosk(me), "kiosk"],
      [mcp(me), "mcp"],
      [sessionActor(me), "ai"],
      [sessionActor(me), "ui"],
    ];
    for (const [actor, source] of allowed) {
      expect(
        await run(
          "set_shopping_category",
          { item: "milk", category: "fresh" },
          ctxFor(actor, { source }),
        ),
        source,
      ).toMatchObject({ ok: true });
    }
    expect(seen).toHaveLength(4);
  });

  it("previews the item and its group, by name or by id", async () => {
    memoryAdd(["Oat milk"]);
    const ctx = { ...ctxFor(sessionActor("m")), db: db() };
    const preview = REGISTRY.set_shopping_category.preview!;
    expect(await preview(ctx, { item: "beans", category: "pantry" })).toBe(
      "Put beans under Pantry",
    );
    expect(
      await preview(ctx, { id: memoryShopping()[0]!.id, category: null }),
    ).toBe("Move Oat milk to Not sorted");
    expect(
      await preview(ctx, {
        id: "00000000-0000-4000-8000-000000000999",
        category: "coffee",
      }),
    ).toBe("Put that item under Coffee");
  });
});

describe("check_off_shopping_items", () => {
  it("checks items off with no transaction open, and audits it", async () => {
    const me = await seedMember(db());
    memoryAdd(["Milk", "eggs", "tea"]);
    const data = ok(
      await run(
        "check_off_shopping_items",
        { items: ["milk", "coffee"] },
        ctxFor(kiosk(me), { source: "kiosk" }),
      ),
    );
    expect(data).toMatchObject({ checkedOff: ["Milk"], notFound: ["coffee"] });
    expect(seen).toEqual([["checkOffShopping", 0]]);
    expect(names()).toEqual(["eggs", "tea"]);
    expect((await audits())[0]).toMatchObject({
      action: "check_off_shopping_items",
      entity: "shopping_list",
      source: "kiosk",
      payload: { items: ["milk", "coffee"], checkedOff: ["Milk"] },
    });
  });

  it("says when none of them is on the list, and stores nothing", async () => {
    const me = await seedMember(db());
    memoryAdd(["tea"]);
    expect(
      await run(
        "check_off_shopping_items",
        { items: ["milk"] },
        ctxFor(sessionActor(me)),
      ),
    ).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
      message: "milk is not on the shopping list.",
    });
    expect(
      await run(
        "check_off_shopping_items",
        { items: ["milk", "eggs"] },
        ctxFor(sessionActor(me)),
      ),
    ).toMatchObject({ message: "milk and eggs are not on the shopping list." });
    expect(await audits()).toHaveLength(0);
  });

  it("puts the items back when the audit cannot be written", async () => {
    const me = await seedMember(db());
    memoryAdd(["milk"]);
    failNextAudit();
    expect(
      await run(
        "check_off_shopping_items",
        { items: ["milk"] },
        ctxFor(sessionActor(me)),
      ),
    ).toMatchObject({ code: "INTERNAL" });
    expect(seen).toEqual([
      ["checkOffShopping", 0],
      ["addShopping", 0],
    ]);
    expect(names()).toEqual(["milk"]);
  });

  it("reports brain's failures", async () => {
    const me = await seedMember(db());
    setBrainClientForTests(unconfiguredBrain);
    expect(
      await run(
        "check_off_shopping_items",
        { items: ["milk"] },
        ctxFor(sessionActor(me)),
      ),
    ).toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("previews every item", async () => {
    const ctx = { ...ctxFor(sessionActor("m")), db: db() };
    expect(
      await REGISTRY.check_off_shopping_items.preview!(ctx, {
        items: ["milk", "eggs", "tea"],
      }),
    ).toBe("Check milk, eggs and tea off the shopping list");
  });
});

describe("list_shopping", () => {
  it("lists the open items, oldest first", async () => {
    const me = await seedMember(db());
    memoryAdd(["milk", "eggs"]);
    const data = ok(await run("list_shopping", {}, ctxFor(sessionActor(me))));
    expect(data).toEqual({
      items: [
        {
          id: expect.any(String),
          item: "milk",
          addedAt: expect.any(String),
          category: null,
        },
        {
          id: expect.any(String),
          item: "eggs",
          addedAt: expect.any(String),
          category: null,
        },
      ],
    });
  });

  it("works on every surface, the idle kiosk included, and writes nothing", async () => {
    const me = await seedMember(db());
    const actors: [Actor, RequestCtx["source"]][] = [
      [sessionActor(me), "ui"],
      [kiosk(), "kiosk"],
      [kiosk(me), "kiosk"],
      [sessionActor(me), "ai"],
      [mcp(me, ["baumy:read"]), "mcp"],
      [brain(me), "brain"],
    ];
    for (const [actor, source] of actors) {
      expect(
        await run("list_shopping", {}, ctxFor(actor, { source })),
        source,
      ).toMatchObject({ ok: true });
    }
    expect(await audits()).toHaveLength(0);
    expect(await requests()).toHaveLength(0);
  });

  it("says unavailable when brain is down", async () => {
    const me = await seedMember(db());
    setBrainClientForTests({
      ...unconfiguredBrain,
      listShopping: async () => ({ ok: false, reason: "unavailable" }),
    });
    expect(
      await run("list_shopping", {}, ctxFor(sessionActor(me))),
    ).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });

  it("shows our own write at once, though the list is cached", async () => {
    const me = await seedMember(db());
    setBrainClientForTests(cachedBrain(watching(memoryBrain())));
    const ctx = () => ctxFor(sessionActor(me));
    await run("list_shopping", {}, ctx());
    await run("list_shopping", {}, ctx());
    expect(seen.map(([m]) => m)).toEqual(["listShopping"]);
    // Telegram adds something: the cache still has the old list.
    memoryAdd(["from telegram"]);
    expect(ok(await run("list_shopping", {}, ctx()))).toEqual({ items: [] });
    // Our own write forgets it.
    await run("add_shopping_items", { items: ["milk"] }, ctx());
    const after = ok(await run("list_shopping", {}, ctx())) as {
      items: { item: string }[];
    };
    expect(after.items.map((i) => i.item)).toEqual(["from telegram", "milk"]);
  });
});

describe("helpers", () => {
  it("joins items as a sentence", () => {
    expect(listPhrase([])).toBe("");
    expect(listPhrase(["milk"])).toBe("milk");
    expect(listPhrase(["milk", "eggs"])).toBe("milk and eggs");
    expect(listPhrase(["a", "b", "c"])).toBe("a, b and c");
  });

  it("turns each failure into a sentence with its code", () => {
    expect(
      shoppingFailure({ ok: false, reason: "not_configured" }),
    ).toMatchObject({
      code: "NOT_CONFIGURED",
    });
    expect(shoppingFailure({ ok: false, reason: "unavailable" })).toMatchObject(
      {
        code: "UNAVAILABLE",
      },
    );
  });
});
