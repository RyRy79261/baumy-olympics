import { eq } from "drizzle-orm";
import {
  ListShoppingInput,
  SetShoppingCategoryInput,
  ShoppingAdd,
  ShoppingWrite,
  shoppingCategoryLabel,
  type ShoppingCategory,
} from "@baumy/types";
import { members } from "@baumy/db/schema";
import {
  brainClient,
  type BrainClient,
  type BrainFailure,
  type ShoppingEntry,
} from "@/lib/integrations/brain";
import { defineAction, type ActionCtx } from "./define";
import { fail, type ActionFailure } from "./result";
import { listPhrase } from "./shopping-text";

// The house shopping list (SPEC §3.4, §6.6, issue #26). baumy-brain owns it
// (ADR 0003): these actions read and write brain's list over its kitchen API
// (lib/integrations/brain.ts), so "buy milk" in Telegram and on the kiosk is
// the same row. Olympics keeps no copy, just the audit row of each write.
//
// The writes are `transactional: false`: runAction commits the idempotency
// claim, calls brain with NO transaction open, then writes the audit row in
// a short transaction of its own; if that fails, the `undo` puts the list
// back (an add is checked off again, a check-off is added again).
//
// Brain already offers these to Telegram, so `brain` is not a surface of the
// writes (SPEC §6.3). They are `safe`: adding or ticking an item is cheap to
// put right, and asks for no PIN on the kiosk.

/** Brain's failures as sentences people can act on. */
export function shoppingFailure(r: BrainFailure): ActionFailure {
  return r.reason === "not_configured"
    ? fail(
        "NOT_CONFIGURED",
        "The shopping list is not connected yet. An admin can set it up (docs/SETUP.md).",
      )
    : fail(
        "UNAVAILABLE",
        "The shopping list is unavailable right now. Baumy's brain did not answer; try again in a minute.",
      );
}

export interface ListShoppingData {
  items: ShoppingEntry[];
}

export const listShopping = defineAction({
  name: "list_shopping",
  title: "Shopping list",
  description:
    "Lists what is on the house shopping list (the same list the house Telegram group keeps with Baumy), oldest first: each item's id, its name, when it was added (ISO 8601, UTC) and its group (pantry, fresh, coffee, cleaning, maintenance or household; null while not sorted).",
  consent: "See the house shopping list",
  kind: "read",
  risk: "safe",
  surfaces: ["ui", "kiosk", "ai", "mcp", "brain"],
  // The kitchen screen shows the list before anyone taps in.
  requires: "display",
  input: ListShoppingInput,
  async execute() {
    const read = await brainClient().listShopping();
    if (!read.ok) return shoppingFailure(read);
    const data: ListShoppingData = { items: read.data };
    return { ok: true, data };
  },
});

/** Brain's exact match key: case and spacing do not matter. */
function sameItem(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return norm(a) === norm(b);
}

/**
 * The acting member's linked Telegram account, sent with a group pick so
 * brain knows who picked it (it learns the house's picks); none when they
 * have not linked one.
 */
async function telegramUserIdOf(ctx: ActionCtx): Promise<number | undefined> {
  const memberId = ctx.actor.memberId;
  if (!memberId) return undefined;
  const [row] = await ctx.db
    .select({ telegramUserId: members.telegramUserId })
    .from(members)
    .where(eq(members.id, memberId));
  return row?.telegramUserId ?? undefined;
}

/**
 * Put each newly added item in `category`, by the id brain gave it. What
 * could not be put there stays Not sorted; the add still stands.
 */
async function sortAdded(
  ctx: ActionCtx,
  client: BrainClient,
  added: string[],
  items: ShoppingEntry[],
  category: ShoppingCategory,
): Promise<{ items: ShoppingEntry[]; notSorted: string[] }> {
  const telegramUserId = await telegramUserIdOf(ctx);
  let latest = items;
  const notSorted: string[] = [];
  for (const name of added) {
    const id = items.find((e) => sameItem(e.item, name))?.id;
    const r = await client.setShoppingCategory({
      ...(id !== undefined ? { id } : { item: name }),
      category,
      ...(telegramUserId !== undefined ? { telegramUserId } : {}),
    });
    if (r.ok && r.data.outcome === "set") latest = r.data.items;
    else notSorted.push(name);
  }
  return { items: latest, notSorted };
}

export interface AddShoppingData {
  /** What was new on the list. */
  added: string[];
  /** What was on it already. */
  already: string[];
  items: ShoppingEntry[];
  /** The group the new items were put in, when one was asked for. */
  category?: ShoppingCategory;
  /** With `category`: new items that could not be put in it (Not sorted). */
  notSorted?: string[];
}

export const addShoppingItems = defineAction({
  name: "add_shopping_items",
  title: "Add to the shopping list",
  description:
    'Adds one or more items to the house shopping list, which the house Telegram group shares. Send every item of one request in ONE call, one entry each: "add milk and eggs" is items ["milk", "eggs"]. Something already on the list is left as it is. With `category`, the new items go into that group; without it, brain sorts each one by itself a few seconds later.',
  consent: "Add items to the house shopping list",
  kind: "write",
  refreshes: ["shopping"],
  risk: "safe",
  surfaces: ["ui", "kiosk", "ai", "mcp"],
  requires: "member",
  transactional: false,
  input: ShoppingAdd,
  async preview(_ctx, i) {
    const into = i.category
      ? `, under ${shoppingCategoryLabel(i.category)}`
      : "";
    return `Add ${listPhrase(i.items)} to the shopping list${into}`;
  },
  async execute(ctx, i) {
    const client = brainClient();
    const r = await client.addShopping(i.items);
    if (!r.ok) return shoppingFailure(r);
    let data: AddShoppingData = r.data;
    if (i.category && r.data.added.length > 0) {
      const sorted = await sortAdded(
        ctx,
        client,
        r.data.added,
        r.data.items,
        i.category,
      );
      data = { ...r.data, ...sorted, category: i.category };
    }
    return {
      ok: true,
      data,
      audit: {
        entity: "shopping_list",
        payload: {
          items: i.items,
          added: r.data.added,
          ...(data.category ? { category: data.category } : {}),
        },
      },
      undo: async () => {
        if (r.data.added.length > 0)
          await client.checkOffShopping(r.data.added);
      },
    };
  },
});

