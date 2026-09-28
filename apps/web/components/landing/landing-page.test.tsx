import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RULESET_V1 } from "@baumy/core";
import { NEW_BOUNTY_MS } from "@/lib/chores/urgency";
import { SCREENSAVER_IDLE_MS } from "@/lib/kiosk/constants";
import { LANDING_DESCRIPTION, LandingPage } from "./landing-page";

// Issue #96: the public landing page. It reads no session, so rendering it
// here is rendering it signed out, with no script: what Google's branding
// check and a curl see.

const out = renderToStaticMarkup(<LandingPage />);

describe("LandingPage", () => {
  it("names the app, says what it is for and shows the Baumy badge", () => {
    expect(out).toContain(">Baumy Olympics</h1>");
    expect(LANDING_DESCRIPTION).toContain("private household app");
    expect(out).toContain(LANDING_DESCRIPTION.replace(/'/g, "&#x27;"));
    expect(out).toContain('data-sprite="baumy-badge"');
  });

  it("offers one Sign in button and links to privacy and terms", () => {
    expect(out.match(/href="\/auth\/sign-in"/g)).toHaveLength(1);
    expect(out).toContain(">Sign in</a>");
    expect(out).toContain('href="/privacy"');
    expect(out).toContain('href="/terms"');
  });

  it("says only housemates get in, and leaves Google to the privacy page", () => {
    expect(out).toContain("Who can use it");
    expect(out).toContain('href="/privacy"');
    expect(out).not.toMatch(/google/i);
    expect(out).toContain("invite code");
    expect(out).toContain("founders, and people the admin");
  });

  it("claims only what is true everywhere", () => {
    expect(out).toContain("Breaking a streak never");
    expect(out).not.toContain("scores only go up");
    expect(out).toContain("or by voice where it&#x27;s set up");
    expect(out).toContain("(some things ask for your PIN)");
    expect(out).not.toContain("passkey");
  });

  it("explains the game with the numbers the code plays by", () => {
    expect(out).toContain("How it works");
    for (const title of [
      "Bounties",
      "Streaks",
      "The season and the pot",
      "Confirmations",
      "The kitchen screen",
      "Baumy the cat",
    ]) {
      expect(out).toContain(`>${title}</h3>`);
    }
    const r = RULESET_V1;
    expect(out).toContain(`adds ${r.streakStepPct}% of the job`);
    expect(out).toContain(`pays ${100 + 2 * r.streakStepPct}%`);
    expect(out).toContain(`bonus of ${r.breakPctPerLen}% of the job`);
    expect(out).toContain(`up to ${r.breakPctPerLen * r.breakLenCap}%`);
    expect(out).toContain(`For ${r.challengeWindowH} hours`);
    expect(out).toContain(`within ${r.undoWindowMin} minutes`);
    expect(out).toContain(`last ${NEW_BOUNTY_MS / 86_400_000} days`);
    expect(out).toContain(`after ${SCREENSAVER_IDLE_MS / 60_000} minutes`);
  });

  it("gives no email address and no script-only content", () => {
    expect(out).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(out).toContain("<main");
    expect(out).not.toContain("<script");
  });
});
