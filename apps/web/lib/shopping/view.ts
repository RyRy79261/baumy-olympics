import { splitShoppingText } from "@baumy/types";
import type {
  AddShoppingData,
  CheckOffShoppingData,
} from "@/lib/actions/shopping";
import { listPhrase } from "@/lib/actions/shopping-text";

// The shopping list's words and forms (SPEC §3.4, issue #26). Pure and
// client-safe: the quick-add field and the rows on /shopping, the hub and
// the kitchen screen use these.

/** The toast after an add: what is new, and what was there already. */
export function addedMessage(d: AddShoppingData): string {
  const parts: string[] = [];
  if (d.added.length > 0) parts.push(`Added ${listPhrase(d.added)}.`);
  if (d.already.length > 0) {
    parts.push(
      `${listPhrase(d.already)} ${d.already.length === 1 ? "was" : "were"} on the list already.`,
    );
  }
  return parts.join(" ");
}

/** The toast after a check-off. */
export function checkedOffMessage(d: CheckOffShoppingData): string {
  const done = `Checked off ${listPhrase(d.checkedOff)}.`;
  return d.notFound.length > 0
    ? `${done} ${listPhrase(d.notFound)} ${d.notFound.length === 1 ? "was" : "were"} not on the list.`
    : done;
}

/**
 * The quick-add form with what was typed split into one `items` field per
 * item ("milk, eggs" → items=milk, items=eggs). Every other field is kept.
 */
export function splitItemsForm(form: FormData): FormData {
  const out = new FormData();
  for (const [key, value] of form.entries()) {
    if (key === "items" && typeof value === "string") {
      const items = splitShoppingText(value);
      // Nothing but commas: send it empty, so the action says why.
      for (const item of items.length > 0 ? items : [""]) {
        out.append("items", item);
      }
    } else {
      out.append(key, value);
    }
  }
  return out;
}
