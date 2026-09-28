import type { Metadata } from "next";
import Link from "next/link";
import { linkClass } from "@baumy/ui";
import {
  LegalPage,
  LegalSection,
  TERMS_UPDATED,
} from "@/components/legal/legal-page";

// Public (issue #82): outside the (hub) gate, no session read. Move
// TERMS_UPDATED whenever these words change.

export const metadata: Metadata = { title: "Terms - Baumy Olympics" };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      description="The house rules for using Baumy Olympics."
      updated={TERMS_UPDATED}
    >
      <LegalSection title="What this is">
        <p>
          Baumy Olympics (baumy.tech) is a private app for one household, run by
          the house&apos;s owner. It is not a commercial service. By using it
          you agree to these terms.
        </p>
      </LegalSection>

      <LegalSection title="Household use only">
        <p>
          The app is for the people who live in the house. Anyone can create an
          account, but only an invite from the household makes you a member, and
          only members see the hub.
        </p>
      </LegalSection>

      <LegalSection title="Be decent">
        <ul>
          <li>
            Log the chores you actually did, and dispute a claim only when you
            think it is wrong.
          </li>
          <li>
            Keep notes and reminders kind, and never put passwords or other
            secrets in them.
          </li>
          <li>
            Keep your password and kiosk PIN to yourself, and do not use someone
            else&apos;s account or PIN.
          </li>
          <li>Do not try to break, overload or get around the app.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Points and the pot">
        <p>
          Points are a game. They have no cash value. The only money involved is
          the house&apos;s own year-end pot, which the housemates agree among
          themselves. The app only keeps a record of it; no money moves through
          the app.
        </p>
      </LegalSection>

      <LegalSection title="Baumy can be wrong">
        <p>
          Baumy&apos;s answers come from an AI and can be wrong. Baumy in the
          app never changes anything until you approve it, so check what you
          approve.
        </p>
      </LegalSection>

      <LegalSection title="The admin">
        <p>
          The household&apos;s admin can switch off a membership, unpair a
          kitchen screen, cancel invites and change the chores and their points.
          If you move out, or these terms are broken, the admin may remove you.
        </p>
      </LegalSection>

      <LegalSection title="Provided as it is">
        <p>
          A housemate builds and runs the app in their spare time. It is
          provided as it is, with no promise that it is always available,
          correct or free of bugs, and data can be lost. As far as the law
          allows, the owner is not liable for any loss from using it.
        </p>
      </LegalSection>

      <LegalSection title="Changes and contact">
        <p>
          These terms may change; when they do, the date at the top changes and
          the house hears about it. Questions go to the owner, in the house or
          in the house&apos;s Telegram group. How we handle your data is on the{" "}
          <Link href="/privacy" className={linkClass}>
            privacy page
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
