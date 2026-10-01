import type { Metadata } from "next";
import Link from "next/link";
import { Card, FormMessage, PageHeading } from "@baumy/ui";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { requireMemberPage } from "@/lib/auth";
import { describeScopes } from "@/lib/mcp/scopes";
import { DisconnectForm } from "./connection-forms";

// /settings/connections (SPEC §6.3, issue #23): the apps this member has
// connected over MCP, and a way to disconnect each one. Both go through the
// registry with the `session` gate: the member's own session only.

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Connected apps",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/Berlin",
    dateStyle: "medium",
    timeStyle: "short",
  });

export default async function ConnectionsPage() {
  await requireMemberPage();
  const result = await runAction(
    "list_mcp_connections",
    {},
    (await uiRequestCtx(undefined))!,
  );

  return (
    <>
      <PageHeading
        title="Connected apps"
        description="Apps such as Claude that can reach Baumy as you. Disconnecting one stops it at once."
        actions={
          <Link href="/settings" className="text-sm underline">
            Back to settings
          </Link>
        }
      />
      {!result.ok ? (
        <FormMessage tone="error">{result.message}</FormMessage>
      ) : result.data.length === 0 ? (
        <Card>
          <p className="text-sm text-bm-muted" data-testid="no-connections">
            No apps are connected. To connect Claude, add a custom connector in
            Claude with this site&apos;s <code>/api/mcp/mcp</code> address.
          </p>
        </Card>
      ) : (
        <ul
          className="flex max-w-xl flex-col gap-4"
          aria-label="Connected apps"
        >
          {result.data.map((c) => (
            <li key={c.grantId} data-testid={`connection-${c.grantId}`}>
              <Card title={c.clientName}>
                <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-bm-muted">May</dt>
                  <dd>{describeScopes(c.scopes)}</dd>
                  <dt className="text-bm-muted">Connected</dt>
                  <dd>{when(c.grantedAt)}</dd>
                  <dt className="text-bm-muted">Last used</dt>
                  <dd>{c.lastUsedAt ? when(c.lastUsedAt) : "Not yet"}</dd>
                </dl>
                <DisconnectForm grantId={c.grantId} clientName={c.clientName} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
