"use client";

// PROTOTYPE (issue #7), throwaway. Variant B: notification icons by
// TAXONOMY (Consumables, Maintenance, each with urgent + new counts) and
// Messages, over a full-width seven-column week grid.

import { useState } from "react";
import { BOUNTIES, HOUSEMATES, isUrgent, WEEK, type Taxonomy } from "./data";
import { BASKET, ENVELOPE, WRENCH, type PixelIcon } from "./calm-icons";
import {
  BountyRows,
  CalmShell,
  DATES,
  DAYS,
  F,
  framed,
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
import { hhmm } from "./shared-overlays";

type Tab = "urgent" | "new" | "all";

function TaxModule({ tax, icon, accent, close }: { tax: Taxonomy; icon: PixelIcon; accent: string; close: () => void }) {
  const list = BOUNTIES.filter((b) => b.taxonomy === tax);
  const pick = (t: Tab) => list.filter((b) => t === "all" || (t === "urgent" ? isUrgent(b) : b.isNew));
  const [tab, setTab] = useState<Tab>(pick("urgent").length ? "urgent" : "all");
  return (
    <ModuleSheet
      title={tax === "consumables" ? "Consumables" : "Maintenance"}
      icon={icon}
      accent={accent}
      subtitle={tax === "consumables" ? "Things to buy or refill" : "Things to fix or clean"}
      onClose={close}
      tabs={
        <Tabs
          value={tab}
          onPick={setTab}
          items={[
            { k: "urgent", l: "Urgent", n: pick("urgent").length, color: K.red },
            { k: "new", l: "New", n: pick("new").length, color: K.yellow },
            { k: "all", l: "All", n: list.length, color: accent },
          ]}
        />
      }
    >
      <BountyRows list={pick(tab)} />
    </ModuleSheet>
  );
}

const counts = (tax: Taxonomy) => {
  const l = BOUNTIES.filter((b) => b.taxonomy === tax);
  return [
    { n: l.filter(isUrgent).length, color: K.red },
    { n: l.filter((b) => b.isNew).length, color: K.yellow },
  ];
};

const ICONS: IconSpec[] = [
  {
    key: "consumables",
    label: "Buy",
    icon: BASKET,
    badges: counts("consumables"),
    module: (close) => <TaxModule tax="consumables" icon={BASKET} accent={K.amber} close={close} />,
  },
  {
    key: "maintenance",
    label: "Fix",
    icon: WRENCH,
    badges: counts("maintenance"),
    module: (close) => <TaxModule tax="maintenance" icon={WRENCH} accent={K.teal} close={close} />,
  },
  messagesSpec(ENVELOPE),
];

const BODY_H = 764;
const DAY_FROM = 7 * 60;
const PPM = BODY_H / (24 * 60 - DAY_FROM);
const MIN_H = 110;
const y = (min: number) => Math.round((min - DAY_FROM) * PPM);

/** Blocks sit at their time of day; an overlapping block slides down below the one before it. */
function place(evs: (typeof WEEK)[number][]) {
  let bottom = -Infinity;
  return evs.map((e) => {
    const top = Math.max(y(toMin(e.start)), bottom + 6);
    const h = Math.max(MIN_H, y(toMin(e.end)) - y(toMin(e.start)));
    bottom = top + h;
    return { e, top, h };
  });
}

function Block({ e, top, h, past }: { e: (typeof WEEK)[number]; top: number; h: number; past?: boolean }) {
  const c = whoColor(e.who);
  return (
    <div
      className="absolute left-0 right-0 flex flex-col gap-2 overflow-hidden px-[7px] py-[10px]"
      style={{ top, height: h, ...framed(`${c}77`, `${c}22`, 3), opacity: past ? 0.4 : 1 }}
    >
      <span className={`${F.silk} text-[14px] font-bold`} style={{ color: c }}>
        {e.start}
      </span>
      <span className={`${F.pix} text-[19px] leading-[1.1]`} style={{ color: K.text, overflowWrap: "break-word" }}>
        {e.title}
      </span>
    </div>
  );
}

function Week({ now }: { now: Date }) {
  const m = nowMin(now);
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex h-[36px] items-center justify-between px-1">
        <span className={`${F.press} text-[18px]`} style={{ color: K.text }}>
          THIS WEEK
        </span>
        <span className="flex gap-4">
          {[...HOUSEMATES.map((h) => h.id), "house"].map((w) => (
            <span key={w} className={`${F.silk} flex items-center gap-[6px] text-[13px] font-bold uppercase`} style={{ color: K.muted }}>
              <span className="block size-[12px]" style={{ background: whoColor(w) }} />
              {whoName(w)}
            </span>
          ))}
        </span>
      </div>
      <div className="grid grid-cols-7 gap-[4px]">
        {DAYS.map((d, i) => {
          const today = i === 0;
          const placed = place(WEEK.filter((e) => e.day === i));
          return (
            <div
              key={d}
              className="flex flex-col gap-[8px]"
              style={today ? { ...framed(K.violet, "#221638", 3), padding: 3 } : { background: i >= 5 ? "#1a1127" : "#170f23" }}
            >
              <div className="flex h-[72px] flex-col items-center justify-center" style={today ? { background: K.violet, color: K.ink } : { color: K.muted }}>
                <span className={`${F.silk} text-[14px] font-bold uppercase`}>{today ? "Today" : d}</span>
                <span className={`${F.press} mt-2 text-[22px]`} style={{ color: today ? K.ink : K.text }}>
                  {DATES[i]}
                </span>
              </div>
              <div className="relative" style={{ height: BODY_H }}>
                {[12, 18].map((hr) => (
                  <span key={hr} className="absolute left-0 right-0 block h-[2px]" style={{ top: y(hr * 60), background: "#ffffff0a" }} />
                ))}
                {placed.map(({ e, top, h }) => (
                  <Block key={e.title} e={e} top={top} h={h} past={today && toMin(e.end) <= m} />
                ))}
                {today && (
                  <div className="cm-now absolute left-[-4px] right-[-4px] z-10 flex items-center" style={{ top: y(m) - 2 }}>
                    <span className="block h-[4px] flex-1" style={{ background: K.red }} />
                    <span className={`${F.silk} px-1 text-[12px] font-bold`} style={{ background: K.red, color: K.ink }}>
                      {hhmm(now)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function VariantB() {
  return <CalmShell icons={ICONS} calendar={(now) => <Week now={now} />} />;
}
