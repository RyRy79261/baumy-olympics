import Link from "next/link";
import type { ReactNode } from "react";
import { RULESET_V1 } from "@baumy/core";
import {
  BaumyBadge,
  Card,
  Glyph,
  PageHeading,
  PixelIcon,
  buttonClass,
  linkClass,
} from "@baumy/ui";
import { LegalLinks } from "@/components/legal/legal-page";
import { NEW_BOUNTY_MS } from "@/lib/chores/urgency";
import { SCREENSAVER_IDLE_MS } from "@/lib/kiosk/constants";

// The public landing page at `/` (issue #96): what a signed-out visitor, and
// Google's branding check, sees instead of a redirect to sign-in. Server
// rendered, no script needed to read it, and nothing here reads a session or
// the database. Every sentence must stay true to SPEC and /privacy: change
// the words in the same PR as the behaviour.

// The explainer's numbers come from the constants the code runs on, so the
// page cannot promise a rule the game does not play.
const R = RULESET_V1;
const NEW_DAYS = NEW_BOUNTY_MS / 86_400_000;
const THIRD_IN_A_ROW_PCT = 100 + 2 * R.streakStepPct;
const BREAK_CAP_PCT = R.breakPctPerLen * R.breakLenCap;
const SCREENSAVER_MIN = SCREENSAVER_IDLE_MS / 60_000;

/** The page's one-line purpose, also its meta description. */
export const LANDING_DESCRIPTION =
  "Baumy Olympics is a private household app for the people who live in one house: a shared calendar, chores as bounties worth points, the shopping list, reminders, and Baumy the pixel cat as the house assistant.";

export function LandingPage() {
  return (
    <main className="min-h-dvh bg-bm-bg px-4 py-10 text-bm-text">
      <article className="mx-auto flex max-w-3xl flex-col gap-8">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
          <BaumyBadge scale={3} label="Baumy, the Baumy Olympics cat" />
          <div className="flex-1 [&>div]:mb-0">
            <PageHeading
              eyebrow="A private household app"
              title="Baumy Olympics"
              description={LANDING_DESCRIPTION}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-4 sm:justify-start">
          <Link href="/auth/sign-in" className={buttonClass("primary")}>
            Sign in
          </Link>
          <span className="text-base text-bm-muted">
            Invited by the house?{" "}
            <Link href="/auth/sign-up" className={linkClass}>
              Create an account
            </Link>
          </span>
        </div>

        <HowItWorks />

        <Card title="Why it uses Google">
          <div className="flex flex-col gap-3 text-lg leading-relaxed">
            <p>
              <strong>Sign in with Google is optional.</strong> Email and
              password, or a passkey, work just as well. If you choose Google,
              it shares only your basic profile: your name, your email address
              and your profile picture. The app asks for nothing else from your
              Google account: not your Gmail, your Drive, your contacts or your
              own calendar.
            </p>
            <p>
              <strong>The house calendar</strong> is one Google Calendar
              belonging to the house, shared with a Google service account made
              for this house. The app reads and writes the house&apos;s events
              through that account, never through yours.
            </p>
          </div>
        </Card>

        <Card title="Who can use it">
          <p className="text-lg leading-relaxed">
            Only the housemates. Anyone can create an account, but an account
            opens nothing until the house&apos;s admin gives it an invite code.
            It is not a commercial service: there are no ads, nothing is sold,
            and nobody pays for it.
          </p>
        </Card>

        <footer className="flex flex-col items-center gap-2">
          <p className="text-center text-base text-bm-muted">
            Read what the app keeps about you in the{" "}
            <Link href="/privacy" className={linkClass}>
              privacy policy
            </Link>{" "}
            and the house rules in the{" "}
            <Link href="/terms" className={linkClass}>
              terms
            </Link>
            .
          </p>
          <LegalLinks />
        </footer>
      </article>
    </main>
  );
}

