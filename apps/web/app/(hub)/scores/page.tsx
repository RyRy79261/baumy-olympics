import type { Metadata } from "next";
import { formatBerlinDateTime } from "@baumy/core";
import {
  Card,
  FormMessage,
  PageHeading,
  Points,
  StreakFlame,
  Table,
  Td,
  Th,
} from "@baumy/ui";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { StandingName } from "@/components/scores/standing-name";
import { requireMemberPage } from "@/lib/auth";
import { householdMembers, householdRoster } from "@/lib/members/household";
import {
  breakdownLabel,
  disputeLabel,
  gapLabel,
  prizeModeLabel,
  signedPoints,
} from "@/lib/scores/view";
import {
  AdjustmentForm,
  ApproveAdjustmentButton,
  PrizeModeForm,
} from "./score-forms";

// /scores (SPEC §3.2, §4.5): the season scoreboard. Points per member with
// the still-disputable part dimmed, the gap to the leader, this month's
// disputes, the streak board, the latest completions broken down into base,
// streak and break points, the prize mode and the point adjustments. The data
// is `get_standings` and `get_streaks`, the same reads the AI and MCP get.
// Admins also set the prize mode (before the season's first completion, or
// next year's) and propose and approve adjustments.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Scores" };

export default async function ScoresPage() {
  const me = await requireMemberPage();
  const ctx = (await uiRequestCtx(undefined))!;
  // Side by side (issue #128); the members are the same read the header's
  // roster made.
  const [standings, streaks, roster, people] = await Promise.all([
    runAction("get_standings", {}, ctx),
    runAction("get_streaks", {}, ctx),
    householdRoster(ctx.householdId),
    householdMembers(ctx.householdId),
  ]);
  if (!standings.ok || !streaks.ok) {
    const failed = !standings.ok ? standings : streaks;
    return (
      <>
        <PageHeading eyebrow="Baumy Olympics" title="Scores" />
        <FormMessage tone="error">
          {failed.ok ? null : failed.message}
        </FormMessage>
      </>
    );
  }
  const data = standings.data;
  const isAdmin = me.role === "admin";
  const disputesOf = new Map(
    data.disputesThisMonth.members.map((d) => [d.memberId, d]),
  );
  const leader = data.standings.find((s) => s.memberId === data.leaderId);
  const members = isAdmin ? people : [];

  return (
    <>
      <PageHeading
        eyebrow="Baumy Olympics"
        title="Scores"
        description={`Season ${data.season.year}. ${
          leader
            ? `${leader.displayName} leads with ${leader.points} points.`
            : "Nobody leads yet."
        } Dimmed points can still be disputed.`}
      />
      <div className="flex flex-col gap-6">
        <Card title="Standings">
          <Table caption="Season standings" data-testid="standings">
            <thead>
              <tr>
                <Th numeric>Rank</Th>
                <Th>Member</Th>
                <Th numeric>Points</Th>
                <Th>Gap</Th>
                <Th numeric>Verified</Th>
                <Th>Disputes this month</Th>
              </tr>
            </thead>
            <tbody>
              {data.standings.map((s) => (
                <tr key={s.memberId} data-testid={`standing-${s.displayName}`}>
                  <Td numeric>{s.rank}</Td>
                  <Td>
                    <StandingName
                      memberId={s.memberId}
                      name={s.displayName}
                      leader={s.memberId === data.leaderId}
                      roster={roster}
                    />
                  </Td>
                  <Td numeric>
                    <Points points={s.points} provisional={s.provisionalPts} />
                  </Td>
                  <Td>{gapLabel(s.gapToLeader)}</Td>
                  <Td numeric>
                    {s.verifiedCount} of {s.completions}
                  </Td>
                  <Td>{disputeLabel(disputesOf.get(s.memberId))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card title="Streaks" description="Who holds each chore's streak now.">
          {streaks.data.current.length === 0 ? (
            <p className="text-sm text-bm-muted">No streaks yet.</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="current-streaks">
              {streaks.data.current.map((r) => (
                <li key={r.choreId} className="flex items-center gap-3">
                  <StreakFlame length={r.length} />
                  <span>
                    {r.memberName} on {r.choreName}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {streaks.data.best.length > 0 ? (
            <>
              <h3 className="mt-6 mb-2 font-semibold">Best runs this season</h3>
              <ul className="flex flex-col gap-2" data-testid="best-streaks">
                {streaks.data.best.map((r) => (
                  <li
                    key={`${r.choreId}-${r.startedAt}`}
                    className="flex items-center gap-3"
                  >
                    <StreakFlame length={r.length} current={r.current} />
                    <span>
                      {r.memberName} on {r.choreName}, {r.basePts} base points
                      {r.current ? ", still going" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>

        <Card title="Recent completions">
          {data.recent.length === 0 ? (
            <p className="text-sm text-bm-muted">
              Nothing scored this season yet.
            </p>
          ) : (
            <Table caption="Recent completions" data-testid="recent">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Who</Th>
                  <Th>Chore</Th>
                  <Th>Breakdown</Th>
                  <Th numeric>Total</Th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((c) => (
                  <tr key={c.completionId}>
                    <Td>{formatBerlinDateTime(new Date(c.occurredAt))}</Td>
                    <Td>{c.doneByName}</Td>
                    <Td>{c.choreName}</Td>
                    <Td>{breakdownLabel(c)}</Td>
                    <Td numeric>
                      <Points
                        points={c.totalPts}
                        provisional={c.provisional ? c.totalPts : 0}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card
          title="Prize"
          description="The season's winner takes the whole pot. The mode is fixed once the season's first chore is logged."
        >
          <p className="text-sm" data-testid="prize-mode">
            {data.season.year}: {prizeModeLabel(data.season.prizeMode)}
            {data.season.prizeLocked ? " (fixed)" : ""}
          </p>
          <p className="text-sm">
            {data.season.nextSeason.year}:{" "}
            {prizeModeLabel(data.season.nextSeason.prizeMode)}
          </p>
          {isAdmin ? (
            <div className="mt-4 flex flex-col gap-4">
              {data.season.prizeLocked ? null : (
                <PrizeModeForm
                  season="current"
                  year={data.season.year}
                  mode={data.season.prizeMode}
                />
              )}
              <PrizeModeForm
                season="next"
                year={data.season.nextSeason.year}
                mode={data.season.nextSeason.prizeMode}
              />
            </div>
          ) : null}
        </Card>

        <Card
          title="Point adjustments"
          description="A manual change to a season total. It counts once a second admin approves it."
        >
          {data.adjustments.length === 0 ? (
            <p className="text-sm text-bm-muted">No adjustments.</p>
          ) : (
            <ul data-testid="adjustments">
              {data.adjustments.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 border-b border-bm-line py-3 last:border-b-0"
                >
                  <span className="font-mono">{signedPoints(a.points)}</span>
                  <span>
                    {a.memberName}: {a.reason}
                  </span>
                  <span className="text-sm text-bm-muted">
                    {a.approvedByName
                      ? `Approved by ${a.approvedByName}`
                      : `Proposed by ${a.createdByName}, waiting for a second admin`}
                  </span>
                  {isAdmin &&
                  !a.approvedByName &&
                  a.createdBy !== me.memberId ? (
                    <span className="ml-auto">
                      <ApproveAdjustmentButton
                        adjustmentId={a.id}
                        label={`${signedPoints(a.points)} for ${a.memberName}`}
                      />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {isAdmin ? (
            <div className="mt-6">
              <AdjustmentForm
                members={members.map((m) => ({
                  id: m.id,
                  displayName: m.displayName,
                }))}
              />
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
