"use client";

// PROTOTYPE (issue #7), throwaway. Variant A's full-screen states: the
// reminder notice (all four housemates confirm "seen") and the night
// screensaver where raccoons mess with the kitchen.

import type React from "react";
import { useEffect, useState } from "react";
import { BaumySprite } from "./baumy-sprite";
import { HOUSEMATES, REMINDER } from "./data";
import { Icon, Person, Raccoon } from "./variant-a-pixels";

const silk = "font-[family-name:var(--font-silk)]";
const press = "font-[family-name:var(--font-press)]";
const vt = "font-[family-name:var(--font-vt)]";
const pixelify = "font-[family-name:var(--font-pixelify)]";

export const notch = (n: number) =>
  `polygon(0 ${n}px, ${n}px ${n}px, ${n}px 0, calc(100% - ${n}px) 0, calc(100% - ${n}px) ${n}px, 100% ${n}px, 100% calc(100% - ${n}px), calc(100% - ${n}px) calc(100% - ${n}px), calc(100% - ${n}px) 100%, ${n}px 100%, ${n}px calc(100% - ${n}px), 0 calc(100% - ${n}px))`;

/** A box with a stepped (notched) pixel border that survives the corners. */
export function Framed({
  border,
  bg,
  n = 10,
  b = 4,
  className = "",
  style,
  children,
  ...rest
}: {
  border: string;
  bg: string;
  n?: number;
  b?: number;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className" | "children">) {
  return (
    <div {...rest} className={`relative ${className}`} style={{ clipPath: notch(n), background: border, ...style }}>
      <div className="pointer-events-none absolute" style={{ inset: b, clipPath: notch(Math.max(2, n - b)), background: bg }} />
      <div className="relative">{children}</div>
    </div>
  );
}

export function ReminderA({ onClose }: { onClose: () => void }) {
  const [seen, setSeen] = useState<string[]>(REMINDER.seenBy);
  const all = seen.length === HOUSEMATES.length;
  useEffect(() => {
    if (!all) return;
    const t = setTimeout(onClose, 1400);
    return () => clearTimeout(t);
  }, [all, onClose]);

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col items-center overflow-hidden bg-[#1a0712] text-[#fff4f8]"
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, rgba(122,31,61,0.35) 0 24px, transparent 24px 48px), radial-gradient(ellipse at 50% 30%, rgba(255,77,109,0.25), transparent 60%)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Reminder"
    >
      <div className="va-siren-flash pointer-events-none absolute inset-0" />
      <div className="mt-16 flex items-center gap-6">
        <span className="va-shake inline-block">
          <Icon name="siren" scale={6} />
        </span>
        <h1 className={`${press} text-[64px] leading-none tracking-tight text-[#ff4d6d] [text-shadow:6px_6px_0_#0b0712]`}>
          REMINDER
        </h1>
        <span className="va-shake inline-block [animation-delay:.15s]">
          <Icon name="siren" scale={6} />
        </span>
      </div>

      <div
        className="mt-12 w-[700px] bg-[#fff0d6] px-10 py-8 text-[#1b0f14]"
        style={{ clipPath: notch(10), boxShadow: "inset 0 -10px 0 #d9b98f" }}
      >
        <p className={`${press} text-[30px] leading-tight`}>{REMINDER.title}</p>
        <p className={`${pixelify} mt-5 text-[30px] leading-snug`}>{REMINDER.body}</p>
      </div>

      <p className={`${silk} mt-12 text-[22px] tracking-[0.2em] text-[#ffb8d2]`}>
        {all ? "EVERYONE HAS SEEN IT!" : `${seen.length} OF 4 HAVE SEEN IT`}
      </p>

      <div className="mt-6 grid w-[740px] grid-cols-4 gap-5">
        {HOUSEMATES.map((h) => {
          const ok = seen.includes(h.id);
          return (
            <div key={h.id} className="flex flex-col items-center">
              <div className={`flex h-[150px] items-end ${ok ? "va-hop" : ""}`}>
                <Person hair={h.hair} shirt={h.shirt} scale={8} cheer={ok} />
              </div>
              <div className="mt-2 h-3 w-24 rounded-[50%] bg-black/50" />
              <p className={`${press} mt-3 text-[20px]`} style={{ color: h.color }}>
                {h.name}
              </p>
              <button
                type="button"
                disabled={ok}
                onClick={() => setSeen((s) => (s.includes(h.id) ? s : [...s, h.id]))}
                className={`${press} mt-4 flex h-[84px] w-full items-center justify-center gap-2 text-[20px] transition-transform active:translate-y-1`}
                style={{
                  clipPath: notch(6),
                  background: ok ? "#1f9e66" : h.color,
                  color: "#0b0712",
                  boxShadow: ok ? "inset 0 0 0 4px #43f0a0" : "inset 0 -8px 0 rgba(0,0,0,0.3)",
                }}
              >
                {ok ? (
                  <>
                    <Icon name="check" scale={3} /> SEEN
                  </>
                ) : (
                  "I SAW IT"
                )}
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onClose}
        className={`${silk} absolute bottom-24 h-[64px] bg-[#3d1227] px-10 text-[22px] tracking-[0.2em] text-[#ffb8d2]`}
        style={{ clipPath: notch(6), boxShadow: "inset 0 -6px 0 rgba(0,0,0,0.35)" }}
      >
        DISMISS FOR NOW
      </button>
    </div>
  );
}

const LIGHTS = ["#8f7dff", "#4ff5e6", "#ff8fc7", "#ffe46b"];

export function ScreensaverA({ onWake }: { onWake: () => void }) {
  const [now, setNow] = useState("23:47");
  useEffect(() => {
    const f = () =>
      setNow(
        new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(
          new Date(),
        ),
      );
    f();
    const t = setInterval(f, 15000);
    return () => clearInterval(t);
  }, []);
  return (
    <button
      type="button"
      onPointerDown={onWake}
      className="absolute inset-0 z-[60] block cursor-pointer overflow-hidden bg-[#07040c] text-left"
      aria-label="Tap to wake"
    >
      {/* back wall */}
      <div
        className="absolute inset-x-0 top-0 h-[760px]"
        style={{ background: "linear-gradient(#0d0716, #1c0a17 70%, #230c1a)" }}
      />
      {/* fairy lights, dimmed */}
      <svg className="absolute left-0 top-6" width="820" height="80" aria-hidden>
        <path d="M0 10 Q 205 70 410 20 T 820 16" stroke="#07040c" strokeWidth="3" fill="none" />
      </svg>
      {Array.from({ length: 14 }, (_, i) => {
        const x = 20 + i * 57;
        const y = 16 + Math.round(Math.sin((i / 13) * Math.PI * 2.1) * 18 + 22);
        return (
          <span
            key={i}
            className="proto-twinkle absolute h-3 w-3"
            style={{
              left: x,
              top: y,
              background: LIGHTS[i % 4],
              boxShadow: `0 0 14px 4px ${LIGHTS[i % 4]}55`,
              opacity: 0.55,
              animationDelay: `${(i % 5) * 0.4}s`,
            }}
          />
        );
      })}
      {/* window with moon */}
      <div
        className="absolute left-[70px] top-[140px] h-[220px] w-[190px] bg-[#131c3a]"
        style={{ boxShadow: "inset 0 0 0 10px #2a1622, inset 0 0 0 14px #07040c" }}
      >
        <div className="absolute left-1/2 top-0 h-full w-[8px] -translate-x-1/2 bg-[#2a1622]" />
        <div className="absolute left-0 top-1/2 h-[8px] w-full -translate-y-1/2 bg-[#2a1622]" />
        <Icon name="moon" scale={5} className="absolute left-[24px] top-[22px] opacity-90" />
        <span className="proto-twinkle absolute left-[130px] top-[40px] h-1 w-1 bg-white" />
        <span className="proto-twinkle absolute left-[150px] top-[150px] h-1 w-1 bg-white [animation-delay:.6s]" />
      </div>

      {/* clock */}
      <div className="absolute right-[70px] top-[150px] text-right">
        <p className={`${press} text-[88px] leading-none text-[#3d2d57]`}>{now}</p>
        <p className={`${silk} mt-4 text-[18px] tracking-[0.2em] text-[#4a3868]`}>SHHH… EVERYONE’S ASLEEP</p>
      </div>

      {/* sleeping Baumy on the counter */}
      <div className="absolute left-[560px] top-[520px]">
        <div className="absolute -top-2 left-[-12px] h-4 w-[200px] bg-[#2a1622]" />
        <BaumySprite scale={5} blink className="relative -top-[146px] opacity-80" />
        <span className={`${press} va-zzz absolute -top-[190px] left-[140px] text-[22px] text-[#8f7dff]`}>z</span>
        <span className={`${press} va-zzz absolute -top-[220px] left-[160px] text-[30px] text-[#8f7dff] [animation-delay:1s]`}>Z</span>
      </div>

      {/* floor */}
      <div
        className="absolute inset-x-0 bottom-0 top-[760px]"
        style={{
          background:
            "repeating-linear-gradient(90deg, #160b1c 0 102px, #120817 102px 106px), linear-gradient(#1a0d1f, #0a0510)",
          backgroundBlendMode: "normal",
        }}
      />

      {/* lane 1: raccoon knocks the bin over */}
      <div className="va-bin absolute left-[470px] top-[690px] origin-bottom-right">
        <Icon name="bin" scale={7} />
      </div>
      <div className="va-trash absolute left-[540px] top-[770px] flex gap-3">
        <span className="h-4 w-5 bg-[#43f0a0]/70" />
        <span className="h-3 w-3 bg-[#ffe46b]/70" />
        <span className="h-4 w-6 bg-[#fff0d6]/60" />
      </div>
      <div className="va-run1 absolute top-[700px]">
        <Raccoon scale={6} />
      </div>

      {/* lane 2: raccoon carries a sock, right to left */}
      <div className="va-run2 absolute top-[860px]">
        <div className="relative -scale-x-100">
          <Raccoon scale={6} />
          <div className="absolute left-[96px] top-[22px] rotate-[70deg]">
            <Icon name="sock" scale={4} />
          </div>
        </div>
      </div>

      {/* lane 3: raccoon pushes a box */}
      <div className="va-run3 absolute top-[990px] flex items-end">
        <Raccoon scale={6} />
        <Icon name="box" scale={6} className="-ml-2" />
      </div>

      <p className={`${silk} va-breathe absolute inset-x-0 bottom-16 text-center text-[24px] tracking-[0.3em] text-[#6b5a86]`}>
        TAP ANYWHERE TO WAKE
      </p>
    </button>
  );
}
