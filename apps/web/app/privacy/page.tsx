import type { Metadata } from "next";
import Link from "next/link";
import {
  AUTH_COOKIE_PREFIX,
  AUTH_SESSION,
  LAST_LOGIN_METHOD_COOKIE,
  SECURITY_COOKIES,
} from "@baumy/auth/env";
import { PHOTO_RETENTION_DAYS } from "@baumy/core";
import { RATE_LIMIT_ROW_HORIZON_MS } from "@baumy/db/rate-limit";
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
  KIOSK_WALK_IN_COOKIE,
  KIOSK_WALK_IN_MAX_AGE_S,
} from "@/lib/kiosk/cookies";
import { PAIRING_COOKIE, PAIRING_COOKIE_MAX_AGE_S } from "@/lib/kiosk/pairing";
import {
  LOGIN_REQUEST_RETENTION_MS,
  LOGIN_REQUEST_TTL_MS,
} from "@baumy/db/login-requests";
import {
  LOGIN_COOKIE,
  LOGIN_COOKIE_MAX_AGE_S,
} from "@/lib/login-approval/flow";

// Public (issue #82): outside the (hub) gate, no session read. Every sentence
// here describes what the code does; change the words in the same PR as the
// behaviour, and move PRIVACY_UPDATED with them (issue #87 corrected it). The cookie names and the
// numbers come from the constants the code uses, so they cannot drift.

const DAY_S = 24 * 60 * 60;
const SESSION_DAYS = AUTH_SESSION.expiresInSeconds / DAY_S;
const SESSION_CACHE_MIN = AUTH_SESSION.cookieCacheMaxAgeSeconds / 60;
const KIOSK_YEARS = Math.round(KIOSK_COOKIE_MAX_AGE_S / (365 * DAY_S));
const KIOSK_MEMBER_MIN = KIOSK_MEMBER_MAX_AGE_S / 60;
const RATE_LIMIT_DAYS = RATE_LIMIT_ROW_HORIZON_MS / (DAY_S * 1000);
const LAST_LOGIN_DAYS = SECURITY_COOKIES.lastLoginMethodMaxAgeSeconds / DAY_S;
const TWO_FACTOR_MIN = SECURITY_COOKIES.twoFactorChallengeMaxAgeSeconds / 60;
const TRUST_DAYS = SECURITY_COOKIES.trustDeviceMaxAgeSeconds / DAY_S;
const PASSKEY_CHALLENGE_MIN =
  SECURITY_COOKIES.passkeyChallengeMaxAgeSeconds / 60;
