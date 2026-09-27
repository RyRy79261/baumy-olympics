"use client";

// PROTOTYPE (issue #7), throwaway. Variant A: notification icons by STATUS
// (Urgent, New, Messages) over a Week | Month calendar (variant-a-cal.tsx).

import { useState } from "react";
import { BOUNTIES, eventsOn, isUrgent, TODAY_ISO } from "./data";
import { CalendarArea } from "./variant-a-cal";
import { ENVELOPE, SIREN, STAR } from "./calm-icons";
import {
  BountyRows,
  CalmShell,
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
  const today = eventsOn(TODAY_ISO);
  const past = today.filter((e) => toMin(e.end) <= m);
  const coming = today.filter((e) => toMin(e.end) > m);
  const next = coming[0];
  return (
    <section className="flex shrink-0 flex-col px-7 pb-5 pt-5" style={framed(K.violet, "#1e1432", 4)}>
      <div className="flex items-baseline justify-between">
        <span className={`${F.press} text-[22px]`} style={{ color: K.violet }}>
          TODAY
        </span>
        <span className={`${F.silk} text-[15px] uppercase`} style={{ color: K.muted }}>
          {coming.length} still to come
        </span>
      </div>
      {past.map((e) => (
        <div key={e.title} className={`${F.pix} mt-3 flex items-center gap-4 text-[22px]`} style={{ color: K.dim }}>
          <span className={`${F.press} w-[150px] text-[16px]`}>{e.start}</span>
          <span className="ml-6 line-through">{e.title}</span>
          <span className={`${F.silk} text-[13px] uppercase`}>done</span>
        </div>
      ))}
      {coming.map((e) => {
        const c = whoColor(e.who);
        const mins = toMin(e.start) - m;
        return (
          <div key={e.title} className="mt-4 flex items-center gap-4">
            <div className="w-[150px] shrink-0">
              <div className={`${F.press} text-[28px] leading-none`}>{e.start}</div>
              <div className={`${F.silk} mt-2 text-[14px] uppercase`} style={{ color: K.muted }}>
                to {e.end}
              </div>
            </div>
            <span className="block h-[76px] w-[8px] shrink-0" style={{ background: c }} />
            <div className="min-w-0 flex-1">
              <div className={`${F.pix} truncate text-[40px] font-semibold leading-none`}>{e.title}</div>
              <div className="mt-2">
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

export function VariantA() {
  return (
    <CalmShell
      icons={ICONS}
      calendar={(now) => <CalendarArea today={<Today now={now} />} />}
    />
  );
}
