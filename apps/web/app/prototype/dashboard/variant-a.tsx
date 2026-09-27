"use client";

// PROTOTYPE (issue #7), throwaway. Variant A: notification icons by STATUS
// (Urgent, New, Messages) over a full-width week agenda: today big, then
// the next six days as rows.

import { useState } from "react";
import { BOUNTIES, isUrgent, WEEK } from "./data";
import { ENVELOPE, SIREN, STAR } from "./calm-icons";
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

const URGENT = BOUNTIES.filter(isUrgent);
const NEW = BOUNTIES.filter((b) => b.isNew);

function TaxModule({
  title,
  icon,
  accent,
  list,
  subtitle,
  close,
}: {
  title: string;
  icon: typeof SIREN;
  accent: string;
  list: typeof BOUNTIES;
  subtitle: string;
  close: () => void;
}) {
  const [tab, setTab] = useState<"all" | "consumables" | "maintenance">("all");
  const shown = list.filter((b) => tab === "all" || b.taxonomy === tab);
  const n = (t: string) => list.filter((b) => t === "all" || b.taxonomy === t).length;
  return (
    <ModuleSheet
      title={title}
      icon={icon}
      accent={accent}
      subtitle={subtitle}
      onClose={close}
      tabs={
        <Tabs
          value={tab}
          onPick={setTab}
          items={[
            { k: "all", l: "All", n: n("all"), color: accent },
            { k: "consumables", l: "Consumables", n: n("consumables"), color: K.amber },
            { k: "maintenance", l: "Maintenance", n: n("maintenance"), color: K.teal },
          ]}
        />
      }
    >
      <BountyRows list={shown} />
    </ModuleSheet>
  );
}

const ICONS: IconSpec[] = [
  {
    key: "urgent",
    label: "Urgent",
    icon: SIREN,
    badges: [{ n: URGENT.length, color: K.red }],
    module: (close) => (
      <TaxModule title="Urgent" icon={SIREN} accent={K.red} list={URGENT} subtitle="Overdue or due in the next 12 hours" close={close} />
    ),
  },
  {
    key: "new",
    label: "New",
    icon: STAR,
    badges: [{ n: NEW.length, color: K.yellow }],
    module: (close) => (
      <TaxModule title="New bounties" icon={STAR} accent={K.yellow} list={NEW} subtitle="Posted since you last looked" close={close} />
    ),
  },
  messagesSpec(ENVELOPE),
];

function Who({ who, scale = 2 }: { who: string; scale?: number }) {
  const h = HM[who];
  return (
    <span className={`${F.silk} flex items-center gap-2 text-[16px] font-bold uppercase`} style={{ color: whoColor(who) }}>
      {h && <Person id={h.id} hair={h.hair} shirt={h.shirt} scale={scale} />}
      {whoName(who)}
    </span>
  );
}

function Today({ now }: { now: Date }) {
  const m = nowMin(now);
  const today = WEEK.filter((e) => e.day === 0);
  const past = today.filter((e) => toMin(e.end) <= m);
  const coming = today.filter((e) => toMin(e.end) > m);
  const next = coming[0];
  return (
    <section className="flex flex-col px-7 pb-5 pt-6" style={framed(K.violet, "#1e1432", 4)}>
      <div className="flex items-baseline justify-between">
        <span className={`${F.press} text-[22px]`} style={{ color: K.violet }}>
          TODAY
        </span>
        <span className={`${F.silk} text-[15px] uppercase`} style={{ color: K.muted }}>
          {coming.length} still to come
        </span>
      </div>
      {past.map((e) => (
        <div key={e.title} className={`${F.pix} mt-4 flex items-center gap-4 text-[22px]`} style={{ color: K.dim }}>
          <span className={`${F.press} w-[150px] text-[16px]`}>{e.start}</span>
          <span className="ml-6 line-through">{e.title}</span>
          <span className={`${F.silk} text-[13px] uppercase`}>done</span>
        </div>
      ))}
      {coming.map((e) => {
        const c = whoColor(e.who);
        const mins = toMin(e.start) - m;
        return (
          <div key={e.title} className="mt-5 flex items-center gap-4">
            <div className="w-[150px] shrink-0">
              <div className={`${F.press} text-[28px] leading-none`}>{e.start}</div>
              <div className={`${F.silk} mt-2 text-[14px] uppercase`} style={{ color: K.muted }}>
                to {e.end}
              </div>
            </div>
            <span className="block h-[84px] w-[8px] shrink-0" style={{ background: c }} />
            <div className="min-w-0 flex-1">
              <div className={`${F.pix} truncate text-[42px] font-semibold leading-none`}>{e.title}</div>
              <div className="mt-3">
                <Who who={e.who} />
              </div>
            </div>
            {e === next && mins > 0 && (
              <span className={`${F.silk} shrink-0 px-3 py-2 text-[15px] font-bold uppercase`} style={{ ...framed(K.amber, "#2e1f14", 3), color: K.amber }}>
                in {mins} min
              </span>
            )}
          </div>
        );
      })}
    </section>
  );
}

function Days() {
  return (
    <section className="flex flex-1 flex-col">
      {[1, 2, 3, 4, 5, 6].map((d) => {
        const evs = WEEK.filter((e) => e.day === d);
        return (
          <div key={d} className="flex flex-1 items-center gap-5 px-2" style={{ borderTop: `2px solid ${K.line}` }}>
            <div className="w-[118px] shrink-0">
              <div className={`${F.silk} text-[15px] font-bold uppercase`} style={{ color: d === 1 ? K.text : K.muted }}>
                {d === 1 ? "Tomorrow" : DAYS[d]}
              </div>
              <div className={`${F.press} mt-2 text-[22px]`} style={{ color: d >= 5 ? K.muted : K.text }}>
                {DATES[d]}
              </div>
            </div>
            <div className="flex min-w-0 flex-1 gap-6">
              {evs.map((e) => (
                <div key={e.title} className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="block h-[46px] w-[6px] shrink-0" style={{ background: whoColor(e.who) }} />
                  <div className="min-w-0">
                    <div className={`${F.pix} truncate text-[27px] leading-none`}>{e.title}</div>
                    <div className={`${F.silk} mt-[6px] text-[13px] uppercase`} style={{ color: K.muted }}>
                      {e.start} · <span style={{ color: whoColor(e.who) }}>{whoName(e.who)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function VariantA() {
  return (
    <CalmShell
      icons={ICONS}
      calendar={(now) => (
        <div className="flex h-full flex-col gap-4">
          <Today now={now} />
          <Days />
        </div>
      )}
    />
  );
}
