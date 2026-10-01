import type { Metadata } from "next";
import Link from "next/link";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { findKioskPairingByCode } from "@baumy/db/kiosk-pairing";
import { KioskPairingCode } from "@baumy/types";
import { Card, FormMessage, PageHeading, linkClass } from "@baumy/ui";
import { requireAdminPage } from "@/lib/auth";
import { now } from "@/lib/clock";
import { KIOSK_APPROVE_PATH, formatKioskPairingCode } from "@/lib/kiosk/format";
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

  const parsed = KioskPairingCode.safeParse(typed);
  const request = parsed.success
    ? await findKioskPairingByCode(
        createHttpDb() as unknown as Queryable,
        HOUSEHOLD_ID,
        parsed.data,
        now(),
      )
    : null;

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
              <p className="text-base text-bm-muted">
                Check it matches the code on the iPad.
              </p>
              <ApproveKioskForm code={parsed.data} />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
