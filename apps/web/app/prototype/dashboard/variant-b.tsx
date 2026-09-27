"use client";

// PROTOTYPE (issue #7), throwaway. Variant B "Lounge": the Baumy picture's
// lounge brought to life. Status props hang from a string of fairy lights,
// the week is a lamp-lit grid, Baumy peeks up from the footer to listen.

import { useCallback, useEffect, useRef, useState } from "react";
import { BlinkingBaumy } from "./baumy-sprite";
import { BOUNTIES, HOUSEMATES, LAST_EVENT, MESSAGES, METRICS, POT, WEEK, isUrgent } from "./data";
import { BULB, BULB_OFF, COIN_JAR, CRATE, CROWN, Housemate, LANTERN, NAV_ICONS, Pix, TODAY_LAMP, TOOLBOX } from "./variant-b-art";
import { Drape, F, HOUSE_COLOR, dither, whoColor, whoName } from "./variant-b-bits";
import { BountyBoard, Listening, Reminder, Screensaver, VB_KEYFRAMES, type Slice } from "./variant-b-overlays";

const NOW = "08:42";
const DAYS = [
  { d: "MON", n: 28 },
  { d: "TUE", n: 29 },
  { d: "WED", n: 30 },
  { d: "THU", n: 1 },
  { d: "FRI", n: 2 },
  { d: "SAT", n: 3 },
  { d: "SUN", n: 4 },
];
const LIGHTS = ["#8f7dff", "#4ff5e6", "#ff8fc7", "#ffe46b"];

/* ---------------- fairy-light string with hanging ornaments ---------------- */

const ANCHOR_Y = 58;
const SAG_Y = 128; // control point: droop reaches (ANCHOR_Y + SAG_Y) / 2
const SEG = 205;

function wirePoint(seg: number, t: number) {
  const x0 = seg * SEG;
  const x = x0 + t * SEG;
  const y = (1 - t) * (1 - t) * ANCHOR_Y + 2 * (1 - t) * t * SAG_Y + t * t * ANCHOR_Y;
  return { x, y };
}

function FairyString() {
  const d = Array.from({ length: 4 }, (_, i) => `M${i * SEG} ${ANCHOR_Y} Q${i * SEG + SEG / 2} ${SAG_Y} ${(i + 1) * SEG} ${ANCHOR_Y}`).join(" ");
  const bulbs: { x: number; y: number; c: string; delay: number }[] = [];
  let k = 0;
  for (let s = 0; s < 4; s++)
    for (const t of [0.1, 0.24, 0.38, 0.62, 0.76, 0.9]) {
      const p = wirePoint(s, t);
      bulbs.push({ ...p, c: LIGHTS[k % 4]!, delay: (k * 0.37) % 1.2 });
      k++;
    }
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[120px]">
      <svg width={820} height={120} className="absolute inset-0" aria-hidden>
        <path d={d} stroke="#07040c" strokeWidth={3} fill="none" />
        <path d={d} stroke="#3d2d57" strokeWidth={1} fill="none" transform="translate(0,-1)" />
      </svg>
      {bulbs.map((b, i) => (
        <span key={i} className="absolute" style={{ left: b.x - 5, top: b.y - 1 }}>
          <span className="absolute left-[2px] top-0 h-[4px] w-[6px] bg-[#1a1224]" />
          <span className="proto-twinkle absolute left-0 top-[4px] h-[12px] w-[10px]" style={{ background: b.c, boxShadow: `0 0 14px 4px ${b.c}90`, animationDelay: `${b.delay}s` }} />
        </span>
      ))}
    </div>
  );
}

type Orn = {
  slice: Slice;
  icon: string[];
  label: string;
  count: number;
  sub: string | null;
  string: number;
  paper: string;
  ink: string;
  countColor: string;
  glow: string | null;
  tilt: number;
  delay: string;
  flare?: boolean;
};

