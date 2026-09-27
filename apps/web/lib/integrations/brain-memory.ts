import "server-only";

import { cookies } from "next/headers";
import { now } from "@/lib/clock";
import type { BrainClient, BrainResult, ShoppingEntry } from "./brain";

// The E2E fake brain (SPEC §10): an in-memory shopping list for
// E2E_TEST_MODE=1 that answers like baumy-brain's kitchen API (issue #25):
// open items oldest first, re-adding an open item is a no-op, and a check-off
// matches by the same normalised name. `/api/test/brain` plays Telegram
// against the same list, so a spec can add in "Telegram" and look on the
// kiosk, or add on the kiosk and read what Telegram would see.
//
// Brain being DOWN is per browser, not per server, so specs running in
// parallel do not see each other's outage: a request whose browser carries
// the cookie `baumy_e2e_brain=down` gets `unavailable` from every call.
//
// The list lives on globalThis, so every route bundle of one server shares
// it (as lib/clock.ts does).

/** The cookie a spec sets to take brain down for its own browser. */
export const BRAIN_DOWN_COOKIE = "baumy_e2e_brain";

interface Row {
  id: string;
  item: string;
  norm: string;
  createdAt: Date;
}

const STORE_KEY = Symbol.for("baumy.brain.memory");
type StoreGlobal = typeof globalThis & {
  [STORE_KEY]?: { rows: Row[]; seq: number };
};

function store() {
  return ((globalThis as StoreGlobal)[STORE_KEY] ??= { rows: [], seq: 0 });
}

/** Brain's exact match key: case and spacing do not matter. */
export function normalizeItem(item: string): string {
  return item.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Tests: an empty list. */
export function clearMemoryShopping(): void {
  const s = store();
  s.rows = [];
  s.seq = 0;
}

function view(): ShoppingEntry[] {
  return store().rows.map((r) => ({
    id: r.id,
    item: r.item,
    addedAt: r.createdAt.toISOString(),
  }));
}

/** Add, as brain does: new items appended, open ones left alone. */
export function memoryAdd(items: string[]): {
  added: string[];
  already: string[];
} {
  const s = store();
  const added: string[] = [];
  const already: string[] = [];
  for (const raw of items) {
    const item = raw.trim().replace(/\s+/g, " ");
    if (!item) continue;
    const norm = normalizeItem(item);
    if (s.rows.some((r) => r.norm === norm)) {
      already.push(item);
      continue;
    }
    s.seq += 1;
    s.rows.push({ id: String(s.seq), item, norm, createdAt: now() });
    added.push(item);
  }
  return { added, already };
}

/** Check off, as brain does: by the normalised name. */
export function memoryCheckOff(items: string[]): {
  checkedOff: string[];
  notFound: string[];
} {
  const s = store();
  const checkedOff: string[] = [];
  const notFound: string[] = [];
  for (const raw of items) {
    const norm = normalizeItem(raw);
    const at = s.rows.findIndex((r) => r.norm === norm);
    if (at < 0) {
      notFound.push(raw.trim());
      continue;
    }
    checkedOff.push(s.rows[at]!.item);
    s.rows.splice(at, 1);
  }
  return { checkedOff, notFound };
}

/** The open list, as Telegram would see it. */
export function memoryShopping(): ShoppingEntry[] {
  return view();
}

/** True when this request's browser asked for brain to be down. */
async function isDown(): Promise<boolean> {
  try {
    return (await cookies()).get(BRAIN_DOWN_COOKIE)?.value === "down";
  } catch {
    // Outside a request (a unit test): brain is up.
    return false;
  }
}

const DOWN = { ok: false, reason: "unavailable" } as const;

async function answer<T>(fn: () => T): Promise<BrainResult<T>> {
  if (await isDown()) return DOWN;
  return { ok: true, data: fn() };
}

export function memoryBrain(): BrainClient {
  return {
    listShopping: () => answer(view),
    addShopping: (items) =>
      answer(() => ({ ...memoryAdd(items), items: view() })),
    checkOffShopping: (items) =>
      answer(() => ({ ...memoryCheckOff(items), items: view() })),
  };
}
