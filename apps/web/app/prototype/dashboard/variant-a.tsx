"use client";

// PROTOTYPE (issue #7), throwaway. Variant A, "Calm": a clean game HUD.
// Four huge status tiles with chunky SNES item icons, one slim metrics
// strip, a big calendar agenda, a one-line message ticker and a tiny nav.
// Near-black plum, one loud accent at a time (the urgent siren).

import { useCallback, useEffect, useRef, useState } from "react";
import { BaumySprite, BlinkingBaumy } from "./baumy-sprite";
import {
  BOUNTIES,
  HOUSEMATES,
  LAST_EVENT,
  MESSAGES,
  METRICS,
  POT,
  WEEK,
  isUrgent,
  type Bounty,
} from "./data";
import { Icon, type IconName, Person } from "./variant-a-pixels";
import { Framed, notch, ReminderA, ScreensaverA } from "./variant-a-scenes";

const silk = "font-[family-name:var(--font-silk)]";
const press = "font-[family-name:var(--font-press)]";
const vt = "font-[family-name:var(--font-vt)]";
const pixelify = "font-[family-name:var(--font-pixelify)]";

const HOUSE = { name: "House", color: "#ffb347" };
const who = (id: string) => HOUSEMATES.find((h) => h.id === id) ?? { ...HOUSE, id: "house" };

type SliceKey = "new" | "urgent" | "shop" | "chores" | "scores";
const SLICES: {
  key: Exclude<SliceKey, "scores">;
  word: string;
  title: string;
  icon: IconName;
  accent: string;
  filter: (b: Bounty) => boolean;
  hint: string;
}[] = [
  { key: "urgent", word: "URGENT", title: "Urgent bounties", icon: "siren", accent: "#ff4d6d", filter: isUrgent, hint: `${METRICS.overdue} OVERDUE` },
  { key: "new", word: "NEW", title: "New bounties", icon: "star", accent: "#ffe46b", filter: (b) => b.isNew, hint: `${BOUNTIES.filter((b) => b.isNew).reduce((a, b) => a + b.reward, 0)} PTS UP` },
  { key: "shop", word: "BUY", title: "Consumables", icon: "bag", accent: "#4ff5e6", filter: (b) => b.taxonomy === "consumables", hint: "TP FIRST" },
  { key: "chores", word: "CHORES", title: "Maintenance", icon: "broom", accent: "#8f7dff", filter: (b) => b.taxonomy === "maintenance", hint: "LITTER FIRST" },
];

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DATES = [28, 29, 30, 1, 2, 3, 4];

function due(h: number) {
  if (h < 0) return { text: `${Math.abs(h)}H OVERDUE`, color: "#ff4d6d", bg: "#3a0d1c" };
  if (h <= 12) return { text: `DUE IN ${h}H`, color: "#ffb347", bg: "#33200d" };
  if (h < 48) return { text: `DUE IN ${h}H`, color: "#cbb8e0", bg: "#241733" };
  return { text: `IN ${Math.round(h / 24)} DAYS`, color: "#cbb8e0", bg: "#241733" };
}

export function VariantA() {
  const [slice, setSlice] = useState<SliceKey | null>(null);
  const [reminder, setReminder] = useState(false);
  const [asleep, setAsleep] = useState(false);
  const [voice, setVoice] = useState<"idle" | "listening" | "heard">("idle");
  const [tick, setTick] = useState(0);
  const [clock, setClock] = useState("09:41");
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poke = useCallback(() => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => setAsleep(true), 60_000);
  }, []);

  useEffect(() => {
    const r = () => setReminder(true);
    const s = () => setAsleep(true);
    window.addEventListener("proto:reminder", r);
    window.addEventListener("proto:screensaver", s);
    window.addEventListener("pointerdown", poke);
    poke();
    // Sample data is pinned to Mon 28 Sep, 09:41; the header matches it.
    const c = setInterval(() => setClock("09:41"), 60_000);
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => {
      window.removeEventListener("proto:reminder", r);
      window.removeEventListener("proto:screensaver", s);
      window.removeEventListener("pointerdown", poke);
      clearInterval(c);
      clearInterval(t);
      if (idle.current) clearTimeout(idle.current);
    };
  }, [poke]);

  useEffect(() => {
    if (voice !== "heard") return;
    const t = setTimeout(() => setVoice("idle"), 6000);
    return () => clearTimeout(t);
  }, [voice]);

  return (
    <div
      className={`relative h-[1180px] w-[820px] select-none overflow-hidden bg-[#110917] text-[#f6ecff] ${pixelify}`}
      style={{
        backgroundImage:
          "radial-gradient(ellipse 70% 30% at 50% 0%, rgba(122,31,61,0.45), transparent 70%), radial-gradient(ellipse 50% 25% at 90% 100%, rgba(143,125,255,0.14), transparent 70%)",
      }}
    >
      <style>{CSS}</style>
      <Garland />
      <Header clock={clock} />
      <StatusRow onOpen={setSlice} />
      <MetricsStrip onOpen={() => setSlice("scores")} />
      <Calendar />
      <Ticker tick={tick} />
      <Nav />
      <VoiceBubble state={voice} onPress={() => setVoice((v) => (v === "idle" ? "listening" : v === "listening" ? "heard" : "idle"))} />

      {slice && <BountyModal slice={slice} onClose={() => setSlice(null)} />}
      {reminder && <ReminderA onClose={() => setReminder(false)} />}
      {asleep && (
        <ScreensaverA
          onWake={() => {
            setAsleep(false);
            poke();
          }}
        />
      )}
    </div>
  );
}

