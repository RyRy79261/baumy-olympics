import "server-only";

import { cookies } from "next/headers";
import { forgetShoppingReads } from "@/lib/integrations/brain";
import { REFRESH_COOKIE } from "./refresh";

/**
 * On the kitchen screen's own re-read, forget the cached shopping list so
 * this page load asks brain. Returns whether it did.
 */
export async function skipShoppingCacheOnRefresh(): Promise<boolean> {
  const marked = (await cookies()).get(REFRESH_COOKIE)?.value === "1";
  if (marked) forgetShoppingReads();
  return marked;
}
