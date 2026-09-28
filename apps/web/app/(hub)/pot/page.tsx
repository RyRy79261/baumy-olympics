import type { Metadata } from "next";
import { berlinMonthKey, formatMonthKey } from "@baumy/core";
import { createHttpDb, type Queryable } from "@baumy/db";
import { listActiveMembers } from "@baumy/db/members";
import { Card, FormMessage, PageHeading, Stat, Table, Td, Th } from "@baumy/ui";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { requireMemberPage } from "@/lib/auth";
import { formatEuros } from "@/lib/scores/view";
import { AddContributionForm } from "./pot-forms";

// /pot (SPEC §4.5): the year-end savings pot. Each month's contributions,
// the running total and who would take it all now. The data is `get_pot`,
// the same read the AI and MCP get; admins record contributions.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pot - Baumy Olympics" };

export default async function PotPage() {
  const me = await requireMemberPage();
  const ctx = (await uiRequestCtx(undefined))!;
  const pot = await runAction("get_pot", {}, ctx);
  if (!pot.ok) {
    return (
      <>
        <PageHeading eyebrow="Baumy Olympics" title="Pot" />
        <FormMessage tone="error">{pot.message}</FormMessage>
      </>
    );
  }
  const data = pot.data;
  const isAdmin = me.role === "admin";
  const members = isAdmin
    ? await listActiveMembers(
        createHttpDb() as unknown as Queryable,
        ctx.householdId,
      )
    : [];
  return (
    <>
      <PageHeading
        eyebrow="Baumy Olympics"
        title="Pot"
        description={`The ${data.year} season's winner takes the whole pot. This is a ledger only; the money moves at the bank.`}
      />
      <div className="flex flex-col gap-6">
        <Card>
          <div className="grid gap-6 sm:grid-cols-2">
            <div data-testid="pot-total">
              <Stat label="In the pot" value={formatEuros(data.totalCents)} />
            </div>
            <div data-testid="pot-leader">
              <Stat
                label="Would win it now"
                value={data.leader ? data.leader.displayName : "Nobody yet"}
                hint={
                  data.leader
                    ? `${data.leader.points} points`
                    : "Nobody leads outright."
                }
              />
            </div>
          </div>
        </Card>
        <Card title="By month">
          {data.months.length === 0 ? (
            <p className="text-sm text-bm-muted">
              Nothing in the pot yet this season.
            </p>
          ) : (
            <Table caption="Contributions by month" data-testid="pot-months">
              <thead>
                <tr>
                  <Th>Month</Th>
                  <Th>Contributions</Th>
                  <Th numeric>Month total</Th>
                  <Th numeric>Running total</Th>
                </tr>
              </thead>
              <tbody>
                {data.months.map((m) => (
                  <tr key={m.month}>
                    <Td>{formatMonthKey(m.month)}</Td>
                    <Td>
                      <ul>
                        {m.contributions.map((c) => (
                          <li key={c.id}>
                            {c.contributedByName} {formatEuros(c.amountCents)}
                            {c.note ? ` (${c.note})` : ""}
                          </li>
                        ))}
                      </ul>
                    </Td>
                    <Td numeric>{formatEuros(m.totalCents)}</Td>
                    <Td numeric>{formatEuros(m.runningTotalCents)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        {isAdmin ? (
          <AddContributionForm
            members={members.map((m) => ({
              id: m.id,
              displayName: m.displayName,
            }))}
            me={me.memberId}
            month={berlinMonthKey(ctx.now)}
          />
        ) : null}
      </div>
    </>
  );
}
