"use client";

// PROTOTYPE (issue #7), throwaway. The full-screen reminder and the raccoon
// screensaver the owner liked (from the old variant C), shared by every
// calm variant. Their look is unchanged.

import { useState } from "react";
import { BaumySprite, BlinkingBaumy } from "./baumy-sprite";
import { HOUSEMATES, REMINDER } from "./data";
import { bevel, C, font, Win } from "./overlay-chrome";
import { Glyph, Person, Px, Raccoon } from "./pixels";

const pad = (n: number) => String(n).padStart(2, "0");
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// ---------------------------------------------------------------- reminder
export function Reminder({ onClose }: { onClose: () => void }) {
  const [seen, setSeen] = useState<Set<string>>(new Set(REMINDER.seenBy));
  const confirm = (id: string) => {
    setSeen((s) => {
      const n = new Set(s);
      n.add(id);
      if (n.size === HOUSEMATES.length) window.setTimeout(onClose, 700);
      return n;
    });
  };
  return (
    <div
      className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 p-8"
      data-reminder
      style={{
        background: `radial-gradient(circle at 50% 30%, #5a1838 0%, ${C.wineDk} 45%, #12060d 100%)`,
      }}
    >
      {/* hazard frame */}
      <div
        className="pointer-events-none absolute inset-3"
        style={{
          border: "10px solid transparent",
          borderImage: `repeating-linear-gradient(45deg, ${C.amber} 0 14px, ${C.ink} 14px 28px) 10`,
        }}
      />
      <div className="flex items-center gap-4">
        <span className="vc-blink">
          <Glyph name="alarm" size={56} color={C.red} />
        </span>
        <span className={`${font.press} text-[52px]`} style={{ color: C.amber, textShadow: `4px 4px 0 ${C.lo}, 0 0 24px ${C.amber}88` }}>
          REMINDER
        </span>
        <span className="vc-blink">
          <Glyph name="alarm" size={56} color={C.red} />
        </span>
      </div>
      <div className="w-full max-w-[720px]">
        <Win title="notice.txt — from ryan" glyph="pin" led={C.red}>
          <div className="p-5">
            <div className={`${font.press} text-[26px] leading-snug`} style={{ color: C.text }}>
              {REMINDER.title}
            </div>
            <p className={`${font.pix} mt-3 text-[26px] leading-snug`} style={{ color: C.amberLt }}>
              {REMINDER.body}
            </p>
          </div>
        </Win>
      </div>
      <div className={`${font.silk} text-[16px] font-bold uppercase`} style={{ color: C.muted }}>
        {seen.size} / {HOUSEMATES.length} have seen it
      </div>
      <div className="grid w-full max-w-[740px] grid-cols-4 gap-4">
        {HOUSEMATES.map((h) => {
          const ok = seen.has(h.id);
          return (
            <div key={h.id} className="flex flex-col items-center gap-3 p-3" style={{ background: ok ? `${h.color}26` : C.panel, ...bevel() }}>
              <div className={`relative ${ok ? "vc-seen" : "vc-bob"}`}>
                <Person id={h.id} hair={h.hair} shirt={h.shirt} scale={7} />
                {ok && (
                  <span className="absolute -right-3 -top-2">
                    <Glyph name="check" size={36} color={C.green} />
                  </span>
                )}
              </div>
              <span className={`${font.press} text-[16px]`} style={{ color: h.color }}>
                {h.name.toUpperCase()}
              </span>
              <button
                type="button"
                data-seen={h.id}
                disabled={ok}
                onClick={() => confirm(h.id)}
                className={`${font.press} h-[72px] w-full text-[14px] leading-tight`}
                style={{
                  background: ok ? C.green : C.amber,
                  color: C.ink,
                  ...bevel(!ok),
                }}
              >
                {ok ? "SEEN ✓" : "I'VE SEEN IT"}
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onClose}
        className={`${font.silk} mt-2 h-[56px] px-6 text-[15px] font-bold uppercase`}
        style={{ background: C.chrome, color: C.muted, ...bevel() }}
      >
        Dismiss for everyone
      </button>
      <div className="absolute bottom-[40px] right-[40px] flex items-end gap-2">
        <div className={`${font.vt} relative mb-16 px-2 py-1 text-[20px]`} style={{ background: C.text, color: C.ink, ...bevel() }}>
          everyone tap your face pls
        </div>
        <BlinkingBaumy scale={4} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- screensaver
const SOCK = ["..KK..", ".KPK..", ".KPK..", ".KPPKK", ".KPWPK", "..KKK."];
const BOX = [
  "KKKKKKKKKKKK",
  "KbbbbTTbbbbK",
  "KbbbbTTbbbbK",
  "KBBBBBBBBBBK",
  "KBBBBBBBBBBK",
  "KBBBBBBBBBBK",
  "KBBBBBBBBBBK",
  "KKKKKKKKKKKK",
];
const BIN = [
  "..KKKKKKKK..",
  "KKKGGGGGGKKK",
  "KGGGGGGGGGGK",
  ".KgKgKKgKgK.",
  ".KgKgKKgKgK.",
  ".KgKgKKgKgK.",
  ".KgKgKKgKgK.",
  ".KgKgKKgKgK.",
  "..KKKKKKKK..",
];
const TRASH = ["..KK.K", ".KYKKW", "KPK.KK"];


export function Screensaver({ now, onWake }: { now: Date; onWake: () => void }) {
  const floor = 840;
  return (
    <div
      className="absolute inset-0 z-[60] overflow-hidden"
      data-screensaver
      onPointerDown={onWake}
      style={{ background: "linear-gradient(180deg, #07040c 0%, #120a1d 60%, #1a0d18 100%)" }}
    >
      {/* window with moon */}
      <div className="absolute left-[70px] top-[140px] h-[220px] w-[180px]" style={{ background: "#0d1430", boxShadow: `0 0 0 6px #241a33, inset 0 0 0 3px #07040c` }}>
        <div className="absolute left-1/2 top-0 h-full w-[6px] -translate-x-1/2" style={{ background: "#241a33" }} />
        <div className="absolute left-0 top-1/2 h-[6px] w-full -translate-y-1/2" style={{ background: "#241a33" }} />
        <div className="absolute left-[104px] top-[22px] size-[40px]" style={{ background: "#fff7c2", boxShadow: "0 0 30px #fff7c2aa", clipPath: "polygon(20% 0,80% 0,100% 20%,100% 80%,80% 100%,20% 100%,0 80%,0 20%)" }} />
        {[
          [22, 30],
          [60, 150],
          [140, 170],
          [30, 90],
        ].map(([x, y], i) => (
          <span key={i} className="vc-bulb absolute block size-[3px]" style={{ left: x, top: y, background: "#fff", animationDelay: `${i * 0.5}s` }} />
        ))}
      </div>
      {/* fairy lights, dim */}
      <div className="absolute left-0 right-0 top-[40px] opacity-60">
        {Array.from({ length: 16 }, (_, i) => (
          <span
            key={i}
            className="vc-bulb absolute block h-[8px] w-[6px]"
            style={{
              left: 20 + i * 51,
              top: Math.sin((i / 15) * Math.PI) * 30,
              background: [C.violet, C.teal, C.pink, C.yellow][i % 4],
              boxShadow: `0 0 10px ${[C.violet, C.teal, C.pink, C.yellow][i % 4]}`,
              animationDelay: `${i * 0.3}s`,
              animationDuration: "3s",
            }}
          />
        ))}
      </div>
      {/* big dim clock */}
      <div className="absolute right-[60px] top-[170px] text-right">
        <div className={`${font.press} text-[84px]`} style={{ color: "#3d2d57", textShadow: "0 0 30px #8f7dff33" }}>
          {hhmm(now)}
        </div>
        <div className={`${font.silk} text-[20px] font-bold uppercase`} style={{ color: "#3d2d57" }}>
          Mon 28 Sep · all quiet
        </div>
      </div>
      {/* shelf with sleeping Baumy */}
      <div className="absolute left-[470px] top-[560px]">
        <div className="relative opacity-70">
          <span className="absolute -top-[40px] right-[-6px]">
            <span className={`${font.press} vc-zzz absolute text-[18px]`} style={{ color: C.violet }}>
              z
            </span>
            <span className={`${font.press} vc-zzz absolute text-[14px]`} style={{ color: C.teal, animationDelay: "1.5s" }}>
              z
            </span>
          </span>
          <BaumySprite scale={4} blink />
        </div>
        <div className="h-[12px] w-[200px] -translate-x-[40px]" style={{ background: "#3a2518", boxShadow: "0 4px 0 #1a0f0a" }} />
      </div>
      {/* floor */}
      <div className="absolute left-0 right-0" style={{ top: floor, bottom: 0, background: "repeating-linear-gradient(90deg, #1d1020 0 80px, #180c1a 80px 160px)", boxShadow: "inset 0 4px 0 #2a1628" }} />
      {/* the bin that gets knocked */}
      <div className="absolute" style={{ left: 380, top: floor - 9 * 6 }}>
        <div style={{ animation: "vc-bin 7s steps(6) infinite", transformOrigin: "100% 100%" }}>
          <Px grid={BIN} scale={6} pal={{ K: "#07040c", G: "#3d4a5c", g: "#2c3645" }} />
        </div>
        <div className="absolute bottom-0 left-[70px]" style={{ animation: "vc-trash 7s steps(8) infinite" }}>
          <Px grid={TRASH} scale={5} pal={{ K: "#07040c", Y: "#8a7a2c", W: "#6f6a80", P: "#7a3a5c" }} />
        </div>
      </div>
      {/* raccoon 1: runs right, knocks the bin */}
      <div className="absolute left-0" style={{ top: floor - 60, animation: "vc-run 7s linear infinite" }}>
        <Raccoon scale={6} />
      </div>
      {/* raccoon 2: carries a sock back left */}
      <div className="absolute left-0" style={{ top: floor + 60, animation: "vc-run-back 9s linear infinite", animationDelay: "-3s" }}>
        <div className="relative">
          <span className="absolute -top-[22px] left-[40px] vc-hop">
            <Px grid={SOCK} scale={5} pal={{ K: "#07040c", P: "#b84a8a", W: "#e8e4f0" }} />
          </span>
          <Raccoon scale={6} flip />
        </div>
      </div>
      {/* raccoon 3: pushes a box */}
      <div className="absolute left-0" style={{ top: floor + 170, animation: "vc-run 14s linear infinite", animationDelay: "-6s" }}>
        <div className="flex items-end">
          <Raccoon scale={6} />
          <span className="-ml-1">
            <Px grid={BOX} scale={6} pal={{ K: "#07040c", B: "#6b4a2a", b: "#8a6238", T: "#c9a46a" }} />
          </span>
        </div>
      </div>
      <div className="absolute bottom-[40px] left-0 right-0 text-center">
        <span className={`${font.press} vc-blink-slow text-[16px]`} style={{ color: "#6f5f8c" }}>
          TAP ANYWHERE TO WAKE
        </span>
      </div>
    </div>
  );
}
