import type { Metadata } from "next";
import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { inviteCodeState, listInviteCodes } from "@baumy/db/invite-codes";
import { kioskDeviceState, listKioskDevices } from "@baumy/db/kiosk-devices";
import { listMembers } from "@baumy/db/members";
import { activeRoster } from "@/lib/members/characters";
import { Card, PageHeading } from "@baumy/ui";
import { requireAdminPage } from "@/lib/auth";
import { now } from "@/lib/clock";
import {
  MemberControls,
  MintInviteForm,
  RevokeInviteButton,
} from "./admin-forms";
import { PairKioskForm, RevokeKioskButton } from "./kiosk-forms";

// /admin/members (SPEC §6.2): admins only; anyone else gets a 404 from the
// page gate, and every write here is an admin-only registry action.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Members - Baumy Olympics" };

const DEVICE_STATE_LABEL = {
  waiting: "Waiting for its code",
  expired: "Code expired",
  paired: "Paired",
  revoked: "Revoked",
} as const;

const day = (d: Date) => d.toISOString().slice(0, 10);

const STATE_LABEL = {
  active: "Active",
  revoked: "Cancelled",
  expired: "Expired",
  used_up: "Used up",
} as const;

export default async function AdminMembersPage() {
  const me = await requireAdminPage();
  const db = createHttpDb() as unknown as Queryable;
  const [people, codes, devices, { characters, images }] = await Promise.all([
    listMembers(db, HOUSEHOLD_ID),
    listInviteCodes(db, HOUSEHOLD_ID),
    listKioskDevices(db, HOUSEHOLD_ID),
    // The same characters as every other screen (the active roster).
    activeRoster(db, HOUSEHOLD_ID),
  ]);
  const at = now();

  return (
    <>
      <PageHeading
        eyebrow="Admin"
        title="Members"
        description="Who is in the household, the codes that let people in, and the kitchen kiosks."
      />
      <div className="flex flex-col gap-6">
        <Card title="Household">
          <ul>
            {people.map((m) => (
              <MemberControls
                key={m.id}
                id={m.id}
                displayName={m.displayName}
                avatarSprite={m.avatarSprite}
                color={m.color}
                role={m.role}
                active={m.deactivatedAt === null}
                isMe={m.id === me.memberId}
                telegramUserId={m.telegramUserId}
                character={characters.get(m.id)}
                image={images.get(m.id)}
              />
            ))}
          </ul>
        </Card>

        <MintInviteForm />

        <Card title="Invite codes">
          {codes.length === 0 ? (
            <p className="text-sm text-bm-muted">No codes yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {codes.map((c) => {
                const state = inviteCodeState(c, at);
                return (
                  <li
                    key={c.code}
                    className="flex flex-wrap items-center gap-3 text-sm"
                    data-testid={`invite-${c.code}`}
                  >
                    <code className="font-mono">{c.code}</code>
                    <span>{c.role === "admin" ? "Admin" : "Member"}</span>
                    <span>
                      {c.useCount} of {c.maxUses} used
                    </span>
                    <span>
                      {state === "active"
                        ? `Expires ${c.expiresAt.toISOString().slice(0, 10)}`
                        : STATE_LABEL[state]}
                    </span>
                    {c.createdByName ? (
                      <span className="text-bm-muted">
                        by {c.createdByName}
                      </span>
                    ) : null}
                    {state === "active" ? (
                      <RevokeInviteButton code={c.code} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <PairKioskForm />

        <Card title="Kiosks">
          {devices.length === 0 ? (
            <p className="text-sm text-bm-muted">No kiosks yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {devices.map((d) => {
                const state = kioskDeviceState(d, at);
                return (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center gap-3 text-sm"
                    data-testid={`kiosk-${d.name}`}
                  >
                    <span className="font-semibold">{d.name}</span>
                    <span>{DEVICE_STATE_LABEL[state]}</span>
                    {state === "paired" && d.pairedAt ? (
                      <span className="text-bm-muted">
                        since {day(d.pairedAt)}
                        {d.lastSeenAt
                          ? `, last seen ${d.lastSeenAt.toISOString().slice(0, 16).replace("T", " ")} UTC`
                          : ""}
                      </span>
                    ) : null}
                    {state === "paired" || state === "waiting" ? (
                      <RevokeKioskButton
                        deviceId={d.id}
                        name={d.name}
                        paired={state === "paired"}
                      />
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
