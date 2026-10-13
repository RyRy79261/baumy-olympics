// Test-only stand-in for the house Telegram group (issue #26). Answers 404,
// exactly like a route that does not exist, unless E2E_TEST_MODE=1; and test
// mode refuses to boot on Vercel (lib/test-mode.ts), so no deployment serves
// it. It reads and writes the fake brain's list directly
// (lib/integrations/brain-memory.ts), the way Telegram writes brain's list
// without going through Olympics or its cache.
//
//   GET  /api/test/brain                        -> { items: [...] }
//   POST /api/test/brain { add: ["milk"] }      -> { added, already, items }
//   POST /api/test/brain { checkOff: ["milk"] } -> { checkedOff, notFound, items }
//   POST /api/test/brain { sort: { item: "milk", category: "fresh" } }
//                                               -> { outcome, item, category, items }
//
// `sort` (issue #208) plays brain sorting an item by itself a few seconds
// after it was added, or a housemate's "put milk under fresh" in Telegram:
// the fake never sorts on its own. `category: null` is "Not sorted".

import { NextResponse } from "next/server";
import { z } from "zod";
import { ShoppingCategoryKey } from "@baumy/types";
import {
  memoryAdd,
  memoryCheckOff,
  memorySetCategory,
  memoryShopping,
} from "@/lib/integrations/brain-memory";
import { isTestMode } from "@/lib/test-mode";

export const dynamic = "force-dynamic";

const Items = z.array(z.string().min(1).max(200)).min(1).max(30);
const Body = z.union([
  z.strictObject({ add: Items }),
  z.strictObject({ checkOff: Items }),
  z.strictObject({
    sort: z.strictObject({
      item: z.string().min(1).max(200),
      category: ShoppingCategoryKey.nullable(),
    }),
  }),
]);

export async function GET() {
  if (!isTestMode()) return new NextResponse(null, { status: 404 });
  return NextResponse.json({ items: memoryShopping() });
}

export async function POST(request: Request) {
  if (!isTestMode()) return new NextResponse(null, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          'Send { add: ["milk"] }, { checkOff: ["milk"] } or { sort: { item: "milk", category: "fresh" } }.',
      },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const result =
    "add" in body
      ? memoryAdd(body.add)
      : "checkOff" in body
        ? memoryCheckOff(body.checkOff)
        : memorySetCategory(body.sort);
  return NextResponse.json({ ...result, items: memoryShopping() });
}
