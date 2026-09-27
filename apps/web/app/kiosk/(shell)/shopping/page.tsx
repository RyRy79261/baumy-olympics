import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FormMessage, PageHeading, buttonClass } from "@baumy/ui";
import { ShoppingList } from "@/components/shopping/shopping-list";
import { kioskRequestCtx } from "@/lib/actions/kiosk";
import { runAction } from "@/lib/actions/registry";
import { getKioskActor } from "@/lib/auth";
import {
  kioskAddShoppingAction,
  kioskCheckOffShoppingAction,
} from "../../actions";

// The whole shopping list on the kitchen iPad (SPEC §3.4, §8): anyone can
// read it; the member whose avatar was tapped can add to it or tick things
// off, with no PIN (adding milk vouches for nobody).

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shopping - Kiosk - Baumy" };

export default async function KioskShoppingPage() {
  const kiosk = await getKioskActor();
  if (!kiosk) redirect("/kiosk/pair");
  const ctx = (await kioskRequestCtx(undefined, undefined))!;
  const listed = await runAction("list_shopping", {}, ctx);
  const acting = Boolean(kiosk.memberId);
  return (
    <>
      <PageHeading
        eyebrow={kiosk.deviceName ?? "Kiosk"}
        title="Shopping list"
        description={
          acting
            ? "Tap an item when it's bought."
            : "Tap your avatar at the top to add or tick off items."
        }
        actions={
          <Link href="/kiosk" className={buttonClass("secondary", "kiosk")}>
            Home
          </Link>
        }
      />
      {listed.ok ? (
        <ShoppingList
          items={listed.data.items}
          kiosk
          canEdit={acting}
          actions={{
            add: kioskAddShoppingAction,
            checkOff: kioskCheckOffShoppingAction,
          }}
        />
      ) : (
        <FormMessage tone="error">{listed.message}</FormMessage>
      )}
    </>
  );
}