/* ───────────────────────── header ───────────────────────── */

const BULBS = ["#8f7dff", "#4ff5e6", "#ff8fc7", "#ffe46b"];

function Garland() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-7" aria-hidden>
      <svg width="820" height="28" className="absolute inset-0">
        <path d="M0 4 Q 102 22 205 6 T 410 6 T 615 6 T 820 4" stroke="#2c1d3d" strokeWidth="2" fill="none" />
      </svg>
      {Array.from({ length: 20 }, (_, i) => {
        const x = 14 + i * 41;
        const phase = ((x % 205) / 205) * Math.PI;
        const y = Math.round(4 + Math.sin(phase) * 12);
        const c = BULBS[i % 4];
        return (
          <span
            key={i}
            className="proto-twinkle absolute h-[6px] w-[6px]"
            style={{ left: x, top: y, background: c, boxShadow: `0 0 8px 2px ${c}88`, animationDelay: `${(i % 7) * 0.3}s` }}
          />
        );
      })}
    </div>
  );
}

function Header({ clock }: { clock: string }) {
  return (
    <header className="absolute left-7 right-7 top-[30px] flex h-[52px] items-center justify-between">
      <div className="flex items-center gap-3">
        <BlinkingBaumy scale={1.6} />
        <div>
          <p className={`${press} text-[15px] leading-none tracking-tight text-[#f6ecff]`}>BAUMY OLYMPICS</p>
          <p className={`${silk} mt-[6px] text-[13px] leading-none tracking-[0.18em] text-[#a893c4]`}>
            SEASON {POT.season} · {POT.daysLeft} DAYS LEFT
          </p>
        </div>
      </div>
      <div className="flex items-baseline gap-4">
        <p className={`${silk} text-[18px] tracking-[0.14em] text-[#a893c4]`}>MON 28 SEP</p>
        <p className={`${press} text-[30px] leading-none text-[#fff0d6]`}>{clock}</p>
      </div>
    </header>
  );
}

/* ─────────────────────── status tiles ─────────────────────── */

