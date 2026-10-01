import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { findKioskPairingByCode } from "@baumy/db/kiosk-pairing";
import { KioskPairingCode } from "@baumy/types";
import { Card, FormMessage, PageHeading, linkClass } from "@baumy/ui";
import { requireAdminPage } from "@/lib/auth";
import { now } from "@/lib/clock";
import { KIOSK_APPROVE_PATH, formatKioskPairingCode } from "@/lib/kiosk/format";
import {
  DIFFERENT_NETWORK_WARNING,
  askedAgo,
  differentNetwork,
  networkPrefix,
} from "@/lib/kiosk/network";
import { getClientIp } from "@/lib/rate-limit";
import { ApproveKioskForm } from "../kiosk-forms";

// /admin/kitchen-screen/approve?code=… (issue #126): where the QR code on
// the unpaired iPad leads. An admin's phone asks "Make this iPad the kitchen
// screen?" with one button (approve_kiosk_pairing). Someone not signed in
// comes back here after signing in; anyone not an admin gets a 404.

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Make this iPad the kitchen screen",
};

const BACK = (
  <Link href="/admin/kitchen-screen" className={linkClass}>
    Back to Kitchen screen
  </Link>
);

export default async function ApproveKitchenScreenPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const raw = (await searchParams).code;
  const typed = typeof raw === "string" ? raw : "";
  await requireAdminPage({
    returnTo: `${KIOSK_APPROVE_PATH}?code=${encodeURIComponent(typed)}`,
  });

  const at = now();
  const parsed = KioskPairingCode.safeParse(typed);
  const request = parsed.success
    ? await findKioskPairingByCode(
        createHttpDb() as unknown as Queryable,
        HOUSEHOLD_ID,
        parsed.data,
        at,
      )
    : null;
  // The admin's own network, to warn about a code asked for elsewhere (a
  // link sent to them rather than an iPad in front of them).
  const mine = networkPrefix(getClientIp(await headers()));

  let problem: string | null = null;
  if (!parsed.success) {
    problem = "That code doesn't look right. It is six letters and numbers.";
  } else if (!request) {
    problem =
      "No iPad is showing that code. Check it against the iPad's screen.";
  } else if (request.state === "expired") {
    problem =
      "That code has expired. The iPad already shows a new one: scan that instead.";
  } else if (request.state !== "pending") {
    problem =
      "That iPad was already approved. It should be the kitchen screen now.";
  }

  return (
    <>
      <PageHeading
        eyebrow="Kitchen screen"
        title="Make this iPad the kitchen screen?"
        description="It will sign in as the household's kitchen screen, not as you."
      />
      <div className="max-w-xl">
        <Card>
          {problem || !parsed.success || !request ? (
            <div className="flex flex-col gap-4">
              <FormMessage tone="error">{problem}</FormMessage>
              {BACK}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-base">
                Code{" "}
                <strong
                  className="font-mono text-lg"
                  data-testid="approve-code"
                >
                  {formatKioskPairingCode(parsed.data)}
                </strong>{" "}
                <span className="text-bm-muted">· {request.device}</span>
              </p>
              <p className="text-base text-bm-muted" data-testid="asked-ago">
                Asked {askedAgo(request.createdAt, at)}.
              </p>
              <p className="text-base" data-testid="approve-rule">
                Only approve a code you can see on the iPad in front of you.
              </p>
              {differentNetwork(request.network, mine) ? (
                <p
                  role="alert"
                  data-testid="network-warning"
                  className="pixel-frame bg-bm-red/10 px-4 py-3 text-base text-bm-red [--pf:var(--color-bm-red)]"
                >
                  {DIFFERENT_NETWORK_WARNING}
                </p>
              ) : null}
              <ApproveKioskForm code={parsed.data} />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