function Ornament({ o, x, onOpen }: { o: Orn; x: number; onOpen: (s: Slice) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(o.slice)}
      aria-label={`${o.count} ${o.label} bounties`}
      className="absolute top-[92px] flex w-[190px] flex-col items-center active:scale-[.97]"
      style={{ left: x - 95 }}
    >
      <div className="vb-sway flex flex-col items-center" style={{ animationDelay: o.delay }}>
        <div className="w-[3px] bg-[#07040c]" style={{ height: o.string }} />
        <div className="relative">
          {o.glow && <div className="vb-glow absolute left-1/2 top-1/2 size-[150px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: `radial-gradient(circle, ${o.glow}88, ${o.glow}22 45%, transparent 70%)` }} />}
          <div className={`relative ${o.flare ? "vb-flare" : ""}`}>
            <Pix rows={o.icon} scale={7} />
          </div>
        </div>
        {/* tag on a string */}
        <div className="h-[8px] w-[2px] bg-[#f4e4c1]" />
        <div
          className="relative flex min-w-[150px] flex-col items-center px-3 pb-2 pt-3"
          style={{ background: o.paper, transform: `rotate(${o.tilt}deg)`, boxShadow: "0 0 0 3px #0b0712, 4px 5px 0 3px #00000070", clipPath: "polygon(12px 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%, 0 12px)" }}
        >
          <span className="absolute left-1/2 top-[3px] size-[6px] -translate-x-1/2 rounded-full bg-[#0b0712]" />
          <div className="flex items-baseline gap-2">
            <span className={`${F.press} text-[38px] leading-none`} style={{ color: o.countColor }}>{o.count}</span>
            <span className={`${F.silk} text-[17px] font-bold leading-none`} style={{ color: o.ink }}>{o.label.toUpperCase()}</span>
          </div>
          <div className={`${F.silk} mt-1.5 h-[14px] text-[12px] leading-none`} style={{ color: o.ink, opacity: 0.85 }}>{o.sub ?? " "}</div>
        </div>
      </div>
    </button>
  );
}

/* ---------------- calendar ---------------- */

