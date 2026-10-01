import "server-only";

import { cookies } from "next/headers";
import { now } from "@/lib/clock";
import type {
  BrainClient,
  BrainResult,
  LoginApprovalMessage,
  ShoppingEntry,
} from "./brain";

// The E2E fake brain (SPEC §10): an in-memory shopping list for
// E2E_TEST_MODE=1 that answers like baumy-brain's kitchen API (issue #25):
// open items oldest first, re-adding an open item is a no-op, and a check-off
// matches by the same normalised name. `/api/test/brain` plays Telegram
// against the same list, so a spec can add in "Telegram" and look on the
// kiosk, or add on the kiosk and read what Telegram would see.
//
// Brain being DOWN is per browser, not per server, so specs running in
// parallel do not see each other's outage: a request whose browser carries
// the cookie `baumy_e2e_brain=down` gets `unavailable` from every call
// (`downWhenAsked`, in front of the read cache). With
// `baumy_e2e_brain=slow` it is up but answers a read of the list only after
// `BRAIN_SLOW_MS`, as a brain starting cold does (issue #128), so a spec can
// watch the hub stream its shopping widget in.
//
// "Sign in with Baumy" (issue #80): each approval DM brain would send is kept
// here instead, per Telegram user, so `/api/test/brain/login` can show a spec
// what the member's Telegram shows and tap one of its buttons.
//
// The list lives on globalThis, so every route bundle of one server shares
// it (as lib/clock.ts does).

/** The cookie a spec sets to take brain down (or slow) for its own browser. */
export const BRAIN_DOWN_COOKIE = "baumy_e2e_brain";

/** How long a slow brain takes to read the list. */
export const BRAIN_SLOW_MS = 3000;

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

const DMS_KEY = Symbol.for("baumy.brain.memory.login-dms");
type DmGlobal = typeof globalThis & { [DMS_KEY]?: LoginApprovalMessage[] };

function dms(): LoginApprovalMessage[] {
  return ((globalThis as DmGlobal)[DMS_KEY] ??= []);
}

/** The newest approval DM sent to this Telegram user, or null. */
export function memoryLoginApproval(
  telegramUserId: number,
): LoginApprovalMessage | null {
  const all = dms();
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i]!.telegramUserId === telegramUserId) return all[i]!;
  }
  return null;
}

/** Tests: no approval DMs. */
export function clearMemoryLoginApprovals(): void {
  dms().length = 0;
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

/** What this request's browser asked brain to be: down, slow, or itself. */
async function asked(): Promise<string | undefined> {
  try {
    return (await cookies()).get(BRAIN_DOWN_COOKIE)?.value;
  } catch {
    // Outside a request (a unit test): brain is up.
    return undefined;
  }
}

async function isDown(): Promise<boolean> {
  return (await asked()) === "down";
}

const DOWN = { ok: false, reason: "unavailable" } as const;

/**
 * `inner`, but `unavailable` for a browser that asked for brain to be down,
 * and a list read `BRAIN_SLOW_MS` late for one that asked for it slow.
 */
export function downWhenAsked(
  inner: BrainClient,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms)),
): BrainClient {
  return {
    listShopping: async () => {
      const mode = await asked();
      if (mode === "down") return DOWN;
      if (mode === "slow") await sleep(BRAIN_SLOW_MS);
      return inner.listShopping();
    },
    addShopping: async (items) =>
      (await isDown()) ? DOWN : inner.addShopping(items),
    checkOffShopping: async (items) =>
      (await isDown()) ? DOWN : inner.checkOffShopping(items),
    requestLoginApproval: async (message) =>
      (await isDown()) ? DOWN : inner.requestLoginApproval(message),
  };
}

const ok = async <T>(data: T): Promise<BrainResult<T>> => ({ ok: true, data });

export function memoryBrain(): BrainClient {
  return {
    listShopping: () => ok(view()),
    addShopping: (items) => ok({ ...memoryAdd(items), items: view() }),
    checkOffShopping: (items) =>
      ok({ ...memoryCheckOff(items), items: view() }),
    requestLoginApproval: (message) => {
      // Keep the last few per server: a spec reads the newest for its user.
      const all = dms();
      all.push(message);
      if (all.length > 200) all.splice(0, all.length - 200);
      return ok({ sent: true });
    },
  };
}
