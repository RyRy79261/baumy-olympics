import type { Metadata } from "next";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { kioskDeviceState, listKioskDevices } from "@baumy/db/kiosk-devices";
import { Button, Card, Field, Input, PageHeading } from "@baumy/ui";
import { requireAdminPage } from "@/lib/auth";
import { now } from "@/lib/clock";
import { KIOSK_APPROVE_PATH } from "@/lib/kiosk/format";
import { RenameKioskForm, RevokeKioskButton } from "./kiosk-forms";

// /admin/kitchen-screen (issue #126): the kitchen iPad. How to pair it (scan
// its QR code), the code to type when the camera will not read it, and every
// screen paired so far, to rename or sign out. Admins only; every write here
// is an admin-only registry action.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kitchen screen" };

const STATE_LABEL = {
  waiting: "Approved, waiting for the iPad",
  expired: "Approved, never picked up",
  paired: "Paired",
  revoked: "Signed out",
} as const;

const seen = (d: Date) =>
  d.toLocaleString("en-GB", {
    timeZone: "Europe/Berlin",
    dateStyle: "medium",
    timeStyle: "short",
  });

export default async function KitchenScreenPage() {
  await requireAdminPage();
  const devices = await listKioskDevices(
    createHttpDb() as unknown as Queryable,
    HOUSEHOLD_ID,
  );
  const at = now();

  return (
    <>
      <PageHeading
        eyebrow="Admin"
        title="Kitchen screen"
        description="The iPad in the kitchen signs in as a screen, not as a person."
      />
      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        <Card title="Pair the iPad">
          <ol className="mb-6 flex list-decimal flex-col gap-2 pl-6 text-base">
            <li>
              On the iPad, open Baumy at <code>/kiosk</code>. It shows a QR
              code.
            </li>
            <li>Scan the code with this phone&rsquo;s camera.</li>
            <li>
              Tap <strong>Make it the kitchen screen</strong>. The iPad switches
              by itself.
            </li>
          </ol>
          {/* A plain GET to the confirm page: the approval itself is the
              action there. */}
          <form
            method="get"
            action={KIOSK_APPROVE_PATH}
            className="flex flex-wrap items-end gap-3"
          >
            <Field
              id="pairing-code"
              label="Camera won't scan? Type the code"
              hint="The six letters and numbers under the QR code."
            >
              {(control) => (
                <Input
                  {...control}
                  name="code"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="ABC-234"
                  maxLength={12}
                  required
                />
              )}
            </Field>
            <Button type="submit" variant="secondary">
              Next
            </Button>
          </form>
        </Card>

        <Card title="Screens" data-testid="kitchen-screens">
          {devices.length === 0 ? (
            <p className="text-base text-bm-muted">No screen is paired yet.</p>
          ) : (
            <ul className="flex flex-col gap-6">
              {devices.map((d) => {
                const state = kioskDeviceState(d, at);
                const live = state === "paired" || state === "waiting";
                return (
                  <li
                    key={d.id}
                    className="flex flex-col gap-2 text-base"
                    data-testid={`kiosk-${d.name}`}
                  >
                    <p>
                      <span className="text-lg">{d.name}</span>
                      <span className="text-bm-muted">
                        {" "}
                        · {STATE_LABEL[state]}
                        {state === "paired"
                          ? `, last seen ${d.lastSeenAt ? seen(d.lastSeenAt) : "not yet"}`
                          : ""}
                      </span>
                    </p>
                    {live ? (
                      <div className="flex flex-wrap items-end gap-3">
                        <RenameKioskForm deviceId={d.id} name={d.name} />
                        <RevokeKioskButton
                          deviceId={d.id}
                          name={d.name}
                          paired={state === "paired"}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
