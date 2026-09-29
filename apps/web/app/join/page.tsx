import type { Metadata } from "next";
import Link from "next/link";
import { isFounderEmail } from "@baumy/auth/env";
import { createHttpDb, type Queryable } from "@baumy/db";
import { listAvatars } from "@baumy/db/avatars";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { findMemberByAuthUserId } from "@baumy/db/members";
import { Card, FormMessage, PageHeading, buttonClass } from "@baumy/ui";
import { requireJoiningPage } from "@/lib/auth";
import { avatarImageView } from "@/lib/avatars/paths";
import { FounderForm, InviteForm } from "./join-forms";

// /join (SPEC §6.2): where a signed-in account with no member row lands.
// Sign-up is open; the household is not. An invite code, or a verified email
// on FOUNDER_EMAILS, makes the account a member. Outside the hub shell,
// because the visitor is not in the household yet.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Join - Baumy Olympics" };

export default async function JoinPage() {
  const me = await requireJoiningPage();
  const existing = await findMemberByAuthUserId(
    createHttpDb() as unknown as Queryable,
    me.userId,
  );
  const founder = isFounderEmail(process.env, me.email);
  // The gallery to pick a character from (issue #111): the live ones.
  const gallery = (
    await listAvatars(
      createHttpDb() as unknown as Queryable,
      HOUSEHOLD_ID,
      false,
    )
  ).map((a) => ({ id: a.id, name: a.name, image: avatarImageView(a)! }));

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-4 py-10">
      <PageHeading
        eyebrow="Baumy Olympics"
        title="Join the household"
        description="Only household members can see the hub."
        actions={
          <Link href="/auth/sign-out" className={buttonClass("secondary")}>
            Sign out
          </Link>
        }
      />
      <p className="text-sm">
        Signed in as <span data-testid="signed-in-as">{me.email}</span>.
      </p>
      {existing?.deactivatedAt ? (
        <Card title="Your membership is switched off">
          <FormMessage tone="error">
            Your membership was switched off. Ask a household admin to turn it
            back on.
          </FormMessage>
        </Card>
      ) : (
        <>
          {founder ? (
            <FounderForm
              email={me.email}
              emailVerified={me.emailVerified}
              gallery={gallery}
            />
          ) : null}
          <InviteForm gallery={gallery} />
        </>
      )}
    </main>
  );
}
