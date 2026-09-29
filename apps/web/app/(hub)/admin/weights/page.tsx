import type { Metadata } from "next";
import { Card, FormMessage, PageHeading, Sparkline } from "@baumy/ui";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { PointsHistory } from "@/components/chores/points-history";
import type { PointsHistoryView, WeightRowView } from "@/lib/actions/weights";
import { requireAdminPage } from "@/lib/auth";
import {
  appliesLabel,
  changeLabel,
  formatMinutes,
  formatRaw,
  intervalsLabel,
  verdictLabel,
} from "@/lib/weights/view";
import { ScheduledChanges } from "./scheduled-changes";
import { DismissWeightButton, ScheduleWeightForm } from "./weight-forms";

// /admin/weights (SPEC §4.4): for each chore, the points now against what
// the frequency formula says (raw and suggested), how many gaps it measured
// and a sparkline of them, and the week's suggestion to schedule (as it is
// or edited) or dismiss. A scheduled change shows when it applies; another
// member can veto it until then (here or on /inbox). Suggestions are
// computed on Mondays by the daily job (issue #18). Each chore folds out its
// points history (issue #115): every change, and who vetoed or cancelled one.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Weights - Baumy Olympics" };

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs uppercase tracking-widest text-bm-muted">
        {label}
      </dt>
      <dd className="font-mono text-lg text-bm-text">{value}</dd>
    </div>
  );
}

function WeightRow({
  row,
  history,
}: {
  row: WeightRowView;
  history: PointsHistoryView[];
}) {
  const s = row.suggestion;
  const live = row.live;
  return (
    <li
      data-testid={`weight-${row.choreName}`}
      className="flex flex-col gap-3 border-b border-bm-line py-4 last:border-b-0"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">{row.choreName}</h3>
        <span className="text-sm text-bm-muted">
          {verdictLabel(live)}
          {row.effortFactorPct !== 100
            ? ` Effort ${row.effortFactorPct}%.`
            : ""}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Figure
          label="Current"
          value={row.current ? `${row.current.basePoints} pts` : "–"}
        />
        <Figure label="Raw" value={formatRaw(live?.rawPoints ?? null)} />
        <Figure
          label="Suggested"
          value={
            live?.suggestedPoints != null ? `${live.suggestedPoints} pts` : "–"
          }
        />
        <Figure
          label="Median gap"
          value={
            live?.medianMinutes != null
              ? formatMinutes(live.medianMinutes)
              : "–"
          }
        />
        <Figure label="Sample" value={`${live?.sampleSize ?? 0} gaps`} />
      </dl>
      <Sparkline
        values={live?.intervals ?? []}
        label={intervalsLabel(live?.intervals ?? [])}
      />
      {s ? (
        <div
          data-testid="suggestion"
          data-status={s.status}
          className="flex flex-col gap-3 border-2 border-bm-line p-3"
        >
          {s.status === "open" ? (
            <>
              <p className="text-sm">
                This week&apos;s suggestion, from {s.sampleIntervals!.length}{" "}
                gaps (median {formatMinutes(s.medianIntervalMinutes!)}, raw{" "}
                {formatRaw(s.rawPoints)}):{" "}
                {changeLabel({
                  fromPoints: s.currentPoints,
                  toPoints: s.suggestedPoints!,
                  fromCooldownMinutes: s.currentCooldownMinutes,
                  toCooldownMinutes: s.suggestedCooldownMinutes!,
                })}
                .
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <ScheduleWeightForm
                  suggestionId={s.id}
                  choreName={row.choreName}
                  suggestedPoints={s.suggestedPoints!}
                  suggestedCooldownMinutes={s.suggestedCooldownMinutes!}
                />
                <DismissWeightButton
                  suggestionId={s.id}
                  choreName={row.choreName}
                  scheduled={false}
                />
              </div>
            </>
          ) : (
            <>
              <p className="text-sm">
                Scheduled:{" "}
                {changeLabel({
                  fromPoints: s.currentPoints,
                  toPoints: s.scheduledPoints!,
                  fromCooldownMinutes: s.currentCooldownMinutes,
                  toCooldownMinutes: s.scheduledCooldownMinutes!,
                })}
                . {appliesLabel(s.appliesAt!)}
              </p>
              <div className="flex flex-wrap gap-3">
                <DismissWeightButton
                  suggestionId={s.id}
                  choreName={row.choreName}
                  scheduled
                />
              </div>
            </>
          )}
        </div>
      ) : null}
      <details data-testid="weight-history">
        <summary className="cursor-pointer text-sm text-bm-muted">
          Points history ({history.length})
        </summary>
        <div className="pt-3">
          <PointsHistory changes={history} />
        </div>
      </details>
    </li>
  );
}

export default async function AdminWeightsPage() {
  await requireAdminPage();
  const ctx = (await uiRequestCtx(undefined))!;
  const [listed, history] = await Promise.all([
    runAction("get_weights", {}, ctx),
    runAction("get_points_history", {}, ctx),
  ]);
  const historyOf = new Map<string, PointsHistoryView[]>();
  for (const e of history.ok ? history.data.changes : []) {
    historyOf.set(e.choreId, [...(historyOf.get(e.choreId) ?? []), e]);
  }
  return (
    <>
      <PageHeading
        eyebrow="Admin"
        title="Weights"
        description="Points follow how often each chore is really done. Each Monday the formula suggests a change where the points are off. A scheduled suggestion applies at the first Monday 00:00 at least two days away, and at least 28 days after the chore's last change, unless another member vetoes it first. Points you set yourself on Bounties (Edit, Change points) apply at the first Monday 00:00 at least two days away, with the same veto. Points already scored never change."
      />
      {!listed.ok ? (
        <FormMessage tone="error">{listed.message}</FormMessage>
      ) : (
        <div className="flex flex-col gap-6">
          {listed.data.scheduled.some((c) => c.canVeto) ? (
            <Card
              title="Changes someone else scheduled"
              description="You can veto these until they apply."
            >
              <ScheduledChanges
                changes={listed.data.scheduled.filter((c) => c.canVeto)}
              />
            </Card>
          ) : null}
          <Card title="Chores">
            {listed.data.chores.length === 0 ? (
              <p className="text-sm text-bm-muted">No chores yet.</p>
            ) : (
              <ul>
                {listed.data.chores.map((row) => (
                  <WeightRow
                    key={row.choreId}
                    row={row}
                    history={historyOf.get(row.choreId) ?? []}
                  />
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