function Calendar() {
  return (
    <section className="absolute left-[16px] top-[372px] h-[462px] w-[788px] bg-[#170d22]" style={{ boxShadow: "0 0 0 3px #3d2d57, 0 0 0 6px #0b0712, 0 10px 0 6px #00000070" }}>
      <header className="flex h-[46px] items-center gap-3 px-4">
        <span className={`${F.press} text-[16px] text-[#f4e4c1]`}>THIS WEEK</span>
        <span className="flex items-center gap-3">
          {[...HOUSEMATES.map((h) => ({ n: h.name, c: h.color })), { n: "House", c: HOUSE_COLOR }].map((h) => (
            <span key={h.n} className={`${F.silk} flex items-center gap-1 text-[12px] text-[#c9b8e0]`}>
              <span className="size-[10px]" style={{ background: h.c, boxShadow: "0 0 0 2px #0b0712" }} />
              {h.n}
            </span>
          ))}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className={`${F.silk} bg-[#43f0a0] px-2 py-1 text-[13px] text-[#0b0712]`} style={{ boxShadow: "0 0 0 2px #0b0712" }}>
            <b>{METRICS.doneThisWeek}</b> DONE
          </span>
          <span className={`${F.silk} bg-[#ffb347] px-2 py-1 text-[13px] text-[#0b0712]`} style={{ boxShadow: "0 0 0 2px #0b0712" }}>
            <b>{METRICS.houseStreakDays}</b> DAY STREAK
          </span>
        </span>
      </header>
      <div className="grid h-[402px] gap-[6px] px-[8px]" style={{ gridTemplateColumns: "1.75fr repeat(6, 1fr)" }}>
        {DAYS.map((day, i) => {
          const today = i === 0;
          const weekend = i >= 5;
          const events = WEEK.filter((e) => e.day === i);
          return (
            <div
              key={day.d}
              className="relative flex flex-col"
              style={{
                background: today
                  ? "radial-gradient(ellipse 120% 60% at 50% 0%, #ffb34766, #ffb34718 60%, #2a1522 100%)"
                  : weekend
                    ? "#1f1230"
                    : "#1b1029",
                boxShadow: today ? "0 0 0 3px #ffb347, 0 0 28px 2px #ffb34755" : "inset 0 0 0 2px #2b1c3d",
              }}
            >
              <div className={`flex items-baseline justify-center gap-1.5 pb-1 pt-2 ${today ? "text-[#ffe46b]" : "text-[#c9b8e0]"}`}>
                {today && <Pix rows={TODAY_LAMP} scale={3} className="mr-1 self-center" />}
                <span className={`${F.silk} ${today ? "text-[20px] font-bold" : "text-[14px]"}`}>{day.d}</span>
                <span className={`${F.press} ${today ? "text-[24px]" : "text-[15px]"}`}>{day.n}</span>
              </div>
              {today && (
                <div className="mx-2 mb-2 flex items-center gap-1">
                  <span className="h-[3px] flex-1 bg-[#4ff5e6]" />
                  <span className={`${F.silk} text-[11px] text-[#4ff5e6]`}>NOW {NOW}</span>
                  <span className="h-[3px] w-3 bg-[#4ff5e6]" />
                </div>
              )}
              <div className={`flex flex-col ${today ? "gap-3 px-2" : "gap-2.5 px-[5px]"} pt-1`}>
                {events.map((e) => {
                  const past = today && e.end < NOW;
                  const c = whoColor(e.who);
                  return (
                    <div
                      key={e.title}
                      className={`relative px-1.5 pb-1.5 pt-1 ${past ? "opacity-45" : ""}`}
                      style={{ background: c, boxShadow: "0 0 0 2px #0b0712, 3px 3px 0 2px #00000080" }}
                    >
                      <span className="absolute -top-[5px] right-2 size-[6px] rounded-full bg-[#0b0712]" style={{ boxShadow: `0 0 0 2px ${c}` }} />
                      <div className={`${F.silk} flex justify-between text-[11px] leading-tight text-[#1a0f26]`}>
                        <span className="font-bold">{e.start}</span>
                        {today && <span>{e.who === "house" ? "HOUSE" : whoName(e.who).toUpperCase()}</span>}
                      </div>
                      <div className={`${F.vt} ${today ? "text-[27px]" : "text-[23px]"} leading-[0.95] text-[#0b0712]`}>{e.title}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- metrics corner + corkboard ---------------- */

function Scores() {
  const max = Math.max(...HOUSEMATES.map((h) => h.points));
  return (
    <section className="absolute left-[16px] top-[856px] flex h-[168px] w-[500px] bg-[#1b1029] px-3 py-2" style={{ boxShadow: "0 0 0 3px #3d2d57, 0 0 0 6px #0b0712" }}>
      <div className="flex flex-1 flex-col justify-between">
        {HOUSEMATES.map((h, i) => (
          <div key={h.id} className="flex items-center gap-2">
            <span className={`${F.press} w-[18px] text-[12px] text-[#8d7fae]`}>{i + 1}</span>
            <span className="relative">
              {i === 0 && <Pix rows={CROWN} scale={3} className="absolute -top-[9px] left-[11px]" />}
              <Housemate id={h.id} hair={h.hair} shirt={h.shirt} face scale={3} />
            </span>
            <span className={`${F.silk} w-[52px] text-[15px] font-bold`} style={{ color: h.color }}>{h.name.toUpperCase()}</span>
            <span className="relative h-[14px] flex-1 bg-[#0b0712]" style={{ boxShadow: "0 0 0 2px #0b0712" }}>
              <span className="absolute inset-y-0 left-0" style={{ width: `${(h.points / max) * 100}%`, background: `repeating-linear-gradient(90deg, ${h.color} 0 8px, ${h.color}aa 8px 10px)` }} />
            </span>
            <span className={`${F.vt} w-[52px] text-right text-[26px] leading-none text-[#f4e4c1]`}>{h.points}</span>
          </div>
        ))}
      </div>
      <div className="ml-3 flex w-[130px] flex-col items-center justify-center" style={{ boxShadow: "inset 3px 0 0 #2b1c3d" }}>
        <Pix rows={COIN_JAR} scale={6} label="Savings pot" />
        <span className={`${F.press} mt-1 text-[14px] text-[#ffe46b]`}>€{POT.euros.toFixed(2)}</span>
        <span className={`${F.silk} text-[11px] text-[#8d7fae]`}>POT · {POT.daysLeft} DAYS</span>
      </div>
    </section>
  );
}

function Corkboard() {
  const pins = ["#ff4d5e", "#4ff5e6", "#ffe46b"];
  return (
    <section className="absolute left-[532px] top-[856px] h-[168px] w-[272px] overflow-hidden bg-[#9a6a42] px-3 py-2" style={{ ...dither("#7c5231", 4), backgroundColor: "#9a6a42", boxShadow: "0 0 0 3px #5e3a24, 0 0 0 6px #0b0712" }}>
      <div className="flex flex-col gap-[7px]">
        {MESSAGES.map((m, i) => (
          <div key={m.text} className="relative bg-[#fff7e6] px-2 py-[3px]" style={{ transform: `rotate(${[-1.2, 0.8, -0.5][i]}deg)`, boxShadow: "0 0 0 2px #0b0712, 2px 3px 0 2px #00000050" }}>
            <span className="absolute -top-[4px] left-[8px] size-[9px] rounded-full" style={{ background: pins[i], boxShadow: "0 0 0 2px #0b0712" }} />
            <div className={`${F.vt} truncate text-[20px] leading-[1.05] text-[#1a0f26]`}>{m.text}</div>
            <div className={`${F.silk} text-[10px] leading-none`} style={{ color: whoColor(m.who) === "#ffe46b" ? "#a37f00" : "#5e3a24" }}>
              — {whoName(m.who).toUpperCase()} · {m.ago}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------- footer ---------------- */

const NAV = [
  { k: "home", l: "Home" },
  { k: "bounties", l: "Bounties" },
  { k: "calendar", l: "Calendar" },
  { k: "board", l: "Board" },
  { k: "shop", l: "Shop" },
  { k: "scores", l: "Scores" },
];

function Footer({ listening, onTalk }: { listening: boolean; onTalk: () => void }) {
  const item = (n: (typeof NAV)[number]) => {
    const on = n.k === "home";
    return (
      <button key={n.k} type="button" className="flex h-[72px] w-[100px] flex-col items-center justify-center gap-1 active:translate-y-[2px]">
        <span className="grid place-items-center p-1" style={on ? { background: "#ffb34733", boxShadow: "0 0 0 2px #ffb347" } : undefined}>
          <Pix rows={NAV_ICONS[n.k]!} scale={3} />
        </span>
        <span className={`${F.silk} text-[11px] ${on ? "text-[#ffe46b]" : "text-[#e6cfa8]"}`}>{n.l.toUpperCase()}</span>
      </button>
    );
  };
  return (
    <footer className="absolute inset-x-0 bottom-0 h-[84px]">
      {/* fabric trim */}
      <div className="absolute inset-x-0 top-0 h-[8px]" style={{ background: "repeating-linear-gradient(90deg, #b8487f 0 12px, #7a2a4f 12px 24px)", boxShadow: "0 -3px 0 #0b0712" }} />
      <div className="absolute inset-x-0 bottom-0 top-[8px] bg-[#5e3a24]" style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent 0 18px, #4a2c1a 18px 20px), repeating-linear-gradient(90deg, transparent 0 136px, #3d2416 136px 139px)" }} />
      <nav className="absolute inset-x-0 bottom-0 top-[8px] flex items-center justify-between px-3">
        <div className="flex">{NAV.slice(0, 3).map(item)}</div>
        <div className="flex">{NAV.slice(3).map(item)}</div>
      </nav>
      {/* Baumy peeks up from the footer edge */}
      <button type="button" onClick={onTalk} aria-label={listening ? "Stop listening" : "Talk to Baumy"} className="absolute bottom-[4px] left-1/2 z-[35] -translate-x-1/2 active:translate-y-[3px]">
        <span className="vb-ring absolute left-1/2 top-[22px] size-[124px] -translate-x-1/2 rounded-full" style={{ boxShadow: `0 0 0 6px ${listening ? "#ff8fc7" : "#ffb347"}` }} />
        <span className="absolute left-1/2 top-[0px] size-[150px] -translate-x-1/2 rounded-full" style={{ background: `radial-gradient(circle, ${listening ? "#ff8fc7" : "#ffb347"}55, transparent 65%)` }} />
        <span className="proto-bob relative block">
          <BlinkingBaumy scale={4} />
        </span>
        <span className={`${F.press} absolute -right-[58px] top-[6px] bg-[#fff1d0] px-2 py-1.5 text-[11px] text-[#1a0f26]`} style={{ boxShadow: "0 0 0 3px #0b0712, 3px 3px 0 3px #00000060", transform: "rotate(6deg)" }}>
          {listening ? "…" : "TALK"}
        </span>
      </button>
    </footer>
  );
}

/* ---------------- root ---------------- */

export function VariantB() {
  const [slice, setSlice] = useState<Slice | null>(null);
  const [reminder, setReminder] = useState(false);
  const [sleeping, setSleeping] = useState(false);
  const [listening, setListening] = useState(false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armIdle = useCallback(() => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => setSleeping(true), 60_000);
  }, []);

  useEffect(() => {
    const onRem = () => setReminder(true);
    const onSave = () => setSleeping(true);
    window.addEventListener("proto:reminder", onRem);
    window.addEventListener("proto:screensaver", onSave);
    window.addEventListener("pointerdown", armIdle);
    armIdle();
    return () => {
      window.removeEventListener("proto:reminder", onRem);
      window.removeEventListener("proto:screensaver", onSave);
      window.removeEventListener("pointerdown", armIdle);
      if (idle.current) clearTimeout(idle.current);
    };
  }, [armIdle]);

  const newN = BOUNTIES.filter((b) => b.isNew).length;
  const urgent = BOUNTIES.filter(isUrgent);
  const cons = BOUNTIES.filter((b) => b.taxonomy === "consumables");
  const maint = BOUNTIES.filter((b) => b.taxonomy === "maintenance");
  const urgentIn = (l: typeof BOUNTIES) => l.filter(isUrgent).length;

  const ornaments: Orn[] = [
    { slice: "new", icon: newN ? BULB : BULB_OFF, label: "New", count: newN, sub: "JUST POSTED", string: 18, paper: "#fff1c9", ink: "#5e3a24", countColor: "#c9642a", glow: newN ? "#ffe46b" : null, tilt: -3, delay: "0s" },
    { slice: "urgent", icon: LANTERN, label: "Urgent", count: urgent.length, sub: `${METRICS.overdue} OVERDUE!`, string: 36, paper: "#ff5d6c", ink: "#1a0f26", countColor: "#fff7e6", glow: "#ff4d5e", tilt: 2, delay: "-.8s", flare: true },
    { slice: "consumables", icon: CRATE, label: "To buy", count: cons.length, sub: `${urgentIn(cons)} URGENT`, string: 24, paper: "#d7f7ef", ink: "#1f5e5a", countColor: "#1f9e96", glow: null, tilt: -2, delay: "-1.6s" },
    { slice: "maintenance", icon: TOOLBOX, label: "To fix", count: maint.length, sub: `${urgentIn(maint)} URGENT`, string: 40, paper: "#f4e4c1", ink: "#5e3a24", countColor: "#9e1f35", glow: null, tilt: 3, delay: "-2.4s" },
  ];

  return (
    <div className="relative h-[1180px] w-[820px] overflow-hidden bg-[#140c1f] text-[#f4e4c1]">
      <style>{VB_KEYFRAMES}</style>
      {/* wine-red wall, dithered into the plum */}
      <div className="absolute inset-x-0 top-0 h-[900px]" style={{ background: "linear-gradient(#4a1230, #3a0f28 40%, #1f0d24 80%, #140c1f)" }} />
      <div className="absolute inset-x-0 top-0 h-[900px] opacity-70" style={{ ...dither("#2a0a1e", 4), maskImage: "linear-gradient(#000 20%, transparent)" }} />
      {/* lamp glows on the wall */}
      <div className="absolute left-[140px] top-[40px] size-[420px] -translate-x-1/2 rounded-full" style={{ background: "radial-gradient(circle, #ffb34722, transparent 65%)" }} />
      <div className="absolute left-[720px] top-[60px] size-[380px] -translate-x-1/2 rounded-full" style={{ background: "radial-gradient(circle, #8f7dff1c, transparent 65%)" }} />

      <FairyString />
      <Drape className="absolute left-0 top-0" />

      {/* date + last event, tucked between the drapes */}
      <div className="absolute left-[16px] top-[46px] flex items-baseline gap-2">
        <span className={`${F.press} text-[15px] text-[#ffe46b]`}>MON 28 SEP</span>
      </div>
      <div className="absolute right-[16px] top-[40px]">
        <span className={`${F.vt} text-[36px] leading-none text-[#f4e4c1]`}>{NOW}</span>
      </div>

      {ornaments.map((o, i) => (
        <Ornament key={o.slice} o={o} x={i * SEG + SEG / 2} onOpen={setSlice} />
      ))}

      {/* last event ribbon */}
      <div className="absolute left-1/2 top-[342px] -translate-x-1/2 -rotate-1">
        <div className={`${F.silk} flex items-center gap-2 whitespace-nowrap bg-[#ff8fc7] px-3 py-1 text-[14px] text-[#1a0f26]`} style={{ boxShadow: "0 0 0 3px #0b0712, 3px 3px 0 3px #00000070" }}>
          <span className="text-[#9e1f35]">★</span> {LAST_EVENT.text} <b className="text-[#5842d8]">+{LAST_EVENT.bonus}</b>
        </div>
      </div>

      <Calendar />
      <Scores />
      <Corkboard />
      <Footer listening={listening} onTalk={() => setListening((v) => !v)} />

      {listening && <Listening onStop={() => setListening(false)} />}
      {slice && <BountyBoard slice={slice} onSlice={setSlice} onClose={() => setSlice(null)} />}
      {reminder && <Reminder onClose={() => setReminder(false)} />}
      {sleeping && (
        <Screensaver
          onWake={() => {
            setSleeping(false);
            armIdle();
          }}
        />
      )}
    </div>
  );
}
