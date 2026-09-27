"use client";

// PROTOTYPE (issue #7), throwaway. Variant B overlays: the bounty board
// pop-up, the full-screen reminder, the raccoon screensaver, listening.

import { useEffect, useState } from "react";
import {
  BANANA,
  BOUNTY_ICONS,
  BOX,
  BULB,
  CRATE,
  Housemate,
  LANTERN,
  MOON,
  Pix,
  RACCOON_A,
  RACCOON_B,
  SOCK,
  TOOLBOX,
} from "./variant-b-art";
import { BaumySprite } from "./baumy-sprite";
import { BOUNTIES, HOUSEMATES, REMINDER, isUrgent, type Bounty } from "./data";
import { Drape, F, dither, dueText, mate, whoName } from "./variant-b-bits";

export type Slice = "all" | "new" | "urgent" | "consumables" | "maintenance";

export const SLICES: { key: Slice; label: string; icon: string[]; test: (b: Bounty) => boolean }[] = [
  { key: "new", label: "New", icon: BULB, test: (b) => b.isNew },
  { key: "urgent", label: "Urgent", icon: LANTERN, test: isUrgent },
  { key: "consumables", label: "Shop", icon: CRATE, test: (b) => b.taxonomy === "consumables" },
  { key: "maintenance", label: "Fix", icon: TOOLBOX, test: (b) => b.taxonomy === "maintenance" },
  { key: "all", label: "All", icon: BOUNTY_ICONS.tp!, test: () => true },
];

const SLICE_TITLE: Record<Slice, string> = {
  all: "THE WHOLE BOARD",
  new: "NEW BOUNTIES",
  urgent: "URGENT BOUNTIES",
  consumables: "CONSUMABLES · TO BUY",
  maintenance: "MAINTENANCE · TO DO",
};

/* ---------------- bounty board pop-up ---------------- */