const LOGIN_REQUEST_MIN = LOGIN_REQUEST_TTL_MS / 60_000;
const LOGIN_REQUEST_HOURS = LOGIN_REQUEST_RETENTION_MS / 3_600_000;

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      description="What Baumy Olympics keeps about you, where it lives and who else sees it."
      updated={PRIVACY_UPDATED}
    >
      <LegalSection title="Who runs this">
        <p>
          Baumy Olympics (www.baumy.tech) is a private app for the people who
          live in one house. The house&apos;s owner runs it for the household.
          It is not a commercial service: nobody pays for it, and there are no
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
            <strong>Passkeys, if you add one:</strong> its public key (the
            private key never leaves your device), the name you gave it, its
            credential id, whether it lives on one device or is synced, whether
            it is backed up, how the browser reaches it (its transports), the
            authenticator&apos;s model id (AAGUID) and when you added it.
          </li>
          <li>
            <strong>Two-factor, if you turn it on:</strong> your authenticator
            secret and your backup codes, both stored encrypted; a count of
            wrong codes, and a temporary lock after too many; and, for each
            browser where you ticked &quot;Trust this device&quot;, a record
            that lets it skip the code for {TRUST_DAYS} days.
          </li>
          <li>
            <strong>Sessions:</strong> one per signed-in device, with its IP
            address, its browser name (user agent), when it signed in and when
            it was last used. Settings, Security lists your devices by a name
            worked out from the browser (for example &quot;Chrome on
            macOS&quot;) and when each was used; it does not show the IP address
            or a place.
          </li>
          <li>
            <strong>Your member profile:</strong> display name, colour, the
            gallery character you picked (if any), your role, your kiosk PIN (as
            a hash only), your Telegram user id if you link Telegram, and
            whether your membership is switched off. A drawn character chosen
            before characters moved to the gallery (hair, skin and shirt) is
            still stored on it but is no longer shown or used.
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
            <strong>Avatar images:</strong> the pixel characters an admin adds
            to the household&apos;s gallery (up to three poses each, cleaned, 48
            to 64 pixels tall), who added each, and which one each member
            picked. The files as uploaded are not kept.
          </li>
          <li>
            <strong>The audit log:</strong> who changed what, when, from which
            screen, and a copy of what was entered: for example a note&apos;s
            text (also after the note is deleted), shopping items, a calendar
            event&apos;s title, times, place and description, and earlier
            display names. Passwords and PINs are never in it. Retried requests
            are remembered, with their result, so they do not run twice.
          </li>
          <li>
            <strong>Rate-limit counters:</strong> to slow down password guessing
            and abuse, short-lived counters keyed by IP address (and by member).
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
            The app runs on Vercel. Its server code runs in Frankfurt (fra1).
            Vercel&apos;s network in front of it, and its request logs (for
            example the IP address and page of each request, kept for a short
            time), are not tied to one region.
          </li>
          <li>
            Proof photos and avatar images are stored in Vercel Blob in
            Frankfurt (fra1). The store is private: an image is only shown
            through the app, to household members and the paired kitchen screen
            (avatar images also to a founder setting up the household, so they
            can pick one).
          </li>
          <li>
            Calendar events live in the house&apos;s Google Calendar; the app
            has no calendar of its own, but the audit log keeps what was entered
            when an event is added or changed through the app. The shopping list
            lives in baumy-brain (below).
          </li>
          <li>
            Some services below (Google, Anthropic, Groq, Resend) are US
            companies, so what they receive leaves the EU.
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
            change (title, times, place, description) go to Google, tagged with
            your member id so the app can show your colour.
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
            address, reset your password, password changed, a password or a
            passkey was added to your account). It receives your email address
            and that email.
          </li>
          <li>
            <strong>baumy-brain and Telegram:</strong> baumy-brain
            (brain.baumy.tech) is the house&apos;s Telegram bot, which the same
            owner runs. The shopping list belongs to it, so items you add or
            tick off here are sent to it. It can also read the chores, scores,
            notes, reminders, the calendar, the pot, claims waiting for
            confirmation and the chore weights, and may post them in the
            house&apos;s Telegram group. It runs messages through its own calls
            to Anthropic. If you link your Telegram account, we keep your
            Telegram user id, and the bot can do things in this app for you when
            you ask it, or for another housemate after a confirm button.
            Everything in Telegram also passes through Telegram. If Sign in with
            Baumy is switched on and you use it, the bot messages you the
            sign-in&apos;s device name (for example &quot;Chrome on macOS&quot;)
            with the numbers to tap; the request (device name, the numbers and
            what you answered) is deleted by the daily clean-up once it is more
            than {LOGIN_REQUEST_HOURS} hours old (so within two days), and a
            record that it was asked for, with the asking device&apos;s IP
            address, stays in the audit log. baumy-brain keeps its own copy of
            the device name and the numbers, in the pending sign-in card it
            sends and in its log.
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
            <code>{LAST_LOGIN_METHOD_COOKIE}</code>: how this browser last
            signed in (email, Google or passkey), so the sign-in page can say
            &quot;Last used&quot;, for {LAST_LOGIN_DAYS} days. Not a secret.
          </li>
          <li>
            <code>
              {AUTH_COOKIE_PREFIX}.{SECURITY_COOKIES.twoFactorChallenge}
            </code>
            : between your password and your two-factor code, for at most{" "}
            {TWO_FACTOR_MIN} minutes.
          </li>
          <li>
            <code>
              {AUTH_COOKIE_PREFIX}.{SECURITY_COOKIES.trustDevice}
            </code>
            : only if you tick &quot;Trust this device&quot;; it lets this
            browser skip the two-factor code for {TRUST_DAYS} days, renewed each
            time you sign in with it.
          </li>
          <li>
            <code>
              {AUTH_COOKIE_PREFIX}.{SECURITY_COOKIES.passkeyChallenge}
            </code>
            : the one-time challenge while you use or add a passkey, for{" "}
            {PASSKEY_CHALLENGE_MIN} minutes.
          </li>
          <li>
            Short-lived helper cookies during a sign-in, for example the Google
            round trip.
          </li>
          <li>
            <code>{LOGIN_COOKIE}</code>: only while you sign in with Baumy from
            Telegram; it proves the approval is for this browser, and goes after{" "}
            {LOGIN_COOKIE_MAX_AGE_S} seconds (a request lasts{" "}
            {LOGIN_REQUEST_MIN} minutes). A session made that way is marked with{" "}
            <code>{AUTH_COOKIE_PREFIX}.dont_remember</code> and ends when the
            browser closes, or after a day at most.
          </li>
          <li>
            <code>{PAIRING_COOKIE}</code>: only on an iPad showing the code to
            become the kitchen screen; it proves an admin&rsquo;s approval is
            for that iPad, and goes after {PAIRING_COOKIE_MAX_AGE_S / 60}{" "}
            minutes or once it is paired.
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
            <code>{KIOSK_WALK_IN_COOKIE}</code>: on the kitchen iPad, the member
            who just tapped their avatar (a member id), so their character walks
            in once; the screen clears it straight away, and it lasts{" "}
            {KIOSK_WALK_IN_MAX_AGE_S} seconds at most.
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
            last used the app on that device. When you sign a device out in
            Settings, Security, its session ends at once, but a page it already
            has open can keep working for up to {SESSION_CACHE_MIN} minutes. It
            cannot change your sign-in settings in that time: those check the
            session in the database each time. Signing devices out, or changing
            or resetting your password, also forgets every device you trusted
            for two-factor.
          </li>
          <li>
            Proof photos are deleted {PHOTO_RETENTION_DAYS} days after their
            claim was settled.
          </li>
          <li>
            Avatar images are kept while the household has them; archiving one
            only takes it out of the gallery.
          </li>
          <li>Password-reset and confirmation links expire.</li>
          <li>
            Rate-limit counters are deleted automatically: the sign-in library
            clears its own after they expire, and the app&apos;s own go at the
            latest {RATE_LIMIT_DAYS} days after their last use.
          </li>
          <li>
            Everything else stays while the household uses the app and is not
            deleted automatically, including the audit log. A deleted note is
            hidden everywhere but stays in the database.
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
            your sign-in account (email, password hash, Google link, passkeys,
            two-factor secret and backup codes, and sessions) directly in the
            database; the passkeys, two-factor and sessions go with the account.
            A trusted-device record expires by itself within {TRUST_DAYS} days.
          </li>
          <li>
            Your member entry stays, because the household&apos;s history points
            at it: your past chores stay in the season&apos;s score history
            (everyone&apos;s scores are rebuilt from it), and the audit log
            keeps its copies, including your earlier names. The admin can rename
            the entry, change its colour and avatar, and unlink your Telegram
            account in the app; your PIN hash, your gallery pick and any old
            drawn character stay on it unless the owner clears them in the
            database.
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
