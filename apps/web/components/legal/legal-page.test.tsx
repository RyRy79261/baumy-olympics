import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AUTH_COOKIE_PREFIX } from "@baumy/auth/env";
import { PHOTO_RETENTION_DAYS } from "@baumy/core";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import { REFRESH_COOKIE } from "@/lib/hub/refresh";
import { KIOSK_COOKIE, KIOSK_MEMBER_COOKIE } from "@/lib/kiosk/cookies";
import {
  LegalLinks,
  PRIVACY_UPDATED,
  TERMS_UPDATED,
  formatUpdated,
} from "./legal-page";

// Issue #82: the public privacy and terms pages. They read no session, so
// rendering them here is rendering them signed out.

describe("formatUpdated", () => {
  it("writes an ISO date the way the page shows it", () => {
    expect(formatUpdated("2026-09-28")).toBe("28 September 2026");
    expect(formatUpdated("2027-01-05")).toBe("5 January 2027");
  });
});

describe("LegalLinks", () => {
  it("links to both pages", () => {
    const out = renderToStaticMarkup(<LegalLinks />);
    expect(out).toContain('href="/privacy"');
    expect(out).toContain('href="/terms"');
  });
});

describe("PrivacyPage", () => {
  const out = renderToStaticMarkup(<PrivacyPage />);

  it("has its heading, its date and the footer links", () => {
    expect(out).toContain(">Privacy</h1>");
    expect(out).toContain(`dateTime="${PRIVACY_UPDATED}"`);
    expect(out).toContain(formatUpdated(PRIVACY_UPDATED));
    expect(out).toContain('href="/terms"');
    expect(out).toContain('href="/privacy"');
  });

  it("names every cookie the app sets, from the code's own constants", () => {
    for (const name of [
      `${AUTH_COOKIE_PREFIX}.session_token`,
      `${AUTH_COOKIE_PREFIX}.session_data`,
      KIOSK_COOKIE,
      KIOSK_MEMBER_COOKIE,
      REFRESH_COOKIE,
    ]) {
      expect(out).toContain(`<code>${name}</code>`);
    }
  });

  it("states where data lives, who receives it and how long photos stay", () => {
    expect(out).toContain("Frankfurt");
    for (const party of ["Anthropic", "Groq", "Resend", "baumy-brain"]) {
      expect(out).toContain(party);
    }
    expect(out).toContain(`${PHOTO_RETENTION_DAYS} days after their`);
    expect(out).toContain("no analytics");
  });

  it("says what the audit log keeps and where the code runs", () => {
    expect(out).toContain("a copy of what was entered");
    expect(out).toContain("including the audit log");
    expect(out).toContain("title, times, place, description");
    expect(out).toContain("server code runs in Frankfurt (fra1)");
    expect(out).toContain("region of the");
    expect(out).not.toContain("processed in the EU");
    expect(out).toContain("the calendar, the pot");
    expect(out).toContain("change its colour and avatar");
    expect(out).toContain("US");
    // The page's Frankfurt claim holds only while Vercel pins the functions.
    const vercel = JSON.parse(
      readFileSync(
        path.resolve(import.meta.dirname, "../../vercel.json"),
        "utf8",
      ),
    ) as { regions?: string[] };
    expect(vercel.regions).toEqual(["fra1"]);
  });

  it("gives no email address to write to", () => {
    expect(out).toContain("Talk to the owner");
    expect(out).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(out).not.toContain("mailto:");
  });
});

describe("TermsPage", () => {
  const out = renderToStaticMarkup(<TermsPage />);

  it("has its heading, its date and the footer links", () => {
    expect(out).toContain(">Terms</h1>");
    expect(out).toContain(`dateTime="${TERMS_UPDATED}"`);
    expect(out).toContain(formatUpdated(TERMS_UPDATED));
    expect(out).toContain('href="/privacy"');
    expect(out).toContain('href="/terms"');
  });

  it("covers the house rules", () => {
    expect(out).toContain("Household use only");
    expect(out).toContain("no cash value");
    expect(out).toContain("Provided as it is");
    expect(out).toContain("the admin may");
  });

  it("gives no email address to write to", () => {
    expect(out).toContain("Questions go to the owner");
    expect(out).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});
