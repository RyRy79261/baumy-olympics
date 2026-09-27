"use client";

// PROTOTYPE (issue #7), throwaway. Variant C: ONE combined Bounties icon
// (a notice board with urgent + new counts) and Messages, over today as a
// big hour timeline with a NOW line and a strip of the next six days.

import { useState } from "react";
import { BOUNTIES, isUrgent, WEEK } from "./data";
import { BOARD, ENVELOPE } from "./calm-icons";
import {
  BountyRows,
  CalmShell,
  DATES,
  DAYS,
  F,
  framed,
  HM,
  K,
  messagesSpec,
  ModuleSheet,
  nowMin,
  Tabs,
  toMin,
  whoColor,
  whoName,
  type IconSpec,
} from "./calm-kit";
import { Person } from "./pixels";
import { hhmm } from "./shared-overlays";

type Tab = "urgent" | "new" | "all";
const pick = (t: Tab) => BOUNTIES.filter((b) => t === "all" || (t === "urgent" ? isUrgent(b) : b.isNew));

function BountiesModule({ close }: { close: () => void }) {
  const [tab, setTab] = useState<Tab>("urgent");
  return (
    <ModuleSheet
      title="Bounties"
      icon={BOARD}
      accent={K.amber}
      subtitle={`${BOUNTIES.length} open · ${BOUNTIES.reduce((s, b) => s + b.reward, 0)} points up for grabs`}
      onClose={close}
      tabs={
        <Tabs
          value={tab}
          onPick={setTab}
          items={[
            { k: "urgent", l: "Urgent", n: pick("urgent").length, color: K.red },
            { k: "new", l: "New", n: pick("new").length, color: K.yellow },
            { k: "all", l: "All", n: BOUNTIES.length, color: K.amber },
          ]}
        />
      }
    >
      <BountyRows list={pick(tab)} />
    </ModuleSheet>
  );
}

const ICONS: IconSpec[] = [
  {
    key: "bounties",
    label: "Bounties",
    icon: BOARD,
    badges: [
      { n: pick("urgent").length, color: K.red },
      { n: pick("new").length, color: K.yellow },
    ],
    module: (close) => <BountiesModule close={close} />,
  },
  messagesSpec(ENVELOPE),
];

const FROM = 17 * 60 + 30;
const TO = 24 * 60;
const pct = (min: number) => `${(((min - FROM) / (TO - FROM)) * 100).toFixed(3)}%`;

function Timeline({ now }: { now: Date }) {
  const m = nowMin(now);
  const today = WEEK.filter((e) => e.day === 0);
  const earlier = today.filter((e) => toMin(e.end) <= FROM);
  const shown = today.filter((e) => toMin(e.end) > FROM);
  // Greedy lanes for overlapping events.
  const laneEnd: number[] = [];
  const lanes = shown.map((e) => {
    let l = laneEnd.findIndex((end) => end <= toMin(e.start));
    if (l < 0) l = laneEnd.length;
    laneEnd[l] = toMin(e.end);
    return l;
  });
  const nLanes = Math.max(1, laneEnd.length);
  const first = Math.ceil(FROM / 60) * 60;
  const hours = Array.from({ length: (TO - first) / 60 }, (_, i) => first + i * 60);
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-baseline justify-between px-1 pb-4">
        <span className={`${F.press} text-[22px]`} style={{ color: K.violet }}>
          TODAY
        </span>
        {earlier.map((e) => (
          <span key={e.title} className={`${F.silk} text-[15px] uppercase`} style={{ color: K.dim }}>
            earlier: {e.start} {e.title} ✓
          </span>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        {hours.map((h) => (
          <div key={h} className="absolute left-0 right-0 flex items-start" style={{ top: pct(h) }}>
            <span className={`${F.silk} w-[84px] -translate-y-1/2 text-[16px] font-bold`} style={{ color: K.muted, visibility: Math.abs(h - m) < 25 ? "hidden" : undefined }}>
              {String(h / 60).padStart(2, "0")}:00
            </span>
            <span className="block h-[2px] flex-1" style={{ background: K.line }} />
          </div>
        ))}
        <div className="absolute bottom-0 left-[84px] right-0 top-0">
          {shown.map((e, i) => {
            const c = whoColor(e.who);
            const h = HM[e.who];
            const w = 100 / nLanes;
            return (
              <div
                key={e.title}
                className="absolute flex flex-col gap-3 px-5 py-4"
                style={{
                  top: pct(Math.max(FROM, toMin(e.start))),
                  bottom: `calc(100% - ${pct(Math.min(TO, toMin(e.end)))})`,
                  left: `calc(${lanes[i]! * w}% + ${lanes[i]! ? 4 : 0}px)`,
                  width: `calc(${w}% - 4px)`,
                  ...framed(`${c}88`, `${c}22`, 4),
                }}
              >
                <span className={`${F.silk} text-[17px] font-bold`} style={{ color: c }}>
                  {e.start} – {e.end}
                </span>
                <span className={`${F.pix} text-[38px] font-semibold leading-[1.05]`}>{e.title}</span>
                <span className={`${F.silk} flex items-center gap-2 text-[16px] font-bold uppercase`} style={{ color: c }}>
                  {h && <Person id={h.id} hair={h.hair} shirt={h.shirt} scale={2} />}
                  {whoName(e.who)}
                </span>
              </div>
            );
          })}
        </div>
        {m >= FROM && m < TO && (
          <div className="cm-now absolute left-0 right-0 z-10 flex items-center" style={{ top: pct(m) }}>
            <span className={`${F.press} w-[84px] -translate-y-0 text-[14px]`} style={{ color: K.red }}>
              NOW
            </span>
            <span className="block h-[4px] flex-1" style={{ background: K.red, boxShadow: `0 0 0 2px ${K.bg}` }} />
            <span className={`${F.press} ml-2 text-[14px]`} style={{ color: K.red }}>
              {hhmm(now)}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function NextDays() {
  return (
    <section className="grid h-[250px] shrink-0 grid-cols-6 gap-[8px]">
      {[1, 2, 3, 4, 5, 6].map((d) => {
        const evs = WEEK.filter((e) => e.day === d);
        return (
          <div key={d} className="flex flex-col gap-3 p-3" style={framed(K.line, K.surface, 3)}>
            <div className="flex items-baseline gap-2">
              <span className={`${F.silk} text-[15px] font-bold uppercase`} style={{ color: d === 1 ? K.text : K.muted }}>
                {DAYS[d]}
              </span>
              <span className={`${F.press} text-[16px]`}>{DATES[d]}</span>
            </div>
            {evs.map((e) => (
              <div key={e.title} className="flex flex-col gap-1 pl-2" style={{ borderLeft: `4px solid ${whoColor(e.who)}` }}>
                <span className={`${F.silk} text-[12px]`} style={{ color: K.muted }}>
                  {e.start}
                </span>
                <span className={`${F.pix} text-[20px] leading-[1.1]`}>{e.title}</span>
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}

export function VariantC() {
  return (
    <CalmShell
      icons={ICONS}
      calendar={(now) => (
        <div className="flex h-full flex-col gap-5">
          <Timeline now={now} />
          <NextDays />
        </div>
      )}
    />
  );
}
