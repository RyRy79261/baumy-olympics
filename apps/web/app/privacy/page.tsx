import type { Metadata } from "next";
import Link from "next/link";
import { AUTH_COOKIE_PREFIX, AUTH_SESSION } from "@baumy/auth/env";
import { PHOTO_RETENTION_DAYS } from "@baumy/core";
import { linkClass } from "@baumy/ui";
import {
  LegalPage,
  LegalSection,
  PRIVACY_UPDATED,
} from "@/components/legal/legal-page";
import { REFRESH_COOKIE, REFRESH_COOKIE_MAX_AGE_S } from "@/lib/hub/refresh";
import {
  KIOSK_COOKIE,
  KIOSK_COOKIE_MAX_AGE_S,
  KIOSK_MEMBER_COOKIE,
  KIOSK_MEMBER_MAX_AGE_S,
} from "@/lib/kiosk/cookies";

// Public (issue #82): outside the (hub) gate, no session read. Every sentence
// here describes what the code does; change the words in the same PR as the
// behaviour, and move PRIVACY_UPDATED with them. The cookie names and the
// numbers come from the constants the code uses, so they cannot drift.

const DAY_S = 24 * 60 * 60;
const SESSION_DAYS = AUTH_SESSION.expiresInSeconds / DAY_S;
const SESSION_CACHE_MIN = AUTH_SESSION.cookieCacheMaxAgeSeconds / 60;
const KIOSK_YEARS = Math.round(KIOSK_COOKIE_MAX_AGE_S / (365 * DAY_S));
const KIOSK_MEMBER_MIN = KIOSK_MEMBER_MAX_AGE_S / 60;

