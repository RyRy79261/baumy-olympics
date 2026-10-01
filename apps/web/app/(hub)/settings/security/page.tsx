import type { Metadata } from "next";
import Link from "next/link";
import { AUTH_SESSION } from "@baumy/auth";
import { isGoogleConfigured, resolvePasskeyScope } from "@baumy/auth/env";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { kioskDeviceState, listKioskDevices } from "@baumy/db/kiosk-devices";
import { Card, FormMessage, PageHeading, linkClass } from "@baumy/ui";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { requireMemberPage } from "@/lib/auth";
import { now } from "@/lib/clock";
import {
  ConfirmEmailCard,
  DevicesCard,
  GoogleCard,
  PasskeysCard,
  PasswordCard,
} from "./security-forms";
import { TwoFactorCard } from "./two-factor-card";

// Settings, Security (issue #79, camp-404 parity: camp-404
// `apps/web/app/(console)/profile/security/page.tsx`): how the member signs
// in (password, Google, passkeys, two-factor) and the devices signed in now.
// Everything is read by one action for the member's own account only; a read
// that fails says so rather than showing an empty list.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Security" };

const seen = (d: Date) =>
  d.toLocaleString("en-GB", {
    timeZone: "Europe/Berlin",
    dateStyle: "medium",
    timeStyle: "short",
  });

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string }>;
}) {
  const me = await requireMemberPage();
  const { link } = await searchParams;

  const result = await runAction(
    "get_account_security",
    {},
    (await uiRequestCtx(undefined))!,
  );
  const at = now();
  const kiosks =
    me.role === "admin"
      ? (
          await listKioskDevices(
            createHttpDb() as unknown as Queryable,
            HOUSEHOLD_ID,
          )
        ).filter((d) => kioskDeviceState(d, at) === "paired")
      : null;

  return (
    <>
      <PageHeading
        eyebrow="Settings"
        title="Security"
        description="How you sign in, and the devices signed in as you right now."
        actions={
          <Link href="/settings" className={linkClass}>
            Back to settings
          </Link>
        }
      />
      {!result.ok ? (
        <FormMessage tone="error">
          We couldn&rsquo;t read your sign-in settings just now. That
          doesn&rsquo;t mean nothing is set up. Reload in a moment.
        </FormMessage>
      ) : (
        <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
          {result.data.emailVerified ? null : (
            <ConfirmEmailCard email={me.email} />
          )}
          <PasswordCard hasPassword={result.data.hasPassword} />
          <TwoFactorCard
            enabled={result.data.twoFactorEnabled}
            hasPassword={result.data.hasPassword}
            emailVerified={result.data.emailVerified}
          />
          <PasskeysCard
            passkeys={result.data.passkeys}
            enabled={resolvePasskeyScope(process.env) !== null}
            emailVerified={result.data.emailVerified}
          />
          {isGoogleConfigured(process.env) || result.data.googleLinked ? (
            <GoogleCard
              linked={result.data.googleLinked}
              linkFailed={link === "failed"}
            />
          ) : null}
          <DevicesCard
            sessions={result.data.sessions}
            lagMinutes={Math.round(AUTH_SESSION.cookieCacheMaxAgeSeconds / 60)}
            now={at.getTime()}
          />
          {kiosks ? (
            <Card
              title="Kitchen kiosks"
              description="The iPads paired to the household. They sign in as a device, not as you."
              data-testid="kiosks-card"
            >
              {kiosks.length === 0 ? (
                <p className="mb-4 text-base text-bm-muted">
                  No kiosk is paired.
                </p>
              ) : (
                <ul className="mb-4 flex flex-col gap-2">
                  {kiosks.map((d) => (
                    <li key={d.id} className="text-base">
                      <span className="text-lg">{d.name}</span>
                      <span className="text-bm-muted">
                        {" "}
                        · last seen{" "}
                        {d.lastSeenAt ? seen(d.lastSeenAt) : "not yet"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/admin/kitchen-screen" className={linkClass}>
                Pair or sign out the kitchen screen
              </Link>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
