"use client";

// PROTOTYPE (issue #7), throwaway. Variant A: notification icons by STATUS
// (Urgent, New, Messages) over a full-month calendar (variant-a-cal.tsx).

import { useState } from "react";
import { BOUNTIES, isUrgent } from "./data";
import { CalendarArea } from "./variant-a-cal";
import { ENVELOPE, SIREN, STAR } from "./calm-icons";
import {
  BountyRows,
  CalmShell,
  F,
  framed,
  K,
  messagesSpec,
  ModuleSheet,
  Tabs,
  type IconSpec,
} from "./calm-kit";

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

export function VariantA() {
  return (
    <CalmShell
      icons={ICONS}
      calendar={() => <CalendarArea />}
    />
  );
}