export const metadata: Metadata = { title: "Privacy - Baumy Olympics" };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      description="What Baumy Olympics keeps about you, where it lives and who else sees it."
      updated={PRIVACY_UPDATED}
    >
      <LegalSection title="Who runs this">
        <p>
          Baumy Olympics (baumy.tech) is a private app for the people who live
          in one house. The house&apos;s owner runs it for the household. It is
          not a commercial service: nobody pays for it, and there are no
          customers.
        </p>
      </LegalSection>

      <LegalSection title="What we keep">
        <ul>
          <li>
            <strong>Your account:</strong> your email address, your name,
            whether you confirmed your email, and when you signed up. With a
            password, we keep only a hash of it (Better Auth), never the
            password itself.
          </li>
          <li>
            <strong>Google sign-in, if you use it:</strong> your Google account
            id, name, email, the link to your profile picture, and the sign-in
            tokens Google returns.
          </li>
          <li>
            <strong>
              Passkeys and two-factor sign-in, once they are added:
            </strong>{" "}
            a passkey&apos;s public key and name (never a private key), and your
            two-factor secret and backup codes. This page will say more when
            they arrive.
          </li>
          <li>
            <strong>Sessions:</strong> one per signed-in device, with its IP
            address, its browser name (user agent) and when it was used.
          </li>
          <li>
            <strong>Your member profile:</strong> display name, colour, your
            16-bit character, your role, your kiosk PIN (as a hash only), your
            Telegram user id if you link Telegram, and whether your membership
            is switched off.
          </li>
          <li>
            <strong>The game:</strong> chores, every completion (who did it, who
            logged it, when, from which screen, any note, confirmations and
            disputes), points, streaks, point adjustments, and the pot
            contributions (amount and who paid).
          </li>
          <li>
            <strong>The board:</strong> notes (title, text, colour, author) and
            reminders, with who has read each reminder.
          </li>
          <li>
            <strong>Proof photos</strong> you attach to a chore.
          </li>
          <li>
            <strong>The audit log:</strong> who changed what, when, from which
            screen, with the details of the change. Retried requests are
            remembered so they do not run twice.
          </li>
          <li>
            <strong>AI usage counts:</strong> how many Baumy commands and voice
            clips each member used, with token counts and clip lengths. Not what
            you said.
          </li>
          <li>
            <strong>Kitchen screens:</strong> each paired iPad&apos;s name, who
            paired it, when it was last seen, and a hash of its device token.
          </li>
          <li>
            <strong>Connected chatbots:</strong> if you connect one (for example
            claude.ai), its name, what you allowed it to do, and hashes of its
            tokens.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Where it lives">
        <ul>
          <li>
            The database is Neon Postgres in Frankfurt (AWS eu-central-1), in
            the EU.
          </li>
          <li>
            The app runs on Vercel. Vercel may handle a request on servers
            outside the EU.
          </li>
          <li>
            Proof photos are stored in Vercel Blob. The store is private: a
            photo is only shown through the app, to household members and the
            paired kitchen screen.
          </li>
          <li>
            Calendar events live only in the house&apos;s Google Calendar; we
            keep no copy. The shopping list lives in baumy-brain (below).
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Who else sees what">
        <ul>
          <li>
            <strong>Google sign-in:</strong> if you use it, Google tells us your
            name, email and picture, and Google knows you signed in here.
          </li>
          <li>
            <strong>Google Calendar:</strong> the house calendar is shared with
            a Google service account made for this house. Events you add or
            change (title, times, description) go to Google, tagged with your
            member id so the app can show your colour.
          </li>
          <li>
            <strong>Anthropic (Claude):</strong> when you ask Baumy something,
            Anthropic receives what you typed (or the transcript of what you
            said), the date and time, your member name, the housemates&apos;
            names and the chores, and whatever the app looks up to answer (for
            example chores, scores, notes, calendar events or the shopping
            list).
          </li>
          <li>
            <strong>Groq:</strong> when you hold the microphone, Groq receives
            the audio clip, with the housemates&apos; and chores&apos; names as
            a spelling hint, and sends back the text.
          </li>
          <li>
            <strong>Resend:</strong> sends the account emails (confirm your
            address, reset your password, password changed). It receives your
            email address and that email.
          </li>
          <li>
            <strong>baumy-brain and Telegram:</strong> the shopping list belongs
            to baumy-brain, the house&apos;s Telegram bot, which the same owner
            runs. Items you add or tick off here are sent to it. If you link
            your Telegram account, we keep your Telegram user id, and the bot
            can do things in this app for you when you ask it in Telegram.
            Messages in Telegram also pass through Telegram.
          </li>
          <li>
            <strong>Chatbots you connect:</strong> a chatbot you connect (for
            example claude.ai) sees what its tools read for you, and can only
            change things if you allowed that when you connected it.
          </li>
          <li>
            <strong>Vercel and Neon</strong> host the app and the database, so
            they hold the data above on our behalf.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="No ads, no selling, no tracking">
        <p>
          There are no ads, and nothing is sold or shared for marketing. The app
          has no analytics and no tracking scripts, loads no third-party
          scripts, and serves its fonts itself. The sign-in library&apos;s own
          telemetry is switched off.
        </p>
      </LegalSection>

      <LegalSection title="Cookies">
        <p>
          Only cookies the app needs to work. None of them track you, so there
          is no cookie banner.
        </p>
        <ul>
          <li>
            <code>{AUTH_COOKIE_PREFIX}.session_token</code>: keeps you signed
            in, for up to {SESSION_DAYS} days after you last used the app. On
            the live site its name starts with <code>__Secure-</code>.
          </li>
          <li>
            <code>{AUTH_COOKIE_PREFIX}.session_data</code>: a signed copy of
            your session that saves a database read, for {SESSION_CACHE_MIN}{" "}
            minutes.
          </li>
          <li>
            Short-lived helper cookies during a sign-in, for example the Google
            round trip.
          </li>
          <li>
            <code>{KIOSK_COOKIE}</code>: only on a paired kitchen iPad; it signs
            the device in, for{" "}
            {KIOSK_YEARS === 1 ? "a year" : `${KIOSK_YEARS} years`}.
          </li>
          <li>
            <code>{KIOSK_MEMBER_COOKIE}</code>: on the kitchen iPad, who tapped
            their avatar (a member id, never a PIN), for at most{" "}
            {KIOSK_MEMBER_MIN} minutes.
          </li>
          <li>
            <code>{REFRESH_COOKIE}</code>: set by the kitchen screen for{" "}
            {REFRESH_COOKIE_MAX_AGE_S} seconds so its refresh fetches a fresh
            shopping list.
          </li>
        </ul>
        <p>
          The kitchen screen also stores its offline page in the browser, so it
          can say it is offline.
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <ul>
          <li>
            Sessions end when you sign out, or {SESSION_DAYS} days after you
            last used the app on that device.
          </li>
          <li>
            Proof photos are deleted {PHOTO_RETENTION_DAYS} days after their
            claim was settled.
          </li>
          <li>Password-reset and confirmation links expire.</li>
          <li>
            Everything else stays while the household uses the app; nothing else
            is deleted automatically. A deleted note is hidden everywhere but
            stays in the database.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Seeing, changing and deleting your data">
        <ul>
          <li>
            You can change your display name, colour and character yourself in
            Settings.
          </li>
          <li>
            To leave, ask the admin. They can switch off your membership in the
            app straight away, which closes the hub to you.
          </li>
          <li>
            There is no delete-account button yet. On request, the owner deletes
            your sign-in account (email, password hash, Google link and
            sessions) directly in the database.
          </li>
          <li>
            Your past chores stay in the season&apos;s score history, because
            everyone&apos;s scores are rebuilt from it. The admin can rename
            your member entry so it no longer shows your name.
          </li>
          <li>
            For a copy of what we hold about you, or anything else removed, ask
            the owner. They will tell you honestly what can be done.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Talk to the owner, in the house or in the house&apos;s Telegram group.
          If this page changes, its date changes and the house hears about it.
          See also the{" "}
          <Link href="/terms" className={linkClass}>
            terms
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
