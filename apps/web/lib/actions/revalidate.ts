import "server-only";

import { revalidatePath } from "next/cache";
import type { ActionName } from "./define";
import { refreshPaths, type RefreshSide } from "./refresh";
import { REGISTRY } from "./registry";

// After a write succeeds in a server action, refresh the pages that read
// what it changed (issue #215): the action's `refreshes` tags, through the
// one map in refresh.ts, on the wrapper's side (hub or kiosk). The server
// actions call it through `actionFormRefreshing` (ui.ts) and
// `kioskActionFormRefreshing` (kiosk.ts), never revalidatePath by hand.

/** Revalidate every page `name`'s tags reach on `side`. A read: nothing. */
export function refreshAfter(name: ActionName, side: RefreshSide): void {
  const tags = REGISTRY[name].refreshes ?? [];
  for (const p of refreshPaths(tags, side)) {
    if (p.layout) revalidatePath(p.path, "layout");
    else revalidatePath(p.path);
  }
}