export interface CheckOffShoppingData {
  checkedOff: string[];
  /** Named, but not on the list. */
  notFound: string[];
  items: ShoppingEntry[];
}

export const checkOffShoppingItems = defineAction({
  name: "check_off_shopping_items",
  title: "Check off the shopping list",
  description:
    "Checks items off the house shopping list (they were bought, or are not needed), by name as list_shopping gives them. Send every item in one call.",
  consent: "Check items off the house shopping list",
  kind: "write",
  refreshes: ["shopping"],
  risk: "safe",
  surfaces: ["ui", "kiosk", "ai", "mcp"],
  requires: "member",
  transactional: false,
  input: ShoppingWrite,
  async preview(_ctx, i) {
    return `Check ${listPhrase(i.items)} off the shopping list`;
  },
  async execute(_ctx, i) {
    const client = brainClient();
    const r = await client.checkOffShopping(i.items);
    if (!r.ok) return shoppingFailure(r);
    if (r.data.checkedOff.length === 0) {
      return fail(
        "NOT_FOUND",
        `${listPhrase(r.data.notFound)} ${r.data.notFound.length === 1 ? "is" : "are"} not on the shopping list.`,
      );
    }
    const data: CheckOffShoppingData = r.data;
    return {
      ok: true,
      data,
      audit: {
        entity: "shopping_list",
        payload: { items: i.items, checkedOff: r.data.checkedOff },
      },
      undo: async () => {
        await client.addShopping(r.data.checkedOff);
      },
    };
  },
});

export interface SetShoppingCategoryData {
  /** The item, as brain names it. */
  item: string;
  /** Its group now; null is "Not sorted". */
  category: ShoppingCategory | null;
  items: ShoppingEntry[];
}

/** "Put oat milk under Fresh", or "Move oat milk to Not sorted". */
export function categoryPhrase(
  item: string,
  category: ShoppingCategory | null,
): string {
  return category
    ? `Put ${item} under ${shoppingCategoryLabel(category)}`
    : `Move ${item} to ${shoppingCategoryLabel(null)}`;
}

// Issue #208 (SPEC §3.4, §12 decision 39): brain puts each new item in one of
// six groups by itself; this is a housemate putting one somewhere else (the
// group buttons on the list, or "put coffee filters under coffee" to the
// Baumy command or over MCP). Brain learns the pick for next time. Like the
// other shopping writes it is not offered to brain, which has its own, and it
// has no undo: setting the old group back would teach brain a pick nobody
// made, and a group is put right with one more tap.
export const setShoppingCategory = defineAction({
  name: "set_shopping_category",
  title: "Put a shopping item in a group",
  description:
    'Puts one item on the house shopping list into a group: pantry, fresh, coffee, cleaning, maintenance or household, or null for "Not sorted". Name the item by its id from list_shopping (best) or by its name. Brain sorts new items by itself; use this when someone says where an item belongs, and brain remembers it for next time.',
  consent: "Put shopping items into groups",
  kind: "write",
  refreshes: ["shopping"],
  risk: "safe",
  surfaces: ["ui", "kiosk", "ai", "mcp"],
  requires: "member",
  transactional: false,
  input: SetShoppingCategoryInput,
  async preview(_ctx, i) {
    let name = i.item;
    if (i.id !== undefined) {
      const read = await brainClient().listShopping();
      name = (read.ok && read.data.find((e) => e.id === i.id)?.item) || name;
    }
    return categoryPhrase(name ?? "that item", i.category);
  },
  async execute(ctx, i) {
    const telegramUserId = await telegramUserIdOf(ctx);
    const r = await brainClient().setShoppingCategory({
      ...(i.id !== undefined ? { id: i.id } : {}),
      ...(i.item !== undefined ? { item: i.item } : {}),
      category: i.category,
      ...(telegramUserId !== undefined ? { telegramUserId } : {}),
    });
    if (!r.ok) return shoppingFailure(r);
    if (r.data.outcome === "not_found") {
      return fail(
        "NOT_FOUND",
        i.item !== undefined
          ? `${i.item} is not on the shopping list.`
          : "That item is not on the shopping list any more.",
      );
    }
    if (r.data.outcome === "ambiguous") {
      const named = `"${i.item ?? r.data.item}"`;
      const matches = r.data.matches ?? [];
      return fail(
        "AMBIGUOUS_ITEM",
        matches.length > 0
          ? `${named} could be ${listPhrase(matches)}. Name the one you mean.`
          : `${named} fits more than one item on the list. Name the one you mean.`,
      );
    }
    const data: SetShoppingCategoryData = {
      item: r.data.item,
      category: r.data.category,
      items: r.data.items,
    };
    return {
      ok: true,
      data,
      audit: {
        entity: "shopping_list",
        entityId: r.data.id ?? null,
        payload: { item: r.data.item, category: r.data.category },
      },
    };
  },
});
