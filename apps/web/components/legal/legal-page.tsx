import type { ReactNode } from "react";
import Link from "next/link";
import { Card, PageHeading, linkClass } from "@baumy/ui";

// The frame of the public /privacy and /terms pages (issue #82). They sit
// outside the (hub) gate, so a signed-out visitor (or Google's reviewer) can
// read them; nothing here reads a session or the database.

/** When each page's words last changed (ISO dates). */
export const PRIVACY_UPDATED = "2026-09-28";
export const TERMS_UPDATED = "2026-09-28";

/** The two legal pages, linked from the sign-in and sign-up footers. */
export function LegalLinks() {
  return (
    <nav
      aria-label="Privacy and terms"
      className="mt-6 flex justify-center gap-6 text-base"
    >
      <Link href="/privacy" className={linkClass}>
        Privacy
      </Link>
      <Link href="/terms" className={linkClass}>
        Terms
      </Link>
    </nav>
  );
}

/** A page of plain-English text: heading, date, sections, footer links. */
export function LegalPage({
  title,
  description,
  updated,
  children,
}: {
  title: string;
  description: string;
  /** ISO date (`YYYY-MM-DD`) this page's words last changed. */
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-dvh bg-bm-bg px-4 py-10 text-bm-text">
      <article className="mx-auto flex max-w-2xl flex-col gap-6">
        <PageHeading
          eyebrow="Baumy Olympics"
          title={title}
          description={description}
        />
        <p className="-mt-4 text-base text-bm-muted">
          Last updated{" "}
          <time dateTime={updated} data-testid="legal-updated">
            {formatUpdated(updated)}
          </time>
        </p>
        {children}
        <footer className="flex flex-col items-center">
          <Link href="/" className={linkClass}>
            Back to Baumy Olympics
          </Link>
          <LegalLinks />
        </footer>
      </article>
    </main>
  );
}

/** One framed section of a legal page, with readable body text. */
export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card title={title}>
      <div className="flex flex-col gap-3 text-lg leading-relaxed [&_li]:mt-1 [&_ul]:list-disc [&_ul]:pl-6">
        {children}
      </div>
    </Card>
  );
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `2026-09-28` → `28 September 2026`, with no time zone involved. */
export function formatUpdated(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}
