import type { Metadata } from "next";
import { createHttpDb, type Queryable } from "@baumy/db";
import { listServiceTokens } from "@baumy/db/service-tokens";
import { Card, PageHeading } from "@baumy/ui";
import { DEFAULT_SERVICE_TOKEN_NAME } from "@/lib/actions/service-tokens";
import { requireAdminPage } from "@/lib/auth";
import { StatusTag } from "../../settings/security/status-tag";
import { CreateTokenForm, LiveTokenControls } from "./token-forms";

// /admin/connections (issue #104): the service tokens baumy-brain uses, so
// an admin never needs a terminal to connect brain. Admins only; anyone else
// gets a 404 from the page gate, and every write is an admin-only registry
// action. The list never holds a token or its hash.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connections - Baumy Olympics" };

const when = (d: Date) =>
  d.toLocaleString("en-GB", {
    timeZone: "Europe/Berlin",
    dateStyle: "medium",
    timeStyle: "short",
  });

export default async function AdminConnectionsPage() {
  await requireAdminPage();
  const tokens = await listServiceTokens(
    createHttpDb() as unknown as Queryable,
  );
  // Live tokens first, then the newest.
  const sorted = [...tokens].sort(
    (a, b) =>
      Number(a.revokedAt !== null) - Number(b.revokedAt !== null) ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );

  return (
    <>
      <PageHeading
        eyebrow="Admin"
        title="Connections"
        description="The service tokens other apps use to reach Baumy Olympics. baumy-brain, the Telegram bot, needs one."
      />
      <div className="flex flex-col gap-6">
        <CreateTokenForm defaultName={DEFAULT_SERVICE_TOKEN_NAME} />

        <Card title="Service tokens">
          {sorted.length === 0 ? (
            <p
              className="text-sm text-bm-muted"
              data-testid="no-service-tokens"
            >
              No service tokens yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-4" aria-label="Service tokens">
              {sorted.map((t) => {
                const live = t.revokedAt === null;
                return (
                  <li
                    // A live name has one row at a time, so rotating keeps
                    // the controls (and the new token they show) mounted.
                    key={live ? `live-${t.name}` : t.id}
                    data-testid={`service-token-${t.name}-${live ? "live" : "revoked"}`}
                    className="flex flex-col gap-3 border-b-2 border-bm-line pb-4 last:border-b-0 last:pb-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{t.name}</span>
                      <StatusTag on={live}>
                        {live ? "Live" : "Revoked"}
                      </StatusTag>
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                      <dt className="text-bm-muted">May</dt>
                      <dd>{t.scopes.join(", ")}</dd>
                      <dt className="text-bm-muted">Created</dt>
                      <dd>{when(t.createdAt)}</dd>
                      <dt className="text-bm-muted">Last used</dt>
                      <dd>{t.lastUsedAt ? when(t.lastUsedAt) : "Not yet"}</dd>
                      {t.revokedAt ? (
                        <>
                          <dt className="text-bm-muted">Revoked</dt>
                          <dd>{when(t.revokedAt)}</dd>
                        </>
                      ) : null}
                    </dl>
                    {live ? <LiveTokenControls name={t.name} /> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
