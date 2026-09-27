"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/actions/result";
import type {
  AddShoppingData,
  CheckOffShoppingData,
} from "@/lib/actions/shopping";
import { actionForm } from "@/lib/actions/ui";
import { splitItemsForm } from "@/lib/shopping/view";

// /shopping's server actions and the hub widget's: thin wrappers around the
// registry (SPEC §3.4). The list is brain's; each change re-renders the
// shopping page and the hub, whose widget shows the list too.

function refresh(): void {
  revalidatePath("/shopping");
  revalidatePath("/");
}

/** The quick-add field: "milk, eggs" is two items. */
export async function addShoppingAction(
  _prev: ActionResult<AddShoppingData> | null,
  form: FormData,
): Promise<ActionResult<AddShoppingData>> {
  const result = await actionForm("add_shopping_items", splitItemsForm(form));
  if (result.ok) refresh();
  return result;
}

/** One tap on a row: that item, exactly as the list names it. */
export async function checkOffShoppingAction(
  _prev: ActionResult<CheckOffShoppingData> | null,
  form: FormData,
): Promise<ActionResult<CheckOffShoppingData>> {
  const result = await actionForm("check_off_shopping_items", form);
  if (result.ok) refresh();
  return result;
}
