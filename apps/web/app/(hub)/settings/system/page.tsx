import type { Metadata } from "next";
import Link from "next/link";
import { Card, FormMessage, PageHeading, cx } from "@baumy/ui";
import { requireAdminPage } from "@/lib/auth";
import { getSystemStatus } from "@/lib/system/probe";
import type { IntegrationCheck } from "@/lib/system/status";

// /settings/system (issue #133, after camp-404
// `app/(console)/captains/system/page.tsx`): the page to open when someone
// says "Baumy is broken". Each integration as configured or not and
// answering or not, with what to change. Admins only: anyone else gets a
// 404 (requireAdminPage). No secret reaches it: lib/system/status.ts prints
// env var NAMES, never their values.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "System status" };

const REACHABLE: Record<IntegrationCheck["reachable"], string> = {
  yes: "Answering",
  no: "Not answering",
  not_checked: "Not checked",
  fake: "Test fake",
};

function Badge({ tone, children }: { tone: "good" | "bad" | "quiet"; children: string }) {
  return (
    <span
      className={cx(
        "pixel-frame inline-block px-2 py-0.5 font-label text-xs font-bold tracking-wide uppercase",
        tone === "good" && "bg-bm-green/10 text-bm-green [--pf:var(--color-bm-green)]",
        tone === "bad" && "bg-bm-red/10 text-bm-red [--pf:var(--color-bm-red)]",
        tone === "quiet" && "text-bm-muted",
      )}
    >
      {children}
    </span>
  );
}

export default async function SystemStatusPage() {
  await requireAdminPage();
  const status = await getSystemStatus();

  return (
    <>
      <PageHeading
        title="System status"
        description="Whether each service Baumy relies on is set up and answering. It names the setting to change, never its value."
        actions={
          <Link href="/settings" className="text-sm underline">
            Back to settings
          </Link>
        }
      />
      <div className="flex max-w-3xl flex-col gap-6">
        <div data-testid="system-headline">
          <FormMessage tone={status.headline.tone === "attention" ? "error" : "success"}>
            {status.headline.summary}
          </FormMessage>
        </div>
        <Card>
          <ul aria-label="Integrations" className="flex flex-col">
            {status.checks.map((c) => (
              <li
                key={c.id}
                data-testid={`check-${c.id}`}
                className="flex flex-col gap-2 border-b-2 border-bm-line py-4 first:pt-0 last:border-b-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="mr-auto font-display text-sm leading-relaxed">
                    {c.label}
                  </h2>
                  <Badge tone={c.configured ? "good" : c.tone === "attention" ? "bad" : "quiet"}>
                    {c.configured ? "Configured" : "Not configured"}
                  </Badge>
                  <Badge
                    tone={
                      c.reachable === "yes"
                        ? "good"
                        : c.reachable === "no"
                          ? "bad"
                          : "quiet"
                    }
                  >
                    {REACHABLE[c.reachable]}
                  </Badge>
                </div>
                <p className="text-base text-bm-muted">{c.detail}</p>
                <p className="font-mono text-sm text-bm-dim">
                  {c.env.join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
