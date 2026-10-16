"use server";

import type { ActionResult } from "@/lib/actions/result";
import type {
  AddShoppingData,
  CheckOffShoppingData,
  SetShoppingCategoryData,
} from "@/lib/actions/shopping";
import { actionFormRefreshing } from "@/lib/actions/ui";
import { groupFormInput, splitItemsForm } from "@/lib/shopping/view";

// /shopping's server actions and the hub widget's: thin wrappers around the
// registry (SPEC §3.4). The list is brain's; each change re-renders the
// shopping page and the hub, whose widget shows the list too.

/** The quick-add field: "milk, eggs" is two items. */
export async function addShoppingAction(
  _prev: ActionResult<AddShoppingData> | null,
  form: FormData,
): Promise<ActionResult<AddShoppingData>> {
  return actionFormRefreshing("add_shopping_items", splitItemsForm(form));
}

/** A group button for one item (issue #208); "Not sorted" sends "none". */
export async function setShoppingCategoryAction(
  _prev: ActionResult<SetShoppingCategoryData> | null,
  form: FormData,
): Promise<ActionResult<SetShoppingCategoryData>> {
  return actionFormRefreshing("set_shopping_category", form, groupFormInput);
}

/** One tap on a row: that item, exactly as the list names it. */
export async function checkOffShoppingAction(
  _prev: ActionResult<CheckOffShoppingData> | null,
  form: FormData,
): Promise<ActionResult<CheckOffShoppingData>> {
  return actionFormRefreshing("check_off_shopping_items", form);
}
