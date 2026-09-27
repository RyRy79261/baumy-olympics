import { ListShoppingInput, ShoppingWrite } from "@baumy/types";
import {
  brainClient,
  type BrainFailure,
  type ShoppingEntry,
} from "@/lib/integrations/brain";
import { defineAction } from "./define";
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
    "Lists what is on the house shopping list (the same list the house Telegram group keeps with Baumy), oldest first: each item's id, its name and when it was added (ISO 8601, UTC).",
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

export interface AddShoppingData {
  /** What was new on the list. */
  added: string[];
  /** What was on it already. */
  already: string[];
  items: ShoppingEntry[];
}

export const addShoppingItems = defineAction({
  name: "add_shopping_items",
  title: "Add to the shopping list",
  description:
    'Adds one or more items to the house shopping list, which the house Telegram group shares. Send every item of one request in ONE call, one entry each: "add milk and eggs" is items ["milk", "eggs"]. Something already on the list is left as it is.',
  consent: "Add items to the house shopping list",
  kind: "write",
  risk: "safe",
  surfaces: ["ui", "kiosk", "ai", "mcp"],
  requires: "member",
  transactional: false,
  input: ShoppingWrite,
  async preview(_ctx, i) {
    return `Add ${listPhrase(i.items)} to the shopping list`;
  },
  async execute(_ctx, i) {
    const client = brainClient();
    const r = await client.addShopping(i.items);
    if (!r.ok) return shoppingFailure(r);
    const data: AddShoppingData = r.data;
    return {
      ok: true,
      data,
      audit: {
        entity: "shopping_list",
        payload: { items: i.items, added: r.data.added },
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
