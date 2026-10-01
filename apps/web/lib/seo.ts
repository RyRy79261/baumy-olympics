import type { Metadata, MetadataRoute } from "next";

// What search engines and link previews see (issue #122). Only the public
// landing page at `/` (issue #96) is for search engines: everything else is
// the household's own, so robots.txt keeps crawlers out of it and the root
// layout marks every page noindex, which the landing page alone overrides.

/** The app's public address (the owner's setup, 2026-09-28). */
export const SITE_URL = "https://www.baumy.tech";
export const SITE_NAME = "Baumy Olympics";
export const SITE_DESCRIPTION = "The Baumschulenweg household hub.";
/** The words beside the share card in a link preview. */
export const SHARE_DESCRIPTION =
  "The Baumschulenweg household games, hosted by Baumy the cat.";

/**
 * Every top-level path a crawler must stay out of: the API, the kitchen
 * screen, sign-in, joining, the MCP consent screen, and the hub's own pages
 * (app/(hub)/, all behind sign-in).
 */
export const DISALLOWED_PATHS = [
  "/api/",
  "/kiosk",
  "/admin",
  "/join",
  "/auth/",
  "/oauth/",
  "/calendar",
  "/chores",
  "/inbox",
  "/notes",
  "/pot",
  "/scores",
  "/settings",
  "/shopping",
] as const;

export function robotsFile(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...DISALLOWED_PATHS] },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

export function sitemapFile(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_URL}/`, changeFrequency: "monthly", priority: 1 }];
}

/**
 * The root layout's metadata: the title template, the share card's words
 * (the card itself is app/opengraph-image.tsx and app/twitter-image.tsx)
 * and noindex for every page that does not say otherwise.
 */
export const ROOT_METADATA: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_GB",
    url: "/",
    title: SITE_NAME,
    description: SHARE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SHARE_DESCRIPTION,
  },
  robots: { index: false, follow: false },
};

/**
 * The public landing page's metadata: the one page search engines may
 * index. It leaves openGraph and twitter to the root layout: a page that
 * sets either replaces the whole object, and with it the card that the
 * file-based app/opengraph-image.tsx and app/twitter-image.tsx add there.
 */
export function landingMetadata(description: string): Metadata {
  return {
    title: { absolute: SITE_NAME },
    description,
    alternates: { canonical: "/" },
    robots: { index: true, follow: true },
  };
}
