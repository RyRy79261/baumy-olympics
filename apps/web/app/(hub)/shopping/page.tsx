import type { Metadata } from "next";
import { FormMessage, PageHeading } from "@baumy/ui";
import { ShoppingList } from "@/components/shopping/shopping-list";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { requireMemberPage } from "@/lib/auth";
import { addShoppingAction, checkOffShoppingAction } from "./actions";

// /shopping (SPEC §3.4, issue #26): the house shopping list. It is
// baumy-brain's (ADR 0003), so it is the same list as in the Telegram
// group: add here, tick off there, or the other way round.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shopping" };

export default async function ShoppingPage() {
  await requireMemberPage();
  const listed = await runAction(
    "list_shopping",
    {},
    (await uiRequestCtx(undefined))!,
  );
  return (
    <>
      <PageHeading
        title="Shopping list"
        description="The same list as the house Telegram group. Add a few things at once with commas; tap an item when it's bought."
      />
      {listed.ok ? (
        <ShoppingList
          items={listed.data.items}
          canEdit
          actions={{ add: addShoppingAction, checkOff: checkOffShoppingAction }}
        />
      ) : (
        <FormMessage tone="error">{listed.message}</FormMessage>
      )}
    </>
  );
}