/** One step of "How it works": a pixel icon, a short title, a few lines. */
function Step({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="pixel-frame pixel-frame-4 flex gap-4 bg-bm-surface p-4 text-bm-text sm:p-5">
      <div className="flex w-12 shrink-0 justify-center pt-1" aria-hidden>
        {icon}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="font-display text-xs leading-relaxed">{title}</h3>
        <div className="flex flex-col gap-2 text-lg leading-relaxed">
          {children}
        </div>
      </div>
    </section>
  );
}

/** The owner's explainer (issue #96): the game in six calm steps. */
function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works" className="flex flex-col gap-4">
      <h2
        id="how-it-works"
        className="font-display text-sm leading-relaxed text-bm-text"
      >
        How it works
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Step
          icon={
            <div className="flex flex-col items-center gap-1">
              <PixelIcon name="basket" scale={2} />
              <PixelIcon name="wrench" scale={2} />
            </div>
          }
          title="Bounties"
        >
          <p>
            Household jobs are bounties worth points.{" "}
            <span className="text-bm-amber">Consumables</span> are things to buy
            or refill; <span className="text-bm-teal">maintenance</span> is
            cleaning and fixing.
          </p>
          <p>
            <span className="text-bm-red">Urgent</span> ones are due now or
            before midnight; <span className="text-bm-yellow">new</span> ones
            were added in the last {NEW_DAYS} days.
          </p>
        </Step>
        <Step
          icon={<Glyph name="flame" size={40} color="var(--color-bm-amber)" />}
          title="Streaks"
        >
          <p>
            Do the same job again and again and your streak grows: each time in
            a row adds {R.streakStepPct}% of the job&apos;s points, so the third
            in a row pays {THIRD_IN_A_ROW_PCT}%.
          </p>
          <p>
            Do a job while someone else holds its streak and you break it, for a
            bonus of {R.breakPctPerLen}% of the job&apos;s points for each job
            in their run (up to {BREAK_CAP_PCT}%). They lose nothing: scores
            only go up.
          </p>
        </Step>
        <Step
          icon={
            <Glyph name="trophy" size={40} color="var(--color-bm-yellow)" />
          }
          title="The season and the pot"
        >
          <p>
            A season is one calendar year, and streaks start over on 1 January.
            Through the year the house puts money into a savings pot.
          </p>
          <p>
            When the season ends, whoever has the most points takes the whole
            pot.
          </p>
        </Step>
        <Step
          icon={<Glyph name="check" size={40} color="var(--color-bm-green)" />}
          title="Confirmations"
        >
          <p>
            Log a job you did and it usually counts straight away. For{" "}
            {R.challengeWindowH} hours your housemates can confirm it, or
            dispute it with a reason.
          </p>
          <p>
            You can add a photo as proof, and a job can ask for one. Logged it
            by mistake? Undo it within {R.undoWindowMin} minutes.
          </p>
        </Step>
        <Step
          icon={
            <Glyph name="calendar" size={40} color="var(--color-bm-teal)" />
          }
          title="The kitchen screen"
        >
          <p>
            An iPad in the kitchen shows the month&apos;s calendar, the bounties
            and the board. Tap your face to act as you.
          </p>
          <p>
            A reminder fills the screen until everyone has tapped
            &quot;I&apos;ve seen it&quot;. At night, or after {SCREENSAVER_MIN}{" "}
            minutes untouched, raccoons take over as the screensaver.
          </p>
        </Step>
        <Step icon={<BaumyBadge scale={1} />} title="Baumy the cat">
          <p>
            Ask Baumy by voice or by typing, for example &quot;who&apos;s
            winning?&quot; or &quot;I took the bins out&quot;. Baumy answers,
            and anything it would change comes back as a proposal for you to
            approve first.
          </p>
          <p>
            Baumy is in the house&apos;s Telegram group too, and asks you to
            confirm with a button before anything important.
          </p>
        </Step>
      </div>
    </section>
  );
}
