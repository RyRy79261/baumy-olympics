import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { Button, Card, Checkbox, FormMessage, PageHeading } from "@baumy/ui";
import { requireMemberPage } from "@/lib/auth";
import {
  AUTHORIZE_PARAM_NAMES,
  checkAuthorizeRequest,
  pickAuthorizeParams,
} from "@/lib/mcp/authorize";
import { consentLines } from "@/lib/mcp/consent";
import { MCP_SCOPES, defaultTicked, type McpScope } from "@/lib/mcp/scopes";

// The MCP consent screen (SPEC §6.3, issue #23). The authorize endpoint sends
// the browser here after checking the request. `requireMemberPage` runs
// first: nobody signed in goes to sign-in and comes back here; an account
// with no member row goes to /join and never sees a code. Only the boxes the
// member ticks are granted; writing starts unticked.
//
// The form posts to the authorize endpoint, not a server action: its answer
// is a page that navigates back to the app (lib/mcp/http.ts `htmlRedirect`).
// The look is the pixel kit's (packages/ui, issue #64).

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect an app" };

const SCOPE_TEXT: Record<McpScope, { label: string; hint: string }> = {
  "baumy:read": {
    label: "Read Baumy (baumy:read)",
    hint: "See the household's chores, scores, calendar and notes.",
  },
  "baumy:write": {
    label: "Make changes as you (baumy:write)",
    hint: "Log chores, confirm or dispute them, and edit events and notes as you. Nothing is ever deleted over this connection.",
  },
};

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = pickAuthorizeParams((n) => {
    const v = sp[n];
    return Array.isArray(v) ? v[0] : v;
  });
  const me = await requireMemberPage({
    returnTo: `/oauth/consent?${new URLSearchParams(raw).toString()}`,
  });
  const check = await checkAuthorizeRequest(raw);

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      {!check.ok ? (
        <>
          <PageHeading title="Could not connect" />
          <FormMessage tone="error">{check.message}</FormMessage>
        </>
      ) : (
        <Consent
          check={check}
          memberName={me.displayName}
          noScope={sp.consent_error === "no_scope"}
        />
      )}
    </main>
  );
}

function Consent({
  check,
  memberName,
  noScope,
}: {
  check: Extract<
    Awaited<ReturnType<typeof checkAuthorizeRequest>>,
    { ok: true }
  >;
  memberName: string;
  noScope: boolean;
}) {
  const lines = consentLines();
  const ticked = defaultTicked(check.offered);
  const { params } = check;
  return (
    <>
      <PageHeading
        eyebrow="Connect an app"
        title={`Connect ${check.clientName} to Baumy`}
        description={`${check.clientName} will act as you, ${memberName}. Tick what it may do. You can disconnect it any time in Settings.`}
      />
      <form method="POST" action="/api/mcp/oauth/authorize">
        {AUTHORIZE_PARAM_NAMES.map((name) =>
          params[name] === undefined ? null : (
            <input key={name} type="hidden" name={name} value={params[name]} />
          ),
        )}
        <input type="hidden" name="requestId" value={randomUUID()} />
        <Card title="What it may do">
          <fieldset className="flex flex-col gap-4">
            <legend className="sr-only">Scopes</legend>
            {MCP_SCOPES.filter((s) => check.offered.includes(s)).map(
              (scope) => {
                const list = scope === "baumy:read" ? lines.read : lines.write;
                return (
                  <Checkbox
                    key={scope}
                    id={`scope-${scope.replace(":", "-")}`}
                    name="grant"
                    value={scope}
                    defaultChecked={ticked.includes(scope)}
                    label={SCOPE_TEXT[scope].label}
                    hint={SCOPE_TEXT[scope].hint}
                  >
                    <ul
                      className="list-disc pl-5 text-sm text-bm-muted"
                      aria-label={`${scope} tools`}
                    >
                      {list.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </Checkbox>
                );
              },
            )}
          </fieldset>
          {noScope ? (
            <div className="mt-4">
              <FormMessage tone="error">
                Tick at least one thing the app may do, or choose Deny.
              </FormMessage>
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-3">
            <Button type="submit" name="decision" value="approve">
              Approve
            </Button>
            <Button
              type="submit"
              name="decision"
              value="deny"
              variant="secondary"
            >
              Deny
            </Button>
          </div>
        </Card>
      </form>
    </>
  );
}