function StatusRow({ onOpen }: { onOpen: (k: SliceKey) => void }) {
  return (
    <div className="absolute left-6 right-6 top-[98px] grid h-[208px] grid-cols-4 gap-4">
      {SLICES.map((s) => {
        const n = BOUNTIES.filter(s.filter).length;
        const loud = s.key === "urgent";
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onOpen(s.key)}
            className={`group relative flex flex-col items-center justify-end pb-[14px] transition-transform active:translate-y-1 ${loud ? "va-alarm" : ""}`}
            style={{ clipPath: notch(9), background: loud ? "#ff4d6d" : `${s.accent}55` }}
            aria-label={`${n} ${s.title}`}
          >
            <span
              className="pointer-events-none absolute inset-[3px]"
              style={{
                clipPath: notch(6),
                background: loud
                  ? "linear-gradient(180deg, #45112a 0%, #22091a 100%)"
                  : "linear-gradient(180deg, #231632 0%, #170d21 100%)",
                boxShadow: "inset 0 -8px 0 rgba(0,0,0,0.35)",
              }}
            />
            {/* badge */}
            <span className="absolute left-1/2 top-[16px] -translate-x-1/2">
              <span
                className={`absolute left-1/2 top-1/2 h-[124px] w-[124px] -translate-x-1/2 -translate-y-1/2 rounded-full ${loud ? "va-glow" : ""}`}
                style={{ background: `radial-gradient(circle, ${s.accent}${loud ? "66" : "33"} 0%, ${s.accent}10 55%, transparent 70%)` }}
              />
              {s.key === "new" && <Burst color={s.accent} />}
              {loud && <SirenRays />}
              <span className={`relative block ${loud ? "va-wobble" : s.key === "new" ? "va-float" : ""}`}>
                <Icon name={s.icon} scale={5} />
              </span>
            </span>
            {/* count bubble */}
            <span
              className={`${press} absolute right-[10px] top-[10px] flex h-[54px] min-w-[54px] items-center justify-center px-2 text-[26px] leading-none text-[#0b0712]`}
              style={{
                background: s.accent,
                clipPath: notch(6),
                boxShadow: "inset 0 -5px 0 rgba(0,0,0,0.25)",
              }}
            >
              {n}
            </span>
            <span className={`${press} relative text-[19px] tracking-tight`} style={{ color: loud ? "#ff8fa6" : "#f6ecff" }}>
              {s.word}
            </span>
            <span className={`${silk} relative mt-[9px] whitespace-nowrap text-[13px] tracking-[0.1em]`} style={{ color: loud ? "#ffb8c8" : "#a893c4" }}>
              {s.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Burst({ color }: { color: string }) {
  return (
    <span className="va-spin pointer-events-none absolute left-1/2 top-1/2 h-[128px] w-[128px] -translate-x-1/2 -translate-y-1/2">
      {Array.from({ length: 8 }, (_, i) => (
        <span
          key={i}
          className="absolute left-1/2 top-0 h-[16px] w-[6px] -translate-x-1/2"
          style={{ background: color, opacity: 0.55, transform: `rotate(${i * 45}deg)`, transformOrigin: "50% 64px" }}
        />
      ))}
    </span>
  );
}

function SirenRays() {
  return (
    <span className="va-rays pointer-events-none absolute left-1/2 top-1/2 h-[130px] w-[130px] -translate-x-1/2 -translate-y-1/2">
      {[-60, -30, 0, 30, 60].map((d) => (
        <span
          key={d}
          className="absolute left-1/2 top-0 h-[14px] w-[6px] -translate-x-1/2 bg-[#ff8fa6]"
          style={{ transform: `rotate(${d}deg)`, transformOrigin: "50% 65px" }}
        />
      ))}
    </span>
  );
}

/* ─────────────────────── metrics strip ─────────────────────── */

function MetricsStrip({ onOpen }: { onOpen: () => void }) {
  const leader = [...HOUSEMATES].sort((a, b) => b.points - a.points)[0]!;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="absolute left-6 right-6 top-[322px] flex h-[76px] items-stretch text-left"
      style={{ clipPath: notch(6), background: "#1a0f24", boxShadow: "inset 0 0 0 2px #2e1f40" }}
      aria-label="Scores and metrics"
    >
      <Metric icon="crown" scale={4} value={leader.name.toUpperCase()} sub={`${leader.points} PTS · LEADS`} color="#ffe46b">
        <span className="ml-1 flex -space-x-1">
          {HOUSEMATES.map((h) => (
            <span key={h.id} className="h-[10px] w-[10px] ring-2 ring-[#1a0f24]" style={{ background: h.color }} />
          ))}
        </span>
      </Metric>
      <Divider />
      <Metric icon="jar" scale={4} value={`€${POT.euros.toFixed(2)}`} sub="HOUSE POT" color="#bfe3ff" />
      <Divider />
      <Metric icon="flame" scale={4} value={`${METRICS.houseStreakDays}`} sub="DAY STREAK" color="#ffb347" flicker />
      <Divider />
      <div className="flex w-[118px] shrink-0 flex-col justify-center pl-4">
        <p className={`${press} text-[20px] leading-none text-[#43f0a0]`}>{METRICS.doneThisWeek}</p>
        <p className={`${silk} mt-2 text-[12px] leading-none tracking-[0.12em] text-[#a893c4]`}>DONE / WK</p>
      </div>
    </button>
  );
}

function Divider() {
  return <span className="my-4 w-[2px] shrink-0 bg-[#2e1f40]" />;
}

function Metric({
  icon,
  scale,
  value,
  sub,
  color,
  flicker,
  children,
}: {
  icon: IconName;
  scale: number;
  value: string;
  sub: string;
  color: string;
  flicker?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center gap-3 px-3">
      <span className={flicker ? "va-flicker" : ""}>
        <Icon name={icon} scale={scale} />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className={`${press} text-[20px] leading-none`} style={{ color }}>
            {value}
          </p>
          {children}
        </div>
        <p className={`${silk} mt-2 whitespace-nowrap text-[12px] leading-none tracking-[0.1em] text-[#a893c4]`}>{sub}</p>
      </div>
    </div>
  );
}

/* ───────────────────────── calendar ───────────────────────── */

function Pip({ id, size = 14 }: { id: string; size?: number }) {
  const c = who(id).color;
  return (
    <span
      className="inline-block shrink-0"
      style={{ width: size, height: size, background: c, boxShadow: `0 0 0 2px #0b0712, 0 0 10px ${c}66` }}
    />
  );
}

function Calendar() {
  const today = WEEK.filter((e) => e.day === 0);
  const nowMin = 9 * 60 + 41;
  const toMin = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3);
  return (
    <section className="absolute left-6 right-6 top-[414px] h-[608px]">
      <div className="flex h-[34px] items-center justify-between px-1">
        <p className={`${silk} text-[16px] tracking-[0.3em] text-[#a893c4]`}>THIS WEEK</p>
        <div className="flex items-center gap-4">
          {[...HOUSEMATES.map((h) => ({ id: h.id, name: h.name })), { id: "house", name: "House" }].map((h) => (
            <span key={h.id} className={`${silk} flex items-center gap-2 text-[13px] tracking-[0.1em] text-[#cbb8e0]`}>
              <Pip id={h.id} size={10} />
              {h.name.toUpperCase()}
            </span>
          ))}
        </div>
      </div>

      {/* today */}
      <Framed border="#ffb347" bg="linear-gradient(90deg, #2a1422, #1d1029 60%)" n={8} b={3} className="mt-2">
      <div className="flex h-[236px] p-[3px]">
        <div className="flex w-[153px] shrink-0 flex-col items-center justify-center bg-[#ffb347] text-[#1b0f14]" style={{ boxShadow: "inset -6px 0 0 #c46a1f" }}>
          <p className={`${press} text-[18px] tracking-tight`}>TODAY</p>
          <p className={`${press} mt-3 text-[64px] leading-none`}>28</p>
          <p className={`${silk} mt-3 whitespace-nowrap text-[17px] font-bold tracking-[0.12em]`}>MON · SEP</p>
        </div>
        <ul className="flex flex-1 flex-col justify-center gap-[6px] px-5">
          {today.map((e, i) => {
            const past = toMin(e.end) <= nowMin;
            const nextUp = !past && today.slice(0, i).every((p) => toMin(p.end) <= nowMin);
            const h = who(e.who);
            return (
              <li key={e.title}>
                {nextUp && (
                  <div className="mb-[6px] flex items-center gap-2">
                    <span className={`${silk} bg-[#ff8fc7] px-2 py-[2px] text-[11px] font-bold tracking-[0.15em] text-[#1b0f14]`}>NOW {`09:41`}</span>
                    <span className="h-[2px] flex-1 bg-[#ff8fc7]/60" />
                  </div>
                )}
                <div className={`flex h-[52px] items-center gap-4 ${past ? "opacity-40" : ""}`}>
                  <span className={`${vt} w-[74px] text-[32px] leading-none text-[#fff0d6]`}>{e.start}</span>
                  <Pip id={e.who} size={18} />
                  <span className={`flex-1 truncate text-[28px] leading-none ${past ? "line-through decoration-2" : ""}`}>{e.title}</span>
                  <span className={`${silk} text-[13px] tracking-[0.12em]`} style={{ color: h.color }}>
                    {h.name.toUpperCase()}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      </Framed>

      {/* next 6 days */}
      <ul className="mt-3 flex flex-col gap-[6px]">
        {[1, 2, 3, 4, 5, 6].map((d) => {
          const evs = WEEK.filter((e) => e.day === d);
          const weekend = d >= 5;
          return (
            <li key={d} className="flex h-[49px] items-center gap-3 bg-[#170d20] pr-3" style={{ clipPath: notch(4) }}>
              <div
                className="flex h-full w-[108px] shrink-0 items-center justify-center gap-2"
                style={{ background: weekend ? "#2b1230" : "#1f1430" }}
              >
                <span className={`${silk} text-[16px] font-bold tracking-[0.12em]`} style={{ color: weekend ? "#ff8fc7" : "#cbb8e0" }}>
                  {DAYS[d]}
                </span>
                <span className={`${press} text-[16px] text-[#f6ecff]`}>{DATES[d]}</span>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-5">
                {evs.map((e) => (
                  <span key={e.title} className="flex min-w-0 items-center gap-2">
                    <Pip id={e.who} size={12} />
                    <span className={`${vt} text-[24px] leading-none text-[#a893c4]`}>{e.start}</span>
                    <span className="truncate text-[21px] leading-none">{e.title}</span>
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ───────────────────────── ticker ───────────────────────── */

function Ticker({ tick }: { tick: number }) {
  const items = [
    { kind: "event" as const },
    ...MESSAGES.map((m) => ({ kind: "msg" as const, ...m })),
  ];
  const i = tick % items.length;
  const it = items[i]!;
  return (
    <div
      className="absolute left-6 right-[150px] top-[1034px] flex h-[52px] items-center gap-3 bg-[#170d20] px-3"
      style={{ clipPath: notch(4) }}
    >
      <Icon name={it.kind === "event" ? "star" : "bubble"} scale={it.kind === "event" ? 2 : 2.4} />
      <div key={i} className="va-slide flex min-w-0 flex-1 items-center gap-2">
        {it.kind === "event" ? (
          <>
            <span className="truncate text-[21px] leading-none text-[#ffe46b]">{LAST_EVENT.text}</span>
            <span className={`${press} shrink-0 text-[13px] text-[#43f0a0]`}>+{LAST_EVENT.bonus}</span>
          </>
        ) : (
          <>
            <span className={`${silk} shrink-0 text-[14px] font-bold tracking-[0.1em]`} style={{ color: who(it.who).color }}>
              {who(it.who).name.toUpperCase()}
            </span>
            <span className="truncate text-[21px] leading-none">{it.text}</span>
            <span className={`${vt} shrink-0 text-[20px] text-[#7d6a98]`}>{it.ago}</span>
          </>
        )}
      </div>
      <div className="flex shrink-0 gap-[5px]">
        {items.map((_, j) => (
          <span key={j} className="h-[6px] w-[6px]" style={{ background: j === i ? "#f6ecff" : "#3a2a50" }} />
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── nav ───────────────────────── */

const TABS: { label: string; icon: IconName }[] = [
  { label: "HOME", icon: "home" },
  { label: "BOUNTIES", icon: "star" },
  { label: "CALENDAR", icon: "cal" },
  { label: "BOARD", icon: "note" },
  { label: "SHOP", icon: "bag" },
  { label: "SCORES", icon: "trophy" },
];

function Nav() {
  return (
    <nav className="absolute inset-x-0 bottom-0 flex h-[82px] border-t-2 border-[#241733] bg-[#0c0611] px-3 pb-2">
      {TABS.map((t, i) => (
        <button
          key={t.label}
          type="button"
          className={`relative flex flex-1 flex-col items-center justify-center gap-[6px] ${i === 0 ? "" : "opacity-60"}`}
        >
          {i === 0 && <span className="absolute left-1/2 top-0 h-[4px] w-10 -translate-x-1/2 bg-[#ffb347]" />}
          <span className="flex h-[36px] items-center">
            <Icon name={t.icon} scale={t.icon === "star" || t.icon === "bag" ? 2 : 3} />
          </span>
          <span className={`${silk} text-[11px] tracking-[0.14em]`} style={{ color: i === 0 ? "#ffb347" : "#cbb8e0" }}>
            {t.label}
          </span>
        </button>
      ))}
    </nav>
  );
}

/* ───────────────────────── voice ───────────────────────── */

function VoiceBubble({ state, onPress }: { state: "idle" | "listening" | "heard"; onPress: () => void }) {
  return (
    <>
      {state !== "idle" && (
        <Framed border="#8f7dff" bg="#1d1133" n={8} b={3} className="!absolute bottom-[222px] right-6 z-30 w-[420px] p-5">
          {state === "listening" ? (
            <>
              <div className="flex items-center justify-between">
                <p className={`${press} text-[20px] text-[#c9bfff]`}>LISTENING…</p>
                <div className="flex h-[36px] items-end gap-[5px]">
                  {Array.from({ length: 7 }, (_, i) => (
                    <span key={i} className="va-eq h-[20px] w-[7px] bg-[#43f0a0]" style={{ animationDelay: `${i * 0.11}s` }} />
                  ))}
                </div>
              </div>
              <p className="mt-3 text-[22px] leading-snug text-[#cbb8e0]">
                “Jo bought cat food and Sam took the bins out”
              </p>
              <p className={`${silk} mt-3 text-[12px] tracking-[0.15em] text-[#7d6a98]`}>TAP BAUMY AGAIN WHEN DONE</p>
            </>
          ) : (
            <>
              <p className={`${press} text-[16px] text-[#43f0a0]`}>BAUMY HEARD YOU</p>
              <ul className="mt-3 space-y-2 text-[22px] leading-tight">
                <li className="flex items-center gap-3">
                  <Icon name="catfood" scale={2} /> Cat food bought by <b style={{ color: who("jo").color }}>Jo</b>
                  <span className={`${press} ml-auto text-[12px] text-[#ffe46b]`}>+20</span>
                </li>
                <li className="flex items-center gap-3">
                  <Icon name="bin" scale={2} /> Bins out by <b style={{ color: who("sam").color }}>Sam</b>
                  <span className={`${press} ml-auto text-[12px] text-[#ffe46b]`}>+20</span>
                </li>
              </ul>
              <p className={`${silk} mt-3 text-[12px] tracking-[0.15em] text-[#7d6a98]`}>STEALS RYAN’S 6× BINS STREAK!</p>
            </>
          )}
        </Framed>
      )}
      <button
        type="button"
        onClick={onPress}
        className="absolute bottom-[94px] right-5 z-30 flex h-[120px] w-[120px] items-center justify-center rounded-full active:scale-95"
        style={{
          background: state === "listening" ? "radial-gradient(circle at 40% 35%, #43f0a0, #1f9e66)" : "radial-gradient(circle at 40% 35%, #a99cff, #5842d8)",
          boxShadow: "0 0 0 5px #0b0712, 0 0 0 9px #c9bfff, 0 10px 30px rgba(143,125,255,0.55)",
        }}
        aria-label={state === "listening" ? "Stop listening" : "Talk to Baumy"}
      >
        {state === "listening" && (
          <>
            <span className="va-ring absolute inset-0 rounded-full" />
            <span className="va-ring absolute inset-0 rounded-full [animation-delay:.6s]" />
          </>
        )}
        <span className={state === "idle" ? "proto-bob" : ""}>
          <BaumySprite scale={3.2} />
        </span>
        <span
          className="absolute -left-3 -top-2 flex h-[40px] w-[40px] items-center justify-center rounded-full bg-[#0b0712]"
          style={{ boxShadow: "0 0 0 3px #c9bfff" }}
        >
          <Icon name="mic" scale={2} />
        </span>
      </button>
    </>
  );
}

/* ───────────────────────── modal ───────────────────────── */

function BountyModal({ slice, onClose }: { slice: SliceKey; onClose: () => void }) {
  if (slice === "scores") return <ScoresModal onClose={onClose} />;
  const s = SLICES.find((x) => x.key === slice)!;
  const list = BOUNTIES.filter(s.filter).sort((a, b) => a.dueInHours - b.dueInHours);
  return (
    <Backdrop onClose={onClose}>
      <Framed
        border={s.accent}
        bg="#1a0f24"
        className="va-pop w-[740px]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={s.title}
      >
        <div className="flex items-center gap-5 px-7 pb-4 pt-6" style={{ background: `linear-gradient(180deg, ${s.accent}22, transparent)` }}>
          <Icon name={s.icon} scale={4} />
          <div className="flex-1">
            <p className={`${press} text-[26px] leading-none`} style={{ color: s.accent }}>
              {s.title.toUpperCase()}
            </p>
            <p className={`${silk} mt-3 text-[15px] tracking-[0.15em] text-[#a893c4]`}>
              {list.length} ON THE BOUNTY BOARD · TAP ONE TO CLAIM
            </p>
          </div>
          <CloseButton onClose={onClose} />
        </div>
        <ul className="flex flex-col gap-3 px-6 pb-7 pt-2">
          {list.map((b) => {
            const d = due(b.dueInHours);
            const st = b.streak ? who(b.streak.who) : null;
            return (
              <li key={b.id}>
                <button
                  type="button"
                  className="flex min-h-[88px] w-full items-center gap-4 bg-[#241733] px-4 text-left active:translate-y-[2px]"
                  style={{ clipPath: notch(5), boxShadow: b.dueInHours < 0 ? "inset 4px 0 0 #ff4d6d" : undefined }}
                >
                  <span className="flex h-[64px] w-[64px] shrink-0 items-center justify-center bg-[#130a1b]">
                    <Icon name={b.icon as IconName} scale={4} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <span className="truncate text-[28px] leading-none">{b.title}</span>
                      {b.isNew && (
                        <span className={`${press} bg-[#ffe46b] px-[6px] py-[3px] text-[10px] text-[#1b0f14]`}>NEW</span>
                      )}
                      <span className={`${silk} ml-auto shrink-0 px-2 py-1 text-[14px] font-bold tracking-[0.08em]`} style={{ color: d.color, background: d.bg }}>
                        {d.text}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-4">
                      <span className={`${silk} text-[13px] tracking-[0.12em]`} style={{ color: b.taxonomy === "consumables" ? "#4ff5e6" : "#a99cff" }}>
                        {b.taxonomy === "consumables" ? "CONSUMABLE" : "MAINTENANCE"}
                      </span>
                      {st && b.streak && (
                        <span className={`${silk} flex items-center gap-2 whitespace-nowrap text-[13px] tracking-[0.1em] text-[#ffb8e0]`}>
                          <Pip id={b.streak.who} size={9} /> STEAL {st.name.toUpperCase()}’S {b.streak.n}× STREAK
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`${press} w-[92px] shrink-0 text-right text-[20px] text-[#ffe46b]`}>
                    +{b.reward}
                    <span className="block pt-1 text-[10px] text-[#a893c4]">PTS</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Framed>
    </Backdrop>
  );
}

function ScoresModal({ onClose }: { onClose: () => void }) {
  const ranked = [...HOUSEMATES].sort((a, b) => b.points - a.points);
  const top = ranked[0]!.points;
  return (
    <Backdrop onClose={onClose}>
      <Framed
        border="#ffe46b"
        bg="#1a0f24"
        className="va-pop w-[700px]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Leaderboard"
      >
        <div className="flex items-center gap-5 px-7 pb-2 pt-6">
          <Icon name="trophy" scale={5} />
          <p className={`${press} flex-1 text-[26px] text-[#ffe46b]`}>LEADERBOARD</p>
          <CloseButton onClose={onClose} />
        </div>
        <ul className="flex flex-col gap-3 px-6 pb-4 pt-3">
          {ranked.map((h, i) => (
            <li key={h.id} className="flex h-[92px] items-center gap-4 bg-[#241733] px-4" style={{ clipPath: notch(5) }}>
              <span className={`${press} w-[36px] text-[24px] text-[#a893c4]`}>{i + 1}</span>
              <Person hair={h.hair} shirt={h.shirt} scale={4} />
              <div className="flex-1">
                <p className={`${press} text-[20px]`} style={{ color: h.color }}>
                  {h.name}
                </p>
                <div className="mt-3 h-[12px] bg-[#130a1b]">
                  <div className="h-full" style={{ width: `${(h.points / top) * 100}%`, background: h.color }} />
                </div>
              </div>
              <div className="w-[120px] text-right">
                <p className={`${press} text-[20px] text-[#fff0d6]`}>{h.points}</p>
                <p className={`${silk} mt-2 text-[12px] tracking-[0.12em] text-[#ffb347]`}>{h.streak > 0 ? `${h.streak}× STREAK` : "NO STREAK"}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className={`${silk} flex justify-between px-7 pb-6 text-[15px] tracking-[0.14em] text-[#a893c4]`}>
          <span>POT €{POT.euros.toFixed(2)}</span>
          <span>{METRICS.doneThisWeek} DONE THIS WEEK</span>
          <span className="text-[#ff8fa6]">{METRICS.overdue} OVERDUE</span>
        </div>
      </Framed>
    </Backdrop>
  );
}

function Backdrop({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="va-fade absolute inset-0 z-40 flex items-center justify-center bg-[#07040c]/80" onClick={onClose}>
      {children}
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className={`${press} flex h-[60px] w-[60px] shrink-0 items-center justify-center bg-[#2e1f40] text-[24px] text-[#f6ecff] active:translate-y-[2px]`}
      style={{ clipPath: notch(5) }}
      aria-label="Close"
    >
      ×
    </button>
  );
}

/* ───────────────────────── keyframes ───────────────────────── */

const CSS = `
@keyframes va-alarm { 0%,100% { background: #ff4d6d; } 50% { background: #7a1f3d; } }
.va-alarm { animation: va-alarm 1.2s steps(2) infinite; }
@keyframes va-glow { 0%,100% { opacity: 1; transform: translate(-50%,-50%) scale(1); } 50% { opacity: .45; transform: translate(-50%,-50%) scale(.85); } }
.va-glow { animation: va-glow 1.2s steps(3) infinite; }
@keyframes va-rays { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
.va-rays { animation: va-rays .6s steps(1) infinite; }
@keyframes va-wobble { 0%,100% { transform: rotate(0); } 25% { transform: rotate(-6deg); } 75% { transform: rotate(6deg); } }
.va-wobble { animation: va-wobble .6s steps(2) infinite; }
@keyframes va-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
.va-float { animation: va-float 2s steps(2) infinite; }
@keyframes va-spin { to { transform: translate(-50%,-50%) rotate(45deg); } }
.va-spin { animation: va-spin 3s steps(4) infinite; }
@keyframes va-flicker { 0%,100% { transform: scaleY(1); } 50% { transform: scaleY(.9) translateY(2px); } }
.va-flicker { display: inline-block; animation: va-flicker .5s steps(2) infinite; transform-origin: bottom; }
@keyframes va-slide { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
.va-slide { animation: va-slide .35s steps(4); }
@keyframes va-eq { 0%,100% { height: 8px; } 50% { height: 34px; } }
.va-eq { animation: va-eq .7s steps(4) infinite; }
@keyframes va-ring { from { transform: scale(1); opacity: .9; box-shadow: 0 0 0 4px #43f0a0; } to { transform: scale(1.6); opacity: 0; box-shadow: 0 0 0 4px #43f0a0; } }
.va-ring { animation: va-ring 1.2s ease-out infinite; }
@keyframes va-pop { from { transform: scale(.9); opacity: 0; } to { transform: none; opacity: 1; } }
.va-pop { animation: va-pop .18s steps(3); }
@keyframes va-fade { from { opacity: 0; } to { opacity: 1; } }
.va-fade { animation: va-fade .15s; }
@keyframes va-flash { 0%,100% { background: transparent; } 50% { background: rgba(255,77,109,.08); } }
.va-siren-flash { animation: va-flash 1s steps(1) infinite; }
@keyframes va-shake { 0%,100% { transform: rotate(-8deg); } 50% { transform: rotate(8deg); } }
.va-shake { animation: va-shake .5s steps(1) infinite; }
@keyframes va-hop { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
.va-hop { animation: va-hop .8s steps(2) infinite; }
@keyframes va-fa { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
@keyframes va-fb { 0%,49% { opacity: 0; } 50%,100% { opacity: 1; } }
.va-frame-a { animation: va-fa .32s steps(1) infinite; }
.va-frame-b { animation: va-fb .32s steps(1) infinite; }
@keyframes va-run1 { from { left: -130px; } to { left: 900px; } }
.va-run1 { animation: va-run1 14s linear infinite; }
@keyframes va-run2 { from { left: 900px; } to { left: -160px; } }
.va-run2 { animation: va-run2 11s linear infinite; animation-delay: -4s; }
@keyframes va-run3 { from { left: -260px; } to { left: 900px; } }
.va-run3 { animation: va-run3 19s linear infinite; animation-delay: -7s; }
@keyframes va-bin { 0%,52% { transform: rotate(0); } 55% { transform: rotate(25deg); } 58%,94% { transform: rotate(90deg); } 100% { transform: rotate(0); } }
.va-bin { animation: va-bin 14s steps(1) infinite; }
@keyframes va-trash { 0%,57% { opacity: 0; } 58%,94% { opacity: 1; } 100% { opacity: 0; } }
.va-trash { animation: va-trash 14s steps(1) infinite; }
@keyframes va-zzz { 0% { transform: translate(0,0); opacity: 0; } 30% { opacity: 1; } 100% { transform: translate(20px,-40px); opacity: 0; } }
.va-zzz { animation: va-zzz 3s steps(6) infinite; }
@keyframes va-breathe { 0%,100% { opacity: .9; } 50% { opacity: .35; } }
.va-breathe { animation: va-breathe 3s ease-in-out infinite; }
`;
