import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FormMessage, PageHeading, Points, Table, Td, Th } from "@baumy/ui";
import { kioskRequestCtx } from "@/lib/actions/kiosk";
import { runAction } from "@/lib/actions/registry";
import { createHttpDb, type Queryable } from "@baumy/db";
import { StandingName } from "@/components/scores/standing-name";
import { getKioskActor } from "@/lib/auth";
import { activeRoster } from "@/lib/members/characters";
import { gapLabel } from "@/lib/scores/view";

// The season's standings on the kitchen iPad (SPEC §3.2, ADR 0005 §1: the
// footer nav's Scores), read as the paired device (`get_standings` needs
// only `display`). Read only: prize modes and adjustments stay on /scores.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Scores · Kiosk" };

export default async function KioskScoresPage() {
  const kiosk = await getKioskActor();
  if (!kiosk) redirect("/kiosk/pair");
  const ctx = (await kioskRequestCtx(undefined, undefined))!;
  const standings = await runAction("get_standings", { recent: 0 }, ctx);
  if (!standings.ok) {
    return (
      <>
        <PageHeading eyebrow={kiosk.deviceName ?? "Kiosk"} title="Scores" />
        <FormMessage tone="error">{standings.message}</FormMessage>
      </>
    );
  }
  const data = standings.data;
  const leader = data.standings.find((s) => s.memberId === data.leaderId);
  const roster = await activeRoster(
    createHttpDb() as unknown as Queryable,
    ctx.householdId,
  );
  return (
    <>
      <PageHeading
        eyebrow={kiosk.deviceName ?? "Kiosk"}
        title="Scores"
        description={`Season ${data.season.year}. ${
          leader
            ? `${leader.displayName} leads with ${leader.points} points.`
            : "Nobody leads yet."
        } Dimmed points can still be disputed.`}
      />
      <Table caption="Season standings" data-testid="standings">
        <thead>
          <tr>
            <Th numeric>Rank</Th>
            <Th>Member</Th>
            <Th numeric>Points</Th>
            <Th>Gap</Th>
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
                  scale={3}
                />
              </Td>
              <Td numeric>
                <Points points={s.points} provisional={s.provisionalPts} />
              </Td>
              <Td>{gapLabel(s.gapToLeader)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
