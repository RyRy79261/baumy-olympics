import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import path from "node:path";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import {
  DISALLOWED_PATHS,
  landingMetadata,
  ROOT_METADATA,
  SITE_NAME,
  SITE_URL,
} from "./seo";

// Issue #122: only the public landing page is for search engines.

const APP = path.resolve(import.meta.dirname, "../app");

/** The app's top-level URL segments, (hub)'s pages lifted to the top. */
function topLevelSegments(): string[] {
  const dirs = (dir: string) =>
    readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  return [
    ...dirs(APP).filter((d) => !d.startsWith("(")),
    ...dirs(path.join(APP, "(hub)")),
  ];
}

describe("robots.txt", () => {
  const file = robots();
  const rules = Array.isArray(file.rules) ? file.rules[0]! : file.rules;

  it("lets every crawler see the landing page and points at the sitemap", () => {
    expect(rules.userAgent).toBe("*");
    expect(rules.allow).toBe("/");
    expect(file.sitemap).toBe("https://www.baumy.tech/sitemap.xml");
  });

  it("keeps crawlers out of the API, the kiosk, admin, joining and sign-in", () => {
    for (const p of ["/api/", "/kiosk", "/admin", "/join", "/auth/"]) {
      expect(rules.disallow).toContain(p);
    }
  });

  it("keeps crawlers out of every page but the landing, privacy and terms", () => {
    const segments = topLevelSegments();
    expect(segments).toContain("chores");
    const disallowed = new Set(
      DISALLOWED_PATHS.map((p) => p.replaceAll("/", "")),
    );
    const open = segments.filter((s) => !disallowed.has(s));
    expect(open.sort()).toEqual(["privacy", "terms"]);
  });
});

describe("sitemap.xml", () => {
  it("lists the landing page and nothing else", () => {
    expect(sitemap().map((e) => e.url)).toEqual(["https://www.baumy.tech/"]);
  });
});

describe("metadata", () => {
  it("roots every URL at www.baumy.tech, with the title template", () => {
    expect(String(ROOT_METADATA.metadataBase)).toBe(`${SITE_URL}/`);
    expect(ROOT_METADATA.title).toEqual({
      default: SITE_NAME,
      template: "%s · Baumy Olympics",
    });
    expect(ROOT_METADATA.openGraph).toMatchObject({
      siteName: SITE_NAME,
      locale: "en_GB",
      type: "website",
    });
    expect(ROOT_METADATA.twitter).toMatchObject({
      card: "summary_large_image",
    });
  });

  it("marks every page noindex unless it says otherwise", () => {
    expect(ROOT_METADATA.robots).toEqual({ index: false, follow: false });
  });

  it("lets the landing page be indexed, at its canonical URL", () => {
    const m = landingMetadata("What the app is.");
    expect(m.robots).toEqual({ index: true, follow: true });
    expect(m.alternates).toEqual({ canonical: "/" });
    expect(m.title).toEqual({ absolute: SITE_NAME });
    expect(m.description).toBe("What the app is.");
  });

  it("leaves the share card to the root layout on the landing page", () => {
    // Setting either here would replace the root's, card and all.
    expect(ROOT_METADATA.openGraph).toBeDefined();
    expect(ROOT_METADATA.twitter).toBeDefined();
    const m = landingMetadata("What the app is.");
    expect(m).not.toHaveProperty("openGraph");
    expect(m).not.toHaveProperty("twitter");
  });
});
