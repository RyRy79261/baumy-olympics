// Test-only stand-in for a member's Telegram DM with Baumy (issue #80).
// Answers 404, exactly like a route that does not exist, unless
// E2E_TEST_MODE=1; and test mode refuses to boot on Vercel
// (lib/test-mode.ts), so no deployment serves it.
//
//   GET  /api/test/brain/login?telegramUserId=<id>
//        -> { message: { requestId, device, choices, expiresAt } | null }
//        the newest approval DM the fake brain "sent" that Telegram user
//   POST /api/test/brain/login { telegramUserId, tap: <number> | "deny" }
//        -> the brain endpoint's answer to that tap
//
// A tap goes through the real brain endpoint (lib/brain/endpoint.ts: the
// actor mapping, the confirm header, the idempotency key, runAction with
// source "brain"), exactly as brain's button handler calls it; only the
// service token check is skipped, since no token was minted.

import { NextResponse } from "next/server";
import { z } from "zod";
import { BRAIN_SCOPE } from "@baumy/db/service-tokens";
import { TelegramUserId } from "@baumy/types";
import { handleBrainAction } from "@/lib/brain/endpoint";
import { brainEndpointDeps } from "@/lib/brain/wiring";
import { memoryLoginApproval } from "@/lib/integrations/brain-memory";
import { isTestMode } from "@/lib/test-mode";

export const dynamic = "force-dynamic";

const TOKEN_NAME = "e2e-telegram";

const Tap = z.strictObject({
  telegramUserId: TelegramUserId,
  tap: z.union([z.int().min(0).max(999), z.literal("deny")]),
});

export async function GET(request: Request) {
  if (!isTestMode()) return new NextResponse(null, { status: 404 });
  const id = TelegramUserId.safeParse(
    new URL(request.url).searchParams.get("telegramUserId"),
  );
  if (!id.success) {
    return NextResponse.json(
      { error: "Send ?telegramUserId=<id>." },
      { status: 400 },
    );
  }
  const message = memoryLoginApproval(id.data);
  return NextResponse.json({
    message: message
      ? {
          requestId: message.requestId,
          device: message.device,
          choices: message.choices,
          expiresAt: message.expiresAt,
        }
      : null,
  });
}

export async function POST(request: Request) {
  if (!isTestMode()) return new NextResponse(null, { status: 404 });
  const parsed = Tap.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Send { telegramUserId, tap: 47 } or { tap: "deny" }.' },
      { status: 400 },
    );
  }
  const { telegramUserId, tap } = parsed.data;
  const message = memoryLoginApproval(telegramUserId);
  if (!message) {
    return NextResponse.json(
      { error: "No approval DM was sent to that Telegram user." },
      { status: 404 },
    );
  }
  const name = tap === "deny" ? "deny_login" : "approve_login";
  const input =
    tap === "deny"
      ? { requestId: message.requestId }
      : { requestId: message.requestId, code: tap };
  const call = new Request(`http://localhost/api/v1/actions/${name}`, {
    method: "POST",
    headers: {
      authorization: "Bearer e2e",
      "content-type": "application/json",
      "x-baumy-actor": `tg:${telegramUserId}`,
      "x-baumy-confirmed": "1",
      "idempotency-key": `e2e-tap-${message.requestId}-${tap}`,
    },
    body: JSON.stringify(input),
  });
  return handleBrainAction(call, name, {
    ...brainEndpointDeps(),
    verifyToken: async () => ({ name: TOKEN_NAME, scopes: [BRAIN_SCOPE] }),
  });
}