export function BountyBoard({ slice, onSlice, onClose }: { slice: Slice; onSlice: (s: Slice) => void; onClose: () => void }) {
  const s = SLICES.find((x) => x.key === slice)!;
  const list = BOUNTIES.filter(s.test).sort((a, b) => a.dueInHours - b.dueInHours);
  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center pt-[70px]" role="dialog" aria-label="Bounty board">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-[#06030bdd]" />
      <div className="vb-pop relative w-[740px] rounded-[4px] bg-[#5e3a24] p-[14px]" style={{ boxShadow: "0 0 0 4px #0b0712, inset 0 0 0 4px #8a5a3b, 0 14px 0 4px #00000080" }}>
        {/* wood grain */}
        <div className="pointer-events-none absolute inset-[8px] opacity-40" style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent 0 22px, #3d2416 22px 24px)" }} />
        {/* header tag */}
        <div className="relative flex items-center gap-4 rounded-[2px] bg-[#fff1d0] px-4 py-3" style={{ boxShadow: "0 0 0 3px #0b0712, 4px 4px 0 3px #00000060" }}>
          <Pix rows={s.icon} scale={5} />
          <div className="flex-1">
            <div className={`${F.silk} text-[13px] tracking-widest text-[#8a5a3b]`}>BOUNTY BOARD</div>
            <div className={`${F.press} mt-1 text-[22px] leading-tight text-[#1a0f26]`}>{SLICE_TITLE[slice]}</div>
          </div>
          <div className={`${F.press} text-[40px] text-[#b8487f]`}>{list.length}</div>
          <button type="button" onClick={onClose} aria-label="Close bounty board" className={`${F.press} ml-2 grid size-[64px] place-items-center bg-[#ff4d5e] text-[28px] text-[#1a0f26] active:translate-y-[2px]`} style={{ boxShadow: "0 0 0 3px #0b0712, 0 5px 0 3px #0b0712" }}>
            ×
          </button>
        </div>

        {/* filter chips */}
        <div className="relative mt-4 flex gap-2">
          {SLICES.map((x) => {
            const n = BOUNTIES.filter(x.test).length;
            const on = x.key === slice;
            return (
              <button key={x.key} type="button" onClick={() => onSlice(x.key)} className={`${F.silk} flex h-[56px] flex-1 items-center justify-center gap-2 text-[15px] ${on ? "bg-[#ffb347] text-[#1a0f26]" : "bg-[#2a1a12] text-[#f4e4c1]"}`} style={{ boxShadow: "0 0 0 3px #0b0712" }}>
                <Pix rows={x.icon} scale={2} />
                {x.label.toUpperCase()} <span className="opacity-70">{n}</span>
              </button>
            );
          })}
        </div>

        {/* bounty cards */}
        <ul className="relative mt-4 flex flex-col gap-3">
          {list.map((b, i) => {
            const due = dueText(b);
            const holder = b.streak ? mate(b.streak.who) : null;
            return (
              <li key={b.id} className="relative flex items-center gap-4 bg-[#fff7e6] px-4 py-2" style={{ boxShadow: "0 0 0 3px #0b0712, 3px 4px 0 3px #00000055", transform: `rotate(${i % 2 ? 0.4 : -0.4}deg)` }}>
                <span className="absolute -top-[7px] left-1/2 size-[12px] rounded-full bg-[#ff4d5e]" style={{ boxShadow: "0 0 0 2px #0b0712" }} />
                <div className="grid size-[64px] shrink-0 place-items-center bg-[#1a0f26]" style={{ boxShadow: "inset 0 0 0 3px #3d2d57" }}>
                  <Pix rows={BOUNTY_ICONS[b.icon] ?? BOUNTY_ICONS.tp!} scale={4} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`${F.vt} truncate text-[34px] leading-none text-[#1a0f26]`}>{b.title}</span>
                    {b.isNew && <span className={`${F.silk} bg-[#ffe46b] px-1.5 text-[12px] text-[#1a0f26]`} style={{ boxShadow: "0 0 0 2px #0b0712" }}>NEW</span>}
                  </div>
                  <div className={`${F.silk} mt-1 flex items-center gap-3 text-[13px]`}>
                    <span className={b.taxonomy === "consumables" ? "text-[#1f9e96]" : "text-[#9e1f35]"}>{b.taxonomy === "consumables" ? "▣ CONSUMABLE" : "✚ MAINTENANCE"}</span>
                    <span className="px-1.5 text-[#1a0f26]" style={{ background: due.color }}>{due.text}</span>
                  </div>
                  <div className={`${F.vt} mt-0.5 flex items-center gap-2 text-[20px] leading-none text-[#5e3a24]`}>
                    {holder ? (
                      <>
                        <Housemate id={holder.id} hair={holder.hair} shirt={holder.shirt} face scale={2} />
                        steal {holder.name}&apos;s {b.streak!.n}× streak for a bonus
                      </>
                    ) : (
                      <span className="opacity-70">no streak on it yet: start one</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end">
                  <span className={`${F.press} text-[26px] text-[#c9642a]`}>+{b.reward}</span>
                  <span className={`${F.silk} text-[12px] text-[#5e3a24]`}>POINTS</span>
                </div>
                <button type="button" className={`${F.silk} ml-1 h-[56px] shrink-0 bg-[#43f0a0] px-3 text-[15px] text-[#1a0f26] active:translate-y-[2px]`} style={{ boxShadow: "0 0 0 3px #0b0712, 0 4px 0 3px #0b0712" }}>
                  CLAIM
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* ---------------- full-screen reminder ---------------- */

export function Reminder({ onClose }: { onClose: () => void }) {
  const [seen, setSeen] = useState<string[]>(REMINDER.seenBy);
  useEffect(() => {
    if (seen.length === HOUSEMATES.length) {
      const t = setTimeout(onClose, 900);
      return () => clearTimeout(t);
    }
  }, [seen, onClose]);
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center bg-[#12091c]" role="dialog" aria-label="Reminder">
      <div className="absolute inset-0 opacity-60" style={dither("#3a0f26", 4)} />
      <div className="absolute inset-x-0 top-0 h-[520px]" style={{ background: "radial-gradient(ellipse 60% 70% at 50% 18%, #ffb34740, transparent 70%)" }} />
      <Drape className="relative" />
      <div className="relative mt-4 flex flex-col items-center">
        <div className="vb-flare">
          <Pix rows={LANTERN} scale={10} />
        </div>
        <div className={`${F.press} mt-5 text-[60px] tracking-wider text-[#ffb347]`} style={{ textShadow: "4px 4px 0 #9e1f35, 0 0 30px #ffb34780" }}>
          REMINDER
        </div>
        <div className="mt-6 bg-[#fff1d0] px-6 py-2 -rotate-1" style={{ boxShadow: "0 0 0 4px #0b0712, 6px 6px 0 4px #00000070" }}>
          <div className={`${F.vt} text-[56px] leading-none text-[#1a0f26]`}>{REMINDER.title}</div>
        </div>
        <p className={`${F.vt} mt-6 max-w-[660px] text-center text-[32px] leading-[1.1] text-[#f4e4c1]`}>{REMINDER.body}</p>
      </div>

      <div className="relative mt-auto mb-[40px] w-full px-8">
        <div className={`${F.silk} mb-4 text-center text-[18px] tracking-widest text-[#c9a7ff]`}>
          {seen.length} / {HOUSEMATES.length} HAVE SEEN IT
        </div>
        <div className="grid grid-cols-4 gap-5">
          {HOUSEMATES.map((h) => {
            const ok = seen.includes(h.id);
            return (
              <div key={h.id} className="flex flex-col items-center">
                <div className="relative grid h-[210px] w-full place-items-end justify-center pb-2" style={{ background: ok ? `radial-gradient(circle at 50% 70%, ${h.color}40, transparent 70%)` : undefined }}>
                  <div className={ok ? "vb-hop" : "opacity-80"}>
                    <Housemate id={h.id} hair={h.hair} shirt={h.shirt} scale={11} />
                  </div>
                  {ok && (
                    <span className={`${F.press} absolute right-3 top-2 grid size-[40px] place-items-center bg-[#43f0a0] text-[20px] text-[#0b0712]`} style={{ boxShadow: "0 0 0 3px #0b0712" }}>
                      ✓
                    </span>
                  )}
                </div>
                <div className={`${F.press} mt-2 text-[18px]`} style={{ color: h.color }}>{h.name.toUpperCase()}</div>
                <button
                  type="button"
                  disabled={ok}
                  onClick={() => setSeen((s) => [...s, h.id])}
                  className={`${F.press} mt-3 h-[84px] w-full text-[18px] active:translate-y-[3px] ${ok ? "bg-[#1f3a30] text-[#43f0a0]" : "text-[#0b0712]"}`}
                  style={{ background: ok ? undefined : h.color, boxShadow: `0 0 0 4px #0b0712, 0 ${ok ? 2 : 7}px 0 4px #0b0712` }}
                >
                  {ok ? "SEEN ✓" : "I'VE SEEN IT"}
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-8 flex justify-center">
          <button type="button" onClick={onClose} className={`${F.silk} h-[60px] px-8 text-[18px] text-[#8d7fae]`} style={{ boxShadow: "0 0 0 3px #3d2d57" }}>
            DISMISS FOR EVERYONE
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- raccoon screensaver ---------------- */

function Walker({ scale = 6, flip = false, speed = "0.36s" }: { scale?: number; flip?: boolean; speed?: string }) {
  return (
    <span className="relative inline-block" style={{ transform: flip ? "scaleX(-1)" : undefined }}>
      <Pix rows={RACCOON_A} scale={scale} className="vb-frame-a" style={{ animationDuration: speed }} />
      <Pix rows={RACCOON_B} scale={scale} className="vb-frame-b absolute inset-0" style={{ animationDuration: speed }} />
    </span>
  );
}

const STARS = Array.from({ length: 26 }, (_, i) => ({ x: (i * 137) % 800, y: (i * 71) % 300, d: (i % 5) * 0.4 }));

export function Screensaver({ onWake }: { onWake: () => void }) {
  return (
    <button type="button" onClick={onWake} aria-label="Wake up" className="absolute inset-0 z-[60] block cursor-default overflow-hidden bg-[#05030a] text-left">
      {/* night wall */}
      <div className="absolute inset-x-0 top-0 h-[900px] opacity-50" style={{ ...dither("#1a0714", 4), backgroundColor: "#0a0512" }} />
      {/* window */}
      <div className="absolute left-[500px] top-[120px] h-[260px] w-[220px] bg-[#0d1030]" style={{ boxShadow: "0 0 0 8px #1a0f26, 0 0 0 12px #0b0712" }}>
        {STARS.filter((s) => s.x < 210 && s.y < 250).map((s, i) => (
          <span key={i} className="proto-twinkle absolute size-[4px] bg-[#c9a7ff]" style={{ left: s.x, top: s.y, animationDelay: `${s.d}s` }} />
        ))}
        <Pix rows={MOON} scale={8} className="absolute left-[120px] top-[30px] opacity-90" />
        <div className="absolute inset-y-0 left-1/2 w-[8px] -translate-x-1/2 bg-[#1a0f26]" />
        <div className="absolute inset-x-0 top-1/2 h-[8px] -translate-y-1/2 bg-[#1a0f26]" />
      </div>
      {/* dim lantern */}
      <div className="absolute left-[120px] top-[60px] flex flex-col items-center opacity-60">
        <div className="h-[60px] w-[3px] bg-[#34304a]" />
        <Pix rows={LANTERN} scale={6} className="vb-dim-lantern" />
        <div className="absolute top-[80px] size-[260px] rounded-full" style={{ background: "radial-gradient(circle, #ffb34722, transparent 65%)" }} />
      </div>
      {/* clock */}
      <div className="absolute inset-x-0 top-[440px] text-center">
        <div className={`${F.vt} text-[150px] leading-none text-[#3d2d57]`}>02:17</div>
        <div className={`${F.silk} text-[18px] tracking-[0.3em] text-[#34304a]`}>TUE 29 SEP · ALL QUIET</div>
      </div>
      {/* sofa silhouette */}
      <div className="absolute bottom-[280px] left-[40px] h-[120px] w-[330px] bg-[#140a1f]" style={{ boxShadow: "0 -30px 0 -10px #140a1f" }} />
      {/* floor */}
      <div className="absolute inset-x-0 bottom-0 h-[280px] bg-[#0c0714]" style={{ boxShadow: "0 -4px 0 #1a0f26" }} />
      {/* the bin that gets knocked over */}
      <div className="absolute bottom-[280px] left-[600px] origin-bottom-right vb-bin">
        <Pix rows={BOUNTY_ICONS.bin!} scale={8} style={{ filter: "brightness(.55)" }} />
      </div>
      <Pix rows={BANANA} scale={6} className="vb-spill absolute bottom-[272px] left-[470px]" />
      <Pix rows={BOUNTY_ICONS.catfood!} scale={4} className="vb-spill absolute bottom-[266px] left-[540px] rotate-90 brightness-50" />
      {/* raccoon 1 pushes a box along the floor */}
      <div className="vb-run-r absolute bottom-[180px] flex items-end">
        <Walker scale={6} />
        <Pix rows={BOX} scale={7} className="-ml-1" style={{ filter: "brightness(.7)" }} />
      </div>
      {/* raccoon 2 runs along the sofa back with a sock */}
      <div className="vb-run-l absolute bottom-[396px] flex items-end">
        <span className="relative">
          <Pix rows={SOCK} scale={5} className="absolute -left-[22px] top-[26px] -rotate-12" />
          <Walker scale={4} flip speed="0.24s" />
        </span>
      </div>
      {/* raccoon 3 raids the bin */}
      <div className="vb-raid absolute bottom-[280px]">
        <Walker scale={5} flip speed="0.3s" />
      </div>
      {/* sleepy Baumy on the sofa, eyes shut */}
      <div className="absolute bottom-[392px] left-[210px] opacity-70">
        <BaumySprite scale={3} blink />
        <span className={`${F.press} vb-z absolute -right-6 -top-4 text-[16px] text-[#8f7dff]`}>z</span>
      </div>
      <div className={`${F.silk} proto-twinkle absolute inset-x-0 bottom-[70px] text-center text-[20px] tracking-[0.3em] text-[#5842d8]`} style={{ animationDuration: "3s" }}>
        TAP ANYWHERE TO WAKE
      </div>
    </button>
  );
}

/* ---------------- listening ---------------- */

export function Listening({ onStop }: { onStop: () => void }) {
  return (
    <div className="absolute inset-0 z-30" role="dialog" aria-label="Baumy is listening">
      <button type="button" aria-label="Stop listening" onClick={onStop} className="absolute inset-0 bg-[#06030bcc]" />
      <div className="vb-pop absolute bottom-[190px] left-1/2 w-[560px] -translate-x-1/2 bg-[#fff1d0] px-8 py-6 text-center" style={{ boxShadow: "0 0 0 4px #0b0712, 6px 8px 0 4px #00000080" }}>
        <div className={`${F.press} text-[30px] text-[#b8487f]`}>LISTENING…</div>
        <div className="mt-5 flex h-[70px] items-end justify-center gap-[6px]">
          {Array.from({ length: 15 }, (_, i) => (
            <span key={i} className="vb-eq w-[16px]" style={{ background: ["#8f7dff", "#4ff5e6", "#ff8fc7", "#ffe46b"][i % 4], animationDelay: `${(i * 0.09) % 0.6}s`, boxShadow: "0 0 0 2px #0b0712" }} />
          ))}
        </div>
        <p className={`${F.vt} mt-4 text-[26px] leading-tight text-[#3d2d57]`}>
          Try: &ldquo;I bought cat food&rdquo; or &ldquo;move board games to Thursday&rdquo;
        </p>
        <button type="button" onClick={onStop} className={`${F.press} mt-5 h-[64px] w-full bg-[#ff4d5e] text-[18px] text-[#0b0712] active:translate-y-[2px]`} style={{ boxShadow: "0 0 0 3px #0b0712, 0 5px 0 3px #0b0712" }}>
          ■ DONE TALKING
        </button>
        {/* bubble tail */}
        <span className="absolute -bottom-[26px] left-1/2 h-[26px] w-[30px] -translate-x-1/2 bg-[#fff1d0]" style={{ clipPath: "polygon(0 0,100% 0,50% 100%)" }} />
      </div>
    </div>
  );
}

export const VB_KEYFRAMES = `
@keyframes vb-sway { 0%,100% { transform: rotate(-2.5deg); } 50% { transform: rotate(2.5deg); } }
.vb-sway { animation: vb-sway 3.2s steps(4) infinite; transform-origin: 50% 0; }
@keyframes vb-flare { 0%,100% { filter: drop-shadow(0 0 10px #ffb347) brightness(1); } 50% { filter: drop-shadow(0 0 22px #ff4d5e) brightness(1.25); } }
.vb-flare { animation: vb-flare 1s steps(2) infinite; }
@keyframes vb-glow { 0%,100% { opacity: .9; transform: scale(1); } 50% { opacity: .45; transform: scale(.85); } }
.vb-glow { animation: vb-glow 1.4s steps(3) infinite; }
@keyframes vb-pop { from { transform: translateY(24px) scale(.96); opacity: 0; } to { transform: none; opacity: 1; } }
.vb-pop { animation: vb-pop .18s steps(3) both; }
@keyframes vb-hop { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
.vb-hop { animation: vb-hop .8s steps(2) infinite; }
@keyframes vb-fa { 0%,49.9% { opacity: 1; } 50%,100% { opacity: 0; } }
@keyframes vb-fb { 0%,49.9% { opacity: 0; } 50%,100% { opacity: 1; } }
.vb-frame-a { animation: vb-fa .36s steps(1) infinite; display: block; }
.vb-frame-b { animation: vb-fb .36s steps(1) infinite; }
@keyframes vb-run-r { from { transform: translateX(-260px); } to { transform: translateX(900px); } }
.vb-run-r { animation: vb-run-r 14s linear infinite; left: 0; }
@keyframes vb-run-l { from { transform: translateX(900px); } to { transform: translateX(-200px); } }
.vb-run-l { animation: vb-run-l 9s linear infinite -2s; left: 0; }
@keyframes vb-raid { 0% { transform: translateX(900px); } 35%,62% { transform: translateX(690px); } 100% { transform: translateX(-160px); } }
.vb-raid { animation: vb-raid 12s linear infinite; left: 0; }
@keyframes vb-bin { 0%,36% { transform: rotate(0); } 40%,94% { transform: rotate(-78deg); } 100% { transform: rotate(0); } }
.vb-bin { animation: vb-bin 12s steps(1) infinite; }
@keyframes vb-spill { 0%,38% { opacity: 0; } 42%,94% { opacity: 1; } 100% { opacity: 0; } }
.vb-spill { animation: vb-spill 12s steps(1) infinite; }
@keyframes vb-z { 0% { transform: translate(0,0); opacity: 0; } 30% { opacity: 1; } 100% { transform: translate(14px,-30px); opacity: 0; } }
.vb-z { animation: vb-z 2.4s steps(6) infinite; }
@keyframes vb-eq { 0%,100% { height: 14px; } 25% { height: 64px; } 50% { height: 30px; } 75% { height: 52px; } }
.vb-eq { animation: vb-eq .7s steps(4) infinite; }
@keyframes vb-ring { 0% { transform: scale(.8); opacity: .9; } 100% { transform: scale(1.35); opacity: 0; } }
.vb-ring { animation: vb-ring 1.6s steps(5) infinite; }
@keyframes vb-dim { 0%,100% { opacity: .8; } 50% { opacity: .55; } }
.vb-dim-lantern { animation: vb-dim 3s steps(2) infinite; }
`;
